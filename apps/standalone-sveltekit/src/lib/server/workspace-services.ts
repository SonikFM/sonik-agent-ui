import { createHmac, timingSafeEqual } from "node:crypto";
import {
  createAsyncWorkspacePersistenceAdapter,
  createCloudWorkspaceRuntime,
  createInMemoryWorkspacePersistence,
  createLocalAuthAdapter,
  createMemoryWorkspaceRuntime,
  createWorkspaceServices,
  type AsyncWorkspacePersistenceAdapter,
  type AuthorizedWorkspaceRuntime,
  type MemoryWorkspaceRuntimeReason,
  type ResolvedWorkspaceRuntime,
  type WorkspaceAuthAdapter,
  type WorkspacePersistenceAdapter,
  type WorkspacePersistencePolicy,
  type WorkspaceServices,
  type WorkspaceHostSessionSnapshot,
} from "@sonik-agent-ui/workspace-session";
import { createNeonWorkspaceSqlExecutor } from "./workspace-cloud-sql.ts";

export type WorkspaceRuntimeRequest = {
  platform?: { env?: Record<string, unknown> } | null;
  request?: Request;
  locals?: unknown;
};

export const AGENT_UI_HOST_CONTEXT_HEADER = "x-sonik-agent-ui-host-context";
export const WORKSPACE_HOST_CONTEXT_SIGNATURE_VERSION = "sonik.agent_ui.host_context.hmac.v1";
const WORKSPACE_HOST_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;
const WORKSPACE_HOST_CONTEXT_CLOCK_SKEW_MS = 60 * 1000;

export type WorkspaceTrustedHostContext = {
  authenticated?: boolean;
  organizationId?: string | null;
  scopes?: string[];
  hostSession?: Partial<WorkspaceHostSessionSnapshot> | null;
  signatureVersion?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  signature?: string | null;
};

export type RequestWorkspaceServices = {
  runtime: ResolvedWorkspaceRuntime;
  persistence: AsyncWorkspacePersistenceAdapter;
  auth: WorkspaceAuthAdapter;
  persistencePolicy: WorkspacePersistencePolicy;
  persistenceMode: ResolvedWorkspaceRuntime["kind"];
};

export type WorkspaceRuntimeDiagnostics = {
  policy: WorkspacePersistencePolicy | "invalid";
  mode: ResolvedWorkspaceRuntime["kind"] | "unresolved";
  memoryReason?: MemoryWorkspaceRuntimeReason;
  cloudErrorCode?: WorkspaceRuntimeResolutionError["code"];
  hostContext: {
    hasHeader: boolean;
    authenticated: boolean;
    organizationIdPresent: boolean;
    userIdPresent: boolean;
    source: string | null;
  };
};

const localWorkspacePersistence = createInMemoryWorkspacePersistence();
const localWorkspaceRuntime = createMemoryWorkspaceRuntime({
  persistence: localWorkspacePersistence,
  reason: "local",
});
const localWorkspaceAuth = createLocalAuthAdapter();

export function createStandaloneWorkspaceServices(): WorkspaceServices {
  return createWorkspaceServices({
    persistence: localWorkspacePersistence,
    auth: localWorkspaceAuth,
  });
}

export const workspaceServices = createStandaloneWorkspaceServices();

export class WorkspaceRuntimeResolutionError extends Error {
  readonly code: "cloud-runtime-not-mounted" | "invalid-persistence-policy" | "missing-cloud-database" | "missing-host-context";

  constructor(code: WorkspaceRuntimeResolutionError["code"], message: string) {
    super(message);
    this.name = "WorkspaceRuntimeResolutionError";
    this.code = code;
  }
}

export function resolveWorkspacePersistencePolicy(input: {
  env?: Record<string, unknown> | null;
  override?: string | null;
} = {}): WorkspacePersistencePolicy {
  const envPolicy = parseWorkspacePersistencePolicy(readEnvString(input.env, "SONIK_AGENT_UI_PERSISTENCE_MODE"), "SONIK_AGENT_UI_PERSISTENCE_MODE");
  const overridePolicy = parseWorkspacePersistencePolicy(input.override ?? null, "workspace persistence policy override");
  if (envPolicy === "cloud" && overridePolicy && overridePolicy !== "cloud") {
    throw new WorkspaceRuntimeResolutionError(
      "invalid-persistence-policy",
      "SONIK_AGENT_UI_PERSISTENCE_MODE=cloud is authoritative and cannot be downgraded by a caller-supplied policy.",
    );
  }
  return overridePolicy ?? envPolicy ?? "memory";
}

export function resolveWorkspaceRuntime(input: {
  event?: WorkspaceRuntimeRequest | null;
  policy?: WorkspacePersistencePolicy;
  memoryReason?: MemoryWorkspaceRuntimeReason;
} = {}): ResolvedWorkspaceRuntime {
  const env = input.event?.platform?.env ?? null;
  const policy = resolveWorkspacePersistencePolicy({ env, override: input.policy });

  if (policy === "memory") {
    return localWorkspaceRuntime;
  }

  if (policy === "auto") {
    const cloudRuntime = tryResolveCloudWorkspaceRuntime(input.event ?? null, correlationIdFromRequest(input.event?.request));
    if (cloudRuntime) return cloudRuntime;
    return {
      ...localWorkspaceRuntime,
      reason: input.memoryReason ?? "cloud-unavailable",
    };
  }

  return resolveCloudWorkspaceRuntime(input.event ?? null, correlationIdFromRequest(input.event?.request));
}

export function createRequestWorkspaceServices(event?: WorkspaceRuntimeRequest | null, input: {
  policy?: WorkspacePersistencePolicy;
  memoryReason?: MemoryWorkspaceRuntimeReason;
  persistence?: WorkspacePersistenceAdapter;
} = {}): RequestWorkspaceServices {
  const env = event?.platform?.env ?? null;
  const persistencePolicy = resolveWorkspacePersistencePolicy({ env, override: input.policy });
  if (persistencePolicy === "cloud") {
    // Test/local injection must not bypass the explicit cloud-mode fail-closed boundary.
    resolveWorkspaceRuntime({ event, policy: persistencePolicy, memoryReason: input.memoryReason });
  }
  const runtime = input.persistence && persistencePolicy !== "cloud"
    ? createMemoryWorkspaceRuntime({ persistence: input.persistence, reason: input.memoryReason ?? "local" })
    : resolveWorkspaceRuntime({ event, policy: persistencePolicy, memoryReason: input.memoryReason });

  return {
    runtime,
    persistence: runtime.persistence,
    auth: localWorkspaceAuth,
    persistencePolicy,
    persistenceMode: runtime.kind,
  };
}

export function resolveWorkspaceRuntimeDiagnostics(event?: WorkspaceRuntimeRequest | null, input: { policy?: WorkspacePersistencePolicy } = {}): WorkspaceRuntimeDiagnostics {
  const env = event?.platform?.env ?? null;
  const hostSession = resolveTrustedHostSessionSnapshot(event);
  const hostContext = {
    hasHeader: Boolean(event?.request?.headers.get(AGENT_UI_HOST_CONTEXT_HEADER)),
    authenticated: hostSession.authenticated,
    organizationIdPresent: Boolean(hostSession.organizationId),
    userIdPresent: Boolean(hostSession.userId),
    source: hostSession.source ?? null,
  };

  let policy: WorkspacePersistencePolicy;
  try {
    policy = resolveWorkspacePersistencePolicy({ env, override: input.policy });
  } catch (error) {
    return {
      policy: "invalid",
      mode: "unresolved",
      cloudErrorCode: error instanceof WorkspaceRuntimeResolutionError ? error.code : "invalid-persistence-policy",
      hostContext,
    };
  }

  try {
    const runtime = resolveWorkspaceRuntime({ event, policy });
    return {
      policy,
      mode: runtime.kind,
      ...(runtime.kind === "memory" ? { memoryReason: runtime.reason } : {}),
      hostContext,
    };
  } catch (error) {
    return {
      policy,
      mode: "unresolved",
      cloudErrorCode: error instanceof WorkspaceRuntimeResolutionError ? error.code : "cloud-runtime-not-mounted",
      hostContext,
    };
  }
}

export function createWorkspaceRuntimeDiagnosticHeaders(event?: WorkspaceRuntimeRequest | null): Record<string, string> {
  const diagnostics = resolveWorkspaceRuntimeDiagnostics(event);
  return {
    "x-sonik-agent-ui-persistence-policy": diagnostics.policy,
    "x-sonik-agent-ui-persistence-mode": diagnostics.mode,
    ...(diagnostics.memoryReason ? { "x-sonik-agent-ui-memory-reason": diagnostics.memoryReason } : {}),
    ...(diagnostics.cloudErrorCode ? { "x-sonik-agent-ui-cloud-error": diagnostics.cloudErrorCode } : {}),
    "x-sonik-agent-ui-host-authenticated": diagnostics.hostContext.authenticated ? "true" : "false",
    "x-sonik-agent-ui-host-org": diagnostics.hostContext.organizationIdPresent ? "present" : "missing",
    "x-sonik-agent-ui-host-user": diagnostics.hostContext.userIdPresent ? "present" : "missing",
  };
}

export function createAsyncLocalWorkspacePersistence(): AsyncWorkspacePersistenceAdapter {
  return createAsyncWorkspacePersistenceAdapter(localWorkspacePersistence);
}

function parseWorkspacePersistencePolicy(value: string | null, label: string): WorkspacePersistencePolicy | null {
  if (value === null) return null;
  if (value === "memory" || value === "cloud" || value === "auto") return value;
  throw new WorkspaceRuntimeResolutionError(
    "invalid-persistence-policy",
    `Invalid ${label}=${JSON.stringify(value)}. Expected memory, cloud, or auto.`,
  );
}

export function resolveTrustedHostContextFromRequest(request?: Request | null): WorkspaceTrustedHostContext | null {
  const encoded = request?.headers.get(AGENT_UI_HOST_CONTEXT_HEADER);
  return decodeTrustedHostContext(encoded);
}

export function encodeTrustedHostContextHeader(context: WorkspaceTrustedHostContext): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(context)))).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function createSignedTrustedHostContextHeader(input: {
  context: WorkspaceTrustedHostContext;
  secret: string;
  issuedAt?: Date;
  ttlMs?: number;
}): string {
  return encodeTrustedHostContextHeader(createSignedTrustedHostContext(input));
}

export function createSignedTrustedHostContext(input: {
  context: WorkspaceTrustedHostContext;
  secret: string;
  issuedAt?: Date;
  ttlMs?: number;
}): WorkspaceTrustedHostContext {
  const issuedAtDate = input.issuedAt ?? new Date();
  const expiresAtDate = new Date(issuedAtDate.getTime() + (input.ttlMs ?? WORKSPACE_HOST_CONTEXT_MAX_AGE_MS));
  const unsigned = normalizeTrustedHostContext({
    ...input.context,
    signature: undefined,
    signatureVersion: WORKSPACE_HOST_CONTEXT_SIGNATURE_VERSION,
    issuedAt: issuedAtDate.toISOString(),
    expiresAt: expiresAtDate.toISOString(),
  });
  if (!unsigned) {
    throw new WorkspaceRuntimeResolutionError("missing-host-context", "Cannot sign an empty Agent UI host context.");
  }
  return {
    ...unsigned,
    signature: signTrustedHostContext(unsigned, input.secret),
  };
}

export function decodeTrustedHostContext(value: string | null | undefined): WorkspaceTrustedHostContext | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  try {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return normalizeTrustedHostContext(JSON.parse(decodeURIComponent(escape(atob(padded)))));
  } catch {
    try {
      return normalizeTrustedHostContext(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
}

function tryResolveCloudWorkspaceRuntime(event: WorkspaceRuntimeRequest | null, requestId: string): ResolvedWorkspaceRuntime | null {
  try {
    return resolveCloudWorkspaceRuntime(event, requestId);
  } catch {
    return null;
  }
}

function resolveCloudWorkspaceRuntime(event: WorkspaceRuntimeRequest | null, requestId: string): ResolvedWorkspaceRuntime {
  const env = event?.platform?.env ?? null;
  const databaseUrl = readFirstEnvString(env, ["SONIK_AGENT_UI_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL", "NEON_DATABASE_URL"]);
  if (!databaseUrl) {
    throw new WorkspaceRuntimeResolutionError(
      "missing-cloud-database",
      "Cloud workspace persistence requires SONIK_AGENT_UI_DATABASE_URL, DATABASE_URL, POSTGRES_URL, or NEON_DATABASE_URL in the current Worker env.",
    );
  }
  const hostSession = resolveTrustedHostSessionSnapshot(event);
  if (!hostSession.authenticated || !hostSession.organizationId || !hostSession.userId) {
    throw new WorkspaceRuntimeResolutionError(
      "missing-host-context",
      "Cloud workspace persistence requires authenticated host session context with organizationId and userId.",
    );
  }
  const authorized: AuthorizedWorkspaceRuntime = {
    kind: "cloud",
    env,
    db: createNeonWorkspaceSqlExecutor(databaseUrl),
    userId: hostSession.userId,
    organizationId: hostSession.organizationId,
    principalId: hostSession.principalId ?? null,
    requestId,
    hostSession,
    commandPolicy: {
      allowed: true,
      commandId: "agent-ui.workspace.persistence",
      reasonCode: "host-context-authenticated",
      effectiveScope: "workspace",
      auditRequired: true,
    },
  };
  return createCloudWorkspaceRuntime(authorized);
}

function resolveTrustedHostSessionSnapshot(event?: WorkspaceRuntimeRequest | null): WorkspaceHostSessionSnapshot {
  const env = event?.platform?.env ?? null;
  const fromLocals = resolveHostSessionFromLocals(event?.locals);
  if (fromLocals) return normalizeHostSessionSnapshot(fromLocals, "server-local-auth-adapter");

  const signedContext = resolveSignedTrustedHostContextFromRequest(event?.request, env);
  if (signedContext?.hostSession) return normalizeHostSessionSnapshot(signedContext.hostSession, "signed-embedded-host-context", signedContext);

  const unsignedContext = isUnsignedBrowserHostContextAllowed(env) ? resolveTrustedHostContextFromRequest(event?.request) : null;
  if (unsignedContext?.hostSession) return normalizeHostSessionSnapshot(unsignedContext.hostSession, "unsigned-dev-fixture-host-context", unsignedContext);

  return {
    source: "none",
    sessionId: event?.request?.headers.get("x-sonik-session-id") ?? null,
    userId: null,
    principalId: null,
    organizationId: null,
    authenticated: false,
    scopes: [],
    expiresAt: null,
    metadata: { authAuthority: "none" },
  };
}

function resolveHostSessionFromLocals(locals: unknown): Partial<WorkspaceHostSessionSnapshot> | null {
  if (!isRecord(locals)) return null;
  const direct = locals.agentUiHostSession ?? locals.hostSession;
  if (isRecord(direct)) return direct as Partial<WorkspaceHostSessionSnapshot>;
  const auth = locals.auth;
  if (isRecord(auth) && isRecord(auth.agentUiHostSession)) return auth.agentUiHostSession as Partial<WorkspaceHostSessionSnapshot>;
  return null;
}

function normalizeHostSessionSnapshot(
  hostSession: Partial<WorkspaceHostSessionSnapshot>,
  defaultAuthority: string,
  context?: WorkspaceTrustedHostContext | null,
): WorkspaceHostSessionSnapshot {
  const authenticated = hostSession.authenticated === true || context?.authenticated === true;
  const organizationId = cleanRuntimeString(hostSession.organizationId) ?? cleanRuntimeString(context?.organizationId) ?? null;
  const sessionId = cleanRuntimeString(hostSession.sessionId) ?? null;
  const userId = cleanRuntimeString(hostSession.userId) ?? cleanRuntimeString(hostSession.principalId) ?? null;
  const principalId = cleanRuntimeString(hostSession.principalId) ?? userId;
  const scopes = normalizeScopes(hostSession.scopes ?? context?.scopes ?? []);
  return {
    source: cleanRuntimeString(hostSession.source) ?? "embedded-host",
    sessionId,
    userId,
    principalId,
    organizationId,
    authenticated,
    scopes,
    expiresAt: cleanRuntimeString(hostSession.expiresAt) ?? null,
    metadata: isRecord(hostSession.metadata) ? hostSession.metadata : { authAuthority: defaultAuthority },
  };
}

function resolveSignedTrustedHostContextFromRequest(request: Request | null | undefined, env: Record<string, unknown> | null): WorkspaceTrustedHostContext | null {
  const context = resolveTrustedHostContextFromRequest(request);
  const secret = readEnvString(env, "SONIK_AGENT_UI_HOST_CONTEXT_SECRET");
  if (!context || !secret) return null;
  return isSignedTrustedHostContextValid(context, secret) ? context : null;
}

function isUnsignedBrowserHostContextAllowed(env: Record<string, unknown> | null): boolean {
  if (readEnvString(env, "SONIK_AGENT_UI_PERSISTENCE_MODE") === "cloud") return false;
  return readEnvString(env, "SONIK_AGENT_UI_ALLOW_UNSIGNED_HOST_CONTEXT") === "true";
}

function isSignedTrustedHostContextValid(context: WorkspaceTrustedHostContext, secret: string, now = new Date()): boolean {
  const signature = cleanRuntimeString(context.signature);
  if (!signature) return false;
  if (context.signatureVersion !== WORKSPACE_HOST_CONTEXT_SIGNATURE_VERSION) return false;
  const issuedAt = parseTrustedContextDate(context.issuedAt);
  const expiresAt = parseTrustedContextDate(context.expiresAt);
  if (!issuedAt || !expiresAt) return false;
  if (issuedAt.getTime() - WORKSPACE_HOST_CONTEXT_CLOCK_SKEW_MS > now.getTime()) return false;
  if (expiresAt.getTime() + WORKSPACE_HOST_CONTEXT_CLOCK_SKEW_MS < now.getTime()) return false;
  if (expiresAt.getTime() - issuedAt.getTime() > WORKSPACE_HOST_CONTEXT_MAX_AGE_MS + WORKSPACE_HOST_CONTEXT_CLOCK_SKEW_MS) return false;

  const unsigned = stripTrustedHostContextSignature(context);
  const expected = signTrustedHostContext(unsigned, secret);
  return safeEqualSignature(signature, expected);
}

function signTrustedHostContext(context: WorkspaceTrustedHostContext, secret: string): string {
  return createHmac("sha256", secret).update(stableJsonStringify(stripTrustedHostContextSignature(context))).digest("base64url");
}

function stripTrustedHostContextSignature(context: WorkspaceTrustedHostContext): WorkspaceTrustedHostContext {
  const { signature: _signature, ...unsigned } = context;
  return unsigned;
}

function safeEqualSignature(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}

function parseTrustedContextDate(value: string | null | undefined): Date | null {
  const cleaned = cleanRuntimeString(value);
  if (!cleaned) return null;
  const date = new Date(cleaned);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeTrustedHostContext(value: unknown): WorkspaceTrustedHostContext | null {
  if (!isRecord(value)) return null;
  return {
    authenticated: typeof value.authenticated === "boolean" ? value.authenticated : undefined,
    organizationId: cleanRuntimeString(value.organizationId) ?? null,
    scopes: normalizeScopes(value.scopes),
    hostSession: isRecord(value.hostSession) ? value.hostSession as Partial<WorkspaceHostSessionSnapshot> : null,
    signatureVersion: cleanRuntimeString(value.signatureVersion) ?? null,
    issuedAt: cleanRuntimeString(value.issuedAt) ?? null,
    expiresAt: cleanRuntimeString(value.expiresAt) ?? null,
    signature: cleanRuntimeString(value.signature) ?? null,
  };
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}

function normalizeScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanRuntimeString).filter((scope): scope is string => Boolean(scope)))].slice(0, 32).sort();
}

function cleanRuntimeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 256) : null;
}

function correlationIdFromRequest(request?: Request | null): string {
  return request?.headers.get("x-sonik-request-id") ?? request?.headers.get("x-request-id") ?? globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}`;
}

function readEnvString(env: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = env?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readFirstEnvString(env: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = readEnvString(env, key);
    if (value) return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
