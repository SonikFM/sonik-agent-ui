import type { Spec } from "@json-render/core";
import { parsePartialJson } from "./partial-json.ts";
import { CREATE_JSON_ARTIFACT_TOOL_PART_TYPE, type JsonArtifactToolCandidate } from "./tool-artifact-extraction.ts";

/**
 * Live tool-input streaming for the JSON-render canvas.
 *
 * The AI SDK ("ai" v6) already owns the transport this needs: it emits
 * `tool-input-start` / `tool-input-delta` / `tool-input-available` chunks, and
 * `processUIMessageStream` (used by `@ai-sdk/svelte`'s Chat) accumulates the
 * `inputTextDelta`s by `toolCallId` and runs its own `parsePartialJson` over the
 * growing buffer. The result surfaces on the tool part as
 * `{ state: "input-streaming", input: DeepPartial<input> }`. So the accumulation
 * + partial-json parse the donor's `tool_input_delta` describes is provided for
 * free — we consume the SDK's parsed partial rather than re-teeing raw deltas.
 *
 * This reads the partial `spec` off a still-streaming `createJsonArtifact` tool
 * call and guards it down to a *minimally renderable* spec so the canvas can
 * mount progressively while the arguments are still arriving. Once the tool
 * reaches `output-available`, the completed spec (see
 * `findJsonArtifactToolCandidate`) is authoritative; both candidates share one
 * stable artifact id, so the partial -> final transition is an in-place version
 * bump — no second artifact, no tear.
 *
 * A provider that surfaces the tool input as a raw (possibly truncated) JSON
 * string instead of a parsed object is absorbed by the partial-json island so a
 * mid-token delta never throws into the render tree.
 */

interface StreamingToolPartLike {
  type?: unknown;
  toolCallId?: unknown;
  state?: unknown;
  input?: unknown;
  output?: unknown;
}

// States where the tool call is still emitting its input and no output exists
// yet. `output-available` / `output-error` are handled by the completed-output
// lane, so we deliberately stop previewing once the call resolves.
const STREAMING_INPUT_STATES = new Set(["input-streaming", "input-available"]);

/**
 * Returns a renderable partial-spec candidate for the newest still-streaming
 * `createJsonArtifact` tool call in `parts`, or null when none has enough
 * structure to render yet. The id matches `findJsonArtifactToolCandidate` so the
 * completed output promotes the same artifact.
 */
export function findStreamingJsonArtifactSpecCandidate(
  messageId: string,
  parts: readonly unknown[],
): JsonArtifactToolCandidate | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index] as StreamingToolPartLike;
    if (!part || part.type !== CREATE_JSON_ARTIFACT_TOOL_PART_TYPE) continue;
    if (typeof part.state !== "string" || !STREAMING_INPUT_STATES.has(part.state)) continue;
    // Output already present: the completed-output lane owns this call.
    if (part.output !== undefined && part.output !== null) continue;

    const partial = coercePartialToolInput(part.input);
    const spec = extractRenderablePartialSpec(partial);
    if (!spec) continue;

    const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : `part-${index}`;
    const title = partial && typeof partial.title === "string" ? partial.title : undefined;
    return {
      id: `json-render-tool:${messageId}:${toolCallId}`,
      spec,
      ...(title ? { title } : {}),
    };
  }

  return null;
}

/**
 * Normalizes a streaming tool input into a plain record. The SDK usually hands
 * us an already-parsed `DeepPartial` object; a provider that instead surfaces
 * the raw (possibly truncated) JSON string is repaired by the partial-json
 * island. Anything that does not resolve to an object yields null so the caller
 * keeps its last good preview.
 */
function coercePartialToolInput(input: unknown): Record<string, unknown> | null {
  if (isRecord(input)) return input;
  if (typeof input === "string") {
    const parsed = parsePartialJson(input);
    return isRecord(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Guards a partial `spec` down to the minimum the core Renderer needs: a root
 * key, an elements map, and a root element with a type and props. The Renderer
 * only mounts `spec.elements[spec.root]` and skips children whose ids are not
 * present yet, so this is exactly the threshold at which progressive mounting is
 * safe. Incomplete deltas below this threshold return null (keep last good).
 */
export function extractRenderablePartialSpec(input: Record<string, unknown> | null): Spec | null {
  if (!input) return null;
  const spec = input.spec;
  return isMinimallyRenderableSpec(spec) ? spec : null;
}

export function isMinimallyRenderableSpec(value: unknown): value is Spec {
  if (!isRecord(value)) return false;
  if (typeof value.root !== "string" || !value.root) return false;
  if (!isRecord(value.elements)) return false;
  const rootElement = value.elements[value.root];
  if (!isRecord(rootElement)) return false;
  return typeof rootElement.type === "string" && isRecord(rootElement.props);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
