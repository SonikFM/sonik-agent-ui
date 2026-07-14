import type { AgentContextItem, AgentRunContextSelection } from "@sonik-agent-ui/tool-contracts/run-context";

// Minimal structural page-context shape this module needs — decoupled from the
// full AgentUiPageContextSnapshot so it stays trivially testable.
export interface AgentContextPageSnapshot {
  route?: string;
  title?: string;
  pageType?: string;
  commandFamilies?: string[];
  skillFamilies?: string[];
  activeEntity?: { type: string; id: string; label?: string };
}

export interface AgentContextCandidatesInput {
  pageContext?: AgentContextPageSnapshot | null;
  activeDocument?: { id: string; title?: string; language?: string } | null;
  activeArtifact?: { id: string; title?: string } | null;
}

export interface AgentContextCandidates {
  /** Auto-seeded chips: current page, active document, and active entity. Subject to authoritative
   *  removal — the reconcile step drops any the user dismissed. */
  seeds: AgentContextItem[];
  /** Full attachable catalog for the composer plus menu (seeds + manual-only
   *  sources: active artifact, command families, runtime skills). */
  sources: AgentContextItem[];
}

export interface PinnedToolContextHint {
  id: string;
  label: string;
  familyId: string;
}

function dedupeById(items: AgentContextItem[]): AgentContextItem[] {
  const map = new Map<string, AgentContextItem>();
  for (const item of items) map.set(item.id, item);
  return [...map.values()];
}

function activeEntityContextItem(entity: { type: string; id: string; label?: string }, source: "auto" | "manual"): AgentContextItem {
  return {
    id: `booking-context:${entity.type}:${entity.id}`,
    kind: "booking-context",
    label: entity.label?.trim() || `${entity.type} ${entity.id}`,
    source,
    ref: entity.id,
    detail: `${entity.type} ${entity.id}`,
    metadata: { entityType: entity.type },
  };
}

/**
 * Derives the auto-seed chips and the full attachable catalog from the current
 * host/page context, active document, and active artifact. Pure and stable: the
 * same inputs always produce the same ids, so reconcile + reload stay idempotent.
 */
export function deriveAgentContextCandidates(input: AgentContextCandidatesInput): AgentContextCandidates {
  const page = input.pageContext ?? undefined;
  const seeds: AgentContextItem[] = [];

  if (page && (page.route || page.title || page.pageType)) {
    seeds.push({
      id: "page:current",
      kind: "page",
      label: page.title?.trim() || page.route || "Current page",
      source: "auto",
      route: page.route,
      detail: page.route,
    });
  }

  if (input.activeDocument?.id) {
    seeds.push({
      id: `document:${input.activeDocument.id}`,
      kind: "document",
      label: input.activeDocument.title?.trim() || "Active document",
      source: "auto",
      ref: input.activeDocument.id,
      detail: input.activeDocument.language ? `${input.activeDocument.language} document` : undefined,
    });
  }

  const entity = page?.activeEntity;
  if (entity?.id) {
    seeds.push(activeEntityContextItem(entity, "auto"));
  }

  const sources: AgentContextItem[] = [...seeds];

  if (input.activeArtifact?.id) {
    sources.push({
      id: `artifact:${input.activeArtifact.id}`,
      kind: "artifact",
      label: input.activeArtifact.title?.trim() || "Active artifact",
      source: "manual",
      ref: input.activeArtifact.id,
    });
  }

  for (const family of page?.commandFamilies ?? []) {
    if (!family) continue;
    sources.push({ id: `command-family:${family}`, kind: "command-family", label: family, source: "manual", ref: family });
  }

  for (const family of page?.skillFamilies ?? []) {
    if (!family) continue;
    sources.push({ id: `runtime-skill:${family}`, kind: "runtime-skill", label: family, source: "manual", ref: family });
  }

  return { seeds, sources: dedupeById(sources) };
}

/** Adds conversation-pinned tools to this turn's provenance as context hints.
 *  These items select command-family context only; grants still come from the
 *  existing server permission and approval contracts. */
export function createTurnContextSelection(
  selection: AgentRunContextSelection,
  pinnedTools: PinnedToolContextHint[],
): AgentRunContextSelection {
  const pinnedToolItems: AgentContextItem[] = pinnedTools.map((tool) => ({
    id: `pinned-tool:${tool.id}`,
    kind: "command-family",
    label: tool.label,
    source: "manual",
    ref: tool.familyId,
    detail: `Pinned tool context hint: ${tool.id}`,
    metadata: { pinnedToolId: tool.id, contextOnly: true },
  }));
  return { ...selection, items: dedupeById([...selection.items, ...pinnedToolItems]) };
}

/** Runtime skills and pinned-tool hints are sent-turn provenance, not chips for
 *  the following turn. Persistent context and authoritative dismissals remain. */
export function createNextTurnContextSelection(selection: AgentRunContextSelection): AgentRunContextSelection {
  return {
    ...selection,
    items: selection.items.filter((item) => item.kind !== "runtime-skill" && typeof item.metadata?.pinnedToolId !== "string"),
  };
}

export function contextItemsByUserMessageId(
  runs: Array<{ user_message_id?: string | null; context_selection?: AgentRunContextSelection | null }>,
  legacyUserMessageIds: string[],
): Map<string, AgentContextItem[]> {
  const result = new Map<string, AgentContextItem[]>();
  runs.forEach((run, index) => {
    const items = run.context_selection?.items ?? [];
    const userMessageId = run.user_message_id ?? legacyUserMessageIds[index];
    if (userMessageId && items.length > 0) result.set(userMessageId, items);
  });
  return result;
}
