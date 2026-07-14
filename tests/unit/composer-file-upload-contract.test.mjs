import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../../apps/standalone-sveltekit/src/routes/+page.svelte", import.meta.url), "utf8");
const composer = await readFile(new URL("../../packages/chat-surface/src/components/AgentComposer.svelte", import.meta.url), "utf8");
const menu = await readFile(new URL("../../packages/chat-surface/src/components/ComposerAttachmentMenu.svelte", import.meta.url), "utf8");
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
assert.match(composer, /onAttachContext\?\.\(item\)/, "successful multipart uploads become detachable context chips");
assert.match(composer, /onCancelUpload=\{cancelUpload\}/, "bounded upload state remains cancellable");

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
