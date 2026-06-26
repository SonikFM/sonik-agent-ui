import { SPEC_DATA_PART_TYPE, type SpecDataPart } from "@json-render/core";
import { isJsonArtifactToolOutput } from "./tool-artifact-extraction.ts";
import { logArtifactTelemetry, summarizeSpec } from "./artifact-telemetry.ts";

interface ToolOutputChunkLike {
  type?: unknown;
  output?: unknown;
}

/**
 * Bridges workspace-style artifact tool calls into the existing json-render
 * stream lane. The renderer already knows how to consume `data-spec`; this
 * keeps the local JSON renderer intact while allowing a dedicated artifact
 * creation tool to deterministically promote the canvas.
 */
export function pipeArtifactToolOutputsToSpecParts<T>(stream: ReadableStream<T>): ReadableStream<T | ArtifactSpecChunk> {
  return stream.pipeThrough(
    new TransformStream<T, T | ArtifactSpecChunk>({
      transform(chunk, controller) {
        controller.enqueue(chunk);

        const artifactChunk = toArtifactSpecChunk(chunk);
        if (artifactChunk) {
          controller.enqueue(artifactChunk);
        }
      },
    }),
  );
}

export interface ArtifactSpecChunk {
  type: typeof SPEC_DATA_PART_TYPE;
  data: SpecDataPart;
}

export function toArtifactSpecChunk(chunk: unknown): ArtifactSpecChunk | null {
  const candidate = chunk as ToolOutputChunkLike;
  if (!candidate || candidate.type !== "tool-output-available") return null;
  if (!isJsonArtifactToolOutput(candidate.output)) return null;

  logArtifactTelemetry({
    source: "server",
    event: "stream.artifactToolOutputToSpec",
    ...summarizeSpec(candidate.output.spec),
    ok: true,
  });

  return {
    type: SPEC_DATA_PART_TYPE,
    data: {
      type: "flat",
      spec: candidate.output.spec,
    },
  };
}
