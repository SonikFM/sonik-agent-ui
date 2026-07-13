import assert from "node:assert/strict";
import {
  applyWorkflowRunEvent,
  startWorkflowRun,
} from "../../packages/tool-contracts/dist/workflow-run-state.js";
import { projectWorkflowRunToAgentUiSnapshot } from "../../packages/tool-contracts/dist/workflow-projection.js";

function step(state, event) {
  const result = applyWorkflowRunEvent(state, event);
  assert.equal(result.ok, true, `${event.type} transition applies`);
  return result.state;
}

// --- Intake shape: ask_user question round-trips into the snapshot. ---
const intake = startWorkflowRun({
  type: "start",
  runId: "run-intake",
  workflowId: "restaurant.setup.intake",
  workflowVersionId: "sonik.restaurant.setup.app@0.1.0",
  artifactId: "artifact-42",
  nodes: [
    { nodeId: "q_name", type: "ask_user", required: true, question: { id: "q_name", title: "Venue name?", required: true, answerType: "text" } },
    { nodeId: "q_notes", type: "ask_user", required: false, question: { id: "q_notes", title: "Notes?", required: false, answerType: "text" } },
    { nodeId: "save", type: "tool_commit", commandId: "booking.create.context", effect: "write" },
  ],
});

let snapshot = projectWorkflowRunToAgentUiSnapshot(intake);
assert.equal(snapshot.activeWorkflowId, "restaurant.setup.intake");
assert.equal(snapshot.activeArtifactId, "artifact-42");
assert.equal(snapshot.phase, "intake");
assert.deepEqual(snapshot.currentQuestion, { id: "q_name", title: "Venue name?", required: true, answerType: "text" });
assert.equal(snapshot.answeredCount, 0);
assert.equal(snapshot.requiredCount, 1);
assert.deepEqual(snapshot.unansweredRequiredIds, ["q_name"]);
assert.equal(snapshot.canSubmitAnswer, true);
assert.equal(snapshot.canRequestApproval, false, "no preview yet");
assert.equal(snapshot.canApproveAndRun, false);
assert.equal(snapshot.disabledReasons.includes("required_questions_unanswered"), true);
assert.equal(snapshot.disabledReasons.includes("approval_required"), true, "pending commit node needs approval");

const intakeAnswered = step(intake, { type: "answer", nodeId: "q_name" });
snapshot = projectWorkflowRunToAgentUiSnapshot(intakeAnswered);
assert.equal(snapshot.answeredCount, 1);
assert.deepEqual(snapshot.unansweredRequiredIds, []);
assert.equal(snapshot.disabledReasons.includes("required_questions_unanswered"), false);

// --- Reservation shape: preview → approval → commit round-trips. ---
let run = startWorkflowRun({
  type: "start",
  runId: "run-reservation",
  workflowId: "booking.reservation.create",
  workflowVersionId: "sonik.booking.reservation.workflow@0.1.0",
  facadeToolIds: ["booking.create.booking"],
  nodes: [
    { nodeId: "preview", type: "tool_preview", commandId: "booking.create.booking", effect: "none" },
    { nodeId: "commit", type: "tool_commit", commandId: "booking.create.booking", effect: "write" },
  ],
});
run = step(run, {
  type: "preview_ready",
  nodeId: "preview",
  preview: { commandId: "booking.create.booking", stableInputHash: "hash-abc", effect: "write", approvalRequired: true },
});

snapshot = projectWorkflowRunToAgentUiSnapshot(run);
assert.equal(snapshot.phase, "preview_ready");
assert.deepEqual(snapshot.commandPreview, {
  commandId: "booking.create.booking",
  stableInputHash: "hash-abc",
  effect: "write",
  approvalRequired: true,
});
assert.equal(snapshot.canRequestApproval, true);
assert.equal(snapshot.canApproveAndRun, false, "approval not yet requested");

run = step(run, { type: "request_approval", nodeId: "commit" });
snapshot = projectWorkflowRunToAgentUiSnapshot(run);
assert.equal(snapshot.phase, "approval_requested");
assert.equal(snapshot.canRequestApproval, false, "already requested");
assert.equal(snapshot.canApproveAndRun, true, "host Review surface may approve");

run = step(run, { type: "approve", hostSigned: true, approvedCommandIds: ["booking.create.booking"] });
run = step(run, { type: "commit_started", nodeId: "commit" });
snapshot = projectWorkflowRunToAgentUiSnapshot(run);
assert.equal(snapshot.phase, "committing");
assert.equal(snapshot.disabledReasons.includes("approval_required"), false, "approved run is not blocked on approval");

run = step(run, { type: "commit_result", nodeId: "commit", receipt: { commandId: "booking.create.booking", receiptRef: "receipts/booked", semanticStatus: "success" } });
snapshot = projectWorkflowRunToAgentUiSnapshot(run);
assert.equal(snapshot.phase, "committed");
assert.equal(snapshot.activeWorkflowId, null, "terminal run reads as no active workflow");
assert.equal(snapshot.canSubmitAnswer, false);
assert.equal(snapshot.canRequestApproval, false);
assert.equal(snapshot.canApproveAndRun, false);
assert.deepEqual(snapshot.disabledReasons, []);

// --- Error surfaces as a visible error. ---
let errored = startWorkflowRun({
  type: "start",
  runId: "run-err",
  workflowId: "booking.reservation.create",
  workflowVersionId: "sonik.booking.reservation.workflow@0.1.0",
  nodes: [{ nodeId: "preview", type: "tool_preview", commandId: "booking.create.booking" }],
});
errored = step(errored, { type: "node_error", nodeId: "preview", error: { code: "availability_unreachable", message: "Availability lookup failed" } });
snapshot = projectWorkflowRunToAgentUiSnapshot(errored);
assert.equal(snapshot.phase, "error");
assert.deepEqual(snapshot.visibleErrors, [{ code: "availability_unreachable", message: "Availability lookup failed" }]);

// --- Cancelled projects as idle (snapshot vocabulary has no cancelled). ---
const cancelled = step(errored, { type: "cancel" });
snapshot = projectWorkflowRunToAgentUiSnapshot(cancelled);
assert.equal(snapshot.phase, "idle");
assert.equal(snapshot.activeWorkflowId, null);

console.log("workflow-projection.test.mjs passed");
