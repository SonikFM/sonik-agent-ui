import assert from "node:assert/strict";
import {
  createComposerFileUpload,
  executeComposerFileUpload,
  failComposerFileUpload,
  retryComposerFileUpload,
} from "../../packages/chat-surface/src/file-upload-state.ts";

const file = new File(["same private bytes"], "operations.txt", { type: "text/plain" });
const first = createComposerFileUpload(file, "upload-1", new AbortController());
const failed = failComposerFileUpload(first, new Error("Your secure workspace session expired. Reconnect and try again."));
assert.equal(failed.status, "failed");
assert.equal(failed.file, file, "failed state retains the original client File by identity");
assert.equal("controller" in failed, false, "failed state cannot reuse an aborted/stale controller");

const retry = retryComposerFileUpload(failed);
assert.equal(retry.file, file, "retry uses the exact same File object");
assert.notEqual(retry.controller, first.controller, "retry creates a fresh AbortController");
let attached = 0;
let uploadedFile = null;
const retryResult = await executeComposerFileUpload({
  upload: retry,
  onUploadFile: async (candidate) => {
    uploadedFile = candidate;
    return { id: "file:ready", kind: "file", label: candidate.name, source: "manual", ref: "ready" };
  },
  onAttachContext: () => { attached += 1; },
});
assert.equal(retryResult, null);
assert.equal(uploadedFile, file);
assert.equal(attached, 1, "successful retry attaches semantic context exactly once");

attached = 0;
const permanent = createComposerFileUpload(file, "upload-2", new AbortController());
const permanentResult = await executeComposerFileUpload({
  upload: permanent,
  onUploadFile: async () => { throw new Error("Unsupported file type"); },
  onAttachContext: () => { attached += 1; },
});
assert.equal(permanentResult?.status, "failed");
assert.equal(permanentResult?.file, file);
assert.equal(attached, 0, "failed upload never calls onAttachContext");

const aborted = createComposerFileUpload(file, "upload-3", new AbortController());
aborted.controller.abort();
attached = 0;
const abortedResult = await executeComposerFileUpload({
  upload: aborted,
  onUploadFile: async () => { throw new Error("AbortError"); },
  onAttachContext: () => { attached += 1; },
});
assert.equal(abortedResult, null);
assert.equal(attached, 0);

console.log("composer-file-retry-state.test.mjs: all assertions passed");
