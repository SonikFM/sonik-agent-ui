import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createKnowledgeStore } from "../../apps/standalone-sveltekit/src/lib/knowledge/knowledge-store.ts";
import { resolveKnowledgeContext } from "../../apps/standalone-sveltekit/src/lib/knowledge/resolve-knowledge-context.ts";

// Phase 9 (agent-creation-tool-plan-2026-07-13.md): Knowledge v1 runtime --
// file-based, human-readable store. No vectors/embeddings/chunking; CRUD
// round-trip plus the resolve-knowledge-context seam the future runtime
// adapter will call.

async function withTempRoot(run) {
  const root = await mkdtemp(path.join(tmpdir(), "knowledge-store-test-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await withTempRoot(async (root) => {
  const store = createKnowledgeStore(root);

  const ref = await store.createStore({ storeId: "sonik.knowledge.campaign-briefs", title: "Campaign briefs" });
  assert.equal(ref.storeId, "sonik.knowledge.campaign-briefs");
  assert.equal(ref.readable, true, "stores are readable-only in v1");
  assert.deepEqual(ref.fileRefs, [], "a fresh store has no files");

  const fileRef = await store.addFile("sonik.knowledge.campaign-briefs", {
    title: "Q3 brief",
    content: "The Q3 campaign targets returning members with a loyalty offer.",
  });
  assert.equal(fileRef.title, "Q3 brief");

  const listed = await store.listFiles("sonik.knowledge.campaign-briefs");
  assert.equal(listed.length, 1);
  assert.equal(listed[0].fileId, fileRef.fileId);

  const content = await store.readFile("sonik.knowledge.campaign-briefs", fileRef.fileId);
  assert.equal(content, "The Q3 campaign targets returning members with a loyalty offer.");

  await store.removeFile("sonik.knowledge.campaign-briefs", fileRef.fileId);
  assert.deepEqual(await store.listFiles("sonik.knowledge.campaign-briefs"), [], "removeFile drops the file");
  await store.removeFile("sonik.knowledge.campaign-briefs", "does-not-exist"); // idempotent, does not throw

  await assert.rejects(
    () => createKnowledgeStore(root).readFile("sonik.knowledge.does-not-exist", "x"),
    /not found/,
    "reading from a missing store throws inside the store (the resolver is what swallows this)",
  );

  console.log("knowledge-store: CRUD round-trip passed");
});

await withTempRoot(async (root) => {
  const store = createKnowledgeStore(root);
  await store.createStore({ storeId: "sonik.knowledge.attached", title: "Attached store" });
  const fileRef = await store.addFile("sonik.knowledge.attached", { title: "Doc A", content: "Answer: the sky is blue." });

  const knowledgeRefs = [
    { storeId: "sonik.knowledge.attached", title: "Attached store", fileRefs: [fileRef], readable: true },
    { storeId: "sonik.knowledge.missing-store", title: "Ghost store", fileRefs: [{ fileId: "ghost", title: "Ghost", path: "x" }], readable: true },
  ];

  const { sections, truncated } = await resolveKnowledgeContext(knowledgeRefs, { rootDir: root });
  assert.equal(sections.length, 1, "missing stores are skipped, not thrown");
  assert.equal(sections[0].storeId, "sonik.knowledge.attached");
  assert.match(sections[0].content, /Answer: the sky is blue\./, "attached file content is included");
  assert.equal(truncated, false);

  console.log("resolveKnowledgeContext: attaches valid refs and skips missing stores without throwing");
});

await withTempRoot(async (root) => {
  const store = createKnowledgeStore(root);
  await store.createStore({ storeId: "sonik.knowledge.old", title: "Older store" });
  await store.addFile("sonik.knowledge.old", { title: "Old doc", content: "a".repeat(100) });
  await store.createStore({ storeId: "sonik.knowledge.new", title: "Newer store" });
  await store.addFile("sonik.knowledge.new", { title: "New doc", content: "b".repeat(100) });

  const oldFiles = await store.listFiles("sonik.knowledge.old");
  const newFiles = await store.listFiles("sonik.knowledge.new");
  const knowledgeRefs = [
    { storeId: "sonik.knowledge.old", title: "Older store", fileRefs: oldFiles, readable: true },
    { storeId: "sonik.knowledge.new", title: "Newer store", fileRefs: newFiles, readable: true },
  ];

  // Budget only fits the newer section's file header + content; the older
  // (index-0) section must be the one dropped/cut first.
  const { sections, truncated } = await resolveKnowledgeContext(knowledgeRefs, { rootDir: root, maxChars: 50 });
  assert.equal(truncated, true, "exceeding the budget sets truncated:true");
  assert.equal(sections.length, 1, "only the newer section survives a tight budget");
  assert.equal(sections[0].storeId, "sonik.knowledge.new", "oldest-truncated-first keeps the newest section");
  assert.ok(sections[0].content.length <= 50, "kept content is clipped to the remaining budget");

  console.log("resolveKnowledgeContext: respects the char budget, oldest-truncated-first");
});

await withTempRoot(async (root) => {
  const store = createKnowledgeStore(root);

  const first = await store.writeArtifactFile("sonik.knowledge.campaign-artifacts", "Campaign artifacts", "Artifact v1 content");
  assert.equal(first.storeId, "sonik.knowledge.campaign-artifacts");
  assert.equal(first.fileRef.title, "Campaign artifacts");

  const roundTripped = await store.readFile(first.storeId, first.fileRef.fileId);
  assert.equal(roundTripped, "Artifact v1 content");

  // Create-if-missing: writing again to the same store does not error and
  // appends a second file rather than clobbering the store.
  const second = await store.writeArtifactFile("sonik.knowledge.campaign-artifacts", "Campaign artifacts v2", "Artifact v2 content");
  const files = await store.listFiles("sonik.knowledge.campaign-artifacts");
  assert.equal(files.length, 2, "writeArtifactFile creates the store once and appends on subsequent commits");
  assert.equal(await store.readFile(first.storeId, second.fileRef.fileId), "Artifact v2 content");

  console.log("writeArtifactFile: campaign tool_commit write path round-trips");
});

console.log("knowledge-store: all assertions passed");
