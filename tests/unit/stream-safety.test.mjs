import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createUiMessageStreamSafetyTransform,
  pipeJsonRender,
} from "../../packages/core/src/types.ts";

async function readAll(stream) {
  const reader = stream.getReader();
  const values = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return values;
    values.push(value);
  }
}

async function transformValues(values, options = {}) {
  const transform = createUiMessageStreamSafetyTransform(options);
  const writer = transform.writable.getWriter();
  const readPromise = readAll(transform.readable);
  for (const value of values) await writer.write(value);
  await writer.close();
  return readPromise;
}

{
  let stats;
  const values = await transformValues([
    { type: "start", messageId: "m1" },
    { type: "reasoning-start", id: "r1" },
    { type: "reasoning-delta", id: "r1", delta: "private" },
    { type: "reasoning-end", id: "r1" },
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "hello" },
    { type: "text-delta", id: "t1", delta: " world" },
    { type: "text-end", id: "t1" },
    { type: "finish", finishReason: "stop" },
  ], { maxTextDeltaChars: 12, onStats: (value) => { stats = value; } });

  assert.deepEqual(values.map((value) => value.type), ["start", "text-start", "text-delta", "text-end", "finish"]);
  assert.equal(values.find((value) => value.type === "text-delta")?.delta, "hello world");
  assert.equal(stats.reasoningChunksDropped, 3);
  assert.equal(stats.textDeltaChunksIn, 2);
  assert.equal(stats.textDeltaChunksOut, 1);
}

{
  const values = await transformValues([
    { type: "text-start", id: "t1" },
    {
      type: "text-delta",
      id: "t1",
      delta: "abcdefghijklmnopqrstuvwxyz",
      providerMetadata: { fixture: { preserved: true } },
      customField: "keep-me",
    },
    { type: "text-end", id: "t1" },
  ], { maxTextDeltaChars: 10 });
  const textDeltas = values.filter((value) => value.type === "text-delta");
  const deltas = textDeltas.map((value) => value.delta);
  assert.deepEqual(deltas, ["abcdefghij", "klmnopqrst", "uvwxyz"]);
  assert.ok(textDeltas.every((value) => value.providerMetadata?.fixture?.preserved === true), "text-delta metadata should be preserved");
  assert.ok(textDeltas.every((value) => value.customField === "keep-me"), "text-delta extension fields should be preserved");
}

{
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "text-start", id: "t1" });
      controller.enqueue({ type: "text-delta", id: "t1", delta: "Here is text before JSON\n" });
      controller.enqueue({ type: "text-delta", id: "t1", delta: '{"op":"add","path":"/root","value":"main"}\n' });
      controller.enqueue({ type: "text-delta", id: "t1", delta: "After JSON" });
      controller.enqueue({ type: "text-end", id: "t1" });
      controller.close();
    },
  });
  const values = await readAll(pipeJsonRender(input).pipeThrough(createUiMessageStreamSafetyTransform({ maxTextDeltaChars: 12 })));
  const textDeltas = values.filter((value) => value.type === "text-delta");
  assert.ok(textDeltas.every((value) => value.delta.length <= 12), "safety transform must bound prose deltas after json-render parsing");
  assert.ok(values.some((value) => value.type === "data-spec"), "json-render spec patches must be preserved");
  assert.ok(values.some((value) => value.type === "text-end"), "text-end must be preserved");
}



function parseSseChunks(text) {
  const chunks = [];
  for (const match of text.matchAll(/^data: (.+)$/gm)) {
    if (match[1] === "[DONE]") continue;
    chunks.push(JSON.parse(match[1]));
  }
  return chunks;
}

{
  let stats;
  const raw = await readFile("tests/fixtures/stream-safety/three-bullet-real-raw.sse", "utf8");
  const chunks = parseSseChunks(raw);
  assert.ok(chunks.filter((chunk) => chunk.type === "reasoning-delta").length > 0, "fixture should preserve the sanitized reasoning-shaped real stream structure");
  assert.ok(chunks.filter((chunk) => chunk.type === "text-delta").length > 400, "fixture should preserve the original micro-delta crash shape");

  const values = await transformValues(chunks, { maxTextDeltaChars: 12, onStats: (value) => { stats = value; } });
  const textDeltas = values.filter((value) => value.type === "text-delta");
  assert.equal(values.some((value) => value.type.startsWith("reasoning-")), false, "reasoning chunks must not reach browser UI");
  assert.ok(textDeltas.length < 80, `expected coalescing to reduce browser text updates, got ${textDeltas.length}`);
  assert.ok(textDeltas.every((value) => value.delta.length <= 12), "all browser text deltas should be bounded below the captured grouped-25 crash shape");
  assert.equal(stats.reasoningChunksDropped, 98);
  assert.equal(stats.textDeltaChunksIn, 493);
  assert.equal(textDeltas.map((value) => value.delta).join(""), chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.delta).join(""));
}

{
  const values = await transformValues([
    { type: "text-start", id: "t1" },
    { type: "text-delta", id: "t1", delta: "callback failure should not fail stream" },
    { type: "text-end", id: "t1" },
  ], {
    maxTextDeltaChars: 12,
    onStats: () => {
      throw new Error("stats sink unavailable");
    },
  });
  assert.equal(values.some((value) => value.type === "text-end"), true, "onStats failures must not break stream delivery");
}

console.log("stream-safety tests passed");
