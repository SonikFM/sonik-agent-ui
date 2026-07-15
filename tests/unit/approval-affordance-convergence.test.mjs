import assert from "node:assert/strict";
import {
  createApprovalAffordanceFromWorkflowRun,
  deriveActiveIntakeWorkflowRunState,
  deriveReservationWorkflowRunState,
} from "../../apps/standalone-sveltekit/src/lib/agent-workflows/approval-affordance.ts";

// Acceptance proof for Phase 2 of the workflow-state-machine consensus plan
// (.omc/plans/workflow-state-machine-consensus-2026-07-10.md): feeds identical
// fixture input through a frozen copy of the pre-Phase-2 ad hoc builder logic
// (as it existed inline in +page.svelte) and the new shared
// createApprovalAffordanceFromWorkflowRun builder, and asserts deep equality
// for both the reservation and intake shapes. This is the proof that read-side
// convergence changed nothing observable.

function oldReservationApprovalAffordance(preview, description, stubs) {
  return {
    title: "Book this reservation?",
    description,
    commandId: preview.commandId,
    artifactTitle: null,
    status: "approval_required",
    disabled: false,
    disabledReason: null,
    previewLabel: "Review reservation",
    approveLabel: "Approve and book",
    cancelLabel: "Cancel",
    onRequestPreview: stubs.onRequestPreview,
    onApprove: stubs.onApprove,
    onCancel: stubs.onCancel,
  };
}

function oldIntakeApprovalAffordance(readiness, artifactTitle, stubs) {
  return {
    title: "Create this booking setup?",
    description: "Preview the booking setup that will be sent to the trusted host. Chat approval is not enough; the host still gates the write.",
    commandId: "booking.create.context",
    artifactTitle,
    status: readiness.ready ? "approval_required" : "blocked",
    disabled: !readiness.ready,
    disabledReason: readiness.reason,
    onRequestPreview: stubs.onRequestPreview,
    onApprove: stubs.onApprove,
    onCancel: stubs.onCancel,
  };
}

const stubs = {
  onRequestPreview: () => {},
  onApprove: () => {},
  onCancel: () => {},
};

// --- Reservation shape ---
const preview = { commandId: "booking.create.booking" };
const reservationDescription = "Dan, party of 3, 2026-07-01T20:00:00.000Z";

const oldReservation = oldReservationApprovalAffordance(preview, reservationDescription, stubs);
const newReservation = createApprovalAffordanceFromWorkflowRun(deriveReservationWorkflowRunState(preview), {
  title: "Book this reservation?",
  description: reservationDescription,
  artifactTitle: null,
  previewLabel: "Review reservation",
  approveLabel: "Approve and book",
  cancelLabel: "Cancel",
  onRequestPreview: stubs.onRequestPreview,
  onApprove: stubs.onApprove,
  onCancel: stubs.onCancel,
});
assert.deepStrictEqual(newReservation, oldReservation, "reservation affordance must match the pre-Phase-2 ad hoc builder output");

// --- Intake shape, ready ---
const readyReadiness = { ready: true, reason: null };
const intakePresentation = {
  title: "Create this booking setup?",
  description: "Preview the booking setup that will be sent to the trusted host. Chat approval is not enough; the host still gates the write.",
  artifactTitle: "My Draft",
  onRequestPreview: stubs.onRequestPreview,
  onApprove: stubs.onApprove,
  onCancel: stubs.onCancel,
};

const oldIntakeReady = oldIntakeApprovalAffordance(readyReadiness, "My Draft", stubs);
const newIntakeReady = createApprovalAffordanceFromWorkflowRun(deriveActiveIntakeWorkflowRunState(readyReadiness), intakePresentation);
assert.deepStrictEqual(newIntakeReady, oldIntakeReady, "intake affordance (ready) must match the pre-Phase-2 ad hoc builder output");

// --- Intake shape, blocked. getActiveIntakeApprovalReadiness's { visible:
// true, ready: false, reason } combination is not reachable by today's live
// callers, but the ad hoc builder as written handles it -- the shared
// builder must reproduce that same handling generically, not just the one
// live-reachable case. ---
const blockedReadiness = { ready: false, reason: "Answer setup type and inventory before previewing." };
const oldIntakeBlocked = oldIntakeApprovalAffordance(blockedReadiness, "My Draft", stubs);
const newIntakeBlocked = createApprovalAffordanceFromWorkflowRun(deriveActiveIntakeWorkflowRunState(blockedReadiness), intakePresentation);
assert.deepStrictEqual(newIntakeBlocked, oldIntakeBlocked, "intake affordance (blocked) must match the pre-Phase-2 ad hoc builder output");

const builderTrustBlocked = createApprovalAffordanceFromWorkflowRun(deriveActiveIntakeWorkflowRunState(readyReadiness), {
  ...intakePresentation,
  disabledReason: "trusted_host_approval_required",
});
assert.equal(builderTrustBlocked.status, "approval_required", "a ready preview remains visibly an approval affordance");
assert.equal(builderTrustBlocked.disabled, true, "the shared producer must carry the caller's trusted-host block onto the card/button state");
assert.equal(builderTrustBlocked.disabledReason, "trusted_host_approval_required");

console.log(JSON.stringify({ ok: true, checked: "approval-affordance-convergence" }));
