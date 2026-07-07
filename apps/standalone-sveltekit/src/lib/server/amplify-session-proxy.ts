// Adapted, direct-copy retrofit of sonik-booking-service's Amplify session
// adapter (packages/service/src/auth/amplify-session.ts), per
// docs/plans/agent-ui-amplify-auth-proxy-retrofit-2026-07-07.md §3 manifest
// entry 1. Amplify remains the sole auth/org authority; this module never
// imports Amplify internals or queries Better Auth tables directly — it only
// proxies Amplify's own `/api/auth/*` and `/api/organizations` HTTP surface,
// exactly like the donor.
//
// Retrofit deltas from the donor (per the copy-retrofit skill's "retrofit
// outside the copied island" rule — allowedLocalModifications):
//   - The Cloudflare `Fetcher` service-binding type is swapped for a
//     loosely-typed, duck-checked binding shape compatible with SvelteKit's
//     `platform.env`, matching the pattern already used by
//     `routes/api/dev/smoke-host-context/+server.ts`'s `platformFetcher`.
//   - The donor resolves a session from an *incoming Request's* forwarded
//     `cookie`/`authorization` headers (browser-to-booking cookie forward).
//     Agent-ui's standalone origin never receives Amplify's session cookie
//     from the browser (see plan §4.1 — Amplify's Better Auth cookie is
//     host-only, not cross-subdomain), so there is nothing to forward.
//     Instead agent-ui's login proxy captures Amplify's session cookie
//     itself, server-to-server, during sign-in, then drives the identical
//     get-session -> organizations reduction with that captured cookie.
//     `resolveAmplifyProductionSession(request, env)` is therefore replaced
//     by `resolveAmplifySessionByCookie(cookieHeader, env)`, and a new
//     `signInAndResolveAmplifySession()` (not present in the donor, which
//     never signs in) drives the sign-in step that produces the cookie.
//   - `hasAuthSignal()`/`buildAmplifySessionHeaders()` were adapted to take a
//     captured cookie string instead of reading a live Request.
//   - `ProductionSessionResolutionError` taxonomy, UUID validation,
//     `pickOrganizationMembership`/`organizationMembershipCandidates`, and
//     the payload-parsing helpers stay verbatim in behavior.

export interface AmplifyServiceBinding {
  fetch: typeof fetch;
}

export interface AmplifySessionAuthEnv {
  /** Base URL for the Amplify host that owns Better Auth + org memberships. */
  AMPLIFY_AUTH_BASE_URL?: string;
  /** Optional Cloudflare service binding for same-account Worker-to-Worker auth calls. */
  AMPLIFY_AUTH_SERVICE?: AmplifyServiceBinding;
  /** Optional server-to-server marker. Never forwarded from browser input. */
  AMPLIFY_AUTH_INTERNAL_TOKEN?: string;
  /** Optional fetch timeout in milliseconds. Defaults to 8000. */
  AMPLIFY_AUTH_TIMEOUT_MS?: string;
  /** Local/staging-only sanitized adapter diagnostics. */
  AUTH_DIAGNOSTICS?: string;
  /**
   * Temporary compatibility for the current Amplify /api/organizations response.
   * When enabled, a membership-proven organization UUID may be used as the app
   * actor UUID if Amplify has not yet surfaced an app principal id. Keep this
   * explicit so future deployments can fail closed once Amplify returns
   * principalId/appPrincipalId.
   */
  AUTH_ORG_ID_PRINCIPAL_COMPATIBILITY?: string;
}

export interface ProductionSessionResolution {
  /** Better Auth user id. Text identity only; never cast into app UUID columns. */
  authUserId: string;
  /** Amplify organization_memberships authority result. */
  organizationId: string;
  /** App-owned principal UUID resolved after org membership is proven. */
  principalId: string;
}

export interface ResolveAmplifySessionOptions {
  fetcher?: typeof fetch;
}

export interface AmplifySignInInput {
  email: string;
  password: string;
}

export interface AmplifySignInResult {
  /** Amplify's captured session cookie, ready to drive get-session/organizations. */
  cookieHeader: string;
  session: ProductionSessionResolution;
}

export class ProductionSessionResolutionError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ProductionSessionResolutionError";
    this.status = status;
  }
}

const DEFAULT_AUTH_TIMEOUT_MS = 8000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function resolveAmplifySessionByCookie(
  cookieHeader: string,
  env: AmplifySessionAuthEnv,
  options: ResolveAmplifySessionOptions = {},
): Promise<ProductionSessionResolution | null> {
  const authBaseUrl = normalizeBaseUrl(env.AMPLIFY_AUTH_BASE_URL);
  if (!authBaseUrl || !cookieHeader?.trim()) {
    return null;
  }

  const controller = new AbortController();
  const timeoutMs = parseTimeoutMs(env.AMPLIFY_AUTH_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetcher = resolveFetcher(env, options);
    const sessionUrl = new URL("/api/auth/get-session", authBaseUrl).toString();
    const response = await fetcher(sessionUrl, {
      method: "GET",
      headers: buildAmplifySessionHeaders(cookieHeader, env),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      diagnostics(env, "amplify_session_denied", { status: response.status });
      return null;
    }
    if (!response.ok) {
      diagnostics(env, "amplify_session_failed", { status: response.status });
      throw new ProductionSessionResolutionError(
        "AMPLIFY_SESSION_ENDPOINT_FAILED",
        response.status,
      );
    }

    if (response.status === 204) {
      return null;
    }
    const payload = (await response.json()) as unknown;
    if (payload == null) {
      return null;
    }
    const parsed = parseProductionSessionPayload(payload);
    if (parsed) {
      return parsed;
    }
    if (hasExplicitPrincipalPayload(payload)) {
      diagnostics(env, "amplify_session_invalid_principal_payload", { status: response.status });
      throw new ProductionSessionResolutionError(
        "AMPLIFY_SESSION_PAYLOAD_INVALID",
        response.status,
      );
    }

    const sessionIdentity = parseSessionIdentityPayload(payload);
    if (!sessionIdentity) {
      diagnostics(env, "amplify_session_unusable_payload", { status: response.status });
      throw new ProductionSessionResolutionError(
        "AMPLIFY_SESSION_PAYLOAD_INVALID",
        response.status,
      );
    }

    const organizationSession = await resolveOrganizationBackedSession(
      cookieHeader,
      env,
      authBaseUrl,
      fetcher,
      sessionIdentity.authUserId,
      controller.signal,
    );
    if (!organizationSession) {
      return null;
    }
    return organizationSession;
  } catch (error) {
    if (isAbortError(error)) {
      diagnostics(env, "amplify_session_timeout", { timeoutMs });
      throw new ProductionSessionResolutionError("AMPLIFY_SESSION_TIMEOUT");
    }
    if (error instanceof ProductionSessionResolutionError) {
      throw error;
    }
    diagnostics(env, "amplify_session_transport_error", {});
    throw new ProductionSessionResolutionError("AMPLIFY_SESSION_TRANSPORT_ERROR");
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * NOT present in the donor (booking never signs in — it only resolves a
 * session a browser already carries). This drives the actual credential
 * exchange for agent-ui's login-form proxy: POST email/password to Amplify's
 * mounted `sign-in/email` Better Auth route, capture the session cookie from
 * the response, then immediately reduce it to an authorized org/principal via
 * the ported `resolveAmplifySessionByCookie` above — the exact same
 * get-session -> organizations flow the donor uses for a browser-forwarded
 * cookie.
 */
export async function signInAndResolveAmplifySession(
  input: AmplifySignInInput,
  env: AmplifySessionAuthEnv,
  options: ResolveAmplifySessionOptions = {},
): Promise<AmplifySignInResult> {
  const authBaseUrl = normalizeBaseUrl(env.AMPLIFY_AUTH_BASE_URL);
  if (!authBaseUrl) {
    throw new ProductionSessionResolutionError("AMPLIFY_AUTH_BASE_URL_MISSING");
  }
  const email = input.email?.trim();
  const password = input.password;
  if (!email || !password) {
    throw new ProductionSessionResolutionError("AMPLIFY_SIGN_IN_CREDENTIALS_REQUIRED");
  }

  const controller = new AbortController();
  const timeoutMs = parseTimeoutMs(env.AMPLIFY_AUTH_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetcher = resolveFetcher(env, options);
    const signInUrl = new URL("/api/auth/sign-in/email", authBaseUrl).toString();
    const response = await fetcher(signInUrl, {
      method: "POST",
      headers: buildAmplifySignInHeaders(env),
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      diagnostics(env, "amplify_sign_in_denied", { status: response.status });
      throw new ProductionSessionResolutionError(
        "AMPLIFY_SIGN_IN_INVALID_CREDENTIALS",
        response.status,
      );
    }
    if (!response.ok) {
      diagnostics(env, "amplify_sign_in_failed", { status: response.status });
      throw new ProductionSessionResolutionError("AMPLIFY_SIGN_IN_FAILED", response.status);
    }

    const cookieHeader = extractSessionCookieHeader(response);
    if (!cookieHeader) {
      diagnostics(env, "amplify_sign_in_missing_cookie", { status: response.status });
      throw new ProductionSessionResolutionError(
        "AMPLIFY_SIGN_IN_MISSING_SESSION_COOKIE",
        response.status,
      );
    }

    const session = await resolveAmplifySessionByCookie(cookieHeader, env, options);
    if (!session) {
      diagnostics(env, "amplify_sign_in_session_unresolved", { status: response.status });
      throw new ProductionSessionResolutionError(
        "AMPLIFY_SIGN_IN_SESSION_UNRESOLVED",
        response.status,
      );
    }
    return { cookieHeader, session };
  } catch (error) {
    if (isAbortError(error)) {
      diagnostics(env, "amplify_sign_in_timeout", { timeoutMs });
      throw new ProductionSessionResolutionError("AMPLIFY_SIGN_IN_TIMEOUT");
    }
    if (error instanceof ProductionSessionResolutionError) {
      throw error;
    }
    diagnostics(env, "amplify_sign_in_transport_error", {});
    throw new ProductionSessionResolutionError("AMPLIFY_SIGN_IN_TRANSPORT_ERROR");
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveOrganizationBackedSession(
  cookieHeader: string,
  env: AmplifySessionAuthEnv,
  authBaseUrl: URL,
  fetcher: typeof fetch,
  authUserId: string,
  signal: AbortSignal,
): Promise<ProductionSessionResolution | null> {
  const response = await fetcher(new URL("/api/organizations", authBaseUrl).toString(), {
    method: "GET",
    headers: buildAmplifySessionHeaders(cookieHeader, env),
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    diagnostics(env, "amplify_organizations_denied", { status: response.status });
    return null;
  }
  if (!response.ok) {
    diagnostics(env, "amplify_organizations_failed", { status: response.status });
    throw new ProductionSessionResolutionError(
      "AMPLIFY_ORGANIZATIONS_ENDPOINT_FAILED",
      response.status,
    );
  }
  const payload = (await response.json()) as unknown;
  const membership = pickOrganizationMembership(
    payload,
    null,
    env.AUTH_ORG_ID_PRINCIPAL_COMPATIBILITY === "true",
  );
  if (!membership) {
    diagnostics(env, "amplify_organizations_missing_membership", { status: response.status });
    return null;
  }
  return { authUserId, ...membership };
}

function resolveFetcher(env: AmplifySessionAuthEnv, options: ResolveAmplifySessionOptions): typeof fetch {
  if (options.fetcher) return options.fetcher;
  const binding = env.AMPLIFY_AUTH_SERVICE;
  if (binding && typeof binding.fetch === "function") {
    return binding.fetch.bind(binding);
  }
  return fetch;
}

function buildAmplifySessionHeaders(cookieHeader: string, env: AmplifySessionAuthEnv): Headers {
  const headers = new Headers({ accept: "application/json" });
  if (cookieHeader.trim()) {
    headers.set("cookie", cookieHeader.trim());
  }
  if (env.AMPLIFY_AUTH_INTERNAL_TOKEN?.trim()) {
    headers.set("x-sonik-internal-auth", `Bearer ${env.AMPLIFY_AUTH_INTERNAL_TOKEN.trim()}`);
  }
  return headers;
}

function buildAmplifySignInHeaders(env: AmplifySessionAuthEnv): Headers {
  const headers = new Headers({ accept: "application/json", "content-type": "application/json" });
  if (env.AMPLIFY_AUTH_INTERNAL_TOKEN?.trim()) {
    headers.set("x-sonik-internal-auth", `Bearer ${env.AMPLIFY_AUTH_INTERNAL_TOKEN.trim()}`);
  }
  return headers;
}

function extractSessionCookieHeader(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : collectSetCookieFallback(headers);
  const pairs = cookies
    .map((cookie) => cookie.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair));
  return pairs.length ? pairs.join("; ") : null;
}

function collectSetCookieFallback(headers: Headers): string[] {
  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
}

function normalizeBaseUrl(value: string | undefined): URL | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

function parseTimeoutMs(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUTH_TIMEOUT_MS;
}

function parseProductionSessionPayload(payload: unknown): ProductionSessionResolution | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  const session = asRecord(root.session);
  const user = asRecord(root.user);
  const organization = asRecord(root.organization) ?? asRecord(root.activeOrganization);
  const principal = asRecord(root.principal) ?? asRecord(root.appPrincipal);

  const authUserId = firstString(
    root.authUserId,
    root.userId,
    user?.id,
    session?.authUserId,
    session?.userId,
  );
  const organizationId = firstString(
    root.organizationId,
    root.orgId,
    root.activeOrganizationId,
    organization?.id,
    session?.organizationId,
    session?.orgId,
    session?.activeOrganizationId,
  );
  const principalId = firstString(
    root.principalId,
    root.appPrincipalId,
    principal?.id,
    session?.principalId,
    session?.appPrincipalId,
  );

  if (!authUserId || !organizationId || !principalId) {
    return null;
  }
  if (!UUID_PATTERN.test(organizationId) || !UUID_PATTERN.test(principalId)) {
    return null;
  }
  return { authUserId, organizationId, principalId };
}

function parseSessionIdentityPayload(payload: unknown): { authUserId: string } | null {
  const root = asRecord(payload);
  if (!root) {
    return null;
  }
  const session = asRecord(root.session);
  const user = asRecord(root.user);
  const authUserId = firstString(
    root.authUserId,
    root.userId,
    user?.id,
    session?.authUserId,
    session?.userId,
  );
  return authUserId ? { authUserId } : null;
}

function hasExplicitPrincipalPayload(payload: unknown): boolean {
  const root = asRecord(payload);
  if (!root) {
    return false;
  }
  const session = asRecord(root.session);
  const principal = asRecord(root.principal) ?? asRecord(root.appPrincipal);
  return Boolean(
    root.principalId ??
      root.appPrincipalId ??
      principal?.id ??
      session?.principalId ??
      session?.appPrincipalId,
  );
}

function pickOrganizationMembership(
  payload: unknown,
  organizationHint: string | null,
  allowOrganizationActorCompatibility: boolean,
): Pick<ProductionSessionResolution, "organizationId" | "principalId"> | null {
  const rawCandidates = organizationMembershipCandidates(payload);
  if (rawCandidates.length === 0) {
    return null;
  }
  const normalizedHint = organizationHint?.trim().toLowerCase();
  if (normalizedHint) {
    const hinted = rawCandidates.find(
      (candidate) => candidate.organizationId.toLowerCase() === normalizedHint,
    );
    if (!hinted) {
      return null;
    }
    return normalizeOrganizationMembership(hinted, allowOrganizationActorCompatibility);
  }

  const candidates = rawCandidates
    .map((candidate) =>
      normalizeOrganizationMembership(candidate, allowOrganizationActorCompatibility),
    )
    .filter(
      (
        candidate,
      ): candidate is { organizationId: string; principalId: string; isDefault: boolean } =>
        candidate !== null,
    );
  if (candidates.length === 0) {
    return null;
  }
  const selected = candidates.find((candidate) => candidate.isDefault) ?? candidates[0];
  if (!selected) {
    return null;
  }
  return selected;
}

function normalizeOrganizationMembership(
  candidate: { organizationId: string; principalId: string | null; isDefault: boolean },
  allowOrganizationActorCompatibility: boolean,
): { organizationId: string; principalId: string; isDefault: boolean } | null {
  const actorPrincipalId =
    candidate.principalId ??
    (allowOrganizationActorCompatibility ? candidate.organizationId : null);
  if (!actorPrincipalId) {
    return null;
  }
  if (!UUID_PATTERN.test(candidate.organizationId) || !UUID_PATTERN.test(actorPrincipalId)) {
    return null;
  }
  return {
    organizationId: candidate.organizationId,
    principalId: actorPrincipalId,
    isDefault: candidate.isDefault,
  };
}

function organizationMembershipCandidates(
  payload: unknown,
): Array<{ organizationId: string; principalId: string | null; isDefault: boolean }> {
  const root = asRecord(payload);
  const rawCandidates = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.organizations)
      ? root.organizations
      : Array.isArray(root?.memberships)
        ? root.memberships
        : Array.isArray(root?.data)
          ? root.data
          : root
            ? [root.activeOrganization, root.organization, root.membership].filter(Boolean)
            : [];

  return rawCandidates.flatMap((raw) => {
    const record = asRecord(raw);
    if (!record) {
      return [];
    }
    const organization = asRecord(record.organization);
    const organizationId = firstString(record.organizationId, record.id, organization?.id);
    const principalId = firstString(record.principalId, record.appPrincipalId, record.principal);
    if (!organizationId) {
      return [];
    }
    return [
      {
        organizationId,
        principalId,
        isDefault: record.isDefault === true || record.default === true || record.active === true,
      },
    ];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function diagnostics(
  env: AmplifySessionAuthEnv,
  event: string,
  details: Record<string, string | number>,
) {
  if (env.AUTH_DIAGNOSTICS !== "true") {
    return;
  }
  console.info(JSON.stringify({ service: "sonik-agent-ui", event, ...details }));
}
