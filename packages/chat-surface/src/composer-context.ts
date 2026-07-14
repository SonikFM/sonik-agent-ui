export type ComposerSuggestionKind = "skill" | "command";
export type ComposerCatalogStatus = "loading" | "ready" | "unavailable";

export interface ComposerSuggestionItem {
  id: string;
  label: string;
  description?: string;
  kind: ComposerSuggestionKind;
}

export interface ComposerToolItem {
  id: string;
  label: string;
  description?: string;
  serverId: string;
  familyId: string;
}

export interface ComposerRecentDocument {
  id: string;
  label: string;
  detail?: string;
}

export interface ComposerTrigger {
  marker: "$" | "/" | "#" | "@";
  query: string;
  start: number;
}

export function findComposerTrigger(value: string): ComposerTrigger | null {
  const match = /(^|\s)([$\/#@])([^\s]*)$/.exec(value);
  if (!match) return null;
  return {
    marker: match[2] as ComposerTrigger["marker"],
    query: match[3] ?? "",
    start: match.index + (match[1] ?? "").length,
  };
}

export function filterComposerSuggestions(
  items: ComposerSuggestionItem[],
  trigger: ComposerTrigger | null,
  limit = 8,
): ComposerSuggestionItem[] {
  if (!trigger || trigger.marker === "#" || trigger.marker === "@") return [];
  const query = trigger.query.toLowerCase();
  return items
    .filter((item) => trigger.marker === "/" || item.kind === "skill")
    .filter((item) => !query || `${item.label} ${item.id} ${item.description ?? ""}`.toLowerCase().includes(query))
    .slice(0, limit);
}

export function replaceComposerTrigger(value: string, trigger: ComposerTrigger, replacement = ""): string {
  return `${value.slice(0, trigger.start)}${replacement}`;
}
