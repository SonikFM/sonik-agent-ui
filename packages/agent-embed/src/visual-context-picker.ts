import "./vendor/impeccable/visual-context-picker/skill/scripts/live-browser-dom.js";

import {
  visualContextRequestSchema,
  visualContextResultSchema,
  visualContextSelectionSchema,
  type VisualContextRequest,
  type VisualContextResult,
  type VisualContextSelection,
} from "@sonik-agent-ui/tool-contracts/visual-context";
import {
  hostUiTargetRegistrySchema,
  semanticTargetIdSchema,
  type HostUiTargetRegistry,
} from "@sonik-agent-ui/tool-contracts/target-registry";

const PICKER_PREFIX = "sonik-visual-context-picker";
const DEFAULT_TIMEOUT_MS = 30_000;
const SKIP_TAGS = new Set(["script", "style", "input", "textarea", "select", "option"]);
const SECRET_PATTERN = /(?:\bbearer\s+[a-zA-Z0-9._-]{12,}|\b(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret|password)\b\s*[:=]\s*\S+|\beyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{10,}|\b(?:sk|vck)[_-][a-zA-Z0-9_-]{12,})/i;
const SELECTOR_PATTERN = /^(?:[#.][a-zA-Z_-][\w-]*|\[[^\]]+\]|\/\/|\/html\b)/;

type LiveDomHelpers = {
  own: (element: Element) => boolean;
  pickable: (element: Element) => boolean;
  id8: () => string;
  uiAppend: <T extends HTMLElement>(element: T) => T;
  uiAppendStyle: <T extends HTMLStyleElement>(element: T) => T;
};

type LiveDomApi = {
  version: number;
  createLiveBrowserDomHelpers: (options: {
    prefix: string;
    skipTags: Set<string>;
    document: Document;
    css?: typeof CSS;
    crypto?: Crypto;
  }) => LiveDomHelpers;
};

type PickerWindow = Window & { __IMPECCABLE_LIVE_DOM__?: LiveDomApi };

export type VisualContextPickerOptions = {
  /** Exact origin of the requesting Agent UI window. */
  origin: string;
  /** Exact requester origin carried by the neutral visual-context request/result. */
  requestOrigin?: string;
  source: Window;
  window?: Window;
  document?: Document;
  timeoutMs?: number;
  getTargetRegistry?: () => HostUiTargetRegistry | null | undefined;
  now?: () => Date;
  helper?: LiveDomApi;
  listen?: boolean;
  isOriginAllowed?: (origin: string) => boolean;
};

export type VisualContextPickerController = {
  cancel: (reason?: "cancelled" | "navigation" | "destroyed") => void;
  destroy: () => void;
  isActive: () => boolean;
  resolvePrivateTarget: (targetId: string) => Element | undefined;
  handleMessage: (event: MessageEvent) => void;
};

type PendingPick = {
  request: VisualContextRequest;
  timeoutId: number;
  settle: (status: "completed" | "cancelled" | "unavailable" | "failed", selection?: VisualContextSelection, disabledReason?: string) => void;
};

export function mountVisualContextPicker(options: VisualContextPickerOptions): VisualContextPickerController {
  const ownerWindow = options.window ?? window;
  const ownerDocument = options.document ?? ownerWindow.document;
  const helperApi = options.helper ?? (ownerWindow as PickerWindow).__IMPECCABLE_LIVE_DOM__;
  if (helperApi?.version !== 1 || typeof helperApi.createLiveBrowserDomHelpers !== "function") {
    throw new Error("Visual context picker requires Impeccable live DOM helper version 1.");
  }
  const expectedOrigin = new URL(options.origin).origin;
  if (expectedOrigin !== options.origin) throw new Error("Visual context picker origin must be an exact origin.");
  const requestOrigin = new URL(options.requestOrigin ?? expectedOrigin).origin;
  const helper = helperApi.createLiveBrowserDomHelpers({
    prefix: PICKER_PREFIX,
    skipTags: SKIP_TAGS,
    document: ownerDocument,
    css: (ownerWindow as Window & { CSS?: typeof CSS }).CSS,
    crypto: ownerWindow.crypto,
  });
  const privateTargets = new Map<string, Element>();
  let pending: PendingPick | undefined;
  let destroyed = false;
  let overlay: HTMLDivElement | undefined;
  let style: HTMLStyleElement | undefined;
  let priorCursor = "";

  const removeChrome = () => {
    overlay?.remove();
    style?.remove();
    overlay = undefined;
    style = undefined;
    ownerDocument.documentElement.style.cursor = priorCursor;
  };

  const removePickerListeners = () => {
    ownerDocument.removeEventListener("pointermove", onPointerMove, true);
    ownerDocument.removeEventListener("click", onClick, true);
    ownerDocument.removeEventListener("keydown", onKeyDown, true);
    ownerWindow.removeEventListener("scroll", onViewportChange, true);
    ownerWindow.removeEventListener("resize", onViewportChange);
  };

  const cleanup = () => {
    removePickerListeners();
    removeChrome();
    if (pending) ownerWindow.clearTimeout(pending.timeoutId);
  };

  const postResult = (request: VisualContextRequest, input: Omit<VisualContextResult, keyof VisualContextRequest | "messageSource" | "type" | "version">) => {
    const result = visualContextResultSchema.parse({
      ...request,
      messageSource: "sonik-agent-host",
      type: "sonik:visual-context:result",
      ...input,
    });
    options.source.postMessage(result, expectedOrigin);
  };

  const cancelPending = (disabledReason: string) => {
    pending?.settle("cancelled", undefined, disabledReason);
  };

  const startPick = (request: VisualContextRequest) => {
    cancelPending("Superseded by a newer picker request.");
    privateTargets.clear();
    priorCursor = ownerDocument.documentElement.style.cursor;
    style = ownerDocument.createElement("style");
    style.textContent = `html { cursor: crosshair !important; } #${PICKER_PREFIX}-overlay { position: fixed; pointer-events: none; z-index: 2147483647; outline: 3px solid #f59e0b; outline-offset: 2px; } @media (prefers-reduced-motion: reduce) { #${PICKER_PREFIX}-overlay { transition: none; } }`;
    helper.uiAppendStyle(style);
    overlay = ownerDocument.createElement("div");
    overlay.id = `${PICKER_PREFIX}-overlay`;
    overlay.setAttribute("aria-hidden", "true");
    helper.uiAppend(overlay);

    const settle: PendingPick["settle"] = (status, selection, disabledReason) => {
      if (!pending || pending.request.requestId !== request.requestId) return;
      cleanup();
      pending = undefined;
      postResult(request, {
        status,
        ...(selection !== undefined ? { selection } : {}),
        ...(disabledReason ? { disabledReason } : {}),
      });
    };
    const timeoutId = ownerWindow.setTimeout(
      () => settle("cancelled", undefined, "Element picker timed out."),
      Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    );
    pending = { request, timeoutId, settle };
    ownerDocument.addEventListener("pointermove", onPointerMove, true);
    ownerDocument.addEventListener("click", onClick, true);
    ownerDocument.addEventListener("keydown", onKeyDown, true);
    ownerWindow.addEventListener("scroll", onViewportChange, true);
    ownerWindow.addEventListener("resize", onViewportChange);
  };

  const onMessage = (event: MessageEvent) => {
    if (destroyed || event.origin !== expectedOrigin || event.source !== options.source || options.isOriginAllowed?.(event.origin) === false) return;
    const parsed = visualContextRequestSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.origin !== requestOrigin) return;
    const request = parsed.data;
    if (request.operation === "pick" && request.provider === "host") {
      startPick(request);
      return;
    }
    if (request.operation === "clear" && request.provider === "host") {
      cancelPending("Element selection cleared.");
      privateTargets.clear();
      postResult(request, { status: "completed", selection: null });
      return;
    }
    if (request.operation === "get-capabilities") {
      postResult(request, {
        status: "completed",
        capabilities: [
          { operation: "pick", status: "available", provider: "host" },
          { operation: "clear", status: "available", provider: "host" },
          { operation: "capture", status: "unavailable", disabledReason: "Exact host pixels require the developer extension." },
        ],
      });
    }
  };

  const onNavigation = () => cancelPending("Navigation cancelled the element picker.");
  if (options.listen !== false) ownerWindow.addEventListener("message", onMessage);
  ownerWindow.addEventListener("pagehide", onNavigation);
  ownerWindow.addEventListener("beforeunload", onNavigation);
  ownerWindow.addEventListener("popstate", onNavigation);
  ownerWindow.addEventListener("hashchange", onNavigation);

  function onPointerMove(event: Event): void {
    const element = pickableElement(event.target);
    if (!overlay || !element) {
      if (overlay) overlay.hidden = true;
      return;
    }
    const bounds = element.getBoundingClientRect();
    overlay.hidden = false;
    overlay.style.left = `${bounds.left}px`;
    overlay.style.top = `${bounds.top}px`;
    overlay.style.width = `${bounds.width}px`;
    overlay.style.height = `${bounds.height}px`;
  }

  function onViewportChange(): void {
    if (overlay) overlay.hidden = true;
  }

  function onClick(event: Event): void {
    if (!pending) return;
    const element = pickableElement(event.target);
    const textSelection = ownerWindow.getSelection?.();
    if (!element || (textSelection && !textSelection.isCollapsed)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const selection = selectionForElement(element, pending.request);
      if (!selection) return;
      pending.settle("completed", selection);
    } catch {
      pending.settle("failed", undefined, "Element selection failed.");
    }
  }

  function onKeyDown(event: Event): void {
    if ((event as KeyboardEvent).key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancelPending("Element picker cancelled.");
  }

  function pickableElement(target: EventTarget | null): Element | undefined {
    if (!target || typeof (target as Element).closest !== "function") return undefined;
    const targetElement = target as Element;
    const element = targetElement.closest("[data-sonik-target]") ?? targetElement;
    if (element.hasAttribute("contenteditable") || helper.own(element) || !helper.pickable(element)) return undefined;
    return element;
  }

  function selectionForElement(element: Element, request: VisualContextRequest): VisualContextSelection | undefined {
    const registeredTarget = element.closest("[data-sonik-target]");
    const stableTargetId = registeredTarget?.getAttribute("data-sonik-target")?.trim();
    const targetId = semanticTargetIdSchema.safeParse(stableTargetId).success
      ? stableTargetId as string
      : `ephemeral:${helper.id8()}`;
    const targetInstanceId = registeredTarget?.getAttribute("data-sonik-target-instance")?.trim() || undefined;
    const registry = hostUiTargetRegistrySchema.safeParse(options.getTargetRegistry?.()).data;
    const registered = registry?.targets.find((target: HostUiTargetRegistry["targets"][number]) => target.targetId === targetId && (!targetInstanceId || target.targetInstanceId === targetInstanceId));
    const role = safePublicText(element.getAttribute("role")) ?? semanticRole(element);
    const accessibleName = safePublicText(element.getAttribute("aria-label") ?? element.getAttribute("alt") ?? element.getAttribute("title"));
    const label = safePublicText(registered?.label) ?? accessibleName ?? safePublicText(role) ?? "Page element";
    const rect = element.getBoundingClientRect();
    const candidate = {
      targetId,
      ...(targetInstanceId ? { targetInstanceId } : {}),
      label,
      ...(role ? { role } : {}),
      ...(accessibleName ? { accessibleName } : {}),
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, coordinateSpace: "viewport" as const },
      selectedAt: (options.now?.() ?? new Date()).toISOString(),
    };
    const parsed = visualContextSelectionSchema.safeParse(candidate);
    if (!parsed.success) return undefined;
    privateTargets.set(targetId, element);
    return parsed.data;
  }

  return {
    cancel: (reason = "cancelled") => cancelPending(reason === "navigation" ? "Navigation cancelled the element picker." : reason === "destroyed" ? "Picker destroyed." : "Element picker cancelled."),
    destroy: () => {
      if (destroyed) return;
      cancelPending("Picker destroyed.");
      destroyed = true;
      cleanup();
      privateTargets.clear();
      if (options.listen !== false) ownerWindow.removeEventListener("message", onMessage);
      ownerWindow.removeEventListener("pagehide", onNavigation);
      ownerWindow.removeEventListener("beforeunload", onNavigation);
      ownerWindow.removeEventListener("popstate", onNavigation);
      ownerWindow.removeEventListener("hashchange", onNavigation);
    },
    isActive: () => Boolean(pending),
    resolvePrivateTarget: (targetId) => privateTargets.get(targetId),
    handleMessage: onMessage,
  };
}

export const mountSonikVisualContextPicker = mountVisualContextPicker;

function safePublicText(value: string | null | undefined): string | undefined {
  const text = value?.trim().slice(0, 160);
  if (!text || SECRET_PATTERN.test(text) || SELECTOR_PATTERN.test(text)) return undefined;
  return text;
}

function semanticRole(element: Element): string {
  const tag = element.tagName.toLowerCase();
  return ({ button: "button", a: "link", img: "image", nav: "navigation", main: "main", header: "banner", footer: "contentinfo", section: "region" } as Record<string, string>)[tag] ?? "element";
}
