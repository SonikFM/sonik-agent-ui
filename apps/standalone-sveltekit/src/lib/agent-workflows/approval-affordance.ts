// Phase 2 of the workflow-state-machine consensus plan (read-side convergence,
// zero behavior change): reservation and intake each produce a WorkflowRunState
// (Phase 1 contract, packages/tool-contracts/src/workflow-run-state.ts) instead
// of an ad hoc shape, and both feed the one shared
// createApprovalAffordanceFromWorkflowRun builder below — the D011 "same
// execution plan" seam. Presentation copy (title/description/labels) and the
// host-side click handlers stay flow-specific inputs; only the
// status/disabled/disabledReason derivation is now shared.
// See .omc/plans/workflow-state-machine-consensus-2026-07-10.md Phase 2.
//
// Rebased for the Phase 2 review constraint (recorded in Phase 3a of the
// consensus plan): the fabricated run must use the HONEST shape the real
// reducer produces -- a genuine preview_ready lands on the tool_preview node,
// with the tool_commit node staying pending, never the other way around.

import type { WorkflowNodeRunState, WorkflowRunState } from "@sonik-agent-ui/tool-contracts/workflow-run-state";
import type { AgentApprovalAffordance } from "@sonik-agent-ui/chat-surface";

const PREVIEW_NODE_ID = "preview";
const COMMIT_NODE_ID = "commit";

function baseRunState(input: {
  workflowId: string;
  workflowVersionId: string;
  phase: WorkflowRunState["phase"];
  commandId: string;
  previewReady: boolean;
  previewError?: { code: string; message: string };
}): WorkflowRunState {
  return {
    runId: `${input.workflowId}-affordance`,
    workflowId: input.workflowId,
    workflowVersionId: input.workflowVersionId,
    artifactId: null,
    phase: input.phase,
    currentNodeId: PREVIEW_NODE_ID,
    facadeToolIds: [],
    nodeStates: {
      [PREVIEW_NODE_ID]: {
        nodeId: PREVIEW_NODE_ID,
        type: "tool_preview",
        status: input.previewReady ? "preview_ready" : "pending",
        commandId: input.commandId,
        effect: "none",
        required: false,
        ...(input.previewError ? { error: input.previewError } : {}),
      },
      // Honest shape: the commit node stays pending behind the preview, never
      // reached by this UI-only derivation (the real approve/commit happens
      // via the trusted host endpoint, outside this fabricated read).
      [COMMIT_NODE_ID]: {
        nodeId: COMMIT_NODE_ID,
        type: "tool_commit",
        status: "pending",
        commandId: input.commandId,
        effect: "write",
        required: false,
      },
    },
    approvalState: { status: "none", hostSigned: false, approvedCommandIds: [], approvedInputHashes: {} },
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
    previewReady: true,
  });
}

/** Same convergence for the intake flow's readiness check. */
export function deriveActiveIntakeWorkflowRunState(readiness: { ready: boolean; reason: string | null }): WorkflowRunState {
  return baseRunState({
    workflowId: "booking.context.intake",
    workflowVersionId: "booking.context.intake@0.0.0",
    phase: readiness.ready ? "preview_ready" : "intake",
    commandId: "booking.create.context",
    previewReady: readiness.ready,
    previewError: readiness.ready || !readiness.reason ? undefined : { code: "intake_not_ready", message: readiness.reason },
  });
}

function findNodeByType(run: WorkflowRunState, type: WorkflowNodeRunState["type"]): WorkflowNodeRunState | undefined {
  return Object.values(run.nodeStates).find((node) => node.type === type);
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
  // Honest shape: readiness/commandId/blocking-error all live on the tool_preview
  // node (the commit node stays pending until a real, host-signed approve), so
  // this reads the preview node rather than whatever run.currentNodeId happens
  // to point at -- generalizes to controller-driven runs too.
  const previewNode = findNodeByType(run, "tool_preview");
  const ready = run.phase === "preview_ready";
  return {
    title: presentation.title,
    description: presentation.description,
    commandId: previewNode?.commandId ?? "",
    artifactTitle: presentation.artifactTitle ?? null,
    status: ready ? "approval_required" : "blocked",
    disabled: !ready,
    disabledReason: ready ? null : (previewNode?.error?.message ?? null),
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
