import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createResult, isExactWorkbenchRequest, pngMetadata } from "../../apps/active-tab-extension/protocol.js";

const manifest = JSON.parse(await readFile("apps/active-tab-extension/manifest.json", "utf8"));
assert.deepEqual(manifest.permissions, ["activeTab", "scripting"]);
assert.equal("host_permissions" in manifest, false);

const request = {
  messageSource: "sonik-agent-ui", type: "sonik:visual-context:request", version: "sonik.visual-context.v1",
  requestId: "request-1", operation: "capture", origin: "https://workbench.example.com",
  sourceContextRevision: 2, routeRevision: 3,
  source: { id: "host", label: "Host", surface: "embedded-host", route: "/bookings" },
  provider: "chrome-active-tab",
};
assert.equal(isExactWorkbenchRequest(request, new Set([request.origin]), "/bookings"), true);
assert.equal(isExactWorkbenchRequest({ ...request, requestId: "" }, new Set([request.origin]), "/bookings"), false);
assert.equal(isExactWorkbenchRequest(request, new Set(["https://other.example.com"]), "/bookings"), false);
assert.equal(isExactWorkbenchRequest(request, new Set([request.origin]), "/other"), false);
assert.equal(createResult(request).messageSource, "sonik-agent-host");

const png = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
png.writeUInt32BE(2, 16);
png.writeUInt32BE(3, 20);
assert.deepEqual(
  { ...pngMetadata(`data:image/png;base64,${png.toString("base64")}`), bytes: undefined, pngBase64: undefined },
  { bytes: undefined, width: 2, height: 3, pngBase64: undefined },
);
assert.throws(() => pngMetadata("data:image/png;base64,bm90LXBuZw=="), /invalid PNG/);

console.log("active-tab extension protocol: ok");
