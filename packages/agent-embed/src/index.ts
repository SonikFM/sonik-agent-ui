import { sanitizePageContext, type AgentUiPageContextSnapshot } from "@sonik-agent-ui/agent-observability";
import type { HostSessionEnvelope, PlatformAdapterContext } from "@sonik-agent-ui/platform-adapters";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";

export const SONIK_AGENT_UI_HOST_MESSAGE_SOURCE = "sonik-agent-ui-host";
export const SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE = "sonik:agent-ui:page-context";
export const SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST = "sonik:agent-ui:request-page-context";

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

export type AgentSignedHostContextFields = {
  signatureVersion?: string | null;
  issuedAt?: string | null;
  expiresAt?: string | null;
  signature?: string | null;
};

export type AgentHostMergedPageContext = AgentHostPageContext & Partial<AgentTrustedHostContext> & AgentSignedHostContextFields;

export type AgentHostPageContextMessage = {
  source: typeof SONIK_AGENT_UI_HOST_MESSAGE_SOURCE;
  type: typeof SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE;
  payload: AgentHostPageContext;
  sentAt?: string;
};

export type AgentHostContextProvider = () => AgentHostPageContext | Promise<AgentHostPageContext>;
export type AgentEmbedThemeProvider = string | (() => string | undefined);

export type AgentEmbedElementRef<T extends HTMLElement = HTMLElement> = T | string | null | undefined;

export type AgentEmbedElementRefs = {
  iframe: AgentEmbedElementRef<HTMLIFrameElement>;
  chatSlot: AgentEmbedElementRef<HTMLElement>;
  canvasSlot?: AgentEmbedElementRef<HTMLElement>;
  sidecar?: AgentEmbedElementRef<HTMLElement>;
  canvasWindow?: AgentEmbedElementRef<HTMLElement>;
  resizeHandle?: AgentEmbedElementRef<HTMLElement>;
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
  initialMode?: AgentEmbedMode | null;
  contextPostDelaysMs?: readonly number[];
  minChatWidth?: number;
  maxChatWidth?: number;
  bodyDatasetKey?: string;
  hostControllerKey?: string | null;
  onModeChange?: (mode: AgentEmbedMode | null) => void;
  onError?: (error: unknown) => void;
  window?: Window;
  document?: Document;
};

export type AgentEmbedUpdateOptions = Partial<Pick<AgentEmbedMountOptions, "getPageContext" | "theme" | "smokeMockStream" | "smokeRunId">>;

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
  "authenticated",
  "organizationId",
  "scopes",
  "hostSession",
  "signatureVersion",
  "issuedAt",
  "expiresAt",
  "signature",
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

export function createAgentEmbedUrl(input: {
  agentUrl: string | URL;
  mode: AgentEmbedMode;
  hostOrigin?: string;
  theme?: string;
  smokeMockStream?: string | boolean | null;
  smokeRunId?: string | null;
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

export function createAgentHostPageContextMessage(payload: AgentHostPageContext): AgentHostPageContextMessage {
  return {
    source: SONIK_AGENT_UI_HOST_MESSAGE_SOURCE,
    type: SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE,
    payload,
    sentAt: new Date().toISOString(),
  };
}

export function sanitizeAgentHostPageContext(value: unknown): AgentHostMergedPageContext | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowedRecord = Object.fromEntries(Object.entries(record).filter(([key]) => ALLOWED_CONTEXT_KEYS.has(key)));
  const base = sanitizePageContext(allowedRecord) as AgentHostPageContext | undefined;
  const activeEntity = sanitizeAgentHostActiveEntity(record.activeEntity);
  const trusted = sanitizeTrustedHostContext(record as AgentTrustedHostContext);
  const signedFields = sanitizeSignedHostContextFields(record);
  const context: AgentHostMergedPageContext = {
    ...(base ?? {}),
    ...(activeEntity ? { activeEntity } : {}),
    ...trusted,
    ...signedFields,
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

export function mountSonikAgentUI(options: AgentEmbedMountOptions): AgentEmbedController {
  const ownerWindow = options.window ?? globalThis.window;
  const ownerDocument = options.document ?? ownerWindow?.document;
  if (!ownerWindow || !ownerDocument) throw new Error("mountSonikAgentUI requires a browser Window/Document.");

  let getPageContext = options.getPageContext;
  let theme = options.theme;
  let smokeMockStream = options.smokeMockStream;
  let smokeRunId = options.smokeRunId;
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
  annotateHostElement(optionalElement(ownerDocument, options.elements.openChat), "open-chat");
  annotateHostElement(optionalElement(ownerDocument, options.elements.openCanvas), "open-canvas");
  annotateHostElement(optionalElement(ownerDocument, options.elements.expandCanvas), "expand-canvas");
  annotateHostElement(optionalElement(ownerDocument, options.elements.dockChat), "dock-chat");
  annotateHostElement(optionalElement(ownerDocument, options.elements.closeChat), "close-chat");
  annotateHostElement(optionalElement(ownerDocument, options.elements.closeCanvas), "close-canvas");

  const postContext = async () => {
    try {
      const payload = sanitizeAgentHostPageContext(await getPageContext()) ?? {};
      const targetOrigin = resolveMountedAgentTargetOrigin(iframe, options.agentUrl, ownerWindow);
      if (!targetOrigin) return;
      iframe.contentWindow?.postMessage(createAgentHostPageContextMessage(payload), targetOrigin);
    } catch (error) {
      options.onError?.(error);
    }
  };

  const scheduleContextPosts = () => {
    for (const delay of delays) contextPostTimeouts.push(ownerWindow.setTimeout(() => void postContext(), delay));
  };

  const mountFrame = (slot: HTMLElement) => {
    if (iframe.parentElement !== slot) slot.appendChild(iframe);
  };

  const setFrameMode = (mode: AgentEmbedMode) => {
    const nextSrc = createAgentEmbedUrl({
      agentUrl: options.agentUrl,
      mode,
      hostOrigin: options.hostOrigin ?? ownerWindow.location.origin,
      theme: resolveTheme(theme),
      smokeMockStream,
      smokeRunId,
    });
    if (iframe.getAttribute("src") !== nextSrc) iframe.src = nextSrc;
    else void postContext();
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
    void postContext();
  };
  iframe.addEventListener("load", onLoad);
  ownerWindow.addEventListener("message", onRequestPageContext);
  disposers.push(() => {
    iframe.removeEventListener("load", onLoad);
    ownerWindow.removeEventListener("message", onRequestPageContext);
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

  const hostController: AgentEmbedHostController = {
    schemaVersion: "sonik.agent_ui.host_controller.v1",
    open,
    close,
    postContext,
    scheduleContextPosts,
    getMode,
    setChatWidth,
    openChat: () => open("chat"),
    openCanvas: () => open("canvas"),
    getState: () => ({ mode: activeMode, iframeSrc: iframe.getAttribute("src") }),
  };

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
    trusted.hostSession = {
      source: cleanText(session.source) === "amplify-embedded" ? "amplify-embedded" : cleanText(session.source) === "embedded-host" ? "embedded-host" : cleanText(session.source) === "standalone-demo" ? "standalone-demo" : "anonymous",
      sessionId: cleanText(session.sessionId) ?? null,
      userId: cleanText(session.userId) ?? null,
      principalId: cleanText(session.principalId) ?? null,
      organizationId: cleanText(session.organizationId) ?? null,
      authenticated: session.authenticated === true,
      scopes: Array.isArray(session.scopes) ? session.scopes.map(cleanText).filter((scope): scope is string => Boolean(scope)).slice(0, MAX_LIST_ITEMS) : [],
      expiresAt: cleanText(session.expiresAt) ?? null,
      ...(metadata ? { metadata } : {}),
    };
  }
  return trusted;
}


function sanitizeHostSessionMetadata(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries: Array<[string, string | number | boolean]> = [];
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>).slice(0, MAX_LIST_ITEMS)) {
    const key = cleanText(rawKey);
    if (!key) continue;
    if (typeof rawValue === "boolean" || typeof rawValue === "number") {
      entries.push([key, rawValue]);
      continue;
    }
    const text = cleanText(rawValue);
    if (text) entries.push([key, text]);
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sanitizeSignedHostContextFields(value: Record<string, unknown>): AgentSignedHostContextFields {
  const signed: AgentSignedHostContextFields = {};
  const signatureVersion = cleanText(value.signatureVersion);
  const issuedAt = cleanText(value.issuedAt);
  const expiresAt = cleanText(value.expiresAt);
  const signature = cleanText(value.signature);
  if (signatureVersion) signed.signatureVersion = signatureVersion;
  if (issuedAt) signed.issuedAt = issuedAt;
  if (expiresAt) signed.expiresAt = expiresAt;
  if (signature) signed.signature = signature;
  return signed;
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
