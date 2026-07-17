// @ts-nocheck
import { captureVisibleTabWithoutSonikChrome } from "./capture-visible-tab.js";
import { TRANSPORT_VERSION, createResult, isExactWorkbenchRequest, pngMetadata } from "./protocol.js";

const pairings = new Map();
const pairingLifetimeMs = 5 * 60_000;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !Number.isInteger(tab.windowId) || !tab.active || !/^https?:/.test(tab.url ?? "")) return;
  const injection = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["dist/content-script.js"] });
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
  pairings.set(tab.id, {
    windowId: tab.windowId,
    documentId: injection[0]?.documentId,
    nonce,
    expiresAt: Date.now() + pairingLifetimeMs,
    requestIds: new Set(),
    allowedOrigins: new Set(response.allowedOrigins),
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url) pairings.delete(tabId);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  for (const pairedTabId of pairings.keys()) if (pairedTabId !== tabId) pairings.delete(pairedTabId);
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  for (const [tabId, pairing] of pairings) if (pairing.windowId !== windowId) pairings.delete(tabId);
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
  if (sender.tab?.windowId !== pairing.windowId
    || activeTabs[0]?.id !== tabId
    || message.nonce !== pairing.nonce
    || sender.documentId !== pairing.documentId
    || Date.now() >= pairing.expiresAt) {
    pairings.delete(tabId);
    throw new Error("The active-tab pairing is no longer valid.");
  }
  const request = message.request;
  if (!isExactWorkbenchRequest(request, pairing.allowedOrigins, message.route)) {
    throw new Error("The Workbench origin, route, revision, or request is invalid.");
  }
  if (pairing.requestIds.has(request.requestId)) throw new Error("The Workbench request id was already used.");
  pairing.requestIds.add(request.requestId);

  if (request.operation === "pair-extension") return createResult(request);
  if (request.operation === "unpair-extension") {
    pairings.delete(tabId);
    return createResult(request);
  }
  if (request.operation === "get-capabilities") {
    return createResult(request, {
      capabilities: ["capture", "unpair-extension"].map((operation) => ({ operation, status: "available", provider: "chrome-active-tab" })),
    });
  }

  let prepared;
  const dataUrl = await captureVisibleTabWithoutSonikChrome({
    async hideCaptureChrome() {
      prepared = await chrome.tabs.sendMessage(tabId, { type: "prepare-capture", version: TRANSPORT_VERSION, nonce: pairing.nonce });
    },
    captureVisibleTab: () => chrome.tabs.captureVisibleTab(pairing.windowId, { format: "png" }),
    restoreCaptureChrome: () => chrome.tabs.sendMessage(tabId, { type: "clear-capture", version: TRANSPORT_VERSION, nonce: pairing.nonce }),
  });
  const stillActive = await chrome.tabs.query({ active: true, windowId: pairing.windowId });
  if (stillActive[0]?.id !== tabId) {
    pairings.delete(tabId);
    throw new Error("The paired tab stopped being active during capture.");
  }
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
      redactionsApplied: prepared.redactionsApplied,
      capturedAt: new Date().toISOString(),
      pngBase64: png.pngBase64,
    },
  });
}
