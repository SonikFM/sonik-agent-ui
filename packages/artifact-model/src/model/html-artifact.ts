import { createArtifact, type Artifact } from "./artifact.js";

export interface HtmlArtifactContent {
  html: string;
}

export type HtmlArtifact = Artifact<HtmlArtifactContent> & { kind: "html" };

export interface CreateHtmlArtifactInput {
  id: string;
  html: string;
  title?: string;
  now?: string;
}

export function createHtmlArtifact({
  id,
  html,
  title = "HTML artifact",
  now,
}: CreateHtmlArtifactInput): HtmlArtifact {
  return createArtifact({
    id,
    kind: "html",
    title,
    content: { html },
    now,
  }) as HtmlArtifact;
}
