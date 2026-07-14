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
  assert.ok(textDeltas.every((value) => !("providerMetadata" in value)), "provider metadata must not reach the browser");
  assert.ok(textDeltas.every((value) => value.customField === "keep-me"), "text-delta extension fields should be preserved");
}

{
  const rawProviderError = "Google provider files/raw-ref at https://example.invalid/private said arbitrary model text";
  const values = await transformValues([
    { type: "text-start", id: "t1", providerMetadata: { google: { raw: "files/raw-ref" } } },
    { type: "text-delta", id: "t1", delta: "Safe partial text", providerMetadata: { google: { model: "arbitrary model text" } } },
    { type: "text-end", id: "t1" },
    { type: "tool-output-error", toolCallId: "tool-1", errorText: rawProviderError, providerMetadata: { google: { url: "https://example.invalid/private" } } },
    { type: "error", errorText: rawProviderError, providerData: { nested: rawProviderError } },
  ]);
  const serialized = JSON.stringify(values);
  assert.equal(serialized.includes("files/raw-ref"), false);
  assert.equal(serialized.includes("example.invalid"), false);
  assert.equal(serialized.includes("arbitrary model text"), false);
  assert.equal(serialized.includes("providerMetadata"), false);
  assert.equal(serialized.includes("providerData"), false);
  assert.deepEqual(values.filter((value) => value.type === "error" || value.type === "tool-output-error").map((value) => value.errorText), ["Run interrupted", "Run interrupted"]);
  assert.equal(values.filter((value) => value.type === "text-delta").map((value) => value.delta).join(""), "Safe partial text");
}

{
  const values = await transformValues([
    { type: "tool-input-available", toolCallId: "tool-safe", toolName: "lookup", input: { query: "safe query" }, providerMetadata: { private: true } },
    { type: "tool-output-available", toolCallId: "tool-safe", output: { result: "safe result" }, providerMetadata: { private: true } },
    { type: "data-spec", data: { op: "add", path: "/root", value: "main" }, providerMetadata: { private: true } },
    { type: "finish", finishReason: "stop", providerMetadata: { private: true } },
    { type: "tool-output-available", toolCallId: "tool-normalized", output: { nested: { provider_reference: "files/opaque-secret-ref", "provider-metadata": { request_url: "https://provider.invalid/private", access_token: "secret-token" }, model_id: "private-model-id", providerPreference: "direct", providerLabel: "Google" } } },
  ]);
  assert.deepEqual(values.map((value) => value.type), ["tool-input-available", "tool-output-available", "data-spec", "finish", "tool-output-available"]);
  assert.equal(values[0].input.query, "safe query");
  assert.equal(values[1].output.result, "safe result");
  assert.equal(values[2].data.value, "main");
  assert.ok(values.every((value) => !("providerMetadata" in value)));
  assert.deepEqual(values[4].output.nested, { providerPreference: "direct", providerLabel: "Google" });
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
