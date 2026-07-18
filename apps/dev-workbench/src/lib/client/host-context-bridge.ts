import {
  visualContextRequestSchema,
  visualContextResultSchema,
  type VisualContextRequest,
  type VisualContextResult,
  type VisualContextSource,
} from "@sonik-agent-ui/tool-contracts/visual-context";

export const SONIK_AGENT_UI_HOST_MESSAGE_SOURCE = "sonik-agent-ui-host";
export const SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE = "sonik:agent-ui:page-context";
export const SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST = "sonik:agent-ui:request-page-context";
export const SONIK_AGENT_UI_HOST_ACTION_REQUEST = "sonik:agent-ui:action-request";
export const SONIK_AGENT_UI_HOST_ACTION_RESULT = "sonik:agent-ui:action-result";
export const SONIK_VISUAL_CONTEXT_REQUEST = "sonik:visual-context:request";
export const SONIK_VISUAL_CONTEXT_RESULT = "sonik:visual-context:result";
export const SONIK_VISUAL_CONTEXT_RESULT_SOURCE = "sonik-agent-host";

export type DiscoveredVisualSource = {
  id: "preview" | "host";
  label: string;
  surface: string;
  route: string;
};

export type AgentHostPageContextMessage = {
  source: typeof SONIK_AGENT_UI_HOST_MESSAGE_SOURCE;
  type: typeof SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE;
  payload: Record<string, unknown>;
  authority?: unknown;
  sentAt?: string;
};

export function isAgentHostPageContextMessage(value: unknown): value is AgentHostPageContextMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.source === SONIK_AGENT_UI_HOST_MESSAGE_SOURCE
    && record.type === SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE
    && Boolean(record.payload)
    && typeof record.payload === "object"
    && !Array.isArray(record.payload)
    && (record.sentAt === undefined || typeof record.sentAt === "string");
}

export function isAgentPageContextRequestMessage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.source === "sonik-agent-ui" && record.type === SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST;
}

export function isAgentHostActionRequestMessage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.source === "sonik-agent-ui" && record.type === SONIK_AGENT_UI_HOST_ACTION_REQUEST;
}

export function isAgentHostActionResultMessage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.source === SONIK_AGENT_UI_HOST_MESSAGE_SOURCE && record.type === SONIK_AGENT_UI_HOST_ACTION_RESULT;
}

export function createAgentPageContextRequest(reason: string) {
  return {
    source: "sonik-agent-ui",
    type: SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST,
    reason,
    sentAt: new Date().toISOString(),
  } as const;
}

export function resolveEmbeddedHostColorScheme(search: string): "light" | "dark" | null {
  const value = new URLSearchParams(search).get("colorScheme");
  return value === "light" || value === "dark" ? value : null;
}

export function resolveEmbeddedHostOrigin(input: {
  search: string;
  referrer: string;
  allowlist?: string;
}): string | null {
  const configured = new URLSearchParams(input.search).get("agentUiHostOrigin");
  if (!configured) return null;
  const configuredOrigin = parseOrigin(configured);
  if (!configuredOrigin || !isOriginAllowed(configuredOrigin, input.allowlist)) return null;
  if (!input.referrer) return configuredOrigin;
  const referrerOrigin = parseOrigin(input.referrer);
  return referrerOrigin === configuredOrigin ? configuredOrigin : null;
}

export function createEmbeddedPreviewUrl(input: {
  previewUrl: string;
  workbenchOrigin: string | null;
  theme?: string | null;
}): string {
  if (!input.workbenchOrigin) return input.previewUrl;
  const url = new URL(input.previewUrl);
  url.searchParams.set("agentUiHostOrigin", input.workbenchOrigin);
  url.searchParams.set("embedMode", "workspace");
  url.searchParams.set("rail", "expanded");
  if (input.theme?.trim()) url.searchParams.set("theme", input.theme.trim());
  return url.toString();
}

export function discoverVisualSources(input: {
  previewUrl?: string | null;
  previewRoute?: string | null;
  hostOrigin?: string | null;
  hostRoute?: unknown;
}): DiscoveredVisualSource[] {
  const sources: DiscoveredVisualSource[] = [];
  if (input.previewUrl) {
    sources.push({ id: "preview", label: "Preview", surface: "workbench-preview", route: sanitizeRoute(input.previewRoute) });
  }
  const hostOrigin = input.hostOrigin ? parseOrigin(input.hostOrigin) : null;
  if (hostOrigin) {
    sources.push({
      id: "host",
      label: `Host · ${new URL(hostOrigin).hostname.slice(0, 120)}`,
      surface: "embedded-host",
      route: sanitizeRoute(input.hostRoute),
    });
  }
  return sources;
}

export function defaultVisualSourceId(sources: readonly DiscoveredVisualSource[]): "preview" | "host" | null {
  return sources.some((source) => source.id === "host") ? "host" : sources[0]?.id ?? null;
}

export function isVisualContextResultMessage(value: unknown): value is VisualContextResult {
  return visualContextResultSchema.safeParse(value).success;
}

export function createVisualContextSubmission(
  workspaceSessionId: string,
  request: VisualContextRequest,
  result: VisualContextResult,
) {
  return { workspaceSessionId, request, result } as const;
}

export function visualPickDisabledReason(sourceId: "preview" | "host" | null): string | null {
  if (!sourceId) return "No Preview or Host visual source is connected.";
  return sourceId === "host" ? null : "Element picking is available only for a connected Host source.";
}

export function classifyVisualContextResult(input: {
  pending: VisualContextRequest | null;
  result: VisualContextResult;
  sourceContextRevision: number;
  routeRevision: number;
  source: VisualContextSource | null;
}): "accept" | "ignore" | "invalidate" {
  if (!input.pending || input.result.requestId !== input.pending.requestId) return "ignore";
  const pending = visualContextRequestSchema.safeParse(input.pending);
  if (!pending.success
    || input.result.operation !== pending.data.operation
    || input.result.origin !== pending.data.origin
    || input.result.provider !== pending.data.provider
    || input.result.sourceContextRevision !== pending.data.sourceContextRevision
    || input.result.routeRevision !== pending.data.routeRevision
    || !sameVisualSource(input.result.source, pending.data.source)
    || input.sourceContextRevision !== pending.data.sourceContextRevision
    || input.routeRevision !== pending.data.routeRevision
    || !input.source
    || !sameVisualSource(input.source, pending.data.source)) return "invalidate";
  return "accept";
}

export function hostVisualPersistenceState(accepted: boolean, result: Pick<VisualContextResult, "operation" | "status">) {
  if (!accepted || result.status !== "completed") return {
    status: "invalidated" as const,
    staleReason: "navigation" as const,
    message: "A stale Host result was discarded. Retry the visual action.",
  };
  return {
    status: "idle" as const,
    staleReason: null,
    message: result.operation === "capture"
      ? "Host Capture is current."
      : result.operation === "pick"
        ? "Visual target selected."
        : "Host visual context cleared.",
  };
}

function sameVisualSource(left: VisualContextSource, right: VisualContextSource): boolean {
  return left.id === right.id && left.label === right.label && left.surface === right.surface && left.route === right.route;
}

export function isOriginAllowed(origin: string, allowlist?: string): boolean {
  const parsed = parseOrigin(origin);
  if (!parsed) return false;
  const url = new URL(parsed);
  return (allowlist ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .some((pattern) => {
      if (pattern === "*") return true;
      const wildcard = pattern.match(/^(https?):\/\/\*\.([^/:]+(?::\d+)?)$/i);
      if (wildcard) {
        const protocol = `${wildcard[1]!.toLowerCase()}:`;
        const [suffix, port] = wildcard[2]!.toLowerCase().split(":");
        if (url.protocol !== protocol || !suffix) return false;
        if (port ? url.port !== port : Boolean(url.port)) return false;
        return url.hostname.toLowerCase().endsWith(`.${suffix}`);
      }
      return parseOrigin(pattern) === parsed;
    });
}

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function sanitizeRoute(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value.split(/[?#]/, 1)[0]!.slice(0, 2_048) || "/";
}
