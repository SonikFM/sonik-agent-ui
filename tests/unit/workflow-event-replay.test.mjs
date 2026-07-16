import assert from "node:assert/strict";
import {
  WORKFLOW_EVENT_SCHEMA_VERSION,
  parseCanonicalWorkflowEvent,
  replayCanonicalWorkflowEvents,
} from "../../packages/tool-contracts/dist/workflow-vnext.js";
import { train0SelectedPathRunState } from "../../packages/tool-contracts/dist/workflow-vnext-fixtures.js";

const seed = 20260715;
const digest = `sha256:${"a".repeat(64)}`;
const runId = train0SelectedPathRunState.workflowRunId;
const timestamp = "2026-07-15T12:00:00.000Z";
const base = (sequence, eventType, subject, payload, attemptId) => ({
  eventId: `event-${seed}-${sequence}`,
  schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
  eventVersion: 1,
  workflowRunId: runId,
  sequence,
  revision: sequence,
  actor: { kind: "system", id: "scheduler" },
  subject,
  causationId: `seed-${seed}`,
  ...(attemptId ? { attemptId } : {}),
  correlationIds: [`seed-${seed}`, ...(attemptId ? [attemptId] : [])],
  timestamp,
  eventType,
  payload,
});

const startAttempt = `${runId}:start:1`;
const chooseAttempt = `${runId}:choose:1`;
const waitpoint = { kind: "answer", waitpointId: "wait-seeded", runId, nodeId: "choose", subjectId: "user-1" };
const events = [
  base(1, "run_started", { kind: "run", id: runId }, { source: train0SelectedPathRunState.source }),
  base(2, "node_completed", { kind: "node", id: "start" }, { nodeId: "start", outputRef: { storage: "inline_redacted", digest, byteLength: 2, redactedSummary: "ok" } }, startAttempt),
  base(3, "wait_created", { kind: "waitpoint", id: waitpoint.waitpointId }, { waitpoint }, chooseAttempt),
  base(4, "run_status_changed", { kind: "run", id: runId }, { status: "succeeded", compatibilityPhase: "completed" }),
];

const initial = {
  ...structuredClone(train0SelectedPathRunState),
  status: "ready",
  revision: 0,
  eventSequence: 0,
  selectedPath: [],
  schedulerFrontier: ["start", "choose"],
  outputs: {},
  outputRefs: {},
  waits: [],
  compatibilityPhase: "ready",
};
const expectedUi = [
  { status: "running", compatibilityPhase: "ready" },
  { status: "running", compatibilityPhase: "ready" },
  { status: "waiting", compatibilityPhase: "ready" },
  { status: "succeeded", compatibilityPhase: "completed" },
];

let incremental = initial;
for (const [index, event] of events.entries()) {
  incremental = replayCanonicalWorkflowEvents(incremental, [event]);
  const prefix = replayCanonicalWorkflowEvents(initial, events.slice(0, index + 1));
  assert.deepEqual(prefix, incremental, `seed=${seed} minimizedCase=${index + 1}: prefix replay equals incremental projection`);
  assert.deepEqual(
    { status: prefix.status, compatibilityPhase: prefix.compatibilityPhase },
    expectedUi[index],
    `seed=${seed} minimizedCase=${index + 1}: UI compatibility projection stays equivalent`,
  );
}
assert.deepEqual(incremental.selectedPath, ["start"]);
assert.deepEqual(incremental.waits, [waitpoint]);
assert.equal(incremental.outputRefs.start.digest, digest);

assert.throws(
  () => replayCanonicalWorkflowEvents(initial, [{ ...events[0], subject: { kind: "node", id: "start" } }]),
  /Event subject must match/,
  "envelope subject must match its payload",
);
assert.throws(
  () => replayCanonicalWorkflowEvents(initial, [{ ...events[1], sequence: 1, revision: 1, correlationIds: [`seed-${seed}`] }]),
  /canonical correlation identifier/,
  "attempt identity must remain correlated",
);

const legacyStart = { ...events[0], schemaVersion: "sonik.workflow.event.v0", eventVersion: 0, legacySource: events[0].payload.source };
delete legacyStart.payload;
const upcasters = {
  "sonik.workflow.event.v0@0": ({ legacySource, ...event }) => ({
    ...event,
    schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION,
    eventVersion: 1,
    payload: { source: legacySource },
  }),
};
assert.deepEqual(parseCanonicalWorkflowEvent(legacyStart, upcasters), events[0], "explicit upcast preserves the canonical v1 envelope");
assert.deepEqual(replayCanonicalWorkflowEvents(initial, [legacyStart, ...events.slice(1)], upcasters), incremental, "upcast history replays identically");

console.log(JSON.stringify({ ok: true, checked: "workflow-event-replay", seed, minimizedCase: null }));
