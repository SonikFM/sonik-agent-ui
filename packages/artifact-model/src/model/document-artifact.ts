import { createArtifact, type Artifact } from "./artifact.js";

export type DocumentArtifactFormat = "markdown" | "plain";

export interface DocumentArtifactContent {
  body: string;
  format: DocumentArtifactFormat;
}

export type DocumentArtifact = Artifact<DocumentArtifactContent> & { kind: "document" };

export interface CreateDocumentArtifactInput {
  id: string;
  body: string;
  format?: DocumentArtifactFormat;
  title?: string;
  now?: string;
}

export function createDocumentArtifact({
  id,
  body,
  format = "markdown",
  title = "Document artifact",
  now,
}: CreateDocumentArtifactInput): DocumentArtifact {
  return createArtifact({
    id,
    kind: "document",
    title,
    content: { body, format },
    now,
  }) as DocumentArtifact;
}
