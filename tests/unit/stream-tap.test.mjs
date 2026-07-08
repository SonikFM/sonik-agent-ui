import assert from "node:assert/strict";
import { tapSpecStreamForTelemetry } from "../../apps/standalone-sveltekit/src/lib/server/spec-stream-tap-telemetry.ts";

async function readAll(stream) {
  const reader = stream.getReader();
  const values = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return values;
    values.push(value);
  }
}

function baseContext(overrides = {}) {
  return { requestId: "req-tap", startedAt: Date.now(), ...overrides };
}

// (a) + (b): the tapped stream passes chunks through byte-identical, and a
// bounded summary event is emitted at stream end with correct aggregated
// counts, plus one per-patch event per patch (patch count is well under 50).
{
  const chunks = [
    { type: "start" },
    { type: "text-delta", id: "t1", delta: "Building..." },
    { type: "data-spec", data: { type: "patch", patch: { op: "add", path: "/elements/main", value: { type: "Card", props: {}, children: [] } } } },
    { type: "data-spec", data: { type: "patch", patch: { op: "replace", path: "/elements/main/props/title", value: "Hi" } } },
    { type: "data-spec", data: { type: "patch", patch: { op: "add", path: "/elements/sidebar", value: { type: "Text", props: {}, children: [] } } } },
    { type: "text-delta", id: "t1", delta: " done" },
  ];
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

  const captured = [];
  let resolveSummary;
  const summarySeen = new Promise((resolve) => {
    resolveSummary = resolve;
  });
  const writeTelemetry = async (event) => {
    captured.push(event);
    if (event.event === "api.generate.spec_stream_summary") resolveSummary();
  };

  const tapped = tapSpecStreamForTelemetry(source, baseContext({ sessionId: "sess-1" }), writeTelemetry);
  const values = await readAll(tapped);
  await summarySeen;

  assert.deepEqual(values, chunks, "tapped stream must pass chunks through byte-identical");

  const patchEvents = captured.filter((event) => event.event === "api.generate.spec_stream_patch");
  assert.equal(patchEvents.length, 3, "one per-patch event should be emitted per patch when under the cap");
  assert.deepEqual(patchEvents.map((event) => event.payload.elementKey), ["main", "main", "sidebar"]);
  assert.deepEqual(patchEvents.map((event) => event.payload.patchIndex), [1, 2, 3]);
  assert.equal(patchEvents.every((event) => event.sessionId === "sess-1"), true);

  const summaryEvents = captured.filter((event) => event.event === "api.generate.spec_stream_summary");
  assert.equal(summaryEvents.length, 1, "exactly one summary event should be emitted");
  const summary = summaryEvents[0];
  assert.equal(summary.ok, true);
  assert.equal(summary.payload.patchCount, 3);
  assert.equal(summary.payload.textChunkCount, 2);
  assert.deepEqual(summary.payload.elementKeys.slice().sort(), ["main", "sidebar"]);
  assert.equal(typeof summary.payload.firstPatchAt, "number");
  assert.equal(typeof summary.payload.lastPatchAt, "number");
  assert.equal(typeof summary.durationMs, "number");
}

// (c): a tap construction error (e.g. the source stream is already locked,
// so `ReadableStream.tee()` throws) must not propagate to the caller. The
// original stream is returned untouched and an error telemetry event fires.
{
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "text-delta", id: "t1", delta: "hi" });
      controller.close();
    },
  });
  const lockingReader = source.getReader();

  const captured = [];
  const writeTelemetry = async (event) => {
    captured.push(event);
  };

  let tapped;
  assert.doesNotThrow(() => {
    tapped = tapSpecStreamForTelemetry(source, baseContext(), writeTelemetry);
  }, "tap construction failures must not propagate to the caller");

  assert.equal(tapped, source, "on tap failure the original stream must be returned unchanged");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].event, "api.generate.spec_stream_tap_error");
  assert.equal(captured[0].ok, false);
  assert.equal(typeof captured[0].error, "string");

  lockingReader.releaseLock();
  const values = await readAll(source);
  assert.deepEqual(values, [{ type: "text-delta", id: "t1", delta: "hi" }], "the fallback stream must still be readable");
}

console.log("stream-tap tests passed");
