import { sanitizePageContext, type AgentUiPageContextSnapshot } from "@sonik-agent-ui/agent-observability";
import type { HostSessionEnvelope, PlatformAdapterContext } from "@sonik-agent-ui/platform-adapters";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";
import {
  agentActionChannelVersion,
  createHostActionRequest,
  createHostActionResult,
  evaluateHostActionRequest,
  hostActionRequestSchema,
  hostActionResultSchema,
  hostUiTargetRegistrySchema,
  hostUiTargetSchema,
  targetRegistryVersion,
  type HostActionKey,
  type HostActionRequest,
  type HostActionResult,
  type HostUiTarget,
  type HostUiTargetRegistry,
} from "@sonik-agent-ui/tool-contracts/target-registry";

export const SONIK_AGENT_UI_HOST_MESSAGE_SOURCE = "sonik-agent-ui-host";
export const SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE = "sonik:agent-ui:page-context";
export const SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST = "sonik:agent-ui:request-page-context";
export const SONIK_AGENT_UI_HOST_ACTION_REQUEST = "sonik:agent-ui:action-request";
export const SONIK_AGENT_UI_HOST_ACTION_RESULT = "sonik:agent-ui:action-result";

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

export type AgentHostAuthorityDonation = {
  /** Opaque HMAC-covered header. Never decode, normalize, or rebuild this value. */
  header: string;
  /** Host-owned monotonic revision used only to reject stale donations. */
  revision: number;
  /** Host-declared expiry for client-side freshness selection. */
  expiresAt: string;
};

export type AgentHostMergedPageContext = AgentHostPageContext & Partial<AgentTrustedHostContext>;

export type AgentHostContextDonation = {
  pageContext: AgentHostPageContext;
  authority?: AgentHostAuthorityDonation | null;
};

export type AgentHostPageContextMessage = {
  source: typeof SONIK_AGENT_UI_HOST_MESSAGE_SOURCE;
  type: typeof SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE;
  payload: AgentHostPageContext;
  authority?: AgentHostAuthorityDonation;
  sentAt?: string;
};

export type AgentHostContextProvider = () => AgentHostPageContext | AgentHostContextDonation | Promise<AgentHostPageContext | AgentHostContextDonation>;
export type AgentEmbedThemeProvider = string | (() => string | undefined);

export type AgentHostActionRequestInput = {
  actionKey: HostActionKey;
  targetId?: string;
  targetInstanceId?: string;
  entityRef?: HostActionRequest["entityRef"];
  input?: unknown;
  intentLabel?: string;
  requestId?: string;
  requiresReceipt?: boolean;
};

export type AgentHostActionRequestOptions = {
  window?: Window;
  hostOrigin?: string | null;
  timeoutMs?: number;
  now?: () => number;
  requestIdFactory?: () => string;
};

export type AgentEmbedHostActionContext = {
  controller: Pick<AgentEmbedHostController, "open" | "close" | "getMode" | "openChat" | "openCanvas">;
  registry?: HostUiTargetRegistry;
  pageContext: AgentHostMergedPageContext;
};

export type AgentEmbedHostActionHandler = (request: HostActionRequest, context: AgentEmbedHostActionContext) => HostActionResult | Promise<HostActionResult>;

export type AgentEmbedElementRef<T extends HTMLElement = HTMLElement> = T | string | null | undefined;

export type AgentEmbedElementRefs = {
  iframe: AgentEmbedElementRef<HTMLIFrameElement>;
  chatSlot: AgentEmbedElementRef<HTMLElement>;
  canvasSlot?: AgentEmbedElementRef<HTMLElement>;
  sidecar?: AgentEmbedElementRef<HTMLElement>;
  canvasWindow?: AgentEmbedElementRef<HTMLElement>;
  resizeHandle?: AgentEmbedElementRef<HTMLElement>;
  launcher?: AgentEmbedElementRef<HTMLElement>;
  openChat?: AgentEmbedElementRef<HTMLElement>;
  openCanvas?: AgentEmbedElementRef<HTMLElement>;
  expandCanvas?: AgentEmbedElementRef<HTMLElement>;
  dockChat?: AgentEmbedElementRef<HTMLElement>;
  closeChat?: AgentEmbedElementRef<HTMLElement>;
  closeCanvas?: AgentEmbedElementRef<HTMLElement>;
};

export type AgentEmbedHostController = Pick<AgentEmbedController, "open" | "close" | "postContext" | "scheduleContextPosts" | "getMode" | "setChatWidth"> & {
  schemaVersion: "sonik.agent_ui.host_controller.v1";
  openChat: () => void;
  openCanvas: () => void;
  getState: () => { mode: AgentEmbedMode | null; iframeSrc: string | null };
};

export type AgentEmbedMountOptions = {
  agentUrl: string | URL;
  elements: AgentEmbedElementRefs;
  getPageContext: AgentHostContextProvider;
  hostOrigin?: string;
  theme?: AgentEmbedThemeProvider;
  smokeMockStream?: string | boolean | null;
  smokeRunId?: string | null;
  /**
   * Phase 10 (agent-creation-tool-plan-2026-07-13.md): selects which PUBLISHED
   * agent definition the embedded chat runs (mirrors `body.publishedAgentId`
   * on the generate route). This is a selector only -- it never grants
   * capability; the embed-scoped grants themselves stay host-signed +
   * registry-gated server-side via the signed host-context envelope.
   */
  publishedAgentId?: string | null;
  /**
   * P1 #10 (production-readiness ledger): restricts which iframe origins this
   * mount will accept page-context-request / action-request messages from, on
   * top of the existing exact-match check against the mounted agentUrl's
   * origin. Absent/undefined = today's behavior (no extra restriction) so
   * existing embeds are unaffected. Accepts the same comma-separated /
   * wildcard-pattern shape as `parseAgentOriginAllowlist`.
   */
  allowedOrigins?: string | readonly string[];
  initialMode?: AgentEmbedMode | null;
  contextPostDelaysMs?: readonly number[];
  minChatWidth?: number;
  maxChatWidth?: number;
  bodyDatasetKey?: string;
  hostControllerKey?: string | null;
  onModeChange?: (mode: AgentEmbedMode | null) => void;
  onError?: (error: unknown) => void;
  /**
   * Optional host-owned implementation of Agent Action Channel requests coming
   * from the embedded iframe. When omitted, the SDK only handles safe canvas
   * open/close requests and returns typed unavailable receipts for everything
   * else; booking/Amplify must install their own adapter before actions execute.
   */
  handleHostAction?: AgentEmbedHostActionHandler;
  window?: Window;
  document?: Document;
};

export type AgentEmbedUpdateOptions = Partial<Pick<AgentEmbedMountOptions, "getPageContext" | "theme" | "smokeMockStream" | "smokeRunId" | "publishedAgentId">>;

export type AgentEmbedController = {
  iframe: HTMLIFrameElement;
  open: (mode: AgentEmbedMode) => void;
  close: (mode?: "chat" | "canvas" | "all") => void;
  postContext: () => Promise<void>;
  scheduleContextPosts: () => void;
  update: (options: AgentEmbedUpdateOptions) => void;
  destroy: () => void;
  getMode: () => AgentEmbedMode | null;
  setChatWidth: (width: number) => void;
};

const MAX_SAFE_TEXT_LENGTH = 160;
const MAX_LIST_ITEMS = 8;
const MAX_SIGNED_HOST_CONTEXT_COMMAND_IDS = 256;
const MAX_HOST_UI_TARGETS = MAX_LIST_ITEMS * 4;
const SIGNED_HOST_CONTEXT_COMMAND_METADATA_KEYS = new Set(["approvedCommandIds"]);
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
  "workflow",
  "hostUiTargets",
  "hostUiTargetRegistry",
  "commandFamilies",
  "skillFamilies",
  "activeEntity",
  "authenticated",
  "organizationId",
  "scopes",
  "hostSession",
  "at",
]);
const SECRET_VALUE_PATTERN = /\b(vck_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/g;

export function isAgentHostPageContextMessage(value: unknown): value is AgentHostPageContextMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.source !== SONIK_AGENT_UI_HOST_MESSAGE_SOURCE) return false;
  if (record.type !== SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE) return false;
  if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) return false;
  if (record.authority !== undefined && !sanitizeAgentHostAuthorityDonation(record.authority)) return false;
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

export function createAgentEmbedUrl(input: {
  agentUrl: string | URL;
  mode: AgentEmbedMode;
  hostOrigin?: string;
  theme?: string;
  smokeMockStream?: string | boolean | null;
  smokeRunId?: string | null;
  publishedAgentId?: string | null;
}): string {
  const url = new URL(String(input.agentUrl), input.hostOrigin ?? globalThis.location?.origin ?? "http://localhost");
  const intent = normalizeAgentEmbedIntent({ embedMode: input.mode });
  if (input.hostOrigin) url.searchParams.set("agentUiHostOrigin", input.hostOrigin);
  if (input.theme) url.searchParams.set("theme", input.theme);
  url.searchParams.set("embedMode", intent.mode);
  url.searchParams.set("rail", intent.railMode);
  if (input.smokeMockStream !== null && input.smokeMockStream !== undefined && input.smokeMockStream !== false) {
    url.searchParams.set("smokeMockStream", input.smokeMockStream === true ? "1" : String(input.smokeMockStream));
  }
  if (input.smokeRunId) url.searchParams.set("smokeRunId", input.smokeRunId);
  if (input.publishedAgentId) url.searchParams.set("publishedAgentId", input.publishedAgentId);
  return url.toString();
}


export function parseAgentOriginAllowlist(value: string | readonly string[] | undefined): string[] {
  if (!value) return [];
  const values = typeof value === "string" ? value.split(",") : [...value];
  return values.map((entry: string) => entry.trim()).filter(Boolean);
}

export function isAgentOriginAllowed(origin: string, allowlist: string | readonly string[] | undefined): boolean {
  const patterns = parseAgentOriginAllowlist(allowlist);
  if (patterns.length === 0) return false;
  const parsedOrigin = parseOriginUrl(origin);
  if (!parsedOrigin) return false;
  return patterns.some((pattern) => doesOriginMatchPattern(parsedOrigin, pattern));
}

function parseOriginUrl(origin: string): URL | undefined {
  try {
    const parsed = new URL(origin);
    if (parsed.pathname !== "/" || parsed.search || parsed.hash) return undefined;
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function resolveAgentHostActionTargetOrigin(ownerWindow: Window, configuredHostOrigin?: string | null): string | undefined {
  const explicit = typeof configuredHostOrigin === "string" && configuredHostOrigin.trim()
    ? configuredHostOrigin.trim()
    : new URLSearchParams(ownerWindow.location.search).get("agentUiHostOrigin");
  if (!explicit) return undefined;
  try {
    return new URL(explicit, ownerWindow.location.origin).origin;
  } catch {
    return undefined;
  }
}

function createAgentHostActionRequestId(nowMs: number): string {
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 18)
    : Math.random().toString(36).slice(2, 20).padEnd(18, "0");
  return `hostact_${Math.max(0, Math.floor(nowMs)).toString(36)}_${random}`;
}

function doesOriginMatchPattern(origin: URL, pattern: string): boolean {
  if (pattern === "*") return true;
  const wildcardMatch = pattern.match(/^(https?):\/\/\*\.([^/:]+(?::\d+)?)$/i);
  if (wildcardMatch) {
    const protocol = wildcardMatch[1];
    const hostPattern = wildcardMatch[2];
    if (!protocol || !hostPattern) return false;
    if (`${protocol.toLowerCase()}:` !== origin.protocol) return false;
    const [suffix, port] = hostPattern.toLowerCase().split(":");
    if (!suffix) return false;
    if (port && origin.port !== port) return false;
    if (!port && origin.port) return false;
    const hostname = origin.hostname.toLowerCase();
    return hostname.endsWith(`.${suffix}`) && hostname !== suffix;
  }

  const exact = parseOriginUrl(pattern);
  return exact?.origin === origin.origin;
}


function isAgentPageContextRequestMessage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.source === "sonik-agent-ui" && record.type === SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST;
}

export function createAgentHostPageContextMessage(
  payload: AgentHostPageContext,
  authority?: AgentHostAuthorityDonation | null,
): AgentHostPageContextMessage {
  const safeAuthority = sanitizeAgentHostAuthorityDonation(authority);
  return {
    source: SONIK_AGENT_UI_HOST_MESSAGE_SOURCE,
    type: SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE,
    payload,
    ...(safeAuthority ? { authority: safeAuthority } : {}),
    sentAt: new Date().toISOString(),
  };
}

export function sanitizeAgentHostAuthorityDonation(value: unknown): AgentHostAuthorityDonation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const { header, revision, expiresAt } = record;
  if (typeof header !== "string" || header.length < 1 || header.length > 8_192 || !/^[A-Za-z0-9_-]+$/.test(header)) return undefined;
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) return undefined;
  if (typeof expiresAt !== "string" || expiresAt.length > MAX_SAFE_TEXT_LENGTH || !Number.isFinite(Date.parse(expiresAt))) return undefined;
  return { header, revision: Number(revision), expiresAt };
}

export function isAgentHostActionRequestMessage(value: unknown): value is HostActionRequest {
  return hostActionRequestSchema.safeParse(value).success;
}

export function isAgentHostActionResultMessage(value: unknown): value is HostActionResult {
  return hostActionResultSchema.safeParse(value).success;
}

export function createUnavailableAgentHostActionResult(input: {
  requestId: string;
  actionKey: HostActionKey;
  disabledReason: string;
  message?: string;
}): HostActionResult {
  return createHostActionResult({
    requestId: input.requestId,
    actionKey: input.actionKey,
    ok: false,
    status: "unavailable",
    policyMode: "require",
    disabledReason: input.disabledReason,
    ...(input.message ? { message: input.message } : {}),
  });
}

export function requestAgentHostAction(input: AgentHostActionRequestInput, options: AgentHostActionRequestOptions = {}): Promise<HostActionResult> {
  const ownerWindow = options.window ?? globalThis.window;
  const request = createHostActionRequest({
    requestId: input.requestId ?? options.requestIdFactory?.() ?? createAgentHostActionRequestId(options.now?.() ?? Date.now()),
    actionKey: input.actionKey,
    targetId: input.targetId,
    targetInstanceId: input.targetInstanceId,
    entityRef: input.entityRef,
    input: input.input,
    intentLabel: input.intentLabel,
    requiresReceipt: input.requiresReceipt ?? true,
  });

  if (!ownerWindow || ownerWindow.parent === ownerWindow) {
    return Promise.resolve(createUnavailableAgentHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      disabledReason: "host_action_parent_unavailable",
      message: "No embedding host is available for this action.",
    }));
  }

  const targetOrigin = resolveAgentHostActionTargetOrigin(ownerWindow, options.hostOrigin);
  if (!targetOrigin) {
    return Promise.resolve(createUnavailableAgentHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      disabledReason: "host_action_origin_unavailable",
      message: "No trusted host origin is configured for this embedded action.",
    }));
  }

  const timeoutMs = Math.max(250, Math.min(options.timeoutMs ?? 5_000, 30_000));
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      ownerWindow.clearTimeout(timeoutId);
      ownerWindow.removeEventListener("message", onMessage);
    };
    const finish = (result: HostActionResult) => {
      if (settled) return;
      cleanup();
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== targetOrigin) return;
      if (event.source !== ownerWindow.parent) return;
      const record = event.data && typeof event.data === "object" && !Array.isArray(event.data)
        ? event.data as Record<string, unknown>
        : null;
      if (record?.requestId !== request.requestId) return;
      const parsed = hostActionResultSchema.safeParse(event.data);
      if (!parsed.success) {
        finish(createHostActionResult({
          requestId: request.requestId,
          actionKey: request.actionKey,
          ok: false,
          status: "invalid_request",
          policyMode: "block",
          disabledReason: "host_action_result_invalid",
          message: "The embedding host returned a malformed action result.",
        }));
        return;
      }
      if (parsed.data.version !== agentActionChannelVersion || parsed.data.actionKey !== request.actionKey) {
        finish(createHostActionResult({
          requestId: request.requestId,
          actionKey: request.actionKey,
          ok: false,
          status: "invalid_request",
          policyMode: "block",
          disabledReason: "host_action_result_mismatch",
          message: "The embedding host returned an action result for the wrong action channel.",
        }));
        return;
      }
      finish(parsed.data);
    };
    const timeoutId = ownerWindow.setTimeout(() => {
      finish(createUnavailableAgentHostActionResult({
        requestId: request.requestId,
        actionKey: request.actionKey,
        disabledReason: "host_action_timeout",
        message: "The embedding host did not return an action receipt before timeout.",
      }));
    }, timeoutMs);
    ownerWindow.addEventListener("message", onMessage);
    ownerWindow.parent.postMessage(request, targetOrigin);
  });
}

export function sanitizeAgentHostPageContext(value: unknown): AgentHostMergedPageContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowedRecord = Object.fromEntries(Object.entries(record).filter(([key]) => ALLOWED_CONTEXT_KEYS.has(key)));
  const base = sanitizePageContext(allowedRecord) as AgentHostPageContext | undefined;
  const activeEntity = sanitizeAgentHostActiveEntity(record.activeEntity);
  const hostUiTargets = sanitizeHostUiTargets(record.hostUiTargets);
  const hostUiTargetRegistry = sanitizeHostUiTargetRegistry(record.hostUiTargetRegistry);
  const trusted = sanitizeTrustedHostContext(record as AgentTrustedHostContext);
  const context: AgentHostMergedPageContext = {
    ...(base ?? {}),
    ...(activeEntity ? { activeEntity } : {}),
    ...(hostUiTargets ? { hostUiTargets } : {}),
    ...(hostUiTargetRegistry ? { hostUiTargetRegistry } : {}),
    ...trusted,
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
  // Canvas/workspace modes show the full rail so session management
  // (pin, archive/restore) is reachable in the embedded product surface;
  // hosts can still pass railMode=collapsed to override.
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

export function mountSonikAgentUI(options: AgentEmbedMountOptions): AgentEmbedController {
  const ownerWindow = options.window ?? globalThis.window;
  const ownerDocument = options.document ?? ownerWindow?.document;
  if (!ownerWindow || !ownerDocument) throw new Error("mountSonikAgentUI requires a browser Window/Document.");

  let getPageContext = options.getPageContext;
  let theme = options.theme;
  let smokeMockStream = options.smokeMockStream;
  let smokeRunId = options.smokeRunId;
  let publishedAgentId = options.publishedAgentId;
  let activeMode: AgentEmbedMode | null = null;
  let resizeFrame = 0;
  const disposers: Array<() => void> = [];
  const contextPostTimeouts: number[] = [];
  const delays = options.contextPostDelaysMs ?? [250, 900, 1800, 3200, 5200, 8000];
  const bodyDatasetKey = options.bodyDatasetKey ?? "agentUiOpen";

  const iframe = requiredElement<HTMLIFrameElement>(ownerDocument, options.elements.iframe, "iframe");
  const chatSlot = requiredElement(ownerDocument, options.elements.chatSlot, "chatSlot");
  const canvasSlot = optionalElement(ownerDocument, options.elements.canvasSlot);
  const sidecar = optionalElement(ownerDocument, options.elements.sidecar);
  const canvasWindow = optionalElement(ownerDocument, options.elements.canvasWindow);
  const resizeHandle = optionalElement(ownerDocument, options.elements.resizeHandle);
  const hostControllerKey = options.hostControllerKey === null ? null : options.hostControllerKey ?? "__sonikAgentHost";
  const hostWindow = ownerWindow as Window & Record<string, unknown>;

  annotateHostElement(iframe, "iframe");
  annotateHostElement(chatSlot, "chat-slot");
  annotateHostElement(canvasSlot, "canvas-slot");
  annotateHostElement(sidecar, "sidecar");
  annotateHostElement(canvasWindow, "canvas-window");
  annotateHostElement(resizeHandle, "resize-handle");
  annotateHostElement(optionalElement(ownerDocument, options.elements.launcher), "launcher");
  annotateHostElement(optionalElement(ownerDocument, options.elements.openChat), "open-chat");
  annotateHostElement(optionalElement(ownerDocument, options.elements.openCanvas), "open-canvas");
  annotateHostElement(optionalElement(ownerDocument, options.elements.expandCanvas), "expand-canvas");
  annotateHostElement(optionalElement(ownerDocument, options.elements.dockChat), "dock-chat");
  annotateHostElement(optionalElement(ownerDocument, options.elements.closeChat), "close-chat");
  annotateHostElement(optionalElement(ownerDocument, options.elements.closeCanvas), "close-canvas");

  const postContext = async () => {
    try {
      const donated = await getPageContext();
      const donation = donated && typeof donated === "object" && !Array.isArray(donated) && "pageContext" in donated
        ? donated as AgentHostContextDonation
        : { pageContext: donated as AgentHostPageContext };
      const payload = {
        ...(sanitizeAgentHostPageContext(donation.pageContext) ?? {}),
        ...(activeMode ? { mode: activeMode } : {}),
      };
      const targetOrigin = resolveMountedAgentTargetOrigin(iframe, options.agentUrl, ownerWindow);
      if (!targetOrigin) return;
      iframe.contentWindow?.postMessage(createAgentHostPageContextMessage(payload, donation.authority), targetOrigin);
    } catch (error) {
      options.onError?.(error);
    }
  };

  const scheduleContextPosts = () => {
    for (const delay of delays) contextPostTimeouts.push(ownerWindow.setTimeout(() => void postContext(), delay));
  };

  const mountFrame = (slot: HTMLElement) => {
    if (iframe.parentElement === slot) return;
    const moveBefore = (slot as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }).moveBefore;
    if (typeof moveBefore === "function") {
      moveBefore.call(slot, iframe, null);
      return;
    }
    slot.appendChild(iframe);
  };

  const setFrameMode = (mode: AgentEmbedMode) => {
    if (iframe.getAttribute("src")) {
      void postContext();
      return;
    }
    iframe.src = createAgentEmbedUrl({
      agentUrl: options.agentUrl,
      mode,
      hostOrigin: options.hostOrigin ?? ownerWindow.location.origin,
      theme: resolveTheme(theme),
      smokeMockStream,
      smokeRunId,
      publishedAgentId,
    });
  };

  const setOpenState = (mode: AgentEmbedMode | null) => {
    activeMode = mode;
    if (mode) ownerDocument.body.dataset[bodyDatasetKey] = mode;
    else delete ownerDocument.body.dataset[bodyDatasetKey];
    if (sidecar) sidecar.dataset.open = mode === "chat" ? "true" : "false";
    if (canvasWindow) canvasWindow.dataset.open = mode === "canvas" ? "true" : "false";
    options.onModeChange?.(mode);
  };

  const open = (mode: AgentEmbedMode) => {
    const nextMode = mode === "canvas" ? "canvas" : mode === "workspace" ? "canvas" : "chat";
    setOpenState(nextMode);
    mountFrame(nextMode === "canvas" && canvasSlot ? canvasSlot : chatSlot);
    setFrameMode(nextMode);
  };

  const close = (mode: "chat" | "canvas" | "all" = "all") => {
    if (mode !== "all" && activeMode !== mode) return;
    setOpenState(null);
  };

  const setChatWidth = (width: number) => {
    const min = options.minChatWidth ?? 360;
    const max = options.maxChatWidth ?? 760;
    const clamped = Math.max(min, Math.min(max, width));
    ownerDocument.documentElement.style.setProperty("--agent-chat-width", `${clamped}px`);
    resizeHandle?.setAttribute("aria-valuenow", String(Math.round(clamped)));
  };

  const hostController: AgentEmbedHostController = {
    schemaVersion: "sonik.agent_ui.host_controller.v1",
    open,
    close,
    postContext,
    scheduleContextPosts,
    getMode: () => activeMode,
    setChatWidth,
    openChat: () => open("chat"),
    openCanvas: () => open("canvas"),
    getState: () => ({ mode: activeMode, iframeSrc: iframe.getAttribute("src") }),
  };

  const startResize = (event: PointerEvent) => {
    if (activeMode !== "chat") return;
    event.preventDefault();
    resizeHandle?.setPointerCapture?.(event.pointerId);
    ownerDocument.body.dataset.agentUiResizing = "true";
    const move = (moveEvent: PointerEvent) => {
      ownerWindow.cancelAnimationFrame(resizeFrame);
      resizeFrame = ownerWindow.requestAnimationFrame(() => setChatWidth(ownerWindow.innerWidth - moveEvent.clientX));
    };
    const end = () => {
      ownerWindow.cancelAnimationFrame(resizeFrame);
      delete ownerDocument.body.dataset.agentUiResizing;
      ownerWindow.removeEventListener("pointermove", move);
      ownerWindow.removeEventListener("pointerup", end);
      ownerWindow.removeEventListener("pointercancel", end);
    };
    ownerWindow.addEventListener("pointermove", move);
    ownerWindow.addEventListener("pointerup", end, { once: true });
    ownerWindow.addEventListener("pointercancel", end, { once: true });
  };

  const update = (next: AgentEmbedUpdateOptions) => {
    if (next.getPageContext) getPageContext = next.getPageContext;
    if ("theme" in next) theme = next.theme;
    if ("smokeMockStream" in next) smokeMockStream = next.smokeMockStream;
    if ("smokeRunId" in next) smokeRunId = next.smokeRunId;
    if ("publishedAgentId" in next) publishedAgentId = next.publishedAgentId;
    if (activeMode) setFrameMode(activeMode);
  };

  const addClick = (ref: AgentEmbedElementRef, handler: () => void) => {
    const element = optionalElement(ownerDocument, ref);
    if (!element) return;
    element.addEventListener("click", handler);
    disposers.push(() => element.removeEventListener("click", handler));
  };

  const onLoad = () => scheduleContextPosts();
  const onRequestPageContext = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    if (!isAgentPageContextRequestMessage(event.data)) return;
    if (event.origin !== resolveMountedAgentTargetOrigin(iframe, options.agentUrl, ownerWindow)) return;
    if (options.allowedOrigins !== undefined && !isAgentOriginAllowed(event.origin, options.allowedOrigins)) return;
    void postContext();
  };
  const onRequestHostAction = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    const agentOrigin = resolveMountedAgentTargetOrigin(iframe, options.agentUrl, ownerWindow);
    if (!agentOrigin || event.origin !== agentOrigin) return;
    if (options.allowedOrigins !== undefined && !isAgentOriginAllowed(event.origin, options.allowedOrigins)) return;
    const parsed = hostActionRequestSchema.safeParse(event.data);
    if (!parsed.success) return;
    void handleEmbeddedHostAction({
      request: parsed.data,
      ownerWindow,
      iframe,
      agentOrigin,
      getPageContext,
      controller: hostController,
      handler: options.handleHostAction,
      onError: options.onError,
    });
  };
  iframe.addEventListener("load", onLoad);
  ownerWindow.addEventListener("message", onRequestPageContext);
  ownerWindow.addEventListener("message", onRequestHostAction);
  disposers.push(() => {
    iframe.removeEventListener("load", onLoad);
    ownerWindow.removeEventListener("message", onRequestPageContext);
    ownerWindow.removeEventListener("message", onRequestHostAction);
  });

  addClick(options.elements.openChat, () => open("chat"));
  addClick(options.elements.openCanvas, () => open("canvas"));
  addClick(options.elements.expandCanvas, () => open("canvas"));
  addClick(options.elements.dockChat, () => open("chat"));
  addClick(options.elements.closeChat, () => close("chat"));
  addClick(options.elements.closeCanvas, () => close("canvas"));

  if (resizeHandle) {
    resizeHandle.addEventListener("pointerdown", startResize);
    const onKeydown = (event: KeyboardEvent) => {
      if (activeMode !== "chat") return;
      const current = parseFloat(ownerWindow.getComputedStyle(ownerDocument.documentElement).getPropertyValue("--agent-chat-width")) || 520;
      if (event.key === "ArrowLeft") setChatWidth(current + 24);
      if (event.key === "ArrowRight") setChatWidth(current - 24);
    };
    resizeHandle.addEventListener("keydown", onKeydown);
    disposers.push(() => {
      resizeHandle.removeEventListener("pointerdown", startResize);
      resizeHandle.removeEventListener("keydown", onKeydown);
    });
  }

  const destroy = () => {
    for (const timeoutId of contextPostTimeouts.splice(0)) ownerWindow.clearTimeout(timeoutId);
    for (const dispose of disposers.splice(0)) dispose();
    close("all");
  };

  const getMode = () => activeMode;

  const controller: AgentEmbedController = {
    iframe,
    open,
    close,
    postContext,
    scheduleContextPosts,
    update,
    destroy,
    getMode,
    setChatWidth,
  };

  if (hostControllerKey) {
    hostWindow[hostControllerKey] = hostController;
    disposers.push(() => {
      if (hostWindow[hostControllerKey] === hostController) delete hostWindow[hostControllerKey];
    });
  }

  if (options.initialMode === "chat" || options.initialMode === "canvas" || options.initialMode === "workspace") open(options.initialMode);
  else mountFrame(chatSlot);

  return controller;
}

function annotateHostElement(element: HTMLElement | null | undefined, control: string): void {
  if (!element) return;
  element.dataset.sonikAgentUiControl = control;
  if (!element.getAttribute("data-testid")) element.setAttribute("data-testid", `sonik-agent-ui-${control}`);
}

async function handleEmbeddedHostAction(input: {
  ownerWindow: Window;
  iframe: HTMLIFrameElement;
  agentOrigin: string;
  getPageContext: AgentHostContextProvider;
  controller: AgentEmbedHostController;
  handler?: AgentEmbedHostActionHandler;
  onError?: (error: unknown) => void;
} & { request: HostActionRequest }): Promise<void> {
  const { request } = input;
  let result: HostActionResult;
  try {
    const pageContext = sanitizeAgentHostPageContext(await input.getPageContext()) ?? {};
    const registry = resolveHostActionRegistry(pageContext);
    if (input.handler) {
      const handlerResult = hostActionResultSchema.parse(await input.handler(request, { controller: input.controller, pageContext, registry }));
      result = correlateHostActionResult(request, handlerResult);
    } else {
      result = handleDefaultEmbeddedHostAction(request, { controller: input.controller, registry });
    }
  } catch (error) {
    input.onError?.(error);
    result = createHostActionResult({
      requestId: request.requestId,
      actionKey: request.actionKey,
      ok: false,
      status: "invalid_request",
      policyMode: "block",
      disabledReason: "host_action_handler_error",
      message: "Host action handler failed.",
    });
  }
  input.iframe.contentWindow?.postMessage(result, input.agentOrigin);
}

function correlateHostActionResult(request: HostActionRequest, result: HostActionResult): HostActionResult {
  if (result.requestId === request.requestId && result.actionKey === request.actionKey) return result;
  return createHostActionResult({
    requestId: request.requestId,
    actionKey: request.actionKey,
    ok: false,
    status: "invalid_request",
    policyMode: "block",
    disabledReason: "host_action_result_mismatch",
    message: "The embedding host returned an action result for the wrong action request.",
  });
}

function handleDefaultEmbeddedHostAction(
  request: HostActionRequest,
  input: { controller: AgentEmbedHostController; registry?: HostUiTargetRegistry },
): HostActionResult {
  const evaluated = evaluateHostActionRequest({ request, registry: input.registry });
  if (!evaluated.ok) return evaluated;
  if (request.actionKey === "canvas.open") {
    input.controller.openCanvas();
    return evaluated;
  }
  if (request.actionKey === "canvas.close") {
    input.controller.close("canvas");
    return evaluated;
  }
  return createUnavailableAgentHostActionResult({
    requestId: request.requestId,
    actionKey: request.actionKey,
    disabledReason: "host_action_handler_not_registered",
    message: "The embedding host has not registered an implementation for this action.",
  });
}

function sanitizeTrustedHostContext(value: AgentTrustedHostContext | null | undefined): Partial<AgentTrustedHostContext> {
  if (!value) return {};
  const trusted: Partial<AgentTrustedHostContext> = {};
  if (typeof value.authenticated === "boolean") trusted.authenticated = value.authenticated;
  if (typeof value.organizationId === "string" && value.organizationId.trim()) trusted.organizationId = cleanText(value.organizationId);
  if (value.organizationId === null) trusted.organizationId = null;
  if (Array.isArray(value.scopes)) trusted.scopes = value.scopes.map(cleanText).filter((scope): scope is string => Boolean(scope)).slice(0, MAX_LIST_ITEMS);
  if (value.hostSession && typeof value.hostSession === "object" && !Array.isArray(value.hostSession)) {
    const session = value.hostSession as HostSessionEnvelope;
    const metadata = sanitizeHostSessionMetadata(session.metadata);
    const theme = cleanText(session.theme);
    trusted.hostSession = {
      source: cleanText(session.source) === "amplify-embedded" ? "amplify-embedded" : cleanText(session.source) === "embedded-host" ? "embedded-host" : cleanText(session.source) === "standalone-demo" ? "standalone-demo" : "anonymous",
      sessionId: cleanText(session.sessionId) ?? null,
      userId: cleanText(session.userId) ?? null,
      principalId: cleanText(session.principalId) ?? null,
      organizationId: cleanText(session.organizationId) ?? null,
      authenticated: session.authenticated === true,
      scopes: Array.isArray(session.scopes) ? session.scopes.map(cleanText).filter((scope): scope is string => Boolean(scope)).slice(0, MAX_LIST_ITEMS) : [],
      ...(theme ? { theme } : {}),
      expiresAt: cleanText(session.expiresAt) ?? null,
      ...(metadata ? { metadata } : {}),
    };
  }
  return trusted;
}

function resolveHostActionRegistry(pageContext: AgentHostMergedPageContext): HostUiTargetRegistry | undefined {
  return sanitizeHostUiTargetRegistry(pageContext.hostUiTargetRegistry) ?? createHostUiTargetRegistryFromTargets(pageContext);
}

function createHostUiTargetRegistryFromTargets(pageContext: AgentHostMergedPageContext): HostUiTargetRegistry | undefined {
  const targets = sanitizeHostUiTargets(pageContext.hostUiTargets);
  if (!targets?.length) return undefined;
  return hostUiTargetRegistrySchema.parse({
    version: targetRegistryVersion,
    generatedAt: cleanText(pageContext.at) ?? new Date(0).toISOString(),
    provider: `${cleanText(pageContext.surface) ?? "page-context"}-targets`,
    ...(cleanText(pageContext.route) ? { route: cleanText(pageContext.route) } : {}),
    ...(cleanText(pageContext.surface) ? { surface: cleanText(pageContext.surface) } : {}),
    targets,
  });
}

function sanitizeHostUiTargets(value: unknown): AgentHostPageContext["hostUiTargets"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const targets = value.flatMap((entry) => {
    const sanitized = sanitizeHostUiTarget(entry);
    return sanitized ? [sanitized] : [];
  }).slice(0, MAX_HOST_UI_TARGETS);
  return targets.length > 0 ? targets : undefined;
}

function sanitizeHostUiTargetRegistry(value: unknown): HostUiTargetRegistry | undefined {
  const parsed = hostUiTargetRegistrySchema.safeParse(value);
  if (!parsed.success) return undefined;
  const provider = cleanText(parsed.data.provider);
  const generatedAt = cleanText(parsed.data.generatedAt);
  if (!provider || !generatedAt) return undefined;
  const targets = parsed.data.targets.flatMap((target) => {
    const sanitized = sanitizeHostUiTarget(target);
    return sanitized ? [sanitized] : [];
  }).slice(0, MAX_HOST_UI_TARGETS);
  if (targets.length === 0) return undefined;
  return hostUiTargetRegistrySchema.parse({
    version: parsed.data.version,
    generatedAt,
    provider,
    ...(cleanText(parsed.data.route) ? { route: cleanText(parsed.data.route) } : {}),
    ...(cleanText(parsed.data.surface) ? { surface: cleanText(parsed.data.surface) } : {}),
    targets,
  });
}

function sanitizeHostUiTarget(value: unknown): HostUiTarget | undefined {
  const parsed = hostUiTargetSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const target = parsed.data;
  const targetId = cleanText(target.targetId);
  const label = cleanText(target.label);
  const description = cleanText(target.description);
  const surface = cleanText(target.surface);
  if (!targetId || !label || !description || !surface) return undefined;
  const targetInstanceId = cleanText(target.targetInstanceId);
  const disabledReason = cleanText(target.disabledReason);
  const policyReason = cleanText(target.policy.reason);
  const entityKind = cleanText(target.entityRef?.kind);
  const entityId = cleanText(target.entityRef?.id);
  const entityLabel = cleanText(target.entityRef?.label);
  const sanitized: HostUiTarget = {
    targetId,
    ...(targetInstanceId ? { targetInstanceId } : {}),
    label,
    description,
    surface,
    ...(entityKind && entityId ? { entityRef: { kind: entityKind, id: entityId, ...(entityLabel ? { label: entityLabel } : {}) } } : {}),
    capabilities: [...target.capabilities],
    visible: target.visible,
    enabled: target.enabled,
    ...(disabledReason ? { disabledReason } : {}),
    ...(sanitizePublicHostUiLocator(target.locator) ? { locator: sanitizePublicHostUiLocator(target.locator) } : {}),
    ...(target.bounds ? { bounds: target.bounds } : {}),
    policy: { actionMode: target.policy.actionMode, ...(policyReason ? { reason: policyReason } : {}) },
    metadata: {},
  };
  return hostUiTargetSchema.parse(sanitized);
}

function sanitizePublicHostUiLocator(locator: HostUiTarget["locator"]): HostUiTarget["locator"] | undefined {
  if (!locator) return undefined;
  if (locator.kind === "host-private") return undefined;
  if (locator.kind === "bounds") return locator;
  const value = cleanText(locator.value);
  return value ? { ...locator, value } : undefined;
}


type SanitizedHostSessionMetadataValue = string | number | boolean | string[];

function sanitizeHostSessionMetadata(value: unknown): Record<string, SanitizedHostSessionMetadataValue> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries: Array<[string, SanitizedHostSessionMetadataValue]> = [];
  let publicMetadataCount = 0;
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = cleanText(rawKey);
    if (!key) continue;
    const isSignedCommandMetadata = SIGNED_HOST_CONTEXT_COMMAND_METADATA_KEYS.has(key);
    if (!isSignedCommandMetadata && publicMetadataCount >= MAX_LIST_ITEMS) continue;
    if (typeof rawValue === "boolean" || typeof rawValue === "number") {
      entries.push([key, rawValue]);
      if (!isSignedCommandMetadata) publicMetadataCount += 1;
      continue;
    }
    if (Array.isArray(rawValue)) {
      const maxItems = isSignedCommandMetadata ? MAX_SIGNED_HOST_CONTEXT_COMMAND_IDS : MAX_LIST_ITEMS;
      const values = rawValue.map(cleanText).filter((entry): entry is string => Boolean(entry)).slice(0, maxItems);
      if (values.length > 0) {
        entries.push([key, values]);
        if (!isSignedCommandMetadata) publicMetadataCount += 1;
      }
      continue;
    }
    const text = cleanText(rawValue);
    if (text) {
      entries.push([key, text]);
      if (!isSignedCommandMetadata) publicMetadataCount += 1;
    }
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
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

function resolveTheme(theme: AgentEmbedThemeProvider | undefined): string | undefined {
  if (typeof theme === "function") return cleanText(theme());
  return cleanText(theme);
}

function resolveMountedAgentTargetOrigin(iframe: HTMLIFrameElement, agentUrl: string | URL, ownerWindow: Window): string | null {
  const frameSrc = iframe.getAttribute("src");
  if (!frameSrc || frameSrc === "about:blank") return null;
  const agentOrigin = new URL(String(agentUrl), ownerWindow.location.href).origin;
  const frameOrigin = new URL(frameSrc, ownerWindow.location.href).origin;
  return frameOrigin === agentOrigin ? frameOrigin : null;
}

function requiredElement<T extends HTMLElement>(document: Document, ref: AgentEmbedElementRef<T>, name: string): T {
  const element = optionalElement<T>(document, ref);
  if (!element) throw new Error(`mountSonikAgentUI missing required element: ${name}`);
  return element;
}

function optionalElement<T extends HTMLElement>(document: Document, ref: AgentEmbedElementRef<T>): T | null {
  if (!ref) return null;
  if (typeof ref !== "string") return ref;
  return document.querySelector<T>(ref);
}
