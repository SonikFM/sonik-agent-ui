export type ArtifactKind = "json-render" | "html" | "document" | "terminal" | "custom";

export interface Artifact<TContent = unknown> {
  id: string;
  kind: ArtifactKind;
  version: number;
  title?: string;
  content: TContent;
  createdAt: string;
  updatedAt: string;
}

export interface CreateArtifactInput<TContent> {
  id: string;
  kind: ArtifactKind;
  content: TContent;
  title?: string;
  now?: string;
}

export function createArtifact<TContent>({
  id,
  kind,
  content,
  title,
  now = new Date().toISOString(),
}: CreateArtifactInput<TContent>): Artifact<TContent> {
  return {
    id,
    kind,
    version: 1,
    title,
    content,
    createdAt: now,
    updatedAt: now,
  };
}

export function replaceArtifactContent<TContent>(
  artifact: Artifact<TContent>,
  content: TContent,
  now = new Date().toISOString(),
): Artifact<TContent> {
  return {
    ...artifact,
    content,
    version: artifact.version + 1,
    updatedAt: now,
  };
}
