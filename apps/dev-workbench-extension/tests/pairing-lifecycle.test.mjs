import assert from "node:assert/strict";
import { createPairingLifecycle } from "../src/pairing-lifecycle.ts";

let time = 1_000;
const identity = { tabId: 7, windowId: 3, documentId: "doc-1", nonce: "nonce-1" };
const request = {
  ...identity,
  operation: "pair-extension",
  requestId: "pair-1",
  origin: "https://workbench.example",
  route: "/bookings",
  sourceContextRevision: 2,
  routeRevision: 4,
};

const lifecycle = createPairingLifecycle({ now: () => time, ttlMs: 100 });
lifecycle.establish(identity);
const lease = lifecycle.authorize(request);
assert.ok(lease);
assert.equal(lifecycle.authorize(request), null, "request IDs are one-time");
assert.equal(lifecycle.authorize({ ...request, requestId: "stale", routeRevision: 5 }), null, "revision changes revoke");
assert.equal(lifecycle.isPaired(identity.tabId), false);

assert.equal(lifecycle.authorize({ ...request, tabId: 8, requestId: "wrong-tab" }), null);
lifecycle.revoke(identity.tabId); // chrome.tabs.onActivated owns the tab-change signal.

for (const changed of [
  { windowId: 4 },
  { documentId: "doc-2" },
  { nonce: "nonce-2" },
]) {
  lifecycle.establish(identity);
  assert.equal(lifecycle.authorize({ ...request, ...changed, requestId: crypto.randomUUID() }), null);
  assert.equal(lifecycle.isPaired(identity.tabId), false);
}

lifecycle.establish(identity);
assert.ok(lifecycle.authorize({ ...request, requestId: "pair-2" }));
time = 1_100;
assert.equal(lifecycle.authorize({ ...request, operation: "capture", requestId: "expired" }), null, "expiry boundary fails closed");

time = 2_000;
lifecycle.establish(identity);
const captureLease = lifecycle.authorize({ ...request, requestId: "pair-3" });
assert.ok(captureLease);
assert.equal(lifecycle.isCurrent(captureLease, { ...identity, documentId: "navigated" }), false, "post-capture navigation discards bytes");

const restarted = createPairingLifecycle();
assert.equal(restarted.isPaired(identity.tabId), false, "service-worker restart cannot hydrate pairing");

lifecycle.establish(identity);
lifecycle.revoke(identity.tabId);
assert.equal(lifecycle.isPaired(identity.tabId), false, "explicit unpair is idempotent");
assert.equal(lifecycle.revoke(identity.tabId), false);

console.log("dev-workbench extension pairing lifecycle: ok");
