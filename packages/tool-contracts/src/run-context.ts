// Composer run-context selection contract for the Sonik Agent UI.
//
// A "run context selection" is the user-visible, per-turn set of context sources
// attached in the composer (chips) plus the record of which auto-seeded chips the
// user explicitly removed. It is sent with the generate request, consumed by the
// server (explicit selection wins over implicit host/page context), and persisted
// on the run record so it can be replayed as provenance and re-hydrated on reload.
//
// Kept dependency-light (no zod, no AI SDK) so producer (composer), consumer
// (api/generate), and the persistence layer share one type and cannot drift.

export const AGENT_CONTEXT_KINDS = [
  "document",
  "artifact",
  "booking-context",
  "page",
  "command-family",
  "runtime-skill",
] as const;
export type AgentContextKind = (typeof AGENT_CONTEXT_KINDS)[number];

export function isAgentContextKind(value: unknown): value is AgentContextKind {
  return typeof value === "string" && (AGENT_CONTEXT_KINDS as readonly string[]).includes(value);
}

/** Where a chip came from. `auto` chips are seeded from host/page context and
 *  are subject to authoritative removal; `manual` chips are user-attached via
 *  the plus menu and simply drop when removed. */
export type AgentContextSource = "auto" | "manual";

export interface AgentContextItem {
  id: string;
  kind: AgentContextKind;
  label: string;
  source: AgentContextSource;
  /** Stable reference into the workspace: document id, artifact id,
   *  command-family id, runtime-skill id, or route. */
  ref?: string;
  /** Explicit locator/detail line shown in the hover card; falls back to
   *  route/ref via {@link agentContextDetailLine}. */
  detail?: string;
  /** Populated for the `page` kind. */
  route?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentRunContextSelection {
  items: AgentContextItem[];
  /** Ids of auto-seeded items the user explicitly removed. Removal is
   *  authoritative: a dismissed id stays out of the selection across re-seeds,
   *  sends, and reloads. */
  dismissedAutoSeedIds: string[];
}

export function createEmptyAgentRunContextSelection(): AgentRunContextSelection {
  return { items: [], dismissedAutoSeedIds: [] };
}

// Human label for a context kind. Hardcoded English; these labels are not
// localized.
export function agentContextKindLabel(kind: AgentContextKind): string {
  switch (kind) {
    case "document": return "Document";
    case "artifact": return "Artifact";
    case "booking-context": return "Booking context";
    case "page": return "Current page";
    case "command-family": return "Command family";
    case "runtime-skill": return "Runtime skill";
    default: return "Context";
  }
}

// The single most useful identifier to surface for a context item: the explicit
// detail, else the route, else the underlying reference id. Empty when the item
// carries no locator (the hover card then shows only the kind).
export function agentContextDetailLine(item: AgentContextItem): string {
  return item.detail?.trim() || item.route?.trim() || item.ref?.trim() || "";
}

const MAX_CONTEXT_ITEMS = 24;
const MAX_DISMISSED_IDS = 64;
const MAX_FIELD_CHARS = 240;

function boundedString(value: unknown, max = MAX_FIELD_CHARS): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeById(items: AgentContextItem[]): AgentContextItem[] {
  const map = new Map<string, AgentContextItem>();
  for (const item of items) map.set(item.id, item);
  return [...map.values()];
}

function normalizeItem(value: unknown): AgentContextItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = boundedString(record.id);
  const label = boundedString(record.label);
  if (!id || !label || !isAgentContextKind(record.kind)) return null;
  const source: AgentContextSource = record.source === "manual" ? "manual" : "auto";
  const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
    ? (record.metadata as Record<string, unknown>)
    : undefined;
  return {
    id,
    kind: record.kind,
    label,
    source,
    ref: boundedString(record.ref),
    detail: boundedString(record.detail),
    route: boundedString(record.route),
    ...(metadata ? { metadata } : {}),
  };
}

/** Validates/bounds an untrusted selection payload (e.g. from the request body).
 *  Returns a normalized selection; drops malformed items rather than throwing so
 *  a bad chip never breaks a turn. Returns undefined when nothing usable remains
 *  AND no dismissals were recorded, so the caller can treat "no selection" as the
 *  implicit-context fallback. */
export function parseAgentRunContextSelection(value: unknown): AgentRunContextSelection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const items = Array.isArray(record.items)
    ? record.items.map(normalizeItem).filter((item): item is AgentContextItem => item !== null).slice(0, MAX_CONTEXT_ITEMS)
    : [];
  const dismissedAutoSeedIds = Array.isArray(record.dismissedAutoSeedIds)
    ? dedupeStrings(record.dismissedAutoSeedIds.map((entry) => boundedString(entry)).filter((entry): entry is string => Boolean(entry))).slice(0, MAX_DISMISSED_IDS)
    : [];
  if (items.length === 0 && dismissedAutoSeedIds.length === 0) return undefined;
  return { items: dedupeById(items), dismissedAutoSeedIds };
}

function normalizeSelection(value: AgentRunContextSelection | null | undefined): AgentRunContextSelection {
  if (!value) return createEmptyAgentRunContextSelection();
  return {
    items: dedupeById(Array.isArray(value.items) ? value.items : []),
    dismissedAutoSeedIds: dedupeStrings(Array.isArray(value.dismissedAutoSeedIds) ? value.dismissedAutoSeedIds : []),
  };
}

/**
 * Merge the previous selection with a fresh set of auto-seed candidates (derived
 * from the current host/page context). This is the single choke point that makes
 * removal authoritative:
 *  - manual items are always kept;
 *  - an auto seed is included only when its id is NOT dismissed and does not
 *    collide with a manual item;
 *  - dismissals carry forward unchanged.
 * Idempotent and reload-safe: calling it again with the same seeds and a
 * hydrated previous selection reproduces the same result.
 */
export function reconcileAgentContextSelection(input: {
  previous?: AgentRunContextSelection | null;
  seeds: AgentContextItem[];
}): AgentRunContextSelection {
  const previous = normalizeSelection(input.previous);
  const dismissed = new Set(previous.dismissedAutoSeedIds);
  const manual = previous.items.filter((item) => item.source === "manual");
  const manualIds = new Set(manual.map((item) => item.id));
  const seeds = input.seeds
    .map((seed) => ({ ...seed, source: "auto" as const }))
    .filter((seed) => !dismissed.has(seed.id) && !manualIds.has(seed.id));
  return {
    items: dedupeById([...manual, ...seeds]),
    dismissedAutoSeedIds: [...dismissed],
  };
}

/** Attach (or re-attach) an item. Re-adding a previously dismissed auto item
 *  clears its dismissal so it is not immediately re-removed by the next reseed. */
export function addAgentContextItem(
  selection: AgentRunContextSelection | null | undefined,
  item: AgentContextItem,
): AgentRunContextSelection {
  const current = normalizeSelection(selection);
  const normalized = normalizeItem(item);
  if (!normalized) return current;
  return {
    items: dedupeById([...current.items.filter((existing) => existing.id !== normalized.id), normalized]),
    dismissedAutoSeedIds: current.dismissedAutoSeedIds.filter((id) => id !== normalized.id),
  };
}

/** Remove an item by id. Auto-seeded items are recorded as dismissed so they
 *  stay removed on the next reseed / send / reload; manual items simply drop. */
export function removeAgentContextItem(
  selection: AgentRunContextSelection | null | undefined,
  id: string,
): AgentRunContextSelection {
  const current = normalizeSelection(selection);
  const removed = current.items.find((item) => item.id === id);
  const items = current.items.filter((item) => item.id !== id);
  const dismissedAutoSeedIds = removed?.source === "auto"
    ? dedupeStrings([...current.dismissedAutoSeedIds, id]).slice(0, MAX_DISMISSED_IDS)
    : current.dismissedAutoSeedIds;
  return { items, dismissedAutoSeedIds };
}

/** Derived view the server uses to layer an explicit selection over implicit
 *  host/page context. `explicit` is false for an empty/absent selection so the
 *  caller keeps the current implicit behavior (graceful degradation). */
export interface AgentContextSelectionResolution {
  explicit: boolean;
  documentIds: string[];
  artifactIds: string[];
  activeEntity: { type: string; id: string; label?: string } | null;
  commandFamilies: string[];
  skillFamilies: string[];
  page: { route?: string; title?: string } | null;
  /** True when the active document should still be injected. An explicit
   *  selection that omits every `document` chip means the user deselected it —
   *  the document must NOT be silently re-attached (authoritative removal at the
   *  server boundary). Absent selection → true (implicit fallback). */
  includeActiveDocument: boolean;
}

export function resolveAgentContextSelection(
  selection: AgentRunContextSelection | null | undefined,
): AgentContextSelectionResolution {
  const items = selection?.items ?? [];
  // A dismissal is itself explicit intent: removing the only seed leaves items
  // empty but must still suppress the implicit fallback, or the server would
  // silently re-inject what the user removed.
  const explicit = items.length > 0 || (selection?.dismissedAutoSeedIds?.length ?? 0) > 0;
  const byKind = (kind: AgentContextKind) => items.filter((item) => item.kind === kind);
  const documentItems = byKind("document");
  const pageItem = byKind("page")[0];
  const entityItem = byKind("booking-context")[0];
  const entityType = typeof entityItem?.metadata?.entityType === "string" && entityItem.metadata.entityType.trim()
    ? entityItem.metadata.entityType.trim()
    : "booking-context";
  const activeEntity = entityItem?.ref
    ? { type: entityType, id: entityItem.ref, label: entityItem.label }
    : null;
  return {
    explicit,
    documentIds: documentItems.map((item) => item.ref).filter((ref): ref is string => Boolean(ref)),
    artifactIds: byKind("artifact").map((item) => item.ref).filter((ref): ref is string => Boolean(ref)),
    activeEntity,
    commandFamilies: dedupeStrings(byKind("command-family").map((item) => item.ref ?? item.label).filter(Boolean)),
    skillFamilies: dedupeStrings(byKind("runtime-skill").map((item) => item.ref ?? item.label).filter(Boolean)),
    page: pageItem ? { route: pageItem.route ?? pageItem.ref, title: pageItem.label } : null,
    // No explicit selection → keep implicit behavior. Explicit selection →
    // include the document only when a document chip is present.
    includeActiveDocument: !explicit || documentItems.length > 0,
  };
}
