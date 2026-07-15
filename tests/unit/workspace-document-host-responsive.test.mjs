import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const hostPath = "apps/standalone-sveltekit/static/workspace-document-host.html";
const hostSource = await readFile(hostPath, "utf8");

assert.match(hostSource, /@media \(max-width: 640px\)[\s\S]*?\.doc-md-toolbar\s*\{[\s\S]*?margin-top: 4px !important;/, "narrow iframe widths must add a four-pixel tab-to-toolbar gap");
assert.match(hostSource, /\.doc-md-toolbar::before\s*\{[\s\S]*?height: 4px;[\s\S]*?background: var\(--sonik-border, var\(--border\)\);/, "the host-only narrow gap must render as a token-bound separator");
assert.doesNotMatch(hostSource, /@media \(min-width:/, "desktop document editor behavior must remain the vendored baseline");
assert.doesNotMatch(hostSource, /#[0-9a-fA-F]{3,8}\b/, "host overrides must not add raw theme colors");
assert.match(hostSource, /box-shadow: var\(--app-shadow-none, none\) !important;/, "host shadow reset must use the existing shadow token seam");
assert.match(hostSource, /font: 12px\/1\.5 var\(--app-font-mono, var\(--font-family, monospace\)\);/, "host loading typography must use the mono token at the approved 12px size");

const destinationHashes = new Map([
  ["apps/standalone-sveltekit/static/vendor/odysseus/static/js/document.js", "50f47e43097995103265df0ba579d0b4c4b00d660c996f18eb210630c2626d62"],
  ["apps/standalone-sveltekit/static/vendor/odysseus/static/js/documentLibrary.js", "3f580880111cedfc89547401b9c847724b1c8bff9fc12c7e7597b3974f26defb"],
  ["apps/standalone-sveltekit/static/vendor/odysseus/static/style.css", "6990eca96402947bfa61c8302064fd628cf057390cc942445bccb3a2bc137efc"],
]);

for (const [path, expected] of destinationHashes) {
  const actual = createHash("sha256").update(await readFile(path)).digest("hex");
  assert.equal(actual, expected, `${path} must stay byte-identical to the pinned vendored destination`);
}

console.log("workspace document host responsive tests passed");
