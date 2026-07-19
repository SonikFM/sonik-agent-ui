import assert from "node:assert/strict";

let messageListener;
let sensitiveSelector = "";
const appended = [];
const rect = (x, y, width, height) => ({ x, y, left: x, top: y, width, height });
const element = (bounds) => ({ getBoundingClientRect: () => bounds });

globalThis.window = { addEventListener() {}, innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2 };
globalThis.requestAnimationFrame = (callback) => callback();
globalThis.location = { origin: "https://host.example", pathname: "/bookings" };
globalThis.document = {
  querySelectorAll(selector) {
    if (selector === "iframe[src]") return [];
    if (selector === "iframe") return [element(rect(40, 50, 300, 200)), element(rect(0, 0, 0, 0))];
    sensitiveSelector = selector;
    return [element(rect(10, 20, 120, 30)), element(rect(0, 0, 0, 0))];
  },
  createElement() {
    return { style: {}, removed: false, remove() { this.removed = true; } };
  },
  documentElement: { append(node) { appended.push(node); } },
};
globalThis.chrome = { runtime: { onMessage: { addListener(listener) { messageListener = listener; } }, sendMessage() {} } };

await import(`../dist/content-script.js?masking=${crypto.randomUUID()}`);
messageListener({ type: "initialize", version: "sonik.active-tab.v1", nonce: "nonce", tabId: 7, windowId: 3 }, null, () => {});
let preparation;
await new Promise((resolve) => messageListener({ type: "prepare-capture", version: "sonik.active-tab.v1", nonce: "nonce" }, null, (value) => { preparation = value; resolve(); }));

for (const required of ["type=password", "autocomplete*=cc-", "autocomplete*=token", "autocomplete=one-time-code", "name*=secret", "name*=token", "data-sonik-redact"]) {
  assert.ok(sensitiveSelector.includes(required), `missing sensitive selector ${required}`);
}
assert.equal(appended.length, 2, "one visible sensitive control and one iframe are masked");
assert.deepEqual(preparation.redactionsApplied, ["Sensitive form controls", "Embedded frame pixels"]);
assert.deepEqual(preparation.viewport, { width: 1280, height: 720, deviceScaleFactor: 2 });
assert.deepEqual(appended.map(({ style }) => [style.left, style.top, style.width, style.height]), [
  ["10px", "20px", "120px", "30px"],
  ["40px", "50px", "300px", "200px"],
]);

messageListener({ type: "clear-capture", version: "sonik.active-tab.v1", nonce: "nonce" }, null, () => {});
assert.ok(appended.every((overlay) => overlay.removed), "every mask is restored after capture");

console.log("dev-workbench extension fail-closed masking: ok");
