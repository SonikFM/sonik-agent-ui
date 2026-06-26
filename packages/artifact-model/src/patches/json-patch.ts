import { applySpecStreamPatch, type JsonPatch } from "@json-render/core";
import { replaceArtifactContent, type Artifact } from "../model/artifact.js";
import { stableStringify } from "../utils/stable-stringify.js";

export type ArtifactJsonPatch = JsonPatch;

function cloneContent<TContent>(content: TContent): TContent {
  return structuredClone(content);
}

export interface ApplyArtifactJsonPatchesInput<TContent extends Record<string, unknown>> {
  artifact: Artifact<TContent>;
  patches: readonly ArtifactJsonPatch[];
  now?: string;
}

export interface TryApplyArtifactJsonPatchesResult<TContent extends Record<string, unknown>> {
  artifact: Artifact<TContent>;
  applied: boolean;
  error?: Error;
}

export function applyArtifactJsonPatches<TContent extends Record<string, unknown>>({
  artifact,
  patches,
  now,
}: ApplyArtifactJsonPatchesInput<TContent>): Artifact<TContent> {
  if (patches.length === 0) {
    return artifact;
  }

  const previousSignature = stableStringify(artifact.content);
  const nextContent = cloneContent(artifact.content);

  for (const patch of patches) {
    applySpecStreamPatch(nextContent, patch);
  }

  if (stableStringify(nextContent) === previousSignature) {
    return artifact;
  }

  return replaceArtifactContent(artifact, nextContent, now);
}

export function applyArtifactJsonPatch<TContent extends Record<string, unknown>>(
  artifact: Artifact<TContent>,
  patch: ArtifactJsonPatch,
  now?: string,
): Artifact<TContent> {
  return applyArtifactJsonPatches({ artifact, patches: [patch], now });
}

export function tryApplyArtifactJsonPatches<TContent extends Record<string, unknown>>({
  artifact,
  patches,
  now,
}: ApplyArtifactJsonPatchesInput<TContent>): TryApplyArtifactJsonPatchesResult<TContent> {
  try {
    return {
      artifact: applyArtifactJsonPatches({ artifact, patches, now }),
      applied: true,
    };
  } catch (error) {
    return {
      artifact,
      applied: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
