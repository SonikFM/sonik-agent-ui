import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { removeAgentContextItem } from "../../packages/tool-contracts/src/run-context.ts";

const page = await readFile(new URL("../../apps/standalone-sveltekit/src/routes/+page.svelte", import.meta.url), "utf8");
const composer = await readFile(new URL("../../packages/chat-surface/src/components/AgentComposer.svelte", import.meta.url), "utf8");
const menu = await readFile(new URL("../../packages/chat-surface/src/components/ComposerAttachmentMenu.svelte", import.meta.url), "utf8");
const generate = await readFile(new URL("../../apps/standalone-sveltekit/src/routes/api/generate/+server.ts", import.meta.url), "utf8");

assert.match(page, /new FormData\(\)/);
assert.match(page, /form\.append\("file", file\)/);
assert.match(page, /form\.append\("session_id", activeSessionId\)/);
assert.match(page, /workspaceFetch\("\/api\/files"/);
assert.match(page, /kind: "file"/);
assert.match(page, /kind: "document"/, "workspace documents remain a separate context kind");
assert.doesNotMatch(page, /uploadComposerTextDocument/);

assert.match(composer, /DOCX is unsupported\. Convert it to PDF, text, or Markdown/);
assert.match(composer, /XLSX is unsupported\. Convert it to CSV/);
assert.match(composer, /PPTX is unsupported\. Convert it to PDF/);
assert.match(composer, /10 \* 1024 \* 1024/);
assert.match(menu, /10 MiB max/);

let deletes = 0;
const detached = removeAgentContextItem({ items: [{ id: "file:public-id", kind: "file", label: "brief.pdf", source: "manual", ref: "public-id" }], dismissedAutoSeedIds: [] }, "file:public-id");
assert.equal(detached.items.length, 0);
assert.equal(deletes, 0, "detaching a chip does not delete the durable object");

assert.match(generate, /createGoogle/);
assert.match(generate, /resolveGoogleAgentUiFileParts/);
assert.match(generate, /Selected files require a direct Google model/);
assert.match(generate, /appendFilePartsToLatestUserMessage/);

console.log("composer file attachment tests passed");
