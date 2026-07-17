// @ts-nocheck
(() => {
  if (globalThis.__sonikExactActiveTab) return;

  const state = { nonce: null, tabId: null, windowId: null, frames: new Map(), overlays: [] };
  globalThis.__sonikExactActiveTab = state;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "initialize" && message.version === "sonik.active-tab.v1") {
      state.nonce = message.nonce;
      state.tabId = message.tabId;
      state.windowId = message.windowId;
      state.frames = discoverWorkbenchFrames();
      sendResponse({ allowedOrigins: [...new Set(state.frames.values())] });
      return;
    }
    if (!state.nonce || message?.nonce !== state.nonce || message.version !== "sonik.active-tab.v1") return;
    if (message.type === "prepare-capture") {
      clearOverlays();
      const redactionsApplied = [];
      const selectors = "input[type=password],input[type=email],input[type=tel],[data-sonik-redact]";
      for (const element of document.querySelectorAll(selectors)) {
        const bounds = element.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) continue;
        const overlay = document.createElement("div");
        Object.assign(overlay.style, {
          position: "fixed", left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`,
          background: "#111", zIndex: "2147483647", pointerEvents: "none",
        });
        document.documentElement.append(overlay);
        state.overlays.push(overlay);
      }
      if (state.overlays.length) redactionsApplied.push("Sensitive form controls");
      const sensitiveCount = state.overlays.length;
      for (const frame of document.querySelectorAll("iframe")) {
        const bounds = frame.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) continue;
        addOverlay(bounds);
      }
      if (state.overlays.length > sensitiveCount) redactionsApplied.push("Embedded frame pixels");
      sendResponse({
        redactionsApplied,
        viewport: { width: window.innerWidth, height: window.innerHeight, deviceScaleFactor: window.devicePixelRatio },
      });
      return;
    }
    if (message.type === "clear-capture") {
      clearOverlays();
      sendResponse({ ok: true });
      return;
    }
  });

  window.addEventListener("message", (event) => {
    const allowedOrigin = state.frames.get(event.source);
    if (!state.nonce || !allowedOrigin || event.origin !== allowedOrigin) return;
    const request = event.data;
    if (!isRequest(request, allowedOrigin)) return;
    void chrome.runtime.sendMessage({
      source: "sonik-active-tab-content",
      version: "sonik.active-tab.v1",
      nonce: state.nonce,
      tabId: state.tabId,
      windowId: state.windowId,
      route: sanitizedRoute(),
      request,
    }).then((result) => {
      if (result?.type === "sonik:visual-context:result") event.source.postMessage(result, allowedOrigin);
    });
  });

  function discoverWorkbenchFrames() {
    const frames = new Map();
    for (const frame of document.querySelectorAll("iframe[src]")) {
      try {
        const url = new URL(frame.src, location.href);
        if ((url.protocol === "http:" || url.protocol === "https:")
          && url.searchParams.get("agentUiHostOrigin") === location.origin
          && frame.dataset.sonikDevWorkbenchOrigin === url.origin
          && frame.contentWindow) frames.set(frame.contentWindow, url.origin);
      } catch {
        // Ignore malformed and non-http iframe sources.
      }
    }
    return frames;
  }

  function isRequest(request, origin) {
    return request?.messageSource === "sonik-agent-ui"
      && request.type === "sonik:visual-context:request"
      && request.version === "sonik.visual-context.v1"
      && request.origin === origin
      && request.provider === "chrome-active-tab"
      && request.source?.id === "host"
      && request.source.route === sanitizedRoute()
      && Number.isInteger(request.sourceContextRevision)
      && Number.isInteger(request.routeRevision)
      && typeof request.requestId === "string"
      && request.requestId.length > 0
      && request.requestId.length <= 128;
  }

  function sanitizedRoute() {
    return location.pathname.startsWith("//") ? "/" : location.pathname.slice(0, 2048) || "/";
  }

  function clearOverlays() {
    for (const overlay of state.overlays) overlay.remove();
    state.overlays = [];
  }

  function addOverlay(bounds) {
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed", left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px`,
      background: "#111", zIndex: "2147483647", pointerEvents: "none",
    });
    document.documentElement.append(overlay);
    state.overlays.push(overlay);
  }
})();
