import assert from "node:assert/strict";
import {
  AGENT_ANALYTICS_ENTRY_FROM,
  isAgentAnalyticsEntryFrom,
  sanitizeAgentAnalyticsHints,
} from "../../packages/tool-contracts/src/index.ts";

// --- entry-from enum matches Sonik's actual entry points -----------------
assert.deepEqual([...AGENT_ANALYTICS_ENTRY_FROM], [
  "workflow_launcher",
  "composer",
  "question_answer",
  "resume_continue",
]);
assert.equal(isAgentAnalyticsEntryFrom("composer"), true);
assert.equal(isAgentAnalyticsEntryFrom("resume_continue"), true);
assert.equal(isAgentAnalyticsEntryFrom("new_project"), false); // donor value Sonik does not have
assert.equal(isAgentAnalyticsEntryFrom(42), false);

// --- sanitize keeps a well-formed payload --------------------------------
assert.deepEqual(
  sanitizeAgentAnalyticsHints({ entryFrom: "workflow_launcher", turnIndex: 3, isFirstRun: false, hasExistingArtifact: true }),
  { entryFrom: "workflow_launcher", turnIndex: 3, isFirstRun: false, hasExistingArtifact: true },
);

// --- droppable: absent / unusable input returns undefined ----------------
assert.equal(sanitizeAgentAnalyticsHints(undefined), undefined);
assert.equal(sanitizeAgentAnalyticsHints(null), undefined);
assert.equal(sanitizeAgentAnalyticsHints("nope"), undefined);
assert.equal(sanitizeAgentAnalyticsHints([]), undefined);
assert.equal(sanitizeAgentAnalyticsHints({}), undefined);
// every field malformed → nothing usable remains → undefined
assert.equal(
  sanitizeAgentAnalyticsHints({ entryFrom: "bogus", turnIndex: -1, isFirstRun: "yes", hasExistingArtifact: 1 }),
  undefined,
);

// --- per-field bounding / coercion ---------------------------------------
// unknown entryFrom dropped, valid fields retained
assert.deepEqual(sanitizeAgentAnalyticsHints({ entryFrom: "bogus", turnIndex: 0 }), { turnIndex: 0 });
// turnIndex floored and clamped, negatives/NaN dropped
assert.deepEqual(sanitizeAgentAnalyticsHints({ turnIndex: 2.9 }), { turnIndex: 2 });
assert.deepEqual(sanitizeAgentAnalyticsHints({ turnIndex: 10 ** 9 }), { turnIndex: 100_000 });
assert.equal(sanitizeAgentAnalyticsHints({ turnIndex: -5 }), undefined);
assert.equal(sanitizeAgentAnalyticsHints({ turnIndex: Number.NaN }), undefined);
// booleans must be real booleans
assert.deepEqual(sanitizeAgentAnalyticsHints({ isFirstRun: true }), { isFirstRun: true });
assert.equal(sanitizeAgentAnalyticsHints({ isFirstRun: "true" }), undefined);
assert.deepEqual(sanitizeAgentAnalyticsHints({ hasExistingArtifact: false, entryFrom: "composer" }), {
  hasExistingArtifact: false,
  entryFrom: "composer",
});

// --- hints never carry extra keys (analytics-only, no passthrough) -------
const sanitized = sanitizeAgentAnalyticsHints({ entryFrom: "composer", turnIndex: 1, extra: "drop me", nested: { a: 1 } });
assert.deepEqual(Object.keys(sanitized).sort(), ["entryFrom", "turnIndex"]);

console.log("agent-analytics-hints.test.mjs OK");
