// New glue module (not donor-derived) that wires the adapted Amplify session
// proxy (./amplify-session-proxy.ts) to agent-ui's EXISTING signed
// host-context envelope (./workspace-services.ts). Per
// docs/plans/agent-ui-amplify-auth-proxy-retrofit-2026-07-07.md §4.1
// (strategy A) and the ONE-ENVELOPE INVARIANT: this module mints envelopes
// using the exact same `createSignedTrustedHostContext` signer and encodes
// them with the exact same `encodeTrustedHostContextHeader` already used by
// the embedded-host and dev-smoke paths. It introduces no parallel envelope
// format and no parallel signature-validation logic — downstream validation
// of the minted envelope happens entirely inside the existing
// `resolveWorkspaceRuntime` / `resolveTrustedHostSessionSnapshot` code path
// in workspace-services.ts, unchanged.
//
// The only new cryptographic surface here is a *separate* concern: sealing
// agent-ui's own short-lived login-proxy cookie (which caches the captured
// Amplify session cookie + the last-minted envelope so requests don't need
// to re-authenticate against Amplify on every request). That cookie is
// signed with a distinct secret (SONIK_AGENT_UI_LOGIN_SESSION_SECRET, per
// plan §4.4) and is never itself treated as host-context authority — it only
// ever produces inputs to the existing signer/encoder above.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Cookies } from "@sveltejs/kit";
import {
  createSignedTrustedHostContext,
  encodeTrustedHostContextHeader,
  type WorkspaceTrustedHostContext,
} from "./workspace-services.ts";
import {
  ProductionSessionResolutionError,
  resolveAmplifySessionByCookie,
  signInAndResolveAmplifySession,
  type AmplifySessionAuthEnv,
  type AmplifySignInInput,
  type ProductionSessionResolution,
} from "./amplify-session-proxy.ts";

/** Authority tag for agent-ui-minted envelopes, per plan §5's parity table. */
export const AMPLIFY_LOGIN_PROXY_AUTH_AUTHORITY = "amplify-login-proxy";

export const AMPLIFY_LOGIN_PROXY_COOKIE_NAME = "sonik_agent_ui_login_proxy";
export const AMPLIFY_LOGIN_PROXY_SCOPES = ["workspace-persistence"];

/** Refresh the cached envelope this long before its signed expiresAt. */
const REFRESH_MARGIN_MS = 90 * 1000;

export interface AmplifyLoginProxyEnv extends AmplifySessionAuthEnv {
  SONIK_AGENT_UI_ENABLE_AMPLIFY_LOGIN_PROXY?: string;
  SONIK_AGENT_UI_HOST_CONTEXT_SECRET?: string;
  SONIK_AGENT_UI_LOGIN_SESSION_SECRET?: string;
  [key: string]: unknown;
}

export interface LoginProxySession {
  /** Amplify's captured session cookie; used to silently refresh the envelope. */
  ampCookie: string;
  /** Last-minted, fully signed host-context envelope. */
  context: WorkspaceTrustedHostContext;
}

export class AmplifyLoginProxyError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "AmplifyLoginProxyError";
    this.code = code;
  }
}

export function isAmplifyLoginProxyEnabled(env: Record<string, unknown> | null | undefined): boolean {
  return readEnvString(env, "SONIK_AGENT_UI_ENABLE_AMPLIFY_LOGIN_PROXY") === "true";
}

/**
 * Pure builder for the unsigned host-context shape a login-proxy session
 * mints. Kept separate from signing/network I/O so envelope-field parity
 * (plan §5) can be asserted directly without mocking HTTP calls.
 */
export function buildLoginProxyHostContext(session: ProductionSessionResolution): WorkspaceTrustedHostContext {
  const hostSession = {
    source: "amplify-login-proxy",
    sessionId: `amplify-login-proxy-${session.principalId}`,
    userId: session.principalId,
    principalId: session.principalId,
    organizationId: session.organizationId,
    authenticated: true,
    scopes: AMPLIFY_LOGIN_PROXY_SCOPES,
    expiresAt: null,
    metadata: { authAuthority: AMPLIFY_LOGIN_PROXY_AUTH_AUTHORITY, authUserId: session.authUserId },
  } satisfies NonNullable<WorkspaceTrustedHostContext["hostSession"]>;

  return {
    authenticated: true,
    organizationId: session.organizationId,
    scopes: AMPLIFY_LOGIN_PROXY_SCOPES,
    hostSession,
  };
}

function requireHostContextSecret(env: AmplifyLoginProxyEnv): string {
  const secret = readEnvString(env, "SONIK_AGENT_UI_HOST_CONTEXT_SECRET");
  if (!secret) {
    throw new AmplifyLoginProxyError(
      "HOST_CONTEXT_SECRET_MISSING",
      "SONIK_AGENT_UI_HOST_CONTEXT_SECRET is required to mint a login-proxy host context.",
    );
  }
  return secret;
}

function requireLoginSessionSecret(env: AmplifyLoginProxyEnv): string {
  const secret = readEnvString(env, "SONIK_AGENT_UI_LOGIN_SESSION_SECRET");
  if (!secret) {
    throw new AmplifyLoginProxyError(
      "LOGIN_SESSION_SECRET_MISSING",
      "SONIK_AGENT_UI_LOGIN_SESSION_SECRET is required to seal the login-proxy session cookie.",
    );
  }
  return secret;
}

function mintSignedLoginProxyContext(
  session: ProductionSessionResolution,
  env: AmplifyLoginProxyEnv,
): WorkspaceTrustedHostContext {
  return createSignedTrustedHostContext({
    context: buildLoginProxyHostContext(session),
    secret: requireHostContextSecret(env),
  });
}

/** Signs in with Amplify, resolves org context, and mints the signed envelope. */
export async function mintLoginProxyEnvelope(
  credentials: AmplifySignInInput,
  env: AmplifyLoginProxyEnv,
): Promise<LoginProxySession> {
  const { cookieHeader, session } = await signInAndResolveAmplifySession(credentials, env);
  return { ampCookie: cookieHeader, context: mintSignedLoginProxyContext(session, env) };
}

/** Re-validates the captured Amplify cookie and re-mints a fresh envelope. */
export async function refreshLoginProxyEnvelope(
  ampCookie: string,
  env: AmplifyLoginProxyEnv,
): Promise<LoginProxySession | null> {
  const session = await resolveAmplifySessionByCookie(ampCookie, env);
  if (!session) return null;
  return { ampCookie, context: mintSignedLoginProxyContext(session, env) };
}

function loginProxyCookieOptions(env: Record<string, unknown> | null | undefined) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: readEnvString(env, "SONIK_AGENT_UI_LOGIN_PROXY_INSECURE_COOKIE") !== "true",
    maxAge: 60 * 60 * 24 * 7,
  };
}

export function writeLoginProxySessionCookie(
  cookies: Cookies,
  session: LoginProxySession,
  env: AmplifyLoginProxyEnv,
): void {
  const value = encodeLoginProxySessionCookieValue(session, requireLoginSessionSecret(env));
  cookies.set(AMPLIFY_LOGIN_PROXY_COOKIE_NAME, value, loginProxyCookieOptions(env));
}

export function clearLoginProxySessionCookie(cookies: Cookies): void {
  cookies.delete(AMPLIFY_LOGIN_PROXY_COOKIE_NAME, { path: "/" });
}

export function readLoginProxySessionCookie(
  cookies: Cookies,
  env: AmplifyLoginProxyEnv,
): LoginProxySession | null {
  const raw = cookies.get(AMPLIFY_LOGIN_PROXY_COOKIE_NAME);
  if (!raw) return null;
  const secret = readEnvString(env, "SONIK_AGENT_UI_LOGIN_SESSION_SECRET");
  if (!secret) return null;
  return decodeLoginProxySessionCookieValue(raw, secret);
}

/**
 * Orchestration for hooks.server.ts: resolves the encoded
 * `x-sonik-agent-ui-host-context` header value for the current request's
 * login-proxy cookie, silently refreshing the envelope first if it is at or
 * near its signed TTL. Returns null (no-op) whenever the proxy is disabled,
 * no session cookie is present, or the Amplify session can no longer be
 * resolved — callers fall back to the existing unauthenticated/missing-host-
 * context behavior, unchanged.
 */
export async function resolveLoginProxyHostContextHeader(
  cookies: Cookies,
  env: AmplifyLoginProxyEnv,
): Promise<string | null> {
  if (!isAmplifyLoginProxyEnabled(env)) return null;
  const cached = readLoginProxySessionCookie(cookies, env);
  if (!cached) return null;

  if (!isExpiringSoon(cached.context)) {
    return encodeTrustedHostContextHeader(cached.context);
  }

  try {
    const refreshed = await refreshLoginProxyEnvelope(cached.ampCookie, env);
    if (!refreshed) {
      clearLoginProxySessionCookie(cookies);
      return null;
    }
    writeLoginProxySessionCookie(cookies, refreshed, env);
    return encodeTrustedHostContextHeader(refreshed.context);
  } catch (error) {
    if (error instanceof ProductionSessionResolutionError) {
      // Transport/timeout failure refreshing: keep serving the still-valid
      // cached envelope if it hasn't actually expired yet; otherwise drop it.
      if (!isExpired(cached.context)) {
        return encodeTrustedHostContextHeader(cached.context);
      }
      clearLoginProxySessionCookie(cookies);
      return null;
    }
    throw error;
  }
}

function isExpired(context: WorkspaceTrustedHostContext): boolean {
  const expiresAt = context.expiresAt ? Date.parse(context.expiresAt) : NaN;
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

function isExpiringSoon(context: WorkspaceTrustedHostContext): boolean {
  const expiresAt = context.expiresAt ? Date.parse(context.expiresAt) : NaN;
  if (!Number.isFinite(expiresAt)) return true;
  return expiresAt - Date.now() <= REFRESH_MARGIN_MS;
}

// Base64url helpers mirror workspace-services.ts's own encode/decode
// technique (btoa/atob + URL-safe substitution) rather than node:buffer's
// encoding-argument overloads, for the same cross-runtime portability reason.
function toBase64Url(text: string): string {
  return btoa(unescape(encodeURIComponent(text))).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return decodeURIComponent(escape(atob(padded)));
}

function encodeLoginProxySessionCookieValue(session: LoginProxySession, secret: string): string {
  const payload = toBase64Url(JSON.stringify(session));
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function decodeLoginProxySessionCookieValue(value: string, secret: string): LoginProxySession | null {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(payload)) as unknown;
    return isValidLoginProxySession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isValidLoginProxySession(value: unknown): value is LoginProxySession {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.ampCookie === "string" && Boolean(record.context) && typeof record.context === "object";
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

function readEnvString(env: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = env?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export { ProductionSessionResolutionError };
