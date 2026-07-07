// Cross-signing parity gate for the Amplify login-proxy envelope (P1 of
// docs/plans/agent-ui-amplify-auth-proxy-retrofit-2026-07-07.md).
//
// Parity claim under test: an envelope minted by agent-ui's own login proxy
// is indistinguishable, at every downstream validator, from one donated by
// the booking-app embed handshake. Both must pass through the exact same
// signature scheme with no forked validation branch.
//
// This file independently re-implements the donor's documented HMAC scheme
// (sonik-booking-service/packages/service/src/agent-ui-host-context.ts,
// see plan §1/§5 — same signature version, same TTL/skew constants, same
// stable-sorted-JSON HMAC-SHA256 base64url signing) WITHOUT importing
// workspace-services.ts, so that:
//   - Envelopes minted by the target (createSignedTrustedHostContext, via
//     the login proxy's buildLoginProxyHostContext) can be validated by the
//     donor-shaped implementation.
//   - Envelopes minted by the donor-shaped implementation can be validated
//     by the target, indirectly through resolveWorkspaceRuntime's existing
//     cloud-mode signed-header path (the same technique already used by
//     tests/unit/workspace-runtime-boundary.test.mjs).
// If these two independent implementations ever diverge, this test fails.

import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  AGENT_UI_HOST_CONTEXT_HEADER,
  WORKSPACE_HOST_CONTEXT_SIGNATURE_VERSION,
  createSignedTrustedHostContext,
  encodeTrustedHostContextHeader,
  resolveWorkspaceRuntime,
} from "../../apps/standalone-sveltekit/src/lib/server/workspace-services.ts";
import {
  AMPLIFY_LOGIN_PROXY_AUTH_AUTHORITY,
  AMPLIFY_LOGIN_PROXY_SCOPES,
  buildLoginProxyHostContext,
} from "../../apps/standalone-sveltekit/src/lib/server/amplify-login-proxy.ts";

const SECRET = "cross-signing-parity-secret";

// ---------------------------------------------------------------------------
// Donor-shaped implementation (independent re-derivation, not imported).
// ---------------------------------------------------------------------------
const DONOR_SIGNATURE_VERSION = "sonik.agent_ui.host_context.hmac.v1";
const DONOR_TTL_MS = 10 * 60 * 1000;
const DONOR_CLOCK_SKEW_MS = 60 * 1000;

function donorSortJsonValue(value) {
  if (Array.isArray(value)) return value.map(donorSortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, donorSortJsonValue(value[key])]),
  );
}
function donorStableJsonStringify(value) {
  return JSON.stringify(donorSortJsonValue(value));
}
function donorStripSignature(context) {
  const { signature: _signature, ...unsigned } = context;
  return unsigned;
}
function donorSign(context, secret) {
  return createHmac("sha256", secret).update(donorStableJsonStringify(donorStripSignature(context))).digest("base64url");
}
function donorCreateSignedAgentUiTrustedHostContext({ context, secret, issuedAt = new Date(), ttlMs = DONOR_TTL_MS }) {
  const expiresAt = new Date(issuedAt.getTime() + ttlMs);
  const unsigned = {
    ...context,
    signature: undefined,
    signatureVersion: DONOR_SIGNATURE_VERSION,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  return { ...unsigned, signature: donorSign(unsigned, secret) };
}
function donorSafeEqual(actual, expected) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(actualBytes, expectedBytes);
}
function donorIsSignedAgentUiTrustedHostContextValid(context, secret, now = new Date()) {
  const signature = context.signature;
  if (!signature) return false;
  if (context.signatureVersion !== DONOR_SIGNATURE_VERSION) return false;
  const issuedAt = context.issuedAt ? new Date(context.issuedAt) : null;
  const expiresAt = context.expiresAt ? new Date(context.expiresAt) : null;
  if (!issuedAt || Number.isNaN(issuedAt.getTime()) || !expiresAt || Number.isNaN(expiresAt.getTime())) return false;
  if (issuedAt.getTime() - DONOR_CLOCK_SKEW_MS > now.getTime()) return false;
  if (expiresAt.getTime() + DONOR_CLOCK_SKEW_MS < now.getTime()) return false;
  if (expiresAt.getTime() - issuedAt.getTime() > DONOR_TTL_MS + DONOR_CLOCK_SKEW_MS) return false;
  const expected = donorSign(context, secret);
  return donorSafeEqual(signature, expected);
}

// ---------------------------------------------------------------------------
// Fixture: a login-proxy session as resolved by mintLoginProxyEnvelope.
// ---------------------------------------------------------------------------
const loginProxySession = {
  authUserId: "amplify-user-parity-1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
};

function cloudRuntimeEventForHeader(headerValue) {
  return { event: {
    platform: {
      env: {
        SONIK_AGENT_UI_PERSISTENCE_MODE: "cloud",
        SONIK_AGENT_UI_DATABASE_URL: "postgres://user:pass@example.neon.tech/db",
        SONIK_AGENT_UI_HOST_CONTEXT_SECRET: SECRET,
      },
    },
    request: new Request("https://agent.example/api/session", {
      headers: { [AGENT_UI_HOST_CONTEXT_HEADER]: headerValue, "x-sonik-request-id": "request-parity" },
    }),
  } };
}

// ---------------------------------------------------------------------------
// 1. Sign with target, validate with donor-shaped implementation.
// ---------------------------------------------------------------------------
const targetSigned = createSignedTrustedHostContext({
  context: buildLoginProxyHostContext(loginProxySession),
  secret: SECRET,
});
assert.equal(targetSigned.signatureVersion, WORKSPACE_HOST_CONTEXT_SIGNATURE_VERSION);
assert.equal(WORKSPACE_HOST_CONTEXT_SIGNATURE_VERSION, DONOR_SIGNATURE_VERSION, "target and donor signature versions must match exactly");
assert.equal(
  donorIsSignedAgentUiTrustedHostContextValid(targetSigned, SECRET),
  true,
  "an envelope minted by the target signer must validate against an independently re-derived donor-shaped validator",
);
assert.equal(
  donorIsSignedAgentUiTrustedHostContextValid(targetSigned, "wrong-secret"),
  false,
  "donor-shaped validation must reject a target-signed envelope under the wrong secret",
);
{
  const tampered = { ...targetSigned, organizationId: "33333333-3333-4333-8333-333333333333" };
  assert.equal(
    donorIsSignedAgentUiTrustedHostContextValid(tampered, SECRET),
    false,
    "donor-shaped validation must reject a target-signed envelope whose payload was tampered with after signing",
  );
}

// ---------------------------------------------------------------------------
// 2. Sign with donor-shaped implementation, validate with target (indirectly
//    through resolveWorkspaceRuntime's existing cloud-mode signed path).
// ---------------------------------------------------------------------------
const donorSigned = donorCreateSignedAgentUiTrustedHostContext({
  context: buildLoginProxyHostContext(loginProxySession),
  secret: SECRET,
});
const donorHeader = encodeTrustedHostContextHeader(donorSigned);
const runtimeFromDonorEnvelope = resolveWorkspaceRuntime(cloudRuntimeEventForHeader(donorHeader));
assert.equal(runtimeFromDonorEnvelope.kind, "cloud", "an envelope minted by the donor-shaped signer must validate against the target's existing signed-header path");
assert.equal(runtimeFromDonorEnvelope.authorized.organizationId, loginProxySession.organizationId);
assert.equal(runtimeFromDonorEnvelope.authorized.userId, loginProxySession.principalId);

{
  const tamperedDonorSigned = { ...donorSigned, organizationId: "44444444-4444-4444-8444-444444444444" };
  const tamperedHeader = encodeTrustedHostContextHeader(tamperedDonorSigned);
  assert.throws(
    () => resolveWorkspaceRuntime(cloudRuntimeEventForHeader(tamperedHeader)),
    /requires authenticated host session context/,
    "target signed-header validation must reject a donor-shaped envelope tampered with after signing",
  );
}

// ---------------------------------------------------------------------------
// 3. TTL + clock-skew parity cases (plan §5 table), validated against the
//    donor-shaped implementation using target-minted envelopes.
// ---------------------------------------------------------------------------
const now = new Date();

// Expired by 1s beyond TTL+skew -> invalid.
{
  const issuedAt = new Date(now.getTime() - (DONOR_TTL_MS + DONOR_CLOCK_SKEW_MS + 1_000));
  const expired = createSignedTrustedHostContext({ context: buildLoginProxyHostContext(loginProxySession), secret: SECRET, issuedAt });
  assert.equal(donorIsSignedAgentUiTrustedHostContextValid(expired, SECRET, now), false, "expired-by-1s-beyond-skew envelope must be rejected");
}

// Expired but within clock skew -> still valid.
{
  const issuedAt = new Date(now.getTime() - (DONOR_TTL_MS + DONOR_CLOCK_SKEW_MS - 1_000));
  const withinSkew = createSignedTrustedHostContext({ context: buildLoginProxyHostContext(loginProxySession), secret: SECRET, issuedAt });
  assert.equal(donorIsSignedAgentUiTrustedHostContextValid(withinSkew, SECRET, now), true, "expiry within clock skew must still validate");
}

// Issued in the future but within clock skew -> valid.
{
  const issuedAt = new Date(now.getTime() + (DONOR_CLOCK_SKEW_MS - 1_000));
  const futureWithinSkew = createSignedTrustedHostContext({ context: buildLoginProxyHostContext(loginProxySession), secret: SECRET, issuedAt });
  assert.equal(donorIsSignedAgentUiTrustedHostContextValid(futureWithinSkew, SECRET, now), true, "issued-in-future-within-skew must still validate");
}

// Issued in the future beyond clock skew -> invalid.
{
  const issuedAt = new Date(now.getTime() + (DONOR_CLOCK_SKEW_MS + 1_000));
  const futureBeyondSkew = createSignedTrustedHostContext({ context: buildLoginProxyHostContext(loginProxySession), secret: SECRET, issuedAt });
  assert.equal(donorIsSignedAgentUiTrustedHostContextValid(futureBeyondSkew, SECRET, now), false, "issued-in-future-beyond-skew must be rejected");
}

// ---------------------------------------------------------------------------
// 4. Envelope-field parity vs an embed-donated envelope fixture.
// ---------------------------------------------------------------------------
// Shape produced by the existing embedded-host / dev-smoke-signer paths
// (see routes/api/dev/smoke-host-context/+server.ts's bootstrapHostSession).
const embedDonatedContext = {
  authenticated: true,
  organizationId: "11111111-1111-4111-8111-111111111111",
  scopes: ["booking:read", "booking:write"],
  hostSession: {
    source: "embedded-host",
    sessionId: "fixture-session-embed",
    userId: "fixture-user-0001",
    principalId: "fixture-user-0001",
    organizationId: "11111111-1111-4111-8111-111111111111",
    authenticated: true,
    scopes: ["booking:read", "booking:write"],
    expiresAt: null,
    metadata: { approvedCommandIds: ["booking.create.context"] },
  },
};
const loginProxyContext = buildLoginProxyHostContext(loginProxySession);

assert.deepEqual(
  Object.keys(loginProxyContext).sort(),
  Object.keys(embedDonatedContext).sort(),
  "login-proxy-minted context must have the exact same top-level envelope fields as an embed-donated context",
);
assert.deepEqual(
  Object.keys(loginProxyContext.hostSession).sort(),
  Object.keys(embedDonatedContext.hostSession).sort(),
  "login-proxy-minted hostSession must have the exact same fields as an embed-donated hostSession",
);
assert.equal(loginProxyContext.authenticated, true);
assert.equal(loginProxyContext.hostSession.authenticated, true);
assert.equal(
  loginProxyContext.hostSession.metadata.authAuthority,
  AMPLIFY_LOGIN_PROXY_AUTH_AUTHORITY,
  "login-proxy envelopes must be distinguishably tagged with their own authAuthority (plan §5) without weakening validation",
);
assert.notEqual(
  loginProxyContext.hostSession.source,
  embedDonatedContext.hostSession.source,
  "login-proxy and embed-donated sessions should be provenance-distinguishable via source while sharing the identical envelope shape",
);
assert.deepEqual(loginProxyContext.scopes, AMPLIFY_LOGIN_PROXY_SCOPES);

// Full round trip: sign the login-proxy-built context with the target signer
// and confirm resolveWorkspaceRuntime mounts cloud persistence from it, end
// to end -- this is the "standalone surface bootstraps cloud persistence"
// behavior the login route wires up.
const fullTargetSigned = createSignedTrustedHostContext({ context: loginProxyContext, secret: SECRET });
const fullHeader = encodeTrustedHostContextHeader(fullTargetSigned);
const fullRuntime = resolveWorkspaceRuntime(cloudRuntimeEventForHeader(fullHeader));
assert.equal(fullRuntime.kind, "cloud");
assert.equal(fullRuntime.authorized.organizationId, loginProxySession.organizationId);
assert.equal(fullRuntime.authorized.userId, loginProxySession.principalId);

console.log("amplify-login-proxy cross-signing parity tests passed");
