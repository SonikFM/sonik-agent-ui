const EXPLICIT_CREATE_PATTERN = /\b(create|make|build|generate|draft|write|start|open)\b/u;
const EXPLICIT_UPDATE_PATTERN = /\b(update|revise|edit|change|patch|modify|replace|append|extend|refresh|iterate)\b/u;
const ACTIVE_DOCUMENT_PATTERN = /\b(this|that|current|existing|active|same)\s+(workspace\s+)?(document|doc)\b|\b(document|doc)\s+(i|we)\s+(just\s+)?(created|opened|made)\b/u;
const DOCUMENT_OBJECT_PATTERN = /\b(?:a|an|the|new)\s+(?:workspace\s+)?(?:document|doc)\b|\b(?:workspace\s+)?(?:document|doc)\s+(?:workspace|editor)\b|\b(?:html|markdown|md|text)\s+(?:document|doc|file)\b|\b(?:document|doc|file)\s+(?:in\s+)?(?:html|markdown|md|text)\b|\.(?:html|md|markdown)\b/u;
const JSON_RENDER_DOCUMENT_PATTERN = /\bjson(?:-|\s+)?render(?:ing)?\s+(?:document|doc)\b/u;
const JSON_RENDER_CANVAS_PATTERN = /\b(json-render|json\s+render|canvas|dashboard)\b/u;

export type WorkspaceDocumentIntent = "none" | "create" | "update";

export function resolveWorkspaceDocumentIntent(prompt: string | null | undefined): WorkspaceDocumentIntent {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return "none";
  if (JSON_RENDER_DOCUMENT_PATTERN.test(normalized)) return "none";
  if (EXPLICIT_UPDATE_PATTERN.test(normalized) && ACTIVE_DOCUMENT_PATTERN.test(normalized)) return "update";
  if (!DOCUMENT_OBJECT_PATTERN.test(normalized)) return "none";
  if (JSON_RENDER_CANVAS_PATTERN.test(normalized) && !/\b(workspace\s+)?(?:document|doc)\b/u.test(normalized)) return "none";
  return EXPLICIT_CREATE_PATTERN.test(normalized) || /\b(?:workspace\s+)?(?:document|doc)\s+(?:workspace|editor)\b/u.test(normalized) ? "create" : "none";
}

export function hasExplicitWorkspaceDocumentIntent(prompt: string | null | undefined): boolean {
  return resolveWorkspaceDocumentIntent(prompt) !== "none";
}

export function shouldMountJsonArtifactTool(intent: WorkspaceDocumentIntent): boolean {
  return intent === "none";
}

function normalizePrompt(prompt: string | null | undefined): string {
  return prompt?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
}
