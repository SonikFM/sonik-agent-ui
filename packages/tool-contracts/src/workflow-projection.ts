// Agent-readable projection (consensus plan Phase 1, Principle 5): a
// WorkflowRunState projects into the EXISTING AgentUiWorkflowSnapshot type —
// the shape already wired through sanitizePageContext and
// AgentUiPageControl.getActiveWorkflowState — rather than a second snapshot
// type. Pure derivation; the run state is the single source of truth.

import type { AgentUiWorkflowPhase, AgentUiWorkflowSnapshot } from "@sonik-agent-ui/agent-observability";
import type { WorkflowRunState } from "./workflow-run-state.js";

function toSnapshotPhase(phase: WorkflowRunState["phase"]): AgentUiWorkflowPhase {
  // "cancelled" is a run-lifecycle phase the snapshot vocabulary lacks; a
  // cancelled run reads as idle to the agent (nothing actionable remains).
  return phase === "cancelled" ? "idle" : phase;
}

export function projectWorkflowRunToAgentUiSnapshot(run: WorkflowRunState): AgentUiWorkflowSnapshot {
  const nodes = Object.values(run.nodeStates);
  const askNodes = nodes.filter((node) => node.type === "ask_user");
  const requiredAsk = askNodes.filter((node) => node.required);
  const answered = (list: typeof askNodes) => list.filter((node) => node.status === "committed");
  const unansweredRequiredIds = requiredAsk
    .filter((node) => node.status !== "committed" && node.status !== "skipped")
    .map((node) => node.question?.id ?? node.nodeId);
  const currentNode = run.currentNodeId ? run.nodeStates[run.currentNodeId] : undefined;
  const awaitingQuestionNode = currentNode?.type === "ask_user" && currentNode.status === "awaiting_input"
    ? currentNode
    : nodes.find((node) => node.type === "ask_user" && node.status === "awaiting_input");
  const previewNode = nodes.find((node) => node.type === "tool_preview" && node.status === "preview_ready" && node.preview);
  const visibleErrors = nodes
    .filter((node) => node.error)
    .map((node) => ({ code: node.error!.code, message: node.error!.message, ...(node.error!.field ? { field: node.error!.field } : {}) }));

  const terminal = run.phase === "committed" || run.phase === "cancelled";
  const disabledReasons: string[] = [];
  if (!terminal && run.approvalState.status !== "approved" && nodes.some((node) => node.type === "tool_commit" && node.status !== "committed" && node.status !== "skipped")) {
    disabledReasons.push("approval_required");
  }
  if (unansweredRequiredIds.length > 0) disabledReasons.push("required_questions_unanswered");

  return {
    activeWorkflowId: terminal ? null : run.workflowId,
    activeArtifactId: run.artifactId,
    phase: toSnapshotPhase(run.phase),
    currentQuestion: awaitingQuestionNode?.question ?? null,
    answeredCount: answered(askNodes).length,
    requiredCount: requiredAsk.length,
    unansweredRequiredIds,
    visibleErrors,
    canSubmitAnswer: Boolean(awaitingQuestionNode) && !terminal,
    canRequestApproval: Boolean(previewNode) && run.approvalState.status === "none" && unansweredRequiredIds.length === 0 && !terminal,
    // "can approve" is a statement about the HOST surface (the Review card),
    // never a model affordance — approval stays a host-signed action.
    canApproveAndRun: run.approvalState.status === "requested" && !terminal,
    disabledReasons,
    commandPreview: previewNode?.preview
      ? {
          commandId: previewNode.preview.commandId,
          stableInputHash: previewNode.preview.stableInputHash,
          effect: previewNode.preview.effect === "read" || previewNode.preview.effect === "write" || previewNode.preview.effect === "destructive"
            ? previewNode.preview.effect
            : "write",
          approvalRequired: previewNode.preview.approvalRequired,
        }
      : null,
  };
}
