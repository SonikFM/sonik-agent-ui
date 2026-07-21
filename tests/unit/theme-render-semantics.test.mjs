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
  assert.match(callout, /class="alert border /);
  for (const token of ["info", "success", "warning", "primary"]) {
    assert.match(callout, new RegExp(token));
  }
  assert.doesNotMatch(callout, /border-l-(?:4|info|success|warning|primary)/);
  assert.doesNotMatch(callout, /(?:blue|emerald|amber|purple)-500/);
});

test("shimmer uses readable opacity motion and respects reduced-motion preferences", () => {
  assert.doesNotMatch(appCss, /linear-gradient|background-clip|text-fill-color/);
  assert.match(appCss, /@keyframes shimmer[\s\S]*?opacity:/);
  assert.match(
    appCss,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.animate-shimmer\s*\{[\s\S]*?animation:\s*none[\s\S]*?opacity:\s*1/,
  );
});
