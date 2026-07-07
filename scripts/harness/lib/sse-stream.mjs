// Parser/reducer for the Vercel AI SDK "UI message stream" SSE protocol that
// POST /api/generate returns (apps/standalone-sveltekit/src/routes/api/generate/+server.ts
// via `ai`'s createUIMessageStreamResponse). Format, confirmed live against
// the deployed worker:
//   data: <json chunk>\n\n
//   ...
//   data: [DONE]\n\n
// Each chunk is a UIMessageChunk: {type: "text-start"|"text-delta"|"text-end"
// |"tool-input-start"|"tool-input-delta"|"tool-input-available"
// |"tool-output-available"|"data-spec"|"error"|"start"|"finish"|..., ...}.
//
// `data-spec` chunks carry json-render Spec patches
// (packages/core/src/types.ts SpecDataPart: {type:"patch",patch:JsonPatch} |
// {type:"flat",spec:Spec}) emitted whenever a tool call mutates the active
// artifact. See lib/spec-reducer.mjs for applying them.

/** Parse a complete SSE text blob into an array of decoded chunk objects. Skips [DONE]. */
export function parseSseText(text) {
  const chunks = [];
  for (const block of text.split("\n\n")) {
    const line = block.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      chunks.push(JSON.parse(payload));
    } catch {
      chunks.push({ type: "harness-parse-error", raw: payload });
    }
  }
  return chunks;
}

/**
 * Read a fetch Response body as the UI message SSE stream, decoding as it
 * arrives (handles chunk boundaries splitting a `data: ...` line/frame across
 * network reads) and invoking onChunk for each decoded UIMessageChunk.
 * Returns the full list of chunks once the stream ends.
 */
export async function readUiMessageStream(response, { onChunk } = {}) {
  if (!response.body) {
    // Some fetch polyfills buffer the whole body; fall back to text().
    const text = await response.text();
    const chunks = parseSseText(text);
    for (const chunk of chunks) onChunk?.(chunk);
    return chunks;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (!payload || payload === "[DONE]") continue;
      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        chunk = { type: "harness-parse-error", raw: payload };
      }
      chunks.push(chunk);
      onChunk?.(chunk);
    }
  }
  return chunks;
}

/**
 * Reduce a flat chunk list into a summary: assistant text, tool calls
 * (paired input/output by toolCallId), spec patches (data-spec chunks, in
 * order), message id, and any stream error.
 */
export function reduceUiMessageChunks(chunks) {
  const textById = new Map();
  const toolCallsById = new Map();
  const toolCallOrder = [];
  const specPatches = [];
  let messageId;
  let error;
  let finishReason;

  for (const chunk of chunks) {
    switch (chunk.type) {
      case "start":
        messageId = chunk.messageId ?? messageId;
        break;
      case "text-start":
        textById.set(chunk.id, textById.get(chunk.id) ?? "");
        break;
      case "text-delta":
        textById.set(chunk.id, (textById.get(chunk.id) ?? "") + (chunk.delta ?? ""));
        break;
      case "tool-input-start": {
        if (!toolCallsById.has(chunk.toolCallId)) {
          toolCallsById.set(chunk.toolCallId, { toolCallId: chunk.toolCallId, toolName: chunk.toolName, input: undefined, output: undefined });
          toolCallOrder.push(chunk.toolCallId);
        }
        break;
      }
      case "tool-input-available": {
        const existing = toolCallsById.get(chunk.toolCallId) ?? { toolCallId: chunk.toolCallId };
        existing.toolName = chunk.toolName ?? existing.toolName;
        existing.input = chunk.input;
        toolCallsById.set(chunk.toolCallId, existing);
        if (!toolCallOrder.includes(chunk.toolCallId)) toolCallOrder.push(chunk.toolCallId);
        break;
      }
      case "tool-output-available": {
        const existing = toolCallsById.get(chunk.toolCallId) ?? { toolCallId: chunk.toolCallId };
        existing.output = chunk.output;
        toolCallsById.set(chunk.toolCallId, existing);
        if (!toolCallOrder.includes(chunk.toolCallId)) toolCallOrder.push(chunk.toolCallId);
        break;
      }
      case "tool-output-error": {
        const existing = toolCallsById.get(chunk.toolCallId) ?? { toolCallId: chunk.toolCallId };
        existing.error = chunk.errorText ?? chunk.error ?? "tool_output_error";
        toolCallsById.set(chunk.toolCallId, existing);
        break;
      }
      case "data-spec":
        if (chunk.data) specPatches.push(chunk.data);
        break;
      case "error":
        error = chunk.errorText ?? chunk.error ?? "stream_error";
        break;
      case "finish":
        finishReason = chunk.finishReason ?? finishReason;
        break;
      default:
        break;
    }
  }

  const text = [...textById.values()].join("");
  const toolCalls = toolCallOrder.map((id) => toolCallsById.get(id)).filter(Boolean);
  return { messageId, text, toolCalls, specPatches, error, finishReason, chunkCount: chunks.length };
}
