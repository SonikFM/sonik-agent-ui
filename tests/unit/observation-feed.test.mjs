import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

// R2-B (live console/network feed) red acceptance suite.
// Wished-for seam (.omc/plans/2026-07-21-dev-workbench-agent-tdd-plan.md, R2 —
// "console.jsonl/network.jsonl paths in bootstrap env (today: absent)"):
//   POST apps/dev-workbench/src/routes/api/workspaces/observations/+server.ts
// accepts a batched-events payload from the embedded host page's own capture
// (packages/agent-embed/src/observation-capture.ts's serialize() shape, sent
// live rather than only at navigation boundaries) and appends it via the
// existing apps/dev-workbench/src/lib/server/observation-mirror.ts sink
// (appendObservationEvents already exists and is unit-tested directly by
// tests/unit/observe-commands.test.mjs E1.5 — this suite is about the HTTP
// route in front of it, which does not exist yet).
//
// Route test pattern reused verbatim from tests/unit/preview-restart-route.test.mjs:
// the route's collaborator ($lib/server/observation-mirror) is swapped for a
// controllable fake via node:module registerHooks, so this suite proves route
// wiring/response-shape/bounds/redaction without needing a real sandbox or a
// real session store. Session auth mirrors apps/dev-workbench/src/routes/api/workspaces/preview/+server.ts
// (DEV_WORKBENCH_SESSION_COOKIE cookie -> 404 structured-unavailable if absent,
// never a 500) and apps/dev-workbench/src/routes/api/workspaces/context/+server.ts
// (body byte-cap -> 413, JSON.parse/schema failure -> 400, all structured, none 500).
//
// Payload shape pinned by this suite (not implemented anywhere yet):
//   POST body: { events: Array<{ kind: "console" | "network", seq, ...entry } > }
//   entry fields per packages/tool-contracts/src/observe.ts's
//   observeConsoleEntrySchema ({seq,level,message,timestamp}) and
//   observeNetworkEntrySchema ({seq,method,url,status,durationMs,sizeBytes}).
//   Success receipt: { ok: true, accepted: N }.
//   Rejection receipt: { ok: false, reason: string } (4xx), or
//   { ok: false, status: "unavailable", reason } for the no-session/no-config
//   case (matches preview route's shape exactly).
// Bounds pinned per plan D4 discussion with the lead: 100 events per batch,
// 64KB body, matching the context route's existing MAX_CONTEXT_BYTES = 64 * 1024.
// Idempotency and the redaction defense-in-depth are pinned as ROUTE-owned
// concerns (dedupe by session+seq in-memory before ever calling the append
// seam; re-run the shared @sonik-agent-ui/agent-observability redactor on
// console messages/URLs before the seam is invoked) so a stub of the seam can
// prove both without needing real file I/O.

const MAX_BATCH_EVENTS = 100;
const MAX_BATCH_BYTES = 64 * 1024;

const stub = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });

let mirrorImpl = async () => {
  throw new Error("recordSessionObservationBatch not configured for this test");
};
globalThis.__observationMirrorImpl = (...args) => mirrorImpl(...args);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "$lib/server/observation-mirror") {
      return stub(`
        export const recordSessionObservationBatch = (...args) => globalThis.__observationMirrorImpl(...args);
        export class InvalidSessionIdError extends Error {}
      `);
    }
    if (specifier === "$env/dynamic/private") {
      return stub(`export const env = {
        DEV_WORKBENCH_ENABLED: "true",
        DEV_WORKBENCH_REPOSITORY_URL: "https://github.com/sonikfm/sonik-agent-ui.git",
        DEV_WORKBENCH_REPOSITORY_REVISION: "main",
        DEV_WORKBENCH_ORGANIZATION_ID: "sonikfm",
      };`);
    }
    if (specifier.startsWith("$lib/")) {
      return { url: new URL(`../../apps/dev-workbench/src/lib/${specifier.slice(5)}.ts`, import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

async function loadRoute() {
  try {
    return await import("../../apps/dev-workbench/src/routes/api/workspaces/observations/+server.ts");
  } catch (error) {
    assert.fail(
      `not implemented: apps/dev-workbench/src/routes/api/workspaces/observations/+server.ts (POST handler for batched host console/network observation events) (import failed: ${error.message})`,
    );
  }
}

function consoleEvent(seq, message = "hello") {
  return { kind: "console", seq, level: "log", message, timestamp: new Date().toISOString() };
}

function networkEvent(seq) {
  return { kind: "network", seq, method: "GET", url: "https://booking.sonik.local/api/health", status: 200, durationMs: 12, sizeBytes: 128 };
}

function requestEvent({ cookie, body } = {}) {
  return {
    cookies: { get: (name) => (name === "sonik-dev-workbench-session" ? cookie : undefined) },
    request: new Request("https://workbench.local/api/workspaces/observations", {
      method: "POST",
      body: JSON.stringify(body ?? { events: [] }),
    }),
  };
}

test("R2-B.1: a valid batch is appended via the observation-mirror seam and returns an accepted receipt", async () => {
  const { POST } = await loadRoute();
  let captured = null;
  mirrorImpl = async (sessionId, events) => {
    captured = { sessionId, events };
    return { accepted: events.length };
  };
  const events = [consoleEvent(1), networkEvent(1)];
  const response = await POST(requestEvent({ cookie: "workspace-valid", body: { events } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, accepted: 2 });
  assert.ok(captured, "the route must invoke the observation-mirror seam");
  assert.equal(captured.sessionId, "workspace-valid");
  assert.equal(captured.events.length, 2, "both console and network events must reach the seam, routed by kind");
});

test("R2-B.2: a batch over the entry cap or the byte cap is rejected with a structured 4xx and nothing is appended", async () => {
  const { POST } = await loadRoute();
  let invoked = false;
  mirrorImpl = async (sessionId, events) => {
    invoked = true;
    return { accepted: events.length };
  };

  const tooManyEvents = Array.from({ length: MAX_BATCH_EVENTS + 1 }, (_, index) => consoleEvent(index));
  const overCount = await POST(requestEvent({ cookie: "workspace-bounds", body: { events: tooManyEvents } }));
  assert.equal(overCount.status >= 400 && overCount.status < 500, true, "a batch with more than 100 events must be a 4xx");
  const overCountBody = await overCount.json();
  assert.equal(overCountBody.ok, false);
  assert.ok(typeof overCountBody.reason === "string" && overCountBody.reason.length > 0);

  const overBytes = await POST(requestEvent({
    cookie: "workspace-bounds",
    body: { events: [consoleEvent(0, "x".repeat(MAX_BATCH_BYTES))] },
  }));
  assert.equal(overBytes.status >= 400 && overBytes.status < 500, true, "a batch body over 64KB must be a 4xx");
  const overBytesBody = await overBytes.json();
  assert.equal(overBytesBody.ok, false);
  assert.ok(typeof overBytesBody.reason === "string" && overBytesBody.reason.length > 0);

  assert.equal(invoked, false, "the observation-mirror seam must never be invoked for an over-cap batch");
});

test("R2-B.3: re-posting an identical batch (same seqs, same session) does not re-append duplicates", async () => {
  const { POST } = await loadRoute();
  const appendedBatches = [];
  mirrorImpl = async (sessionId, events) => {
    appendedBatches.push(events);
    return { accepted: events.length };
  };
  const events = [consoleEvent(10), consoleEvent(11)];

  const first = await POST(requestEvent({ cookie: "workspace-dedupe", body: { events } }));
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.accepted, 2);

  const second = await POST(requestEvent({ cookie: "workspace-dedupe", body: { events } }));
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.accepted, 0, "identical seqs re-posted for the same session must report 0 newly accepted");
  assert.equal(appendedBatches.length, 1, "the seam must not be invoked again once every event in the resubmitted batch was already recorded for this session");
});

test("R2-B.4: no session cookie returns a non-500 structured unavailable receipt and appends nothing", async () => {
  const { POST } = await loadRoute();
  let invoked = false;
  mirrorImpl = async (sessionId, events) => {
    invoked = true;
    return { accepted: events.length };
  };
  const response = await POST(requestEvent({ body: { events: [consoleEvent(1)] } }));
  assert.notEqual(response.status, 500);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, "unavailable");
  assert.ok(typeof body.reason === "string" && body.reason.length > 0);
  assert.equal(invoked, false, "nothing may be appended when no Dev Workbench session is attached");
});

test("R2-B.5: an unredacted secret in a console entry is redacted server-side before it ever reaches the observation-mirror seam", async () => {
  const { POST } = await loadRoute();
  let capturedEvents = null;
  mirrorImpl = async (sessionId, events) => {
    capturedEvents = events;
    return { accepted: events.length };
  };
  const secret = "sk-live-abc123def";
  const response = await POST(requestEvent({
    cookie: "workspace-secret",
    body: { events: [consoleEvent(1, `leaked credential ${secret} in the clear`)] },
  }));
  assert.equal(response.status, 200);
  assert.ok(capturedEvents, "the seam must have been invoked so we can inspect what would have been written to the JSONL mirror");
  const serialized = JSON.stringify(capturedEvents);
  assert.equal(
    serialized.includes(secret),
    false,
    "the raw secret must never reach the JSONL-writing seam, even when the capture layer failed to redact it first — the server must re-run redaction as defense-in-depth",
  );
});

test("R2C.5: two concurrent identical batches for the same session only append once (TOCTOU dedup race)", async () => {
  const { POST } = await loadRoute();
  const appendedBatches = [];
  mirrorImpl = async (sessionId, events) => {
    // Simulate real fs latency so both requests' synchronous dedupe-check
    // step (which today only reads `seen`, and mutates it only after this
    // await resolves) overlaps before either write completes.
    await new Promise((resolve) => setTimeout(resolve, 5));
    appendedBatches.push(events);
    return { accepted: events.length };
  };
  const events = [consoleEvent(20), consoleEvent(21)];
  const makeRequest = () => POST(requestEvent({ cookie: "workspace-race", body: { events } }));

  const [firstResponse, secondResponse] = await Promise.all([makeRequest(), makeRequest()]);
  const firstBody = await firstResponse.json();
  const secondBody = await secondResponse.json();
  const acceptedCounts = [firstBody.accepted, secondBody.accepted].sort((a, b) => a - b);
  assert.deepEqual(acceptedCounts, [0, 2], "exactly one of the two overlapping identical requests must accept the batch; the other must see every seq as already-seen");
  assert.equal(appendedBatches.length, 1, "the observation-mirror seam must only be invoked once for two concurrent identical batches");
});

test("R2C.6: a failed observation-mirror write returns a structured 5xx (never a raw 500) and the failed seqs remain retryable", async () => {
  const { POST } = await loadRoute();
  mirrorImpl = async () => {
    throw new Error("ENOSPC: no space left on device");
  };
  const response = await POST(requestEvent({ cookie: "workspace-write-failure", body: { events: [consoleEvent(30)] } }));
  assert.equal(response.status, 503, "an fs/seam failure must degrade to a structured 503, not an uncaught raw 500");
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.ok(typeof body.reason === "string" && body.reason.length > 0);

  // retry after the seam recovers: the earlier failed write must not have been
  // marked as "seen", so the same seq can still be accepted.
  let recovered = null;
  mirrorImpl = async (sessionId, events) => {
    recovered = events;
    return { accepted: events.length };
  };
  const retry = await POST(requestEvent({ cookie: "workspace-write-failure", body: { events: [consoleEvent(30)] } }));
  assert.equal(retry.status, 200);
  const retryBody = await retry.json();
  assert.equal(retryBody.accepted, 1, "a seq whose write previously failed must remain retryable, not be silently swallowed by the dedupe set");
  assert.ok(recovered, "the retried batch must reach the seam");
});

console.log("observation-feed tests: ok");
