/**
 * Temporary UX policy for the standalone prototype.
 *
 * This keeps JSON-render usable as either inline chat output or a promoted
 * workspace artifact until explicit artifact/tool intent objects exist. It is
 * not the future ORPC/OpenAPI/MCP tool-contract shape.
 */
export type ArtifactPromotionMode = "none" | "inline" | "artifact";

export type ArtifactPromotionReason =
  | "no_renderable_spec"
  | "explicit_inline_only"
  | "explicit_artifact_request"
  | "active_artifact_update"
  | "default_inline";

export interface DecideArtifactPromotionInput {
  hasRenderableSpec: boolean;
  userPrompt?: string | null;
  activeArtifactId?: string | null;
}

export interface ArtifactPromotionDecision {
  mode: ArtifactPromotionMode;
  promoteToArtifact: boolean;
  reuseActiveArtifact: boolean;
  reason: ArtifactPromotionReason;
}

const ARTIFACT_TERMS = [
  "artifact",
  "canvas",
  "workspace",
  "work space",
  "dashboard",
  "document",
  "doc",
  "page",
  "report",
  "brief",
  "proposal",
];

const CREATE_TERMS = [
  "create",
  "make",
  "build",
  "generate",
  "draft",
  "write",
  "open",
  "start",
  "save",
  "persist",
  "put",
  "add",
];

const UPDATE_TERMS = [
  "update",
  "revise",
  "edit",
  "change",
  "patch",
  "modify",
  "replace",
  "add",
  "append",
  "extend",
  "include",
  "refresh",
  "iterate",
];

const ACTIVE_REFERENCES = [
  "this",
  "that",
  "it",
  "current",
  "existing",
  "active",
  "same",
  "canvas",
  "artifact",
  "workspace",
  "document",
  "doc",
  "dashboard",
];

const INLINE_ONLY_PATTERNS = [
  /\bin\s+(the\s+)?chat\b/u,
  /\bchat\s+only\b/u,
  /\binline\b/u,
  /\btemporar(?:y|ily)\b/u,
  /\bquick\s+(look|view|preview)\b/u,
  /\bjust\s+(show|tell|answer|explain)\b/u,
  /\bdon't\s+(create|make|save|persist)\b/u,
  /\bdo\s+not\s+(create|make|save|persist)\b/u,
  /\bwithout\s+(creating|making|saving|persisting)\b/u,
];

export function decideArtifactPromotion({
  hasRenderableSpec,
  userPrompt,
  activeArtifactId,
}: DecideArtifactPromotionInput): ArtifactPromotionDecision {
  if (!hasRenderableSpec) {
    return decision("none", false, false, "no_renderable_spec");
  }

  const prompt = normalizePrompt(userPrompt);

  if (hasInlineOnlyIntent(prompt)) {
    return decision("inline", false, false, "explicit_inline_only");
  }

  if (activeArtifactId && hasActiveArtifactUpdateIntent(prompt)) {
    return decision("artifact", true, true, "active_artifact_update");
  }

  if (hasExplicitArtifactIntent(prompt)) {
    return decision("artifact", true, false, "explicit_artifact_request");
  }

  return decision("inline", false, false, "default_inline");
}

export function hasExplicitArtifactIntent(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return false;
  return includesAny(normalized, ARTIFACT_TERMS) && includesAny(normalized, CREATE_TERMS);
}

export function hasActiveArtifactUpdateIntent(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return false;
  return includesAny(normalized, UPDATE_TERMS) && includesAny(normalized, ACTIVE_REFERENCES);
}

export function hasInlineOnlyIntent(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return false;
  return INLINE_ONLY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizePrompt(prompt?: string | null): string {
  return prompt?.trim().toLowerCase() ?? "";
}

function includesAny(prompt: string, terms: string[]): boolean {
  return terms.some((term) => matchesTerm(prompt, term));
}

function matchesTerm(prompt: string, term: string): boolean {
  if (term.includes(" ")) return prompt.includes(term);
  return new RegExp(`\\b${escapeRegExp(term)}\\b`, "u").test(prompt);
}

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decision(
  mode: ArtifactPromotionMode,
  promoteToArtifact: boolean,
  reuseActiveArtifact: boolean,
  reason: ArtifactPromotionReason,
): ArtifactPromotionDecision {
  return Object.freeze({ mode, promoteToArtifact, reuseActiveArtifact, reason });
}
