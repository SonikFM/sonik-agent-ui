import { captureVisibleTabWithoutSonikChrome } from "./capture-visible-tab.js";
import { createPairingLifecycle } from "./pairing-lifecycle.js";
import { allowedWorkbenchOrigins } from "./config.js";
import { TRANSPORT_VERSION, createResult, isExactWorkbenchRequest, isSafeCapturePreparation, matchesCaptureViewport, pngMetadata } from "./protocol.js";

const pairings = new Map();
const lifecycle = createPairingLifecycle();

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
  const configuredOrigins = response?.allowedOrigins?.filter((origin) => allowedWorkbenchOrigins.has(origin)) ?? [];
  if (!configuredOrigins.length) return;
  const documentId = injection[0]?.documentId;
  if (!documentId) return;
  pairings.set(tab.id, { windowId: tab.windowId, documentId, nonce, allowedOrigins: new Set(configuredOrigins) });
  lifecycle.establish({ tabId: tab.id, windowId: tab.windowId, documentId, nonce });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url) { pairings.delete(tabId); lifecycle.revoke(tabId); }
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  for (const pairedTabId of pairings.keys()) if (pairedTabId !== tabId) { pairings.delete(pairedTabId); lifecycle.revoke(pairedTabId); }
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  for (const [tabId, pairing] of pairings) if (pairing.windowId !== windowId) { pairings.delete(tabId); lifecycle.revoke(tabId); }
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
  const identity = { tabId, windowId: pairing.windowId, documentId: sender.documentId, nonce: message.nonce };
  if (sender.tab?.windowId !== pairing.windowId || activeTabs[0]?.id !== tabId) {
    pairings.delete(tabId);
    lifecycle.revoke(tabId);
    throw new Error("The active-tab pairing is no longer valid.");
  }
  const request = message.request;
  if (!isExactWorkbenchRequest(request, pairing.allowedOrigins, message.route)) {
    throw new Error("The Workbench origin, route, revision, or request is invalid.");
  }
  const lease = lifecycle.authorize({
    ...identity, operation: request.operation, requestId: request.requestId, origin: request.origin, route: message.route,
    sourceContextRevision: request.sourceContextRevision, routeRevision: request.routeRevision,
  });
  if (!lease) throw new Error("The pairing expired, changed context, or replayed a request.");

  if (request.operation === "pair-extension") return createResult(request);
  if (request.operation === "unpair-extension") {
    pairings.delete(tabId);
    lifecycle.revoke(tabId);
    return createResult(request);
  }
  if (request.operation === "get-capabilities") {
    return createResult(request, {
      capabilities: ["capture", "unpair-extension"].map((operation) => ({ operation, status: "available", provider: "chrome-active-tab" })),
    });
  }

  let prepared;
  let dataUrl;
  try {
    dataUrl = await captureVisibleTabWithoutSonikChrome({
      async hideCaptureChrome() {
        prepared = await chrome.tabs.sendMessage(tabId, { type: "prepare-capture", version: TRANSPORT_VERSION, nonce: pairing.nonce });
        if (!isSafeCapturePreparation(prepared)) throw new Error("Capture redaction preparation failed closed.");
      },
      captureVisibleTab: () => chrome.tabs.captureVisibleTab(pairing.windowId, { format: "png" }),
      restoreCaptureChrome: () => chrome.tabs.sendMessage(tabId, { type: "clear-capture", version: TRANSPORT_VERSION, nonce: pairing.nonce }),
    });
  } catch (error) {
    pairings.delete(tabId);
    lifecycle.revoke(tabId);
    throw error;
  }
  const stillActive = await chrome.tabs.query({ active: true, windowId: pairing.windowId });
  if (stillActive[0]?.id !== tabId || !lifecycle.isCurrent(lease, identity)) {
    pairings.delete(tabId);
    lifecycle.revoke(tabId);
    throw new Error("The paired tab stopped being active during capture.");
  }
  const png = pngMetadata(dataUrl);
  if (!matchesCaptureViewport(png, prepared.viewport)) {
    pairings.delete(tabId);
    lifecycle.revoke(tabId);
    throw new Error("Active-tab capture dimensions do not match the prepared viewport.");
  }
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
