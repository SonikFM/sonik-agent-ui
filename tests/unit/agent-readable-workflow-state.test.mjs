import assert from "node:assert/strict";
import { createInteractiveSurfaceJsonRenderSpec } from "../../packages/json-ui-runtime/src/intake.ts";
import { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE } from "../../apps/standalone-sveltekit/src/lib/server/booking-workflows/context-intake.ts";
import {
  createAgentWorkflowSnapshot,
  createQuestionAnswerStateChanges,
} from "../../apps/standalone-sveltekit/src/lib/agent-workflows/page-control-workflow.ts";
import { sanitizePageContext } from "../../packages/agent-observability/src/index.ts";

const spec = createInteractiveSurfaceJsonRenderSpec(BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE);
const artifact = {
  id: "artifact-intake-1",
  title: "Booking intake",
  kind: "json-render",
  version: 7,
  content: spec,
};

{
  const snapshot = createAgentWorkflowSnapshot({
    activeArtifact: artifact,
    pendingChangeCount: 0,
    isStreaming: false,
    approvalReadiness: { ready: false, visible: true, reason: "Answer setup type and inventory before previewing." },
  });
  assert.equal(snapshot.activeWorkflowId, "booking.context.intake");
  assert.equal(snapshot.activeArtifactId, artifact.id);
  assert.equal(snapshot.phase, "intake");
  assert.equal(snapshot.currentQuestion?.id, "q_intake_mode");
  assert.equal(snapshot.currentQuestion?.choices?.some((choice) => choice.value === "venue_schedule"), true);
  assert.equal(snapshot.canSubmitAnswer, true);
  assert.equal(snapshot.canRequestApproval, false);
  assert.ok(snapshot.unansweredRequiredIds.includes("q_intake_mode"));
  assert.ok(snapshot.disabledReasons.includes("Answer setup type and inventory before previewing."));
}

{
  const staged = createQuestionAnswerStateChanges({
    artifact,
    questionId: "q_intake_mode",
    value: "venue_schedule",
    sessionId: "session-1",
  });
  assert.ok(staged.changes.some((change) => change.path === "/answers/q_intake_mode" && change.value === "venue_schedule"));
  assert.ok(staged.changes.some((change) => change.path === "/questionStates/q_intake_mode" && change.value === "answered"));
  const submission = staged.actionParams.submission;
  assert.equal(submission.metadata.execution, "none");
  assert.equal(submission.metadata.approval, "not_granted");
  assert.equal(JSON.stringify(staged).includes("commitCommand"), false);
  assert.equal(JSON.stringify(staged).includes("APPROVE_AND_RUN"), false);
}

{
  const openDays = createQuestionAnswerStateChanges({
    artifact,
    questionId: "q_open_days",
    value: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
    sessionId: "session-1",
  });
  assert.ok(openDays.changes.some((change) => change.path === "/manifest/schedule/openDays" && Array.isArray(change.value) && change.value.length === 7));
  assert.equal(openDays.actionParams.skipped, false);
}

{
  const withError = structuredClone(artifact);
  withError.content.state.questionErrors = { q_open_days: "Answer not saved. Retry this question before continuing." };
  withError.content.state.questionStates = { q_open_days: "error" };
  const snapshot = createAgentWorkflowSnapshot({ activeArtifact: withError, pendingChangeCount: 0, isStreaming: false, approvalReadiness: { ready: true, visible: true, reason: null } });
  assert.equal(snapshot.phase, "error");
  assert.equal(snapshot.canRequestApproval, false);
  assert.equal(snapshot.visibleErrors[0]?.field, "q_open_days");
}

{
  const ready = createAgentWorkflowSnapshot({
    activeArtifact: artifact,
    pendingChangeCount: 0,
    isStreaming: false,
    approvalReadiness: { ready: true, visible: true, reason: null },
  });
  assert.equal(ready.phase, "preview_ready");
  assert.equal(ready.canRequestApproval, true);
  assert.equal(ready.commandPreview?.commandId, "booking.create.context");
  assert.equal(ready.commandPreview?.approvalRequired, true);
  const sanitized = sanitizePageContext({ workflow: ready, visibleErrors: ready.visibleErrors.map((error) => error.message) });
  assert.equal(sanitized?.workflow?.activeWorkflowId, "booking.context.intake");
  assert.equal(sanitized?.workflow?.commandPreview?.effect, "write");
}

console.log("agent-readable workflow state tests passed");
