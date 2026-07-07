import { resolveElementProps, type Spec } from "@json-render/core";
import { CREATE_JSON_ARTIFACT_TOOL_PART_TYPE, type JsonArtifactToolCandidate } from "./tool-artifact-extraction.ts";

/**
 * Live tool-input streaming for the JSON-render canvas.
 *
 * The AI SDK ("ai" v6) emits `tool-input-start` / `tool-input-delta` /
 * `tool-input-available` chunks; `processUIMessageStream` accumulates the
 * `inputTextDelta`s by `toolCallId` and runs `parsePartialJson` over the
 * growing buffer, surfacing `{ state: "input-streaming", input: DeepPartial<input> }`
 * on the tool part. This consumes that already-parsed partial rather than
 * re-teeing raw deltas.
 *
 * Reads the partial `spec` off a still-streaming `createJsonArtifact` tool call
 * and guards it down to a minimally renderable spec so the canvas can mount
 * progressively. Once the tool reaches `output-available`, the completed spec
 * (see `findJsonArtifactToolCandidate`) is authoritative; both candidates share
 * one stable artifact id, so the partial -> final transition is an in-place
 * version bump with no tear.
 *
 * A structurally incomplete partial yields null (keep last good) rather than
 * throwing into the render tree.
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

    const partial = isRecord(part.input) ? part.input : null;
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
 * Guards a partial `spec` down to the minimum the core Renderer needs: a root
 * key, an elements map, and a root element with a type and props. The Renderer
 * only mounts `spec.elements[spec.root]` and skips children whose ids are not
 * present yet, so this is exactly the threshold at which progressive mounting is
 * safe. Incomplete deltas below this threshold return null (keep last good).
 */
export function extractRenderablePartialSpec(input: Record<string, unknown> | null): Spec | null {
  if (!input) return null;
  const spec = input.spec;
  if (!isMinimallyRenderableSpec(spec)) return null;
  // Structural validity is not enough: a partially-streamed directive-shaped root
  // prop (e.g. a `$cond` whose condition has not finished streaming into an object)
  // passes the structural guard but throws when the canvas resolves it inside a
  // $derived. Dry-run the root element's prop resolution here so a throwing partial
  // yields null (keep last good) rather than propagating into the render tree.
  return rootPropsResolveCleanly(spec) ? spec : null;
}

function rootPropsResolveCleanly(spec: Spec): boolean {
  const rootElement = spec.elements[spec.root] as { props?: unknown } | undefined;
  if (!isRecord(rootElement?.props)) return true;
  try {
    resolveElementProps(rootElement.props, { stateModel: isRecord(spec.state) ? spec.state : {} });
    return true;
  } catch {
    return false;
  }
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
