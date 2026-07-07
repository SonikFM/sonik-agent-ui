import assert from "node:assert/strict";
import {
  RUN_STATUSES,
  RUN_ERROR_CODES,
  RESUME_CONTINUE_PROMPT,
  isRunStatus,
  isTerminalRunStatus,
  isRunErrorCode,
  describeRunError,
  isResumableErrorCode,
  classifyRunErrorCode,
} from "../../packages/tool-contracts/src/index.ts";

assert.deepEqual([...RUN_STATUSES], ["running", "succeeded", "failed", "canceled"]);
assert.equal(isRunStatus("running"), true);
assert.equal(isRunStatus("done"), false);
assert.equal(isTerminalRunStatus("running"), false);
assert.equal(isTerminalRunStatus("failed"), true);
assert.equal(isTerminalRunStatus("succeeded"), true);
assert.equal(isTerminalRunStatus("canceled"), true);

assert.ok(RUN_ERROR_CODES.includes("MISSING_HOST_CONTEXT"));
assert.ok(RUN_ERROR_CODES.includes("RATE_LIMITED"));
assert.ok(RUN_ERROR_CODES.includes("STALE_DEPLOYMENT"));
assert.equal(isRunErrorCode("RATE_LIMITED"), true);
assert.equal(isRunErrorCode("nope"), false);

// Typed affordances: transient failures are resumable and carry a recovery action.
for (const code of ["MISSING_HOST_CONTEXT", "RATE_LIMITED", "STALE_DEPLOYMENT", "AGENT_STREAM_FAILED"]) {
  const affordance = describeRunError(code);
  assert.equal(affordance.code, code);
  assert.equal(affordance.resumable, true, `${code} should be resumable`);
  assert.equal(typeof affordance.actionLabel, "string", `${code} should offer a recovery action`);
  assert.ok(affordance.guidance.length > 0);
  assert.equal(isResumableErrorCode(code), true);
}
// Missing host context nudges reconnect, not a dead chat.
assert.match(describeRunError("MISSING_HOST_CONTEXT").guidance, /reconnect/i);

// UNKNOWN is the non-resumable catch-all.
assert.equal(describeRunError("UNKNOWN").resumable, false);
assert.equal(describeRunError(null).code, "UNKNOWN");
assert.equal(isResumableErrorCode(null), false);

// Classification is conservative: unknown text stays UNKNOWN.
assert.equal(classifyRunErrorCode({ status: 429 }), "RATE_LIMITED");
assert.equal(classifyRunErrorCode({ message: "Too many requests, slow down" }), "RATE_LIMITED");
assert.equal(classifyRunErrorCode({ message: "missing-host-context: reconnect required" }), "MISSING_HOST_CONTEXT");
assert.equal(classifyRunErrorCode({ message: "Cloud persistence requires host session" }), "MISSING_HOST_CONTEXT");
assert.equal(classifyRunErrorCode({ message: "Worker was updated; stale deployment" }), "STALE_DEPLOYMENT");
assert.equal(classifyRunErrorCode({ message: "kaboom" }), "UNKNOWN");
assert.equal(classifyRunErrorCode({}), "UNKNOWN");

// Continue prompt is a continuation, not a re-send of the original request.
assert.match(RESUME_CONTINUE_PROMPT, /interrupted/i);
assert.match(RESUME_CONTINUE_PROMPT, /continue it from where you left off/i);
assert.doesNotMatch(RESUME_CONTINUE_PROMPT, /resend|re-send/i);

console.log("run-contract tests passed");
