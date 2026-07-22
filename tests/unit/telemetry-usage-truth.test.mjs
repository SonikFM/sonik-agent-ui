import assert from "node:assert/strict";
import test from "node:test";
import { createRunEventMapper } from "../../apps/standalone-sveltekit/src/lib/server/run-event-log.ts";

// Pinned wished-for API (E2 of .omc/plans/2026-07-21-dev-workbench-agent-tdd-plan.md):
// - apps/standalone-sveltekit/src/lib/server/usage-capture.ts exports
//   recordUsageFromResult(appendRunEvent, {requestId, totalUsage}), which awaits the
//   promise-shaped totalUsage from a streamText result and appends
//   {kind:"usage", requestId, usage:{inputTokens, outputTokens, totalTokens}}.
// - packages/agent-observability/src/telemetry-feed.ts exports
//   createTelemetryFeed({heartbeatIntervalMs, now?}) -> {append(event), heartbeat(), read({sinceSeq, limit})}.
// Neither module exists yet, so every dynamic import below fails and each test
// reports a clean "not implemented" failure instead of an unhandled import error.

const USAGE_CAPTURE_PATH = "../../apps/standalone-sveltekit/src/lib/server/usage-capture.ts";
const TELEMETRY_FEED_PATH = "../../packages/agent-observability/src/telemetry-feed.ts";

async function loadUsageCapture() {
  try {
    return await import(USAGE_CAPTURE_PATH);
  } catch {
    return null;
  }
}

async function loadTelemetryFeed() {
  try {
    return await import(TELEMETRY_FEED_PATH);
  } catch {
    return null;
  }
}

test("recordUsageFromResult appends exactly one usage event with nonzero token counts", async () => {
  const mod = await loadUsageCapture();
  if (!mod?.recordUsageFromResult) {
    assert.fail(`not implemented: ${USAGE_CAPTURE_PATH} must export recordUsageFromResult(appendRunEvent, {requestId, totalUsage})`);
    return;
  }
  const appended = [];
  const totalUsage = Promise.resolve({ inputTokens: 123, outputTokens: 45, totalTokens: 168 });

  await mod.recordUsageFromResult((event) => appended.push(event), { requestId: "req-usage-1", totalUsage });

  assert.equal(appended.length, 1, "exactly one event must be appended");
  const [event] = appended;
  assert.equal(event.kind, "usage");
  assert.equal(event.usage.inputTokens, 123);
  assert.equal(event.usage.outputTokens, 45);
  assert.equal(event.usage.totalTokens, 168);
  assert.notEqual(event.usage.inputTokens, 0, "inputTokens must be nonzero");
  assert.notEqual(event.usage.outputTokens, 0, "outputTokens must be nonzero");
  assert.notEqual(event.usage.totalTokens, 0, "totalTokens must be nonzero");
});

test("usage event correlation id matches the requestId passed to recordUsageFromResult", async () => {
  const mod = await loadUsageCapture();
  if (!mod?.recordUsageFromResult) {
    assert.fail(`not implemented: ${USAGE_CAPTURE_PATH} must export recordUsageFromResult (correlation)`);
    return;
  }
  const appended = [];
  const totalUsage = Promise.resolve({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });

  await mod.recordUsageFromResult((event) => appended.push(event), { requestId: "req-correlate-42", totalUsage });

  assert.equal(appended.length, 1);
  assert.equal(appended[0].requestId, "req-correlate-42", "usage event must carry the generate request's requestId");
});

test("telemetry feed round-trip: an appended event is visible via read in under 2000ms", async () => {
  const mod = await loadTelemetryFeed();
  if (!mod?.createTelemetryFeed) {
    assert.fail(`not implemented: ${TELEMETRY_FEED_PATH} must export createTelemetryFeed({heartbeatIntervalMs, now?})`);
    return;
  }
  const feed = mod.createTelemetryFeed({ heartbeatIntervalMs: 1000 });

  const start = Date.now();
  feed.append({ kind: "receipt", commandId: "observe.console.read", status: "executed" });
  const { events, latestSeq } = feed.read({ sinceSeq: 0, limit: 50 });
  const elapsed = Date.now() - start;

  assert.equal(events.length, 1, "the appended receipt must be visible via read");
  assert.equal(events[0].kind, "receipt");
  assert.ok(latestSeq >= 1, "append must assign a monotonic seq");
  assert.ok(elapsed < 2000, `round-trip SLA violated: ${elapsed}ms`);
});

test("heartbeat staleness: stale is false inside 2x the interval, true and lag-stamped beyond it", async () => {
  const mod = await loadTelemetryFeed();
  if (!mod?.createTelemetryFeed) {
    assert.fail(`not implemented: ${TELEMETRY_FEED_PATH} must export createTelemetryFeed (heartbeat staleness)`);
    return;
  }
  let currentTime = 0;
  const feed = mod.createTelemetryFeed({ heartbeatIntervalMs: 1000, now: () => currentTime });

  feed.heartbeat(); // last activity at t=0

  currentTime = 1500;
  const fresh = feed.read({ sinceSeq: 0, limit: 50 });
  assert.equal(fresh.stale, false, "1500ms since the last heartbeat is under 2x the 1000ms interval");

  currentTime = 2500;
  const stale = feed.read({ sinceSeq: 0, limit: 50 });
  assert.equal(stale.stale, true, "2500ms since the last heartbeat exceeds 2x the 1000ms interval");
  assert.equal(stale.lagMs, 2500, "lagMs must reflect the measured staleness");
});

test("regression: createRunEventMapper alone never emits usage from a v7 finish chunk; usage-capture.ts is the only source", async () => {
  const mapper = createRunEventMapper();
  // A real v7 UIMessageChunk `finish`/`finish-step` carries no usage/totalUsage
  // fields, so the mapper's existing `if (usage)` guard is never satisfied.
  const v7FinishChunk = { type: "finish" };
  const eventsFromMapper = mapper.map(v7FinishChunk);
  assert.deepEqual(eventsFromMapper, [], "createRunEventMapper must not synthesize a usage event from a v7 finish chunk with no usage fields");

  const mod = await loadUsageCapture();
  if (!mod?.recordUsageFromResult) {
    assert.fail(`not implemented: ${USAGE_CAPTURE_PATH} must be the source of the usage event the mapper can no longer produce`);
    return;
  }
  const appended = [];
  await mod.recordUsageFromResult((event) => appended.push(event), {
    requestId: "req-regression-1",
    totalUsage: Promise.resolve({ inputTokens: 7, outputTokens: 8, totalTokens: 15 }),
  });
  assert.equal(appended.length, 1, "usage-capture.ts, not the mapper, must be what produces the usage event");
  assert.equal(appended[0].kind, "usage");
});
