import type { Artifact } from "../model/artifact.js";

export interface ArtifactVersionEntry<TContent = unknown> {
  readonly artifactId: string;
  readonly version: number;
  readonly content: TContent;
  readonly title?: string;
  readonly updatedAt: string;
  readonly reason?: string;
}

export interface ArtifactVersionStore<TContent = unknown> {
  readonly artifactId: string;
  readonly entries: readonly ArtifactVersionEntry<TContent>[];
}

function cloneContent<TContent>(content: TContent): TContent {
  return structuredClone(content);
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (!value || typeof value !== "object") {
    return value;
  }

  Object.freeze(value);

  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }

  return value;
}

export function toArtifactVersionEntry<TContent>(
  artifact: Artifact<TContent>,
  reason?: string,
): ArtifactVersionEntry<TContent> {
  return Object.freeze({
    artifactId: artifact.id,
    version: artifact.version,
    title: artifact.title,
    content: deepFreeze(cloneContent(artifact.content)),
    updatedAt: artifact.updatedAt,
    reason,
  });
}

export function createArtifactVersionStore<TContent>(
  artifact: Artifact<TContent>,
  reason = "initial",
): ArtifactVersionStore<TContent> {
  return Object.freeze({
    artifactId: artifact.id,
    entries: Object.freeze([toArtifactVersionEntry(artifact, reason)]),
  });
}

export function appendArtifactVersion<TContent>(
  store: ArtifactVersionStore<TContent>,
  artifact: Artifact<TContent>,
  reason?: string,
): ArtifactVersionStore<TContent> {
  if (store.artifactId !== artifact.id) {
    throw new Error(
      `Cannot append artifact "${artifact.id}" to version store for "${store.artifactId}"`,
    );
  }

  const latest = getLatestArtifactVersion(store);
  if (latest && artifact.version <= latest.version) {
    throw new Error(
      `Cannot append artifact version ${artifact.version}; latest stored version is ${latest.version}`,
    );
  }

  return Object.freeze({
    artifactId: store.artifactId,
    entries: Object.freeze([...store.entries, toArtifactVersionEntry(artifact, reason)]),
  });
}

export function getLatestArtifactVersion<TContent>(
  store: ArtifactVersionStore<TContent>,
): ArtifactVersionEntry<TContent> | null {
  return store.entries.at(-1) ?? null;
}
