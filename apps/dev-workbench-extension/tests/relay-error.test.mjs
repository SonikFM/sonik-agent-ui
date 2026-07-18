import assert from "node:assert/strict";
let runtimeListener;
let pageListener;
const source = { postMessage(value, origin) { this.value = value; this.origin = origin; } };
const frame = { src: "http://host.test/?agentUiHostOrigin=http://host.test", dataset: { sonikDevWorkbenchOrigin: "http://host.test" }, contentWindow: source };
globalThis.window = { addEventListener(type, listener) { if (type === "message") pageListener = listener; }, innerWidth: 100, innerHeight: 80, devicePixelRatio: 1 };
globalThis.location = { origin: "http://host.test", pathname: "/booking" };
globalThis.document = { querySelectorAll(selector) { return selector === "iframe[src]" ? [frame] : []; } };
globalThis.chrome = { runtime: { onMessage: { addListener(listener) { runtimeListener = listener; } }, sendMessage() { return Promise.resolve({ error: "capture failed" }); } } };
await import(`../dist/content-script.js?relay=${crypto.randomUUID()}`);
runtimeListener({ type: "initialize", version: "sonik.active-tab.v1", nonce: "n", tabId: 1, windowId: 1 }, null, () => {});
pageListener({ source, origin: "http://host.test", data: {
  messageSource: "sonik-agent-ui", type: "sonik:visual-context:request", version: "sonik.visual-context.v1", origin: "http://host.test",
  provider: "chrome-active-tab", operation: "capture", source: { id: "host", route: "/booking" }, sourceContextRevision: 0, routeRevision: 0, requestId: "req-1",
} });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(source.value.type, "sonik:visual-context:result");
assert.equal(source.value.status, "failed");
assert.equal(source.value.disabledReason, "capture failed");
assert.equal(source.origin, "http://host.test");
console.log("dev-workbench extension relay errors: ok");
