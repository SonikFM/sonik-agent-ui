import assert from "node:assert/strict";
import {
  applyWorkflowRunEvent,
  startWorkflowRun,
  workflowRunApprovalStateSchema,
  workflowRunStateSchema,
} from "../../packages/tool-contracts/dist/workflow-run-state.js";

const RESERVATION_NODES = [
  { nodeId: "trigger", type: "trigger" },
  { nodeId: "availability", type: "tool_preview", commandId: "booking.get.availability", effect: "read" },
  { nodeId: "reservation_preview", type: "tool_preview", commandId: "booking.create.booking", effect: "none" },
  { nodeId: "reservation_commit", type: "tool_commit", commandId: "booking.create.booking", effect: "write" },
];

function freshRun() {
  return startWorkflowRun({
    type: "start",
    runId: "run-1",
    workflowId: "booking.reservation.create",
    workflowVersionId: "sonik.booking.reservation.workflow@0.1.0",
    facadeToolIds: ["booking.get.availability", "booking.create.booking"],
    nodes: RESERVATION_NODES,
  });
}

// start: valid initial state, entry node active, facade pinned.
const started = freshRun();
assert.equal(workflowRunStateSchema.safeParse(started).success, true, "started run validates");
assert.equal(started.phase, "intake");
assert.equal(started.currentNodeId, "trigger");
assert.equal(started.nodeStates.trigger.status, "active");
assert.deepEqual(started.facadeToolIds, ["booking.get.availability", "booking.create.booking"]);
assert.equal(applyWorkflowRunEvent(started, { type: "start", runId: "x", workflowId: "y", workflowVersionId: "p@1.0.0", nodes: [] }).ok, false, "double start rejected");

// preview flow.
let result = applyWorkflowRunEvent(started, {
  type: "preview_ready",
  nodeId: "reservation_preview",
  preview: { commandId: "booking.create.booking", stableInputHash: "hash-1", effect: "write", approvalRequired: true },
});
assert.equal(result.ok, true);
assert.equal(result.state.phase, "preview_ready");

// commit before any approval: rejected, state unchanged.
const premature = applyWorkflowRunEvent(result.state, { type: "commit_started", nodeId: "reservation_commit" });
assert.deepEqual({ ok: premature.ok, reason: premature.reason }, { ok: false, reason: "approval_required" });
assert.equal(premature.state.nodeStates.reservation_commit.status, "pending", "rejection leaves state unchanged");

// request approval.
result = applyWorkflowRunEvent(result.state, { type: "request_approval", nodeId: "reservation_commit" });
assert.equal(result.ok, true);
assert.equal(result.state.approvalState.status, "requested");
assert.equal(result.state.phase, "approval_requested");

// approve WITHOUT host signature: rejected — chat/model text is never approval.
const modelApprove = applyWorkflowRunEvent(result.state, { type: "approve", hostSigned: false });
assert.deepEqual({ ok: modelApprove.ok, reason: modelApprove.reason }, { ok: false, reason: "model_supplied_approval_is_not_trusted" });

// commit still rejected after the failed model approval.
assert.equal(applyWorkflowRunEvent(modelApprove.state, { type: "commit_started", nodeId: "reservation_commit" }).ok, false);

// host-signed approve, then commit.
result = applyWorkflowRunEvent(result.state, { type: "approve", hostSigned: true, approvedCommandIds: ["booking.create.booking"] });
assert.equal(result.ok, true);
assert.equal(result.state.phase, "approved");
result = applyWorkflowRunEvent(result.state, { type: "commit_started", nodeId: "reservation_commit" });
assert.equal(result.ok, true);
assert.equal(result.state.phase, "committing");

// semantic FAILURE receipt → error phase, never committed (no success from transport alone).
const failed = applyWorkflowRunEvent(result.state, {
  type: "commit_result",
  nodeId: "reservation_commit",
  receipt: { commandId: "booking.create.booking", semanticStatus: "failure" },
});
assert.equal(failed.ok, true);
assert.equal(failed.state.phase, "error");
assert.equal(failed.state.nodeStates.reservation_commit.status, "error");

// semantic success receipt → committed.
result = applyWorkflowRunEvent(result.state, {
  type: "commit_result",
  nodeId: "reservation_commit",
  receipt: { commandId: "booking.create.booking", receiptRef: "receipts/booking-created", semanticStatus: "success" },
});
assert.equal(result.ok, true);
assert.equal(result.state.phase, "committed");
assert.equal(result.state.receipts.length, 1);
assert.equal(result.state.receipts[0].semanticStatus, "success");

// terminal runs reject further events.
assert.deepEqual(
  (({ ok, reason }) => ({ ok, reason }))(applyWorkflowRunEvent(result.state, { type: "cancel" })),
  { ok: false, reason: "run_is_terminal" },
);

// ask_user answer flow.
const intake = startWorkflowRun({
  type: "start",
  runId: "run-2",
  workflowId: "intake.demo",
  workflowVersionId: "sonik.intake.demo@0.1.0",
  nodes: [
    { nodeId: "q1", type: "ask_user", required: true, question: { id: "q1", title: "Venue name?", required: true, answerType: "text" } },
    { nodeId: "save", type: "tool_commit", commandId: "booking.create.context", effect: "write" },
  ],
});
assert.equal(intake.nodeStates.q1.status, "awaiting_input", "entry ask_user starts awaiting input");
const answered = applyWorkflowRunEvent(intake, { type: "answer", nodeId: "q1" });
assert.equal(answered.ok, true);
assert.equal(answered.state.nodeStates.q1.status, "committed");
assert.equal(applyWorkflowRunEvent(intake, { type: "answer", nodeId: "save" }).ok, false, "answer on non-ask_user node rejected");

// cancel: active/pending nodes skipped, phase cancelled.
const cancelled = applyWorkflowRunEvent(answered.state, { type: "cancel" });
assert.equal(cancelled.ok, true);
assert.equal(cancelled.state.phase, "cancelled");
assert.equal(cancelled.state.nodeStates.save.status, "skipped");
assert.equal(cancelled.state.nodeStates.q1.status, "committed", "completed nodes keep their history through cancel");

// schema refuses to represent a non-host-signed approval.
assert.equal(
  workflowRunApprovalStateSchema.safeParse({ status: "approved", hostSigned: false, approvedCommandIds: [] }).success,
  false,
  "approved-without-hostSigned is structurally invalid",
);

console.log("workflow-run-state.test.mjs passed");
