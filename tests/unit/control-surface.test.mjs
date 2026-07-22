import assert from "node:assert/strict";
import test from "node:test";

// E6 (Epic 6 - Dan's control surface) + R6 red acceptance suite.
// Pinned wished-for API (.omc/plans/2026-07-21-dev-workbench-agent-tdd-plan.md, E6 + R6):
//   packages/agent-embed/src/control-surface.ts exporting:
//     assembleBugReport({capture, pageContext, screenshotRef?})
//       -> {kind:"bug-report", createdAt, console:{entries,droppedCount},
//           network:{entries,droppedCount}, pageContext, screenshotRef}
//     attachToConversation({conversation, attachment})
//       -> appends a v7-canonical {type:"file", mediaType, data} message part,
//          returns a receipt with receiptId
//     createPauseSwitch() -> {pause(), resume(), guard(commandFn)}
//   Consumes packages/agent-embed/src/observation-capture.ts (lane W1-B, in
//   flight per the plan) via createObservationCapture()'s
//   recordConsole/recordNetwork/readConsole/readNetwork.
// Neither module is landed yet, so every dynamic import below fails and each
// test reports a clean "not implemented" failure instead of an unhandled
// import error (matches the importOrFail idiom in observe-commands.test.mjs
// and telemetry-usage-truth.test.mjs).

async function importOrFail(specifier, what) {
  try {
    return await import(specifier);
  } catch (error) {
    assert.fail(`not implemented: ${what} (import of ${specifier} failed: ${error.message})`);
  }
}

async function loadControlSurface() {
  const mod = await importOrFail(
    "../../packages/agent-embed/src/control-surface.ts",
    "packages/agent-embed/src/control-surface.ts exporting assembleBugReport/attachToConversation/createPauseSwitch",
  );
  for (const name of ["assembleBugReport", "attachToConversation", "createPauseSwitch"]) {
    if (typeof mod[name] !== "function") {
      assert.fail(`not implemented: ${name} export from packages/agent-embed/src/control-surface.ts`);
    }
  }
  return mod;
}

async function loadObservationCapture() {
  const mod = await importOrFail(
    "../../packages/agent-embed/src/observation-capture.ts",
    "packages/agent-embed/src/observation-capture.ts exporting createObservationCapture (lane W1-B, existing-by-contract)",
  );
  if (typeof mod.createObservationCapture !== "function") {
    assert.fail("not implemented: createObservationCapture export from packages/agent-embed/src/observation-capture.ts");
  }
  return mod;
}

test("E6.1: assembleBugReport packages console + network + pageContext + screenshot into one payload, secret never leaks, payload <= 64KB", async () => {
  const { assembleBugReport } = await loadControlSurface();
  const { createObservationCapture } = await loadObservationCapture();

  const capture = createObservationCapture();
  capture.recordConsole("error", ["login failed", { apiKey: "sk-live-abc123" }]);
  capture.recordConsole("warn", ["retrying"]);
  capture.recordConsole("info", ["ready"]);
  capture.recordNetwork({ method: "GET", url: "https://booking.sonik.local/api/health", status: 200, durationMs: 12, sizeBytes: 128 });
  capture.recordNetwork({ method: "POST", url: "https://booking.sonik.local/api/reservations", status: 500, durationMs: 842, sizeBytes: 1024 });

  const pageContext = { route: "/booking/reservations", surface: "booking", at: "2026-07-21T00:00:00.000Z" };
  const screenshotRef = { mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAUA" };

  const payload = assembleBugReport({ capture, pageContext, screenshotRef });

  assert.equal(payload.kind, "bug-report");
  assert.equal(typeof payload.createdAt, "string");
  assert.equal(payload.console.entries.length, 3, "expected all 3 recorded console entries within budget");
  assert.equal(payload.network.entries.length, 2, "expected all 2 recorded network entries within budget");
  assert.deepEqual(payload.pageContext, pageContext, "pageContext must pass through the existing sanitization unchanged for already-clean fields");
  assert.deepEqual(payload.screenshotRef, screenshotRef);

  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("sk-live-abc123"), false, "raw secret value must never appear anywhere in the assembled bug report");
  assert.ok(serialized.length <= 65536, `serialized bug report must stay within the 64KB budget, got ${serialized.length} bytes`);
});

test("E6.2: assembleBugReport respects the observe budgets — 300 console entries yield <=200 entries with droppedCount reflecting the excess", async () => {
  const { assembleBugReport } = await loadControlSurface();
  const { createObservationCapture } = await loadObservationCapture();

  const capture = createObservationCapture();
  for (let index = 0; index < 300; index += 1) {
    capture.recordConsole("info", [`entry-${index}`]);
  }

  const payload = assembleBugReport({ capture, pageContext: {} });

  assert.ok(payload.console.entries.length <= 200, `console.entries must be bounded to <=200, got ${payload.console.entries.length}`);
  assert.equal(payload.console.droppedCount, 300 - payload.console.entries.length, "droppedCount must reflect the entries evicted beyond the bound");
  assert.ok(payload.console.droppedCount > 0, "overfilled capture must report a nonzero droppedCount");
});

test("E6.3: attachToConversation appends exactly one v7-canonical file-part message and returns a receipt", async () => {
  const { attachToConversation } = await loadControlSurface();

  const conversation = { messages: [] };
  const screenshotRef = { mediaType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAUA" };

  const receipt = await attachToConversation({ conversation, attachment: screenshotRef });

  assert.equal(conversation.messages.length, 1, "attachToConversation must append exactly one message");
  const [message] = conversation.messages;
  assert.ok(Array.isArray(message.parts), "appended message must carry a parts array");
  const [part] = message.parts;
  assert.deepEqual(part, { type: "file", mediaType: "image/png", data: screenshotRef.data }, "appended part must be a v7-canonical file part shaped from the screenshot ref");
  assert.equal(typeof receipt.receiptId, "string", "attachToConversation must return a receipt with a receiptId");
  assert.ok(receipt.receiptId.length > 0);
});

test("E6.4: createPauseSwitch blocks guarded commands while paused without invoking them, and calls through after resume", async () => {
  const { createPauseSwitch } = await loadControlSurface();

  let callCount = 0;
  const spy = async (arg) => {
    callCount += 1;
    return { ok: true, status: "executed", value: arg };
  };

  const pauseSwitch = createPauseSwitch();
  pauseSwitch.pause();
  const guarded = pauseSwitch.guard(spy);

  const blocked = await guarded("first");
  assert.equal(callCount, 0, "the underlying command must NOT be invoked while paused");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, "blocked");
  assert.equal(typeof blocked.reason, "string");
  assert.ok(blocked.reason.length > 0, "blocked receipt must carry a non-empty reason");

  pauseSwitch.resume();
  const executed = await guarded("second");
  assert.equal(callCount, 1, "the underlying command must be invoked exactly once after resume");
  assert.deepEqual(executed, { ok: true, status: "executed", value: "second" }, "after resume the real command result must be returned unchanged");
});
