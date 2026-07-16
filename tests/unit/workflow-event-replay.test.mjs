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
const random = (() => {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
})();
const shuffle = (values) => {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};
const base = (caseIndex, sequence, eventType, subject, payload, attemptId) => ({
  eventId: `event-${seed}-${caseIndex}-${sequence}`,
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
const makeEvent = (caseIndex, sequence, eventType) => {
  if (eventType === "run_started") return base(caseIndex, sequence, eventType, { kind: "run", id: runId }, { source: train0SelectedPathRunState.source });
  if (eventType === "node_completed") {
    const nodeId = random() < 0.5 ? "start" : "choose";
    return base(caseIndex, sequence, eventType, { kind: "node", id: nodeId }, { nodeId, outputRef: { storage: "inline_redacted", digest, byteLength: 2, redactedSummary: "ok" } }, `${runId}:${nodeId}:${caseIndex + 1}`);
  }
  if (eventType === "wait_created") {
    const waitpoint = { kind: "answer", waitpointId: `wait-${caseIndex}`, runId, nodeId: "choose", subjectId: "user-1" };
    return base(caseIndex, sequence, eventType, { kind: "waitpoint", id: waitpoint.waitpointId }, { waitpoint }, `${runId}:choose:${caseIndex + 1}`);
  }
  if (eventType === "effect_claim_changed") {
    const logicalEffectId = `effect-${caseIndex}`;
    return base(caseIndex, sequence, eventType, { kind: "effect", id: logicalEffectId }, { claimId: `claim-${caseIndex}`, logicalEffectId, status: "claimed" });
  }
  const statuses = [
    ["running", "ready"],
    ["waiting", "ready"],
    ["succeeded", "completed"],
    ["failed", "failed"],
  ];
  const [status, compatibilityPhase] = statuses[Math.floor(random() * statuses.length)];
  return base(caseIndex, sequence, eventType, { kind: "run", id: runId }, { status, compatibilityPhase });
};

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
const eventKinds = ["node_completed", "wait_created", "effect_claim_changed", "run_status_changed"];
const cases = Array.from({ length: 8 }, (_, caseIndex) => [
  makeEvent(caseIndex, 1, "run_started"),
  ...shuffle(eventKinds).map((eventType, index) => makeEvent(caseIndex, index + 2, eventType)),
]);

for (const [caseIndex, events] of cases.entries()) {
  let incremental = initial;
  let expectedUi = { status: "ready", compatibilityPhase: "ready" };
  for (const [eventIndex, event] of events.entries()) {
    incremental = replayCanonicalWorkflowEvents(incremental, [event]);
    const prefix = replayCanonicalWorkflowEvents(initial, events.slice(0, eventIndex + 1));
    if (event.eventType === "run_started") expectedUi = { ...expectedUi, status: "running" };
    else if (event.eventType === "wait_created") expectedUi = { ...expectedUi, status: "waiting" };
    else if (event.eventType === "run_status_changed") expectedUi = event.payload;
    const diagnostic = `seed=${seed} case=${caseIndex} minimizedIndex=${eventIndex}`;
    assert.deepEqual(prefix, incremental, `${diagnostic}: prefix replay equals incremental projection`);
    assert.deepEqual({ status: prefix.status, compatibilityPhase: prefix.compatibilityPhase }, expectedUi, `${diagnostic}: UI compatibility projection stays equivalent`);
  }
}

const events = cases[0];
const canonicalFinal = replayCanonicalWorkflowEvents(initial, events);
const nodeEvent = events.find((event) => event.eventType === "node_completed");
const waitEvent = events.find((event) => event.eventType === "wait_created");
assert.equal(canonicalFinal.outputRefs[nodeEvent.payload.nodeId].digest, digest);
assert.deepEqual(canonicalFinal.waits, [waitEvent.payload.waitpoint]);

assert.throws(
  () => replayCanonicalWorkflowEvents(initial, [{ ...events[0], subject: { kind: "node", id: "start" } }]),
  /Event subject must match/,
  "envelope subject must match its payload",
);
assert.throws(
  () => replayCanonicalWorkflowEvents(initial, [{ ...nodeEvent, sequence: 1, revision: 1, correlationIds: [`seed-${seed}`] }]),
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
assert.deepEqual(replayCanonicalWorkflowEvents(initial, [legacyStart, ...events.slice(1)], upcasters), canonicalFinal, "upcast history replays identically");

console.log(JSON.stringify({ ok: true, checked: "workflow-event-replay", seed, cases: cases.length, minimizedIndex: null }));
