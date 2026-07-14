import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, composer, tools, attachments, chips] = await Promise.all([
  readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8"),
  readFile("packages/chat-surface/src/components/AgentComposer.svelte", "utf8"),
  readFile("packages/chat-surface/src/components/ComposerToolSelector.svelte", "utf8"),
  readFile("packages/chat-surface/src/components/ComposerAttachmentMenu.svelte", "utf8"),
  readFile("packages/chat-surface/src/components/ContextChip.svelte", "utf8"),
]);

for (const action of ["stageComposerSkill", "setComposerToolPermission", "pinComposerTool", "removeComposerContext", "attachComposerDocument"]) {
  assert.match(page, new RegExp(`createActionDescriptor\\(\\"${action}\\"`), `${action} needs an observable descriptor`);
  assert.match(page, new RegExp(`${action}:`), `${action} needs a page-control implementation`);
}
const observability = await readFile("packages/agent-observability/src/index.ts", "utf8");
assert.match(observability, /removeComposerContext\?: \(input: \{ contextId\?: string \}\)/, "removeComposerContext needs typed page-control coverage");
assert.match(composer, /data-composer-suggestions|ComposerSuggestions/, "composer suggestions must stay observable");
assert.match(tools, /data-tool-row/);
assert.match(attachments, /composer-attachment-trigger/);
assert.match(composer, /onRetryComposerCatalogs/);
assert.match(tools, /Retry tool catalog/);
assert.match(attachments, /Retry recent documents/);
assert.match(page, /onRetryComposerCatalogs=\{\(\) => void loadComposerCatalogs\(\)\}/);
assert.match(page, /onRetryRecentDocuments=\{\(\) => void loadRecentComposerDocuments\(\)\}/);
assert.match(chips, /Open details for/);
assert.match(chips, /Remove .* from context/);

console.log("check-agent-ui-coverage.ts: composer controls and semantic actions covered");
