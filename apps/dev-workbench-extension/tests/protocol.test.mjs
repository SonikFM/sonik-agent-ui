import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createResult, isExactWorkbenchRequest, isSafeCapturePreparation, matchesCaptureViewport, pngMetadata } from "../src/protocol.ts";
import { allowedWorkbenchOrigins } from "../src/config.ts";

const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
const serviceWorker = await readFile(new URL("../src/service-worker.ts", import.meta.url), "utf8");
const contentScript = await readFile(new URL("../src/content-script.ts", import.meta.url), "utf8");
assert.deepEqual(manifest.permissions, ["activeTab", "scripting"]);
assert.equal("host_permissions" in manifest, false);
assert.match(serviceWorker, /fidelity: "exact-active-tab"/);
assert.match(serviceWorker, /captureBasis: "native-active-tab-redacted"/);
assert.match(serviceWorker, /redactionsApplied: prepared\.redactionsApplied/);
assert.match(contentScript, /redactionsApplied\.push\("Sensitive form controls"\)/);
assert.match(contentScript, /redactionsApplied\.push\("Embedded frame pixels"\)/);
assert.doesNotMatch(contentScript, /No sensitive fields detected/);

const request = {
  messageSource: "sonik-agent-ui", type: "sonik:visual-context:request", version: "sonik.visual-context.v1",
  requestId: "request-1", operation: "capture", origin: "https://workbench.example.com",
  sourceContextRevision: 2, routeRevision: 3,
  source: { id: "host", label: "Host", surface: "embedded-host", route: "/bookings" },
  provider: "chrome-active-tab",
};
assert.equal(isExactWorkbenchRequest(request, new Set([request.origin]), "/bookings"), true);
assert.equal(allowedWorkbenchOrigins.has("https://arbitrary.example.com"), false, "page markup cannot expand the configured origin authority");
assert.equal(allowedWorkbenchOrigins.has("https://dev-workbench-sooty.vercel.app"), true);
assert.equal(allowedWorkbenchOrigins.has("https://dev-workbench-danletterio-5975s-projects.vercel.app"), true);
assert.equal(allowedWorkbenchOrigins.has("https://random-projects.vercel.app"), false);
assert.equal(isExactWorkbenchRequest({ ...request, requestId: "" }, new Set([request.origin]), "/bookings"), false);
assert.equal(isExactWorkbenchRequest({ ...request, routeRevision: -1 }, new Set([request.origin]), "/bookings"), false);
assert.equal(isExactWorkbenchRequest(request, new Set(["https://other.example.com"]), "/bookings"), false);
assert.equal(isExactWorkbenchRequest(request, new Set([request.origin]), "/other"), false);
assert.equal(createResult(request).messageSource, "sonik-agent-host");
const preparation = { viewport: { width: 1280, height: 720, deviceScaleFactor: 2 }, redactionsApplied: ["Sensitive form controls", "Embedded frame pixels"] };
assert.equal(isSafeCapturePreparation(preparation), true);
assert.equal(isSafeCapturePreparation({ ...preparation, redactionsApplied: ["Sonik capture chrome"] }), true);
assert.equal(isSafeCapturePreparation({ ...preparation, redactionsApplied: ["No sensitive fields detected"] }), false);
assert.equal(isSafeCapturePreparation({ ...preparation, viewport: { ...preparation.viewport, width: 0 } }), false);

const png = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
png.writeUInt32BE(2, 16);
png.writeUInt32BE(3, 20);
assert.deepEqual(
  { ...pngMetadata(`data:image/png;base64,${png.toString("base64")}`), bytes: undefined, pngBase64: undefined },
  { bytes: undefined, width: 2, height: 3, pngBase64: undefined },
);
assert.equal(matchesCaptureViewport({ width: 2, height: 3 }, { width: 2, height: 3, deviceScaleFactor: 1 }), true);
assert.equal(matchesCaptureViewport({ width: 2, height: 3 }, { width: 2, height: 2, deviceScaleFactor: 1 }), false);
assert.throws(() => pngMetadata("data:image/png;base64,bm90LXBuZw=="), /invalid PNG/);
const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(oversized);
assert.throws(() => pngMetadata(`data:image/png;base64,${oversized.toString("base64")}`), /10 MiB/);
let decoded = false;
const originalAtob = globalThis.atob;
globalThis.atob = () => { decoded = true; throw new Error("decoded"); };
assert.throws(() => pngMetadata(`data:image/png;base64,${"A".repeat(Math.ceil(10 * 1024 * 1024 / 3) * 4 + 1)}`), /10 MiB/);
assert.equal(decoded, false, "oversized base64 is rejected before decode/allocation");
globalThis.atob = originalAtob;

console.log("active-tab extension protocol: ok");
