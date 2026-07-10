import assert from "node:assert/strict";
import {
  hasExplicitWorkspaceDocumentIntent,
  resolveWorkspaceDocumentIntent,
  shouldMountJsonArtifactTool,
} from "../../apps/standalone-sveltekit/src/lib/document-intent.ts";

const cases = [
  ["create a document", "create"],
  ["make a new document", "create"],
  ["write a doc", "create"],
  ["create an HTML file", "create"],
  ["write a Markdown file", "create"],
  ["update this document", "update"],
  ["create a json-render canvas", "none"],
  ["create a json-render document", "none"],
  ["create a JSON rendering document", "none"],
  ["create an HTML document dashboard", "create"],
  ["create a Markdown document dashboard", "create"],
];

for (const [prompt, expected] of cases) {
  assert.equal(resolveWorkspaceDocumentIntent(prompt), expected, prompt);
}

assert.equal(resolveWorkspaceDocumentIntent("document I just created needs a new intro"), "none");
assert.equal(resolveWorkspaceDocumentIntent("revise the document i just created"), "update");
assert.equal(resolveWorkspaceDocumentIntent("create a visual dashboard"), "none");
assert.equal(hasExplicitWorkspaceDocumentIntent("create a Markdown document"), true);
assert.equal(hasExplicitWorkspaceDocumentIntent("create a json-render canvas"), false);

assert.equal(shouldMountJsonArtifactTool("none"), true);
assert.equal(shouldMountJsonArtifactTool("create"), false);
assert.equal(shouldMountJsonArtifactTool("update"), false);

console.log("document intent tests passed");
