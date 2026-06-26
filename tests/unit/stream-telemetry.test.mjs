import assert from "node:assert/strict";
import { sanitizeAgentTelemetry } from "../../apps/standalone-sveltekit/src/lib/server/agent-telemetry.ts";
import { instrumentGenerateStream } from "../../apps/standalone-sveltekit/src/lib/server/stream-telemetry.ts";


{
  const payload = sanitizeAgentTelemetry({
    source: "server",
    event: "api.generate.command_index_context",
    commandFamilies: ["a".repeat(3_000), "campaign", "", 42, ...Array.from({ length: 12 }, (_, index) => `family-${index}`)],
    skillFamilies: ["skill", "b".repeat(3_000)],
    ok: true,
  });

  assert.equal(payload.commandFamilies?.length, 8, "telemetry command family hints should be bounded and empty/non-string entries dropped");
  assert.equal(payload.commandFamilies?.[0].length, 2_001, "telemetry command family hints should truncate long entries with ellipsis");
  assert.equal(payload.commandFamilies?.[1], "campaign");
  assert.deepEqual(payload.skillFamilies?.map((entry) => entry.length), [5, 2_001], "telemetry skill family hints should be individually truncated");
}

async function readAll(stream) {
  const reader = stream.getReader();
  const values = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return values;
    values.push(value);
  }
}

{
  const events = [];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("a");
      controller.enqueue("b");
      controller.close();
    },
  });

  const values = await readAll(instrumentGenerateStream(stream, { requestId: "req-ok", traceId: "0123456789abcdef0123456789abcdef", traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01", startedAt: Date.now() }, async (event) => {
    events.push(event);
  }));

  assert.deepEqual(values, ["a", "b"]);
  assert.equal(events.length, 2);
  assert.equal(events[0].event, "api.generate.stream_first_visible_chunk");
  assert.equal(events[0].phase, undefined, "string streams should not invent a chunk type");
  assert.equal(events[1].event, "api.generate.stream_finished");
  assert.equal(events[1].ok, true);
  assert.equal(events[1].traceId, "0123456789abcdef0123456789abcdef");
}

{
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue("still-delivered");
      controller.close();
    },
  });

  const values = await readAll(instrumentGenerateStream(stream, { requestId: "req-telemetry-fails", startedAt: Date.now() }, async () => {
    throw new Error("telemetry disk unavailable");
  }));

  assert.deepEqual(values, ["still-delivered"], "telemetry write failures must not break successful streams");
}

{
  const events = [];
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new Error("upstream exploded"));
    },
  });

  await assert.rejects(
    readAll(instrumentGenerateStream(stream, { requestId: "req-fail", startedAt: Date.now() }, async (event) => {
      events.push(event);
    })),
    /upstream exploded/,
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].event, "api.generate.stream_failed");
  assert.equal(events[0].ok, false);
  assert.equal(events[0].error, "upstream exploded");
}

{
  const events = [];
  let cancelReason;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue("first");
    },
    cancel(reason) {
      cancelReason = reason;
    },
  });

  const reader = instrumentGenerateStream(stream, { requestId: "req-cancel", startedAt: Date.now() }, async (event) => {
    events.push(event);
  }).getReader();
  const first = await reader.read();
  assert.equal(first.value, "first");
  await reader.cancel("manual-stop");

  assert.equal(cancelReason, "manual-stop");
  assert.equal(events.length, 2);
  assert.equal(events[0].event, "api.generate.stream_first_visible_chunk");
  assert.equal(events[1].event, "api.generate.stream_cancelled");
  assert.equal(events[1].ok, false);
}

{
  const events = [];
  const observerEvents = [];
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "start" });
      controller.enqueue({ type: "text-start", id: "txt" });
      controller.enqueue({ type: "text-delta", id: "txt", delta: "" });
      setTimeout(() => {
        controller.enqueue({ type: "text-delta", id: "txt", delta: "Hello" });
        controller.enqueue({ type: "tool-createJsonArtifact", toolCallId: "tool-1", state: "output-available" });
        controller.enqueue({ type: "data-spec", data: { type: "flat", spec: { root: "main", elements: { main: { type: "Text", props: { content: "Hello" }, children: [] } }, state: {} } } });
        controller.close();
      }, 35);
    },
  });

  await readAll(instrumentGenerateStream(stream, { requestId: "req-wait", startedAt: Date.now(), waitingMs: 5, waitingIntervalMs: 20, observer: (event) => observerEvents.push(event) }, async (event) => {
    events.push(event);
  }));

  const waitEvents = events.filter((event) => event.event === "api.generate.stream_waiting");
  assert.ok(waitEvents.length >= 1 && waitEvents.length <= 3, `silent wait telemetry should respect cadence, got ${waitEvents.length}`);
  assert.equal(waitEvents.every((event) => event.phase === "before_visible_output"), true, "protocol chunks must not flip wait telemetry to after-visible-output");
  assert.equal(events.some((event) => event.event === "api.generate.stream_first_visible_chunk" && (event.phase === "start" || event.phase === "text-start")), false, "protocol chunks are not user-visible output");
  assert.equal(events.some((event) => event.event === "api.generate.stream_first_visible_text" && event.phase === "text-start"), false, "text-start does not contain visible text");
  assert.equal(events.some((event) => event.event === "api.generate.stream_first_visible_text"), true, "first visible text latency should be observable");
  assert.equal(events.some((event) => event.event === "api.generate.stream_first_tool" && event.phase === "createJsonArtifact"), true, "first tool latency should be observable");
  assert.equal(events.some((event) => event.event === "api.generate.stream_first_artifact_spec"), true, "first artifact spec latency should be observable");
  assert.equal(observerEvents.some((event) => event.event === "api.generate.stream_first_tool"), true, "observer seam should receive sanitized stream milestone events");
}

console.log("stream-telemetry tests passed");
