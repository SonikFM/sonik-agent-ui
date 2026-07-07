import assert from "node:assert/strict";
// Import the real AI SDK the app uses (resolved via the app's node_modules) so
// this exercises the exact processUIMessageStream path @ai-sdk/svelte's Chat
// runs: tool-input-delta chunks accumulated by toolCallId and parsed with the
// SDK's own parsePartialJson into a DeepPartial tool input.
import { readUIMessageStream } from "../../apps/standalone-sveltekit/node_modules/ai/dist/index.mjs";
import { findStreamingJsonArtifactSpecCandidate } from "../../apps/standalone-sveltekit/src/lib/artifacts/streaming-artifact.ts";
import { findJsonArtifactToolCandidate } from "../../apps/standalone-sveltekit/src/lib/artifacts/tool-artifact-extraction.ts";

const spec = {
  root: "main",
  elements: {
    main: { type: "Card", props: { title: "Sales" }, children: ["body"] },
    body: { type: "Text", props: { text: "Revenue is trending up." } },
  },
};
const toolInput = { title: "Live Sales Dashboard", spec };
const inputText = JSON.stringify(toolInput);
const toolCallId = "call-artifact-1";

// Split the tool-call arguments into small deltas so the canvas can mount a
// renderable partial spec while later characters are still streaming.
function chunkString(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function scriptedChunks() {
  const chunks = [{ type: "start" }, { type: "start-step" }];
  const textId = "t1";
  chunks.push({ type: "text-start", id: textId });
  chunks.push({ type: "text-delta", id: textId, delta: "Building your dashboard…" });
  chunks.push({ type: "text-end", id: textId });
  chunks.push({ type: "tool-input-start", toolCallId, toolName: "createJsonArtifact" });
  for (const delta of chunkString(inputText, 16)) {
    chunks.push({ type: "tool-input-delta", toolCallId, inputTextDelta: delta });
  }
  chunks.push({ type: "tool-input-available", toolCallId, toolName: "createJsonArtifact", input: toolInput });
  chunks.push({ type: "tool-output-available", toolCallId, output: { kind: "json-render-artifact", title: toolInput.title, spec } });
  chunks.push({ type: "finish-step" });
  chunks.push({ type: "finish" });
  return chunks;
}

function streamOf(chunks) {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i]);
      i += 1;
    },
  });
}

// Drive the real SDK stream and snapshot the extraction after every update.
const snapshots = [];
for await (const message of readUIMessageStream({ stream: streamOf(scriptedChunks()) })) {
  const parts = message.parts ?? [];
  snapshots.push({
    streaming: findStreamingJsonArtifactSpecCandidate(message.id, parts),
    completed: findJsonArtifactToolCandidate(message.id, parts),
  });
}

const firstStreamingIndex = snapshots.findIndex((s) => s.streaming);
const completedIndex = snapshots.findIndex((s) => s.completed);

// --- progressive mounting: the canvas mounts a partial spec before completion ---
assert.ok(firstStreamingIndex >= 0, "a renderable partial spec is extracted mid-stream");
assert.ok(completedIndex >= 0, "the completed tool output is extracted at the end");
assert.ok(
  firstStreamingIndex < completedIndex,
  `first live mount (snapshot ${firstStreamingIndex}) precedes stream completion (snapshot ${completedIndex})`,
);

// The mounted partial is renderable and grows toward the final spec.
const firstPartial = snapshots[firstStreamingIndex].streaming;
assert.equal(firstPartial.spec.root, "main");
assert.equal(firstPartial.spec.elements.main.type, "Card");

// --- handoff: partial and final share one artifact id, and the streaming lane
//     stops the moment the completed output exists (no double render / tear) ---
const finalSnapshot = snapshots.at(-1);
assert.ok(finalSnapshot.completed, "final snapshot exposes the completed artifact");
assert.equal(finalSnapshot.streaming, null, "streaming preview yields to the completed output");
assert.equal(
  snapshots[firstStreamingIndex].streaming.id,
  finalSnapshot.completed.id,
  "partial preview and final promote the same artifact id",
);
assert.deepEqual(finalSnapshot.completed.spec, spec, "final spec is authoritative");

console.log(`streaming-artifact SDK tests passed (${snapshots.length} snapshots, first mount at ${firstStreamingIndex}, completion at ${completedIndex})`);
