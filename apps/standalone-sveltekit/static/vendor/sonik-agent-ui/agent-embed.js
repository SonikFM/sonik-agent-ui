// Static browser harness for the fake booking host.
// Production Svelte/TypeScript hosts should import mountSonikAgentUI from @sonik-agent-ui/agent-embed.

export const SONIK_AGENT_UI_HOST_MESSAGE_SOURCE = "sonik-agent-ui-host";
export const SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE = "sonik:agent-ui:page-context";

const MAX_SAFE_TEXT_LENGTH = 160;
const MAX_LIST_ITEMS = 8;
const ALLOWED_CONTEXT_KEYS = new Set([
  "route", "surface", "pageType", "title", "theme", "mode", "activeSessionId",
  "activeArtifactId", "activeDocumentId", "artifactType", "conversationStatus", "messageCount",
  "visibleActions", "visibleWarnings", "visibleErrors", "commandFamilies", "skillFamilies", "activeEntity", "at",
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
  const disposers = [];
  const contextPostTimeouts = [];
  const delays = options.contextPostDelaysMs ?? [250, 900, 1800];
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
      iframe.contentWindow?.postMessage(
        createAgentHostPageContextMessage(host),
        resolveAgentTargetOrigin(iframe, options.agentUrl, ownerWindow),
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
  iframe.addEventListener("load", onLoad);
  disposers.push(() => iframe.removeEventListener("load", onLoad));
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

  if (options.initialMode === "chat" || options.initialMode === "canvas" || options.initialMode === "workspace") open(options.initialMode);
  else mountFrame(chatSlot);

  return { iframe, open, close, postContext, scheduleContextPosts, update, destroy, getMode: () => activeMode, setChatWidth };
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
    if (Array.isArray(raw)) context[key] = raw.map(cleanText).filter(Boolean).slice(0, MAX_LIST_ITEMS);
    else if (typeof raw === "string") context[key] = cleanText(raw);
    else if (typeof raw === "number" || typeof raw === "boolean" || raw === null) context[key] = raw;
  }
  return Object.keys(context).length > 0 ? context : undefined;
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
function resolveAgentTargetOrigin(iframe, agentUrl, ownerWindow) {
  const frameSrc = iframe.getAttribute("src");
  return new URL(frameSrc || String(agentUrl), ownerWindow.location.href).origin;
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
