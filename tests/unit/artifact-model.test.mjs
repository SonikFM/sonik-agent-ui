import assert from "node:assert/strict";
import {
  appendArtifactVersion,
  applyArtifactJsonPatch,
  applyArtifactJsonPatches,
  applyDocumentFindReplacePatch,
  createArtifact,
  createArtifactVersionStore,
  createDocumentArtifact,
  createHtmlArtifact,
  createJsonRenderArtifact,
  getLatestArtifactVersion,
  replaceArtifactContent,
  tryApplyArtifactJsonPatches,
  upsertJsonRenderArtifact,
} from "../../packages/artifact-model/dist/index.js";

const now = "2026-06-18T00:00:00.000Z";
const later = "2026-06-18T00:01:00.000Z";
const latest = "2026-06-18T00:02:00.000Z";
const artifact = createArtifact({
  id: "doc-1",
  kind: "document",
  title: "Doc",
  content: { body: "hello" },
  now,
});

assert.equal(artifact.id, "doc-1");
assert.equal(artifact.version, 1);
assert.equal(artifact.createdAt, now);
assert.equal(artifact.updatedAt, now);

const replaced = replaceArtifactContent(artifact, { body: "goodbye" }, later);
assert.equal(replaced.id, artifact.id, "replace should preserve identity");
assert.equal(replaced.version, 2, "replace should increment version");
assert.equal(replaced.createdAt, now, "replace should preserve createdAt");
assert.equal(replaced.updatedAt, later);
assert.deepEqual(artifact.content, { body: "hello" }, "replace must not mutate original content");

const spec = {
  version: "1",
  state: { title: "Draft" },
  elements: { root: { component: "Text", props: { content: "Hi" } } },
};
const jsonArtifact = createJsonRenderArtifact({ id: "artifact-json", spec, now });
assert.equal(jsonArtifact.kind, "json-render");
assert.equal(jsonArtifact.content, spec);
assert.equal(jsonArtifact.version, 1);

const patchedJsonArtifact = applyArtifactJsonPatch(
  jsonArtifact,
  { op: "replace", path: "/elements/root/props/content", value: "Hello canvas" },
  later,
);
assert.equal(patchedJsonArtifact.id, jsonArtifact.id, "JSON patch should preserve identity");
assert.equal(patchedJsonArtifact.version, 2, "JSON patch should increment version");
assert.equal(patchedJsonArtifact.content.elements.root.props.content, "Hello canvas");
assert.equal(jsonArtifact.content.elements.root.props.content, "Hi", "JSON patch must not mutate original content");
assert.equal(patchedJsonArtifact.content.state.title, "Draft", "JSON patch should only change targeted path");

const testOnlyPatch = applyArtifactJsonPatch(
  jsonArtifact,
  { op: "test", path: "/state/title", value: "Draft" },
  later,
);
assert.equal(testOnlyPatch, jsonArtifact, "test-only JSON patches should not create content versions");

const emptyPatch = applyArtifactJsonPatches({ artifact: jsonArtifact, patches: [], now: later });
assert.equal(emptyPatch, jsonArtifact, "empty JSON patch batches should preserve artifact object/version");

const multiPatched = applyArtifactJsonPatches({
  artifact: patchedJsonArtifact,
  patches: [
    { op: "add", path: "/state/status", value: "ready" },
    { op: "test", path: "/state/status", value: "ready" },
  ],
  now: latest,
});
assert.equal(multiPatched.version, 3);
assert.equal(multiPatched.content.state.status, "ready");

const invalidPatch = tryApplyArtifactJsonPatches({
  artifact: jsonArtifact,
  patches: [{ op: "test", path: "/state/title", value: "Published" }],
  now: latest,
});
assert.equal(invalidPatch.applied, false, "invalid JSON patch should be reported");
assert.equal(invalidPatch.artifact, jsonArtifact, "invalid JSON patch should return original artifact");
assert.equal(jsonArtifact.version, 1, "invalid JSON patch should not advance original version");
assert.deepEqual(jsonArtifact.content.state, { title: "Draft" }, "invalid JSON patch must not corrupt original content");

const invalidBatchPatch = tryApplyArtifactJsonPatches({
  artifact: jsonArtifact,
  patches: [
    { op: "add", path: "/state/transient", value: true },
    { op: "test", path: "/state/title", value: "Published" },
  ],
  now: latest,
});
assert.equal(invalidBatchPatch.applied, false, "invalid multi-patch batch should be reported");
assert.equal(invalidBatchPatch.artifact, jsonArtifact, "invalid multi-patch batch should return original artifact");
assert.equal(jsonArtifact.version, 1, "invalid multi-patch batch should not advance original version");
assert.deepEqual(
  jsonArtifact.content.state,
  { title: "Draft" },
  "invalid multi-patch batch must not leak earlier draft mutations",
);

const htmlArtifact = createHtmlArtifact({ id: "html-1", html: "<section>Hello</section>", now });
assert.equal(htmlArtifact.kind, "html");
assert.deepEqual(htmlArtifact.content, { html: "<section>Hello</section>" });

const documentArtifact = createDocumentArtifact({
  id: "doc-2",
  title: "Doc 2",
  body: "alpha beta alpha",
  format: "markdown",
  now,
});
assert.equal(documentArtifact.kind, "document");
assert.deepEqual(documentArtifact.content, { body: "alpha beta alpha", format: "markdown" });

const findReplace = applyDocumentFindReplacePatch(
  documentArtifact,
  { find: "alpha", replace: "omega" },
  later,
);
assert.equal(findReplace.count, 2, "find/replace should report changed match count");
assert.deepEqual(
  findReplace.ranges.map(({ start, end, replacementStart, replacementEnd, match }) => ({
    start,
    end,
    replacementStart,
    replacementEnd,
    match,
  })),
  [
    { start: 0, end: 5, replacementStart: 0, replacementEnd: 5, match: "alpha" },
    { start: 11, end: 16, replacementStart: 11, replacementEnd: 16, match: "alpha" },
  ],
);
assert.equal(findReplace.artifact.version, 2, "find/replace should increment version when content changes");
assert.equal(findReplace.artifact.content.body, "omega beta omega");
assert.equal(documentArtifact.content.body, "alpha beta alpha", "find/replace must not mutate original content");

const noMatch = applyDocumentFindReplacePatch(documentArtifact, { find: "missing", replace: "noop" }, later);
assert.equal(noMatch.artifact, documentArtifact, "no-match find/replace should preserve current artifact object");
assert.equal(noMatch.count, 0);

const versionStore = createArtifactVersionStore(jsonArtifact, "initial JSON artifact");
const nextStore = appendArtifactVersion(versionStore, patchedJsonArtifact, "content patch");
assert.equal(versionStore.entries.length, 1, "version store append should be immutable");
assert.equal(nextStore.entries.length, 2);
assert.equal(getLatestArtifactVersion(nextStore)?.version, 2);
assert.deepEqual(nextStore.entries[0].content, jsonArtifact.content, "version store should snapshot content");
assert.notEqual(nextStore.entries[0].content, jsonArtifact.content, "version store snapshot should be cloned");
assert.equal(Object.isFrozen(nextStore.entries), true, "version store entries should be immutable");
assert.equal(Object.isFrozen(nextStore.entries[0].content), true, "version store content snapshots should be frozen");
assert.throws(
  () => appendArtifactVersion(nextStore, patchedJsonArtifact, "duplicate version"),
  /latest stored version/,
  "version store should reject non-monotonic version appends",
);

const firstUpsert = upsertJsonRenderArtifact({ id: "artifact-json", spec, title: "Latest", now });
assert.equal(firstUpsert.created, true);
assert.equal(firstUpsert.artifact.version, 1);
const reorderedSpec = {
  elements: { root: { props: { content: "Hi" }, component: "Text" } },
  state: { title: "Draft" },
  version: "1",
};
const sameUpsert = upsertJsonRenderArtifact({
  previous: firstUpsert.artifact,
  id: "artifact-json",
  spec: reorderedSpec,
  title: "Latest",
  now: later,
});
assert.equal(sameUpsert.changed, false, "semantically same artifact signature should preserve object/version");
assert.equal(sameUpsert.artifact, firstUpsert.artifact);
const metadataUpsert = upsertJsonRenderArtifact({
  previous: sameUpsert.artifact,
  id: "artifact-json",
  spec,
  title: "Retitled",
  now: latest,
});
assert.equal(metadataUpsert.changed, false, "metadata-only update should not create a content version");
assert.equal(metadataUpsert.metadataChanged, true);
assert.equal(metadataUpsert.artifact.version, 1);
assert.equal(metadataUpsert.artifact.title, "Retitled");
const changedUpsert = upsertJsonRenderArtifact({
  previous: metadataUpsert.artifact,
  id: "artifact-json",
  spec: patchedJsonArtifact.content,
  title: "Retitled",
  now: latest,
});
assert.equal(changedUpsert.changed, true);
assert.equal(changedUpsert.created, false);
assert.equal(changedUpsert.artifact.id, firstUpsert.artifact.id);
assert.equal(changedUpsert.artifact.version, 2, "same artifact content update should preserve identity and increment version");

console.log("artifact-model tests passed");
