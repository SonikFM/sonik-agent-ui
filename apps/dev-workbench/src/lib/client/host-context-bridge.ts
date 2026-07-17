export const SONIK_AGENT_UI_HOST_MESSAGE_SOURCE = "sonik-agent-ui-host";
export const SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE = "sonik:agent-ui:page-context";
export const SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST = "sonik:agent-ui:request-page-context";
export const SONIK_AGENT_UI_HOST_ACTION_REQUEST = "sonik:agent-ui:action-request";
export const SONIK_AGENT_UI_HOST_ACTION_RESULT = "sonik:agent-ui:action-result";

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
