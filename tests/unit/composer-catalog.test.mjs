import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fetchComposerCatalog } from "../../apps/standalone-sveltekit/src/lib/composer-catalog.ts";

const rejected = await fetchComposerCatalog(() => Promise.reject(new Error("offline")), "/catalog");
assert.deepEqual(rejected, { status: "unavailable" }, "rejected catalog fetches must not masquerade as ready-empty");

const failed = await fetchComposerCatalog(() => Promise.resolve(new Response(null, { status: 503 })), "/catalog");
assert.deepEqual(failed, { status: "unavailable" }, "failed catalog responses must remain unavailable");

const ready = await fetchComposerCatalog(() => Promise.resolve(Response.json({ items: [] })), "/catalog");
assert.deepEqual(ready, { status: "ready", value: { items: [] } }, "valid empty catalogs are ready, not unavailable");

const boundaries = ["/api/skill-catalog?limit=40", "/api/commands/search?limit=40", "/api/tool-manifest", "/api/documents/library?sort=updated&limit=8"];
const attempted = [];
const unavailable = await Promise.all(boundaries.map((input) => fetchComposerCatalog((_input) => {
  attempted.push(String(_input));
  return Promise.reject(new Error("offline"));
}, input)));
assert.deepEqual(attempted, boundaries, "every composer catalog boundary must be exercised");
assert.deepEqual(unavailable.map((result) => result.status), boundaries.map(() => "unavailable"));

const pageSource = await readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");
for (const boundary of boundaries) assert.equal(pageSource.includes(`workspaceFetch, "${boundary}"`), true, `${boundary} must use workspaceFetch`);

const suggestionsSource = await readFile("packages/chat-surface/src/components/ComposerSuggestions.svelte", "utf8");
assert.match(suggestionsSource, /trigger\.marker === "\/" && \(skillCatalogStatus === "unavailable" \|\| commandCatalogStatus === "unavailable"\)/, "slash suggestions must report either partial catalog outage");
assert.ok(suggestionsSource.indexOf("{#each items as item") < suggestionsSource.indexOf("{#if catalogUnavailable}"), "partial outage status must render alongside surviving suggestion rows");
assert.match(suggestionsSource, /\{#if catalogUnavailable\}[\s\S]*role="status"[\s\S]*\{catalogUnavailableMessage\}[\s\S]*Retry catalogs[\s\S]*\{\/if\}/, "partial outage status must include an accessible warning and retry affordance");
assert.match(suggestionsSource, /trigger\.marker === "\$"[\s\S]*skillCatalogStatus === "unavailable"/, "dollar suggestions must remain honest when the skill catalog fails");

console.log("composer-catalog.test.mjs: all assertions passed");
