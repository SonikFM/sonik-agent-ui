import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../../apps/standalone-sveltekit/src/routes/+page.svelte", import.meta.url), "utf8");
const composer = await readFile(new URL("../../packages/chat-surface/src/components/AgentComposer.svelte", import.meta.url), "utf8");
const menu = await readFile(new URL("../../packages/chat-surface/src/components/ComposerAttachmentMenu.svelte", import.meta.url), "utf8");
const stagedContextRow = await readFile(new URL("../../packages/chat-surface/src/components/StagedContextRow.svelte", import.meta.url), "utf8");
const uploadState = await readFile(new URL("../../packages/chat-surface/src/file-upload-state.ts", import.meta.url), "utf8");
const contextChip = await readFile(new URL("../../packages/chat-surface/src/components/ContextChip.svelte", import.meta.url), "utf8");
const generate = await readFile(new URL("../../apps/standalone-sveltekit/src/routes/api/generate/+server.ts", import.meta.url), "utf8");

const uploadFunction = page.match(/async function uploadComposerFile[\s\S]*?\n  }/)?.[0] ?? "";
assert.match(uploadFunction, /new FormData\(\)/);
assert.match(uploadFunction, /append\("file", file\)/);
assert.match(uploadFunction, /append\("session_id", activeSessionId\)/);
assert.match(uploadFunction, /workspaceFetch\("\/api\/files"/);
assert.match(uploadFunction, /id: `file:\$\{uploaded\.id\}`/);
assert.match(uploadFunction, /kind: "file"/);
assert.match(uploadFunction, /ref: uploaded\.id/);
assert.match(uploadFunction, /retry_file_id/);
assert.match(uploadFunction, /method: "DELETE"/, "the browser best-effort cleans retained canonical bytes by opaque id");
assert.doesNotMatch(uploadFunction, /storage_key|provider_references|\/api\/document/, "browser attachment state uses only public file metadata");

for (const guidance of [
  /DOCX.*Convert.*PDF.*text.*Markdown/i,
  /XLSX.*Convert.*CSV/i,
  /PPTX.*Convert.*PDF/i,
  /10 MiB/,
]) assert.match(composer, guidance);
assert.match(composer, /executeComposerFileUpload\(\{ upload, onUploadFile, onAttachContext \}\)/, "the upload state machine owns the single successful context attachment");
assert.match(uploadState, /if \(!input\.upload\.controller\.signal\.aborted\) input\.onAttachContext\?\.\(item\)/, "successful multipart uploads become detachable context chips exactly once");
assert.match(composer, /onRemoveUpload=\{removeUpload\}/, "bounded upload state remains cancellable and removable");
assert.match(composer, /retryComposerFileUpload\(failed\)/, "failed uploads retain an explicit retry path");
assert.match(composer, /items=\{contextItems\}/, "composer passes the complete semantic context selection to the presentation row");

assert.doesNotMatch(stagedContextRow, /filesExpanded/, "overflow disclosure is not limited to document context");
assert.match(stagedContextRow, /\.\.\.items\.map[\s\S]*\.\.\.pinnedTools\.map/, "context and pinned tools share one bounded presentation list");
assert.match(stagedContextRow, /stagedPresentations\.slice\(0, collapsedLimit\)/, "collapsed rendering derives a visual subset without mutating source selection");
assert.match(stagedContextRow, /new ResizeObserver/, "chip disclosure responds to its container width, including floated sidecars");
assert.match(stagedContextRow, /if \(width < 420\) return 1;[\s\S]*if \(width < 640\) return 2;[\s\S]*return 3;/, "collapsed chip capacity has deterministic narrow, sidecar, and wide bounds");
assert.match(stagedContextRow, /aria-controls=\{stagedItemsId\}/);
assert.match(stagedContextRow, /aria-expanded=\{expanded\}/);
assert.match(stagedContextRow, /`\+\$\{hiddenCount\} more`/, "collapsed state exposes the hidden item count");
assert.match(stagedContextRow, /disclosureElement\?\.focus\(\)/, "container shrink recovers focus when a visible chip becomes hidden");
assert.match(stagedContextRow, /role=\{upload\.status === "failed" \? "alert" : "status"\}/, "upload failures remain visible and live-announced outside the hidden subset");
assert.match(stagedContextRow, /data-file-upload-status=\{upload\.id\}/, "upload lifecycle has a presentation surface distinct from semantic context chips");
assert.doesNotMatch(stagedContextRow.match(/\{#if uploads\.length > 0\}[\s\S]*?\{\/if\}/)?.[0] ?? "", /<ContextChip/, "failed and in-flight uploads never render as AgentRunContext chips");
assert.match(stagedContextRow, />Retry<\/button>/);
assert.match(stagedContextRow, />Remove<\/button>/);
assert.match(contextChip, /h-8 w-8/, "context removal keeps an accessible 32px hit target");

assert.match(menu, /type="file"/);
assert.match(menu, /\.pdf,.txt,.md,.markdown,.csv,.html,.htm,.xml,.css,.js,.mjs,.cjs,.json,.bmp,.jpg,.jpeg,.png,.webp/);
assert.match(menu, /Recent documents/);
assert.match(menu, /Available context/);
assert.match(menu, /PDF, text, Markdown, CSV, HTML, XML, CSS, JavaScript, JSON, BMP, JPEG, PNG, or WebP · 10 MiB max/);

assert.match(generate, /const google = googleAbortController[\s\S]*createGoogle\(\{ apiKey: env\.GOOGLE_GENERATIVE_AI_API_KEY, fetch: \(url, init\) => fetch\(url, \{ \.\.\.init, signal: init\?\.signal \? AbortSignal\.any\(\[googleAbortController\.signal, init\.signal\]\) : googleAbortController\.signal \}\) \}\)/, "Google requests preserve both the aggregate deadline and direct-turn abort signal");
for (const source of ["deadline", "turn"]) {
  const deadline = new AbortController();
  const turn = new AbortController();
  const signal = AbortSignal.any([deadline.signal, turn.signal]);
  ({ deadline, turn })[source].abort();
  assert.equal(signal.aborted, true, `${source} aborts the composed Google request signal`);
}
assert.match(generate, /filesApi: google\.files\(\)/);
assert.match(generate, /Selected files require a direct Google model/);
assert.match(generate, /selectedFileIds\.length > 0 \? resolveDirectGoogleModelId/);
assert.match(generate, /model: google && directGoogleModelId \? google\(directGoogleModelId\) : undefined/, "only file turns override the existing Gateway model");

console.log("composer-file-upload-contract.test.mjs: all assertions passed");
