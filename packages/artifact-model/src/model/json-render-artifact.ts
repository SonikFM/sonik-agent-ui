import type { Spec } from "@json-render/core";
import { createArtifact, replaceArtifactContent, type Artifact } from "./artifact.js";
import { stableStringify } from "../utils/stable-stringify.js";

export type JsonRenderArtifact = Artifact<Spec> & { kind: "json-render" };

export interface CreateJsonRenderArtifactInput {
  id: string;
  spec: Spec;
  title?: string;
  now?: string;
}

export interface UpsertJsonRenderArtifactInput {
  previous?: JsonRenderArtifact | null;
  id: string;
  spec: Spec;
  title?: string;
  now?: string;
}

export interface UpsertJsonRenderArtifactResult {
  artifact: JsonRenderArtifact;
  signature: string;
  changed: boolean;
  created: boolean;
  metadataChanged: boolean;
}

export function createJsonRenderArtifact({
  id,
  spec,
  title = "JSON artifact",
  now,
}: CreateJsonRenderArtifactInput): JsonRenderArtifact {
  return createArtifact({
    id,
    kind: "json-render",
    title,
    content: spec,
    now,
  }) as JsonRenderArtifact;
}

export function createJsonRenderArtifactSignature(spec: Spec): string {
  return stableStringify(spec);
}

export function upsertJsonRenderArtifact({
  previous,
  id,
  spec,
  title = "JSON artifact",
  now,
}: UpsertJsonRenderArtifactInput): UpsertJsonRenderArtifactResult {
  const signature = createJsonRenderArtifactSignature(spec);

  if (previous?.id === id) {
    const previousSignature = createJsonRenderArtifactSignature(previous.content);

    if (previousSignature === signature) {
      const metadataChanged = previous.title !== title;
      return {
        artifact: metadataChanged
          ? ({ ...previous, title, updatedAt: now ?? previous.updatedAt } as JsonRenderArtifact)
          : previous,
        signature,
        changed: false,
        created: false,
        metadataChanged,
      };
    }

    return {
      artifact: replaceArtifactContent(previous, spec, now) as JsonRenderArtifact,
      signature,
      changed: true,
      created: false,
      metadataChanged: false,
    };
  }

  return {
    artifact: createJsonRenderArtifact({ id, spec, title, now }),
    signature,
    changed: true,
    created: true,
    metadataChanged: false,
  };
}
