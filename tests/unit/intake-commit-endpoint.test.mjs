import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Draft-only invariant (Slice A, 2026-07-08): POST /api/intake/commit is the
// ONLY code path that publishes a booking-context intake draft, invoked
// directly by the client Approve button -- no model turn runs. It reuses the
// exact same trust checks as /api/generate (resolveTrustedHostSessionSnapshot,
// createAgentHostSessionEnvelope, approvedCommandIdsFromHostSession) so the
// "ask"/"allow" distinction and the commit gate can never drift between the
// two call sites.
//
// The route module itself (+server.ts) imports SvelteKit's $env/$lib aliases
// and ./$types, which don't resolve under plain node -- consistent with every
// other +server.ts in this suite (see workspace-store.test.mjs, which only
// source-pins routes for the same reason). This file instead:
//   1. Exercises the shared trust-resolution helpers the route calls directly
//      (they live in host-command-runtime.ts / workspace-services.ts, neither
//      of which touches SvelteKit aliases, so they're plain-node testable).
//   2. Source-pins the route to prove it actually wires those helpers in,
//      returns a typed error for the auth failure branch, requires an
//      artifactId, and delegates the manifest/readiness/host-grant logic to
//      commitBookingContextIntakeCommand (fully exercised in
//      intake-command-execution-seam.test.mjs and
//      draft-only-commit-invariant.test.mjs) rather than duplicating it.

const [hostCommandRuntimeModule, workspaceServicesModule] = await Promise.all([
  import("../../apps/standalone-sveltekit/src/lib/server/host-command-runtime.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/workspace-services.ts"),
]);

const { createAgentHostSessionEnvelope, approvedCommandIdsFromHostSession } = hostCommandRuntimeModule;
const { resolveTrustedHostSessionSnapshot } = workspaceServicesModule;

function fakeEvent(input = {}) {
  return {
    request: input.request ?? new Request("https://agent-ui.test/api/intake/commit", { method: "POST" }),
    locals: input.locals,
    platform: input.platform ?? null,
  };
}

// 1a. No trusted host session context at all -> unauthenticated, null envelope.
// This is the exact branch the endpoint must reject with 401 before ever
// touching an artifact.
const anonymousEvent = fakeEvent({});
const anonymousSnapshot = resolveTrustedHostSessionSnapshot(anonymousEvent);
assert.equal(anonymousSnapshot.authenticated, false, "no host context resolves to an unauthenticated snapshot");
assert.equal(createAgentHostSessionEnvelope(anonymousEvent), null, "createAgentHostSessionEnvelope must return null with no authenticated host session");
assert.equal(createAgentHostSessionEnvelope(undefined), null, "createAgentHostSessionEnvelope must tolerate an undefined event");

// 1b. Authenticated but missing organizationId -> still must fail closed. A
// valid envelope requires BOTH authenticated:true AND organizationId.
const authenticatedNoOrgEvent = fakeEvent({ locals: { agentUiHostSession: { authenticated: true, userId: "user_1" } } });
assert.equal(createAgentHostSessionEnvelope(authenticatedNoOrgEvent), null, "createAgentHostSessionEnvelope must refuse an authenticated session with no organizationId");

// 1c. Fully trusted host session (server-local-auth-adapter path via
// event.locals, the same shape /api/generate resolves from a signed header or
// dev fixture) -> a real HostSessionEnvelope the endpoint can act on.
const trustedEvent = fakeEvent({
  locals: {
    agentUiHostSession: {
      source: "amplify-embedded",
      authenticated: true,
      organizationId: "org_intake_commit_test",
      userId: "user_intake_commit_test",
      scopes: ["booking:read", "booking:write"],
      metadata: { approvedCommandIds: ["booking.create.context", "  ", "booking.create.context", "booking.create.hold"] },
    },
  },
});
const envelope = createAgentHostSessionEnvelope(trustedEvent);
assert.ok(envelope, "createAgentHostSessionEnvelope must resolve a real envelope for an authenticated, org-scoped session");
assert.equal(envelope.authenticated, true);
assert.equal(envelope.organizationId, "org_intake_commit_test");
assert.equal(envelope.principalId, "user_intake_commit_test", "principalId falls back to userId when absent");

// 2. approvedCommandIdsFromHostSession: trims, dedupes, drops blanks, and is
// the ONLY source of a "grant" -- never model- or client-provided.
assert.deepEqual(
  approvedCommandIdsFromHostSession(envelope),
  ["booking.create.context", "booking.create.hold"],
  "approvedCommandIdsFromHostSession must dedupe and drop blank entries",
);
assert.deepEqual(approvedCommandIdsFromHostSession(null), [], "approvedCommandIdsFromHostSession must return an empty grant for a null host session");
assert.deepEqual(
  approvedCommandIdsFromHostSession({ metadata: { approvedCommandIds: "not-an-array" } }),
  [],
  "approvedCommandIdsFromHostSession must ignore a non-array approvedCommandIds value",
);
const oversizedIds = Array.from({ length: 200 }, (_, i) => `booking.command.${i}`);
assert.equal(
  approvedCommandIdsFromHostSession({ metadata: { approvedCommandIds: oversizedIds } }).length,
  128,
  "approvedCommandIdsFromHostSession must bound the grant to 128 ids (the same cap /api/generate enforces)",
);

// 3. Source-pin the route: prove it reuses the shared helpers checked above
// instead of a local copy, fails closed with a typed 401 before touching an
// artifact, requires artifactId, and delegates to the shared commit function.
const routeSource = await readFile("apps/standalone-sveltekit/src/routes/api/intake/commit/+server.ts", "utf8");
assert.ok(routeSource.includes("createAgentHostSessionEnvelope"), "route must reuse the shared trusted host-session resolver, not a local copy");
assert.ok(routeSource.includes("approvedCommandIdsFromHostSession"), "route must reuse the shared approved-command-grant resolver, not a local copy");
assert.ok(routeSource.includes("commitBookingContextIntakeCommand"), "route must delegate manifest/readiness/host-grant logic to the shared commit function, not duplicate it");
assert.ok(routeSource.includes("createRequestBookingRuntimeFetcher"), "route must create a request-scoped booking runtime fetcher");
assert.ok(routeSource.includes("bookingRuntimeFetcher,"), "route must pass the booking runtime fetcher into the shared intake commit function");
assert.ok(routeSource.includes('error: "unauthenticated"'), "route must return a typed error for the missing-trusted-session branch");
assert.ok(routeSource.includes("status: 401"), "route must fail closed with 401 when no trusted host session is present");
assert.ok(routeSource.includes('error(400, "artifactId is required")'), "route must require an artifactId (typed 400) before doing any work");
assert.ok(routeSource.includes("AGENT_UI_HOST_CONTEXT_HEADER"), "route must read the same signed host-context header /api/generate reads");

// 4. Source-pin the client wiring: the Approve button must call this endpoint
// directly instead of sending a model turn.
const pageSource = await readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");
assert.ok(pageSource.includes('workspaceFetch("/api/intake/commit"'), "the client must POST to the deterministic commit endpoint on approveAndRun");

console.log(JSON.stringify({ ok: true, checked: "intake-commit-endpoint", organizationId: envelope.organizationId }));
