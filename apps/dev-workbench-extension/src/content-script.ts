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
      sendResponse({
        redactionCount: state.overlays.length,
        viewport: { width: window.innerWidth, height: window.innerHeight, deviceScaleFactor: window.devicePixelRatio },
      });
      return;
    }
    if (message.type === "clear-capture") {
      clearOverlays();
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "pick") {
      void pickElement().then(sendResponse);
      return true;
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

  function pickElement() {
    return new Promise((resolve) => {
      let highlighted = null;
      const finish = (result) => {
        highlighted?.style.removeProperty("outline");
        removeEventListener("pointermove", move, true);
        removeEventListener("click", click, true);
        removeEventListener("keydown", keydown, true);
        resolve(result);
      };
      const move = (event) => {
        highlighted?.style.removeProperty("outline");
        highlighted = event.target instanceof HTMLElement ? event.target : null;
        highlighted?.style.setProperty("outline", "2px solid #7c3aed", "important");
      };
      const click = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const element = event.target instanceof HTMLElement ? event.target : null;
        const targetId = element?.dataset.sonikTargetId ?? element?.dataset.agentTargetId;
        if (!element || !targetId) return finish({ disabledReason: "Selected element has no stable Sonik target id." });
        const bounds = element.getBoundingClientRect();
        const label = (element.getAttribute("aria-label") ?? element.innerText ?? targetId).trim().slice(0, 160) || targetId;
        finish({ selection: {
          targetId, label, role: element.getAttribute("role")?.slice(0, 160) || undefined,
          accessibleName: label, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, coordinateSpace: "viewport" },
          selectedAt: new Date().toISOString(),
        } });
      };
      const keydown = (event) => { if (event.key === "Escape") finish({ disabledReason: "Element picking was cancelled." }); };
      addEventListener("pointermove", move, true);
      addEventListener("click", click, true);
      addEventListener("keydown", keydown, true);
    });
  }
})();
