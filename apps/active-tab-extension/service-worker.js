import { TRANSPORT_VERSION, createResult, isExactWorkbenchRequest, pngMetadata } from "./protocol.js";

const pairings = new Map();

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !Number.isInteger(tab.windowId) || !tab.active || !/^https?:/.test(tab.url ?? "")) return;
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-script.js"] });
  const nonce = crypto.randomUUID();
  const response = await chrome.tabs.sendMessage(tab.id, {
    source: "sonik-active-tab-service-worker",
    type: "initialize",
    version: TRANSPORT_VERSION,
    nonce,
    tabId: tab.id,
    windowId: tab.windowId,
  });
  if (!response?.allowedOrigins?.length) return;
  pairings.set(tab.id, { windowId: tab.windowId, nonce, allowedOrigins: new Set(response.allowedOrigins) });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleRequest(message, sender).then(sendResponse, (error) => {
    sendResponse({ error: error instanceof Error ? error.message : "Active-tab request failed." });
  });
  return true;
});

async function handleRequest(message, sender) {
  const tabId = sender.tab?.id;
  const pairing = tabId ? pairings.get(tabId) : null;
  if (!pairing || message?.source !== "sonik-active-tab-content" || message.version !== TRANSPORT_VERSION) {
    throw new Error("This tab is not paired with Sonik Dev Workbench.");
  }
  const activeTabs = await chrome.tabs.query({ active: true, windowId: pairing.windowId });
  if (sender.tab?.windowId !== pairing.windowId || activeTabs[0]?.id !== tabId || message.nonce !== pairing.nonce) {
    pairings.delete(tabId);
    throw new Error("The active-tab pairing is no longer valid.");
  }
  const request = message.request;
  if (!isExactWorkbenchRequest(request, pairing.allowedOrigins, message.route)) {
    throw new Error("The Workbench origin, route, revision, or request is invalid.");
  }

  if (request.operation === "pair-extension") return createResult(request);
  if (request.operation === "unpair-extension") {
    pairings.delete(tabId);
    return createResult(request);
  }
  if (request.operation === "get-capabilities") {
    return createResult(request, {
      capabilities: ["pick", "capture", "unpair-extension"].map((operation) => ({ operation, status: "available", provider: "chrome-active-tab" })),
    });
  }
  if (request.operation === "pick") {
    const picked = await chrome.tabs.sendMessage(tabId, { type: "pick", version: TRANSPORT_VERSION, nonce: pairing.nonce });
    return picked?.selection
      ? createResult(request, { selection: picked.selection })
      : createResult(request, { status: "cancelled", disabledReason: picked?.disabledReason ?? "Element picking was cancelled." });
  }

  let prepared;
  try {
    prepared = await chrome.tabs.sendMessage(tabId, { type: "prepare-capture", version: TRANSPORT_VERSION, nonce: pairing.nonce });
    const dataUrl = await chrome.tabs.captureVisibleTab(pairing.windowId, { format: "png" });
    const png = pngMetadata(dataUrl);
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", png.bytes))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return createResult(request, {
      ariaSnapshot: null,
      selectionResolution: "not-requested",
      screenshot: {
        mime: "image/png",
        width: png.width,
        height: png.height,
        bytes: png.bytes.length,
        sha256,
        provider: "chrome-active-tab",
        fidelity: "exact-active-tab",
        captureBasis: "native-active-tab-redacted",
        viewport: prepared.viewport,
        redactionsApplied: [prepared.redactionCount ? "Sensitive form controls" : "No sensitive fields detected"],
        capturedAt: new Date().toISOString(),
        pngBase64: png.pngBase64,
      },
    });
  } finally {
    await chrome.tabs.sendMessage(tabId, { type: "clear-capture", version: TRANSPORT_VERSION, nonce: pairing.nonce }).catch(() => undefined);
  }
}
