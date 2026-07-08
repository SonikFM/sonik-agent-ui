// Host-context helpers for the headless harness scripts (workflow driver,
// seed tools, persona conversation harness).
//
// Mirrors the base64url envelope encoding in
// apps/standalone-sveltekit/src/lib/server/workspace-services.ts
// (encodeTrustedHostContextHeader) so the harness can hand-build the same
// `x-sonik-agent-ui-host-context` header the browser embed produces, without
// pulling in SvelteKit/browser code.
//
// Two supported paths, matching workspace-services.ts's own trust ladder:
//   - local (memory persistence): an UNSIGNED envelope, accepted only when
//     the target dev server has SONIK_AGENT_UI_ALLOW_UNSIGNED_HOST_CONTEXT=true
//     and is not running in cloud persistence mode (isUnsignedBrowserHostContextAllowed).
//   - deployed (cloud persistence): a SIGNED envelope minted by logging into
//     the booking app and reading back its agent-ui host-context envelope
//     endpoint, exactly as the embedded booking dashboard does today:
//       1. POST {bookingUrl}/api/auth/sign-in/email {email,password} -> cookie
//       2. GET  {bookingUrl}/api/v1/booking/agent-ui/host-context (with cookie)
//          -> signed envelope JSON {authenticated, organizationId, scopes,
//             hostSession, signatureVersion, issuedAt, expiresAt, signature}
//       3. header x-sonik-agent-ui-host-context = base64url(JSON.stringify(envelope))
//     The envelope expires ~10 minutes after issuedAt (expiresAt); see
//     lib/host-context-cache.mjs for on-disk caching across CLI invocations.

const LOCAL_FIXTURE_ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const LOCAL_FIXTURE_USER_ID = "harness-local-user-0001";

export function encodeTrustedHostContextHeader(context) {
  const json = JSON.stringify(context);
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Build an unsigned host-context envelope for local `--target local` runs.
 * Requires the target dev server to run with:
 *   SONIK_AGENT_UI_PERSISTENCE_MODE=memory (or a per-request smoke override)
 *   SONIK_AGENT_UI_ALLOW_UNSIGNED_HOST_CONTEXT=true
 * See apps/standalone-sveltekit/.dev.vars (harness-managed, not committed).
 */
export function buildLocalUnsignedHostContext(input = {}) {
  const organizationId = input.organizationId ?? LOCAL_FIXTURE_ORGANIZATION_ID;
  const userId = input.userId ?? LOCAL_FIXTURE_USER_ID;
  const scopes = input.scopes ?? ["booking:read", "booking:write", "workspace-persistence"];
  const hostSession = {
    source: "unsigned-dev-fixture-host-context",
    sessionId: input.sessionId ?? `harness-local-${Date.now()}`,
    userId,
    principalId: userId,
    organizationId,
    authenticated: true,
    scopes,
    expiresAt: null,
    metadata: { authAuthority: "harness-local-fixture" },
  };
  return {
    authenticated: true,
    organizationId,
    scopes,
    hostSession,
  };
}

export function localHeaders(input = {}) {
  const context = buildLocalUnsignedHostContext(input);
  return {
    "x-sonik-agent-ui-host-context": encodeTrustedHostContextHeader(context),
    // Only honored by workspace-services.ts when the request hostname is
    // localhost/127.0.0.1/0.0.0.0 (readLocalSmokePersistenceModeOverride);
    // harmless against a deployed target, defensive against a dev server
    // whose wrangler.jsonc vars default to cloud.
    "x-sonik-agent-ui-smoke-persistence-mode": "memory",
  };
}

/**
 * Login to the deployed booking app and mint a signed agent-ui host-context
 * envelope from its session cookie, over plain HTTP (no browser). Requires
 * TEST_EMAIL/TEST_PASSWORD (or AMPLIFY_TEST_EMAIL/AMPLIFY_TEST_PASSWORD).
 * Returns `{ envelope, cookie }` so long-running callers (host-context-cache)
 * can reuse the session cookie without re-deriving it.
 */
export async function loginDeployedHostContext(input) {
  const { bookingUrl, email, password, fetchImpl = fetch } = input;
  if (!email || !password) {
    throw new Error("Deployed target requires TEST_EMAIL/TEST_PASSWORD (or AMPLIFY_TEST_EMAIL/AMPLIFY_TEST_PASSWORD).");
  }
  // better-auth rejects sign-in requests with no Origin header
  // ("Missing or null Origin" / MISSING_OR_NULL_ORIGIN) — confirmed live
  // against the deployed booking app. A plain node fetch (unlike a browser
  // page navigation or Playwright's page-bound APIRequestContext) does not
  // set one automatically, so it must be supplied explicitly here.
  const loginResponse = await fetchImpl(`${bookingUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", origin: bookingUrl, referer: `${bookingUrl}/dashboard` },
    body: JSON.stringify({ email, password, callbackURL: "/dashboard" }),
  });
  if (loginResponse.status >= 400) {
    throw new Error(`Booking login failed: ${loginResponse.status} ${await loginResponse.text().catch(() => "")}`);
  }
  const cookie = loginResponse.headers.get("set-cookie");
  if (!cookie) throw new Error("Booking login response did not return a session cookie.");
  // Only the cookie name=value pair is needed on subsequent requests; strip
  // the Set-Cookie attributes (Path, HttpOnly, Secure, SameSite, Max-Age).
  const cookiePair = cookie.split(";")[0];

  const envelopeResponse = await fetchImpl(`${bookingUrl}/api/v1/booking/agent-ui/host-context`, {
    method: "GET",
    headers: { accept: "application/json", cookie: cookiePair },
  });
  if (!envelopeResponse.ok) {
    throw new Error(`Booking agent-ui host-context envelope request failed: ${envelopeResponse.status} ${await envelopeResponse.text().catch(() => "")}`);
  }
  const body = await envelopeResponse.json();
  const envelope = body?.context ?? body?.envelope ?? body;
  if (!envelope || typeof envelope !== "object" || envelope.authenticated !== true) {
    throw new Error("Booking agent-ui host-context envelope response had no usable authenticated envelope field.");
  }
  return { envelope, cookie: cookiePair };
}

export function deployedHeaders(envelope) {
  return {
    "x-sonik-agent-ui-host-context": encodeTrustedHostContextHeader(envelope),
  };
}

/** True when `envelope.expiresAt` is within `marginMs` of now (default 90s). */
export function isEnvelopeNearExpiry(envelope, marginMs = 90_000) {
  if (!envelope?.expiresAt) return true;
  const expiresAtMs = Date.parse(envelope.expiresAt);
  if (Number.isNaN(expiresAtMs)) return true;
  return expiresAtMs - Date.now() <= marginMs;
}
