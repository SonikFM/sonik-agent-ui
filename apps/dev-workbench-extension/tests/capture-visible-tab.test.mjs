import assert from "node:assert/strict";
import { captureVisibleTabWithoutSonikChrome } from "../src/capture-visible-tab.ts";

async function run({ hideError, captureError, restoreError } = {}) {
  const calls = [];
  const operation = captureVisibleTabWithoutSonikChrome({
    async hideCaptureChrome() {
      calls.push("hide");
      if (hideError) throw hideError;
    },
    async captureVisibleTab() {
      calls.push("captureVisibleTab");
      if (captureError) throw captureError;
      return "data:image/png;base64,AA==";
    },
    async restoreCaptureChrome() {
      calls.push("restore");
      if (restoreError) throw restoreError;
    },
  });
  return { calls, operation };
}

const success = await run();
assert.equal(await success.operation, "data:image/png;base64,AA==");
assert.deepEqual(success.calls, ["hide", "captureVisibleTab", "restore"]);

for (const failureAt of ["hide", "capture"]) {
  const failure = new Error(`${failureAt} failed`);
  const failed = await run(failureAt === "hide" ? { hideError: failure } : { captureError: failure });
  await assert.rejects(failed.operation, failure);
  assert.deepEqual(failed.calls, failureAt === "hide" ? ["hide", "restore"] : ["hide", "captureVisibleTab", "restore"]);
}

const restoreFailure = new Error("restore failed");
const restoreFailed = await run({ restoreError: restoreFailure });
await assert.rejects(restoreFailed.operation, restoreFailure);

const captureFailure = new Error("capture failed");
const bothFailed = await run({ captureError: captureFailure, restoreError: restoreFailure });
await assert.rejects(bothFailed.operation, (error) => {
  assert.ok(error instanceof AggregateError);
  assert.deepEqual(error.errors, [captureFailure, restoreFailure]);
  return true;
});

console.log("dev-workbench extension capture chrome lifecycle: ok");
