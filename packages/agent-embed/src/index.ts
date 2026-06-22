import { sanitizePageContext, type AgentUiPageContextSnapshot } from "@sonik-agent-ui/agent-observability";
import type { HostSessionEnvelope, PlatformAdapterContext } from "@sonik-agent-ui/platform-adapters";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";

export const SONIK_AGENT_UI_HOST_MESSAGE_SOURCE = "sonik-agent-ui-host";
export const SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE = "sonik:agent-ui:page-context";

export type AgentEmbedMode = "workspace" | "chat" | "canvas";
export type AgentEmbedRailMode = "expanded" | "collapsed" | "hidden";

export type AgentEmbedIntent = {
  mode: AgentEmbedMode;
  railMode: AgentEmbedRailMode;
};

export type AgentEmbedIntentInput = {
  embedMode?: unknown;
  agentUiMode?: unknown;
  rail?: unknown;
  railMode?: unknown;
};

export type AgentHostActiveEntity = {
  type: string;
  id: string;
  label?: string;
};

export type AgentHostPageContext = Partial<Omit<AgentPageContext, "activeEntity"> & Omit<AgentUiPageContextSnapshot, "activeEntity">> & {
  activeEntity?: AgentHostActiveEntity;
};

export type AgentTrustedHostContext = Pick<PlatformAdapterContext, "authenticated" | "organizationId" | "scopes"> & {
  hostSession?: HostSessionEnvelope | null;
};

export type AgentHostMergedPageContext = AgentHostPageContext & Partial<AgentTrustedHostContext>;

export type AgentHostPageContextMessage = {
  source: typeof SONIK_AGENT_UI_HOST_MESSAGE_SOURCE;
  type: typeof SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE;
  payload: AgentHostPageContext;
  sentAt?: string;
};

export type AgentHostContextProvider = () => AgentHostPageContext | Promise<AgentHostPageContext>;

const MAX_SAFE_TEXT_LENGTH = 160;
const MAX_LIST_ITEMS = 8;
const ALLOWED_CONTEXT_KEYS = new Set([
  "route",
  "surface",
  "pageType",
  "title",
  "theme",
  "mode",
  "activeSessionId",
  "activeArtifactId",
  "activeDocumentId",
  "artifactType",
  "conversationStatus",
  "messageCount",
  "visibleActions",
  "visibleWarnings",
  "visibleErrors",
  "commandFamilies",
  "skillFamilies",
  "activeEntity",
  "at",
]);
const SECRET_VALUE_PATTERN = /\b(vck_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/g;

export function isAgentHostPageContextMessage(value: unknown): value is AgentHostPageContextMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.source !== SONIK_AGENT_UI_HOST_MESSAGE_SOURCE) return false;
  if (record.type !== SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE) return false;
  if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) return false;
  if (record.sentAt !== undefined && typeof record.sentAt !== "string") return false;
  return true;
}

export function normalizeAgentEmbedIntent(input: AgentEmbedIntentInput = {}): AgentEmbedIntent {
  const mode = cleanEmbedMode(input.embedMode) ?? cleanEmbedMode(input.agentUiMode) ?? "workspace";
  return {
    mode,
    railMode: cleanEmbedRailMode(input.railMode) ?? cleanEmbedRailMode(input.rail) ?? defaultRailModeForEmbedMode(mode),
  };
}

export function sanitizeAgentHostPageContext(value: unknown): AgentHostPageContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowedRecord = Object.fromEntries(Object.entries(record).filter(([key]) => ALLOWED_CONTEXT_KEYS.has(key)));
  const base = sanitizePageContext(allowedRecord) as AgentHostPageContext | undefined;
  const activeEntity = sanitizeAgentHostActiveEntity(record.activeEntity);
  const context: AgentHostPageContext = {
    ...(base ?? {}),
    ...(activeEntity ? { activeEntity } : {}),
  };
  return Object.keys(context).length > 0 ? context : undefined;
}

function cleanEmbedMode(value: unknown): AgentEmbedMode | undefined {
  return value === "chat" || value === "canvas" || value === "workspace" ? value : undefined;
}

function cleanEmbedRailMode(value: unknown): AgentEmbedRailMode | undefined {
  return value === "expanded" || value === "collapsed" || value === "hidden" ? value : undefined;
}

function defaultRailModeForEmbedMode(mode: AgentEmbedMode): AgentEmbedRailMode {
  if (mode === "chat") return "hidden";
  if (mode === "canvas") return "collapsed";
  return "expanded";
}

export function mergeAgentHostPageContext(
  local: AgentUiPageContextSnapshot | AgentPageContext = {},
  host?: AgentHostPageContext | null,
  trusted?: AgentTrustedHostContext | null,
): AgentHostMergedPageContext {
  const sanitizedLocal = sanitizeAgentHostPageContext(local) ?? {};
  const sanitizedHost = sanitizeAgentHostPageContext(host) ?? {};
  const sanitizedTrusted = sanitizeTrustedHostContext(trusted);
  return {
    ...sanitizedLocal,
    ...sanitizedHost,
    ...sanitizedTrusted,
  };
}

function sanitizeTrustedHostContext(value: AgentTrustedHostContext | null | undefined): Partial<AgentTrustedHostContext> {
  if (!value) return {};
  const trusted: Partial<AgentTrustedHostContext> = {};
  if (typeof value.authenticated === "boolean") trusted.authenticated = value.authenticated;
  if (typeof value.organizationId === "string" && value.organizationId.trim()) trusted.organizationId = cleanText(value.organizationId);
  if (value.organizationId === null) trusted.organizationId = null;
  if (Array.isArray(value.scopes)) trusted.scopes = value.scopes.map(cleanText).filter((scope): scope is string => Boolean(scope)).slice(0, MAX_LIST_ITEMS);
  if (value.hostSession) trusted.hostSession = value.hostSession;
  return trusted;
}

function sanitizeAgentHostActiveEntity(value: unknown): AgentHostActiveEntity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const type = cleanText(record.type);
  const id = cleanText(record.id);
  const label = cleanText(record.label);
  if (!type || !id) return undefined;
  return {
    type,
    id,
    ...(label ? { label } : {}),
  };
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_SAFE_TEXT_LENGTH).replace(SECRET_VALUE_PATTERN, "[REDACTED]");
}
