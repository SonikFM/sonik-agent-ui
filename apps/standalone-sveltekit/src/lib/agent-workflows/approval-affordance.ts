// Phase 2 of the workflow-state-machine consensus plan (read-side convergence,
// zero behavior change): reservation and intake each produce a WorkflowRunState
// (Phase 1 contract, packages/tool-contracts/src/workflow-run-state.ts) instead
// of an ad hoc shape, and both feed the one shared
// createApprovalAffordanceFromWorkflowRun builder below — the D011 "same
// execution plan" seam. Presentation copy (title/description/labels) and the
// host-side click handlers stay flow-specific inputs; only the
// status/disabled/disabledReason derivation is now shared.
// See .omc/plans/workflow-state-machine-consensus-2026-07-10.md Phase 2.

import type { WorkflowRunState } from "@sonik-agent-ui/tool-contracts/workflow-run-state";
import type { AgentApprovalAffordance } from "@sonik-agent-ui/chat-surface";

const APPROVAL_NODE_ID = "approval";

function baseRunState(input: {
  workflowId: string;
  workflowVersionId: string;
  phase: WorkflowRunState["phase"];
  commandId: string;
  nodeStatus: WorkflowRunState["nodeStates"][string]["status"];
  nodeError?: { code: string; message: string };
}): WorkflowRunState {
  return {
    runId: `${input.workflowId}-affordance`,
    workflowId: input.workflowId,
    workflowVersionId: input.workflowVersionId,
    artifactId: null,
    phase: input.phase,
    currentNodeId: APPROVAL_NODE_ID,
    facadeToolIds: [],
    nodeStates: {
      [APPROVAL_NODE_ID]: {
        nodeId: APPROVAL_NODE_ID,
        type: "tool_commit",
        status: input.nodeStatus,
        commandId: input.commandId,
        effect: "write",
        required: false,
        ...(input.nodeError ? { error: input.nodeError } : {}),
      },
    },
    approvalState: { status: "none", hostSigned: false, approvedCommandIds: [] },
    receipts: [],
  };
}

/**
 * Reads the same reservation preview data `findLatestReservationApprovalPreview`
 * already scans (previewBookingReservationCommand tool output) and emits a
 * WorkflowRunState instead of the ad hoc ReservationApprovalPreview shape.
 */
export function deriveReservationWorkflowRunState(preview: { commandId: string }): WorkflowRunState {
  return baseRunState({
    workflowId: "booking.reservation.create",
    workflowVersionId: "booking.reservation.create@0.0.0",
    phase: "preview_ready",
    commandId: preview.commandId,
    nodeStatus: "preview_ready",
  });
}

/** Same convergence for the intake flow's readiness check. */
export function deriveActiveIntakeWorkflowRunState(readiness: { ready: boolean; reason: string | null }): WorkflowRunState {
  return baseRunState({
    workflowId: "booking.context.intake",
    workflowVersionId: "booking.context.intake@0.0.0",
    phase: readiness.ready ? "preview_ready" : "intake",
    commandId: "booking.create.context",
    nodeStatus: readiness.ready ? "preview_ready" : "pending",
    nodeError: readiness.ready || !readiness.reason ? undefined : { code: "intake_not_ready", message: readiness.reason },
  });
}

export interface ApprovalAffordancePresentation {
  title: string;
  description: string;
  artifactTitle?: string | null;
  previewLabel?: string;
  approveLabel?: string;
  cancelLabel?: string;
  onRequestPreview: () => void;
  onApprove: () => void;
  onCancel: () => void;
}

/**
 * The one shared builder both flows feed. status/disabled/disabledReason
 * derive from the run's phase and current node instead of two independent
 * copies of that logic; everything else is presentation passed through.
 */
export function createApprovalAffordanceFromWorkflowRun(
  run: WorkflowRunState,
  presentation: ApprovalAffordancePresentation,
): AgentApprovalAffordance {
  const node = run.currentNodeId ? run.nodeStates[run.currentNodeId] : undefined;
  const ready = run.phase === "preview_ready";
  return {
    title: presentation.title,
    description: presentation.description,
    commandId: node?.commandId ?? "",
    artifactTitle: presentation.artifactTitle ?? null,
    status: ready ? "approval_required" : "blocked",
    disabled: !ready,
    disabledReason: ready ? null : (node?.error?.message ?? null),
    // Omit rather than set-to-undefined so flows that don't supply custom
    // labels produce the exact same object shape as before this seam existed.
    ...(presentation.previewLabel !== undefined ? { previewLabel: presentation.previewLabel } : {}),
    ...(presentation.approveLabel !== undefined ? { approveLabel: presentation.approveLabel } : {}),
    ...(presentation.cancelLabel !== undefined ? { cancelLabel: presentation.cancelLabel } : {}),
    onRequestPreview: presentation.onRequestPreview,
    onApprove: presentation.onApprove,
    onCancel: presentation.onCancel,
  };
}
