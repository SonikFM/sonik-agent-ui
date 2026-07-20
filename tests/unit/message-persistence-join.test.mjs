import assert from "node:assert/strict";
import { createJoinableWorker } from "../../apps/standalone-sveltekit/src/lib/joinable-worker.ts";

let releaseFirst;
const firstWrite = new Promise((resolve) => {
  releaseFirst = resolve;
});
let dirtyVersion = 1;
const persistedVersions = [];
const persist = createJoinableWorker(async () => {
  const version = dirtyVersion;
  if (version === 1) await firstWrite;
  persistedVersions.push(version);
});

const effectWrite = persist();
await Promise.resolve();
dirtyVersion = 2;
let submitWriteSettled = false;
const submitWrite = persist().then(() => {
  submitWriteSettled = true;
});
await Promise.resolve();

assert.equal(submitWriteSettled, false, "a submit must join the effect's active persistence write");
releaseFirst();
await Promise.all([effectWrite, submitWrite]);
assert.deepEqual(persistedVersions, [1, 2], "dirty state queued during the active write must flush before submit continues");

console.log("message-persistence-join.test.mjs: all assertions passed");
