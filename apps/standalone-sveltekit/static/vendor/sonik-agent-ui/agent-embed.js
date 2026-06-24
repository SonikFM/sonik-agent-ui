// Static browser harness for the fake booking host.
// Production Svelte/TypeScript hosts should import mountSonikAgentUI from @sonik-agent-ui/agent-embed.

export const SONIK_AGENT_UI_HOST_MESSAGE_SOURCE = "sonik-agent-ui-host";
export const SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE = "sonik:agent-ui:page-context";
export const SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST = "sonik:agent-ui:request-page-context";

const MAX_SAFE_TEXT_LENGTH = 160;
const MAX_LIST_ITEMS = 8;
const ALLOWED_CONTEXT_KEYS = new Set([
  "route", "surface", "pageType", "title", "theme", "mode", "activeSessionId",
  "activeArtifactId", "activeDocumentId", "artifactType", "conversationStatus", "messageCount",
  "visibleActions", "visibleWarnings", "visibleErrors", "commandFamilies", "skillFamilies", "activeEntity",
  "authenticated", "organizationId", "scopes", "hostSession", "signatureVersion", "issuedAt", "expiresAt", "signature", "at",
]);
const SECRET_VALUE_PATTERN = /\b(vck_[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/g;

export function normalizeAgentEmbedIntent(input = {}) {
  const mode = cleanEmbedMode(input.embedMode) ?? cleanEmbedMode(input.agentUiMode) ?? "workspace";
  return {
    mode,
    railMode: cleanEmbedRailMode(input.railMode) ?? cleanEmbedRailMode(input.rail) ?? defaultRailModeForEmbedMode(mode),
  };
}

export function createAgentEmbedUrl(input) {
  const url = new URL(String(input.agentUrl), input.hostOrigin ?? window.location.origin);
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


function isAgentPageContextRequestMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return value.source === "sonik-agent-ui" && value.type === SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST;
}

export function createAgentHostPageContextMessage(payload) {
  return {
    source: SONIK_AGENT_UI_HOST_MESSAGE_SOURCE,
    type: SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE,
    payload,
    sentAt: new Date().toISOString(),
  };
}

export function mountSonikAgentUI(options) {
  const ownerWindow = options.window ?? window;
  const ownerDocument = options.document ?? ownerWindow.document;
  const iframe = requiredElement(ownerDocument, options.elements.iframe, "iframe");
  const chatSlot = requiredElement(ownerDocument, options.elements.chatSlot, "chatSlot");
  const canvasSlot = optionalElement(ownerDocument, options.elements.canvasSlot);
  const sidecar = optionalElement(ownerDocument, options.elements.sidecar);
  const canvasWindow = optionalElement(ownerDocument, options.elements.canvasWindow);
  const resizeHandle = optionalElement(ownerDocument, options.elements.resizeHandle);
  const hostControllerKey = options.hostControllerKey === null ? null : options.hostControllerKey ?? "__sonikAgentHost";
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
  const disposers = [];
  const contextPostTimeouts = [];
  const delays = options.contextPostDelaysMs ?? [250, 900, 1800, 3200, 5200, 8000];
  const bodyDatasetKey = options.bodyDatasetKey ?? "agentUiOpen";
  let activeMode = null;
  let resizeFrame = 0;
  let getPageContext = options.getPageContext;
  let theme = options.theme;
  let smokeMockStream = options.smokeMockStream;
  let smokeRunId = options.smokeRunId;

  const postContext = async () => {
    try {
      const host = sanitizeAgentHostPageContext(await getPageContext()) ?? {};
      const targetOrigin = resolveMountedAgentTargetOrigin(iframe, options.agentUrl, ownerWindow);
      if (!targetOrigin) return;
      iframe.contentWindow?.postMessage(
        createAgentHostPageContextMessage(host),
        targetOrigin,
      );
    } catch (error) {
      options.onError?.(error);
    }
  };

  const scheduleContextPosts = () => {
    for (const delay of delays) contextPostTimeouts.push(ownerWindow.setTimeout(() => void postContext(), delay));
  };

  const mountFrame = (slot) => {
    if (iframe.parentElement !== slot) slot.appendChild(iframe);
  };

  const setFrameMode = (mode) => {
    const nextSrc = createAgentEmbedUrl({
      agentUrl: options.agentUrl,
      mode,
      hostOrigin: options.hostOrigin ?? ownerWindow.location.origin,
      theme: typeof theme === "function" ? theme() : theme,
      smokeMockStream,
      smokeRunId,
    });
    if (iframe.getAttribute("src") !== nextSrc) iframe.src = nextSrc;
    else void postContext();
  };

  const setOpenState = (mode) => {
    activeMode = mode;
    if (mode) ownerDocument.body.dataset[bodyDatasetKey] = mode;
    else delete ownerDocument.body.dataset[bodyDatasetKey];
    if (sidecar) sidecar.dataset.open = mode === "chat" ? "true" : "false";
    if (canvasWindow) canvasWindow.dataset.open = mode === "canvas" ? "true" : "false";
    options.onModeChange?.(mode);
  };

  const open = (mode) => {
    const nextMode = mode === "canvas" || mode === "workspace" ? "canvas" : "chat";
    setOpenState(nextMode);
    mountFrame(nextMode === "canvas" && canvasSlot ? canvasSlot : chatSlot);
    setFrameMode(nextMode);
  };

  const close = (mode = "all") => {
    if (mode !== "all" && activeMode !== mode) return;
    setOpenState(null);
  };

  const setChatWidth = (width) => {
    const clamped = Math.max(options.minChatWidth ?? 360, Math.min(options.maxChatWidth ?? 760, width));
    ownerDocument.documentElement.style.setProperty("--agent-chat-width", `${clamped}px`);
    resizeHandle?.setAttribute("aria-valuenow", String(Math.round(clamped)));
  };

  const startResize = (event) => {
    if (activeMode !== "chat") return;
    event.preventDefault();
    resizeHandle?.setPointerCapture?.(event.pointerId);
    ownerDocument.body.dataset.agentUiResizing = "true";
    const move = (moveEvent) => {
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

  const update = (next) => {
    if (next.getPageContext) getPageContext = next.getPageContext;
    if ("theme" in next) theme = next.theme;
    if ("smokeMockStream" in next) smokeMockStream = next.smokeMockStream;
    if ("smokeRunId" in next) smokeRunId = next.smokeRunId;
    if (activeMode) setFrameMode(activeMode);
  };

  const addClick = (ref, handler) => {
    const element = optionalElement(ownerDocument, ref);
    if (!element) return;
    element.addEventListener("click", handler);
    disposers.push(() => element.removeEventListener("click", handler));
  };

  const onLoad = () => scheduleContextPosts();
  const onRequestPageContext = (event) => {
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
    const onKeydown = (event) => {
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
  const hostController = {
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
  const controller = { iframe, open, close, postContext, scheduleContextPosts, update, destroy, getMode, setChatWidth };
  if (hostControllerKey) {
    ownerWindow[hostControllerKey] = hostController;
    disposers.push(() => { if (ownerWindow[hostControllerKey] === hostController) delete ownerWindow[hostControllerKey]; });
  }

  if (options.initialMode === "chat" || options.initialMode === "canvas" || options.initialMode === "workspace") open(options.initialMode);
  else mountFrame(chatSlot);

  return controller;
}

function annotateHostElement(element, control) {
  if (!element) return;
  element.dataset.sonikAgentUiControl = control;
  if (!element.getAttribute("data-testid")) element.setAttribute("data-testid", `sonik-agent-ui-${control}`);
}

function sanitizeAgentHostPageContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const context = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!ALLOWED_CONTEXT_KEYS.has(key)) continue;
    if (key === "activeEntity") {
      const entity = sanitizeAgentHostActiveEntity(raw);
      if (entity) context.activeEntity = entity;
      continue;
    }
    if (key === "hostSession") {
      const session = sanitizeTrustedHostSession(raw);
      if (session) context.hostSession = session;
      continue;
    }
    if (Array.isArray(raw)) context[key] = raw.map(cleanText).filter(Boolean).slice(0, MAX_LIST_ITEMS);
    else if (typeof raw === "string") context[key] = cleanText(raw);
    else if (typeof raw === "number" || typeof raw === "boolean" || raw === null) context[key] = raw;
  }
  return Object.keys(context).length > 0 ? context : undefined;
}
function sanitizeTrustedHostSession(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = cleanText(value.source);
  const scopes = Array.isArray(value.scopes) ? value.scopes.map(cleanText).filter(Boolean).slice(0, MAX_LIST_ITEMS) : [];
  return {
    source: source === "amplify-embedded" || source === "embedded-host" || source === "standalone-demo" ? source : "anonymous",
    sessionId: cleanText(value.sessionId) ?? null,
    userId: cleanText(value.userId) ?? null,
    principalId: cleanText(value.principalId) ?? null,
    organizationId: cleanText(value.organizationId) ?? null,
    authenticated: value.authenticated === true,
    scopes,
    expiresAt: cleanText(value.expiresAt) ?? null,
    metadata: undefined,
  };
}
function sanitizeAgentHostActiveEntity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const type = cleanText(value.type);
  const id = cleanText(value.id);
  const label = cleanText(value.label);
  if (!type || !id) return undefined;
  return { type, id, ...(label ? { label } : {}) };
}
function cleanText(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_SAFE_TEXT_LENGTH).replace(SECRET_VALUE_PATTERN, "[REDACTED]");
}
function cleanEmbedMode(value) {
  return value === "chat" || value === "canvas" || value === "workspace" ? value : undefined;
}
function cleanEmbedRailMode(value) {
  return value === "expanded" || value === "collapsed" || value === "hidden" ? value : undefined;
}
function defaultRailModeForEmbedMode(mode) {
  if (mode === "chat") return "hidden";
  if (mode === "canvas") return "collapsed";
  return "expanded";
}
function resolveMountedAgentTargetOrigin(iframe, agentUrl, ownerWindow) {
  const frameSrc = iframe.getAttribute("src");
  if (!frameSrc || frameSrc === "about:blank") return null;
  const agentOrigin = new URL(String(agentUrl), ownerWindow.location.href).origin;
  const frameOrigin = new URL(frameSrc, ownerWindow.location.href).origin;
  return frameOrigin === agentOrigin ? frameOrigin : null;
}
function requiredElement(document, ref, name) {
  const element = optionalElement(document, ref);
  if (!element) throw new Error(`mountSonikAgentUI missing required element: ${name}`);
  return element;
}
function optionalElement(document, ref) {
  if (!ref) return null;
  if (typeof ref !== "string") return ref;
  return document.querySelector(ref);
}
