import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const callout = readFileSync(
  new URL("../../apps/standalone-sveltekit/src/lib/render/components/Callout.svelte", import.meta.url),
  "utf8",
);
const appCss = readFileSync(
  new URL("../../apps/standalone-sveltekit/src/app.css", import.meta.url),
  "utf8",
);

test("Callout uses active-theme semantic colors and note semantics", () => {
  assert.match(callout, /role="note"/);
  assert.match(callout, /border-l-(?:info|success|warning|secondary)/);
  assert.match(callout, /bg-(?:info|success|warning|secondary)\/10/);
  assert.match(callout, /text-(?:info|success|warning|secondary)/);
  assert.doesNotMatch(callout, /(?:blue|emerald|amber|purple)-500/);
});

test("shimmer respects reduced-motion preferences", () => {
  assert.match(
    appCss,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.animate-shimmer\s*\{[\s\S]*?animation:\s*none/,
  );
});
