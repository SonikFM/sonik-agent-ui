// Workflow controller (consensus plan .omc/plans/workflow-state-machine-consensus-2026-07-10.md,
// Phase 3a): the one interpreter that walks a workflowDefinitionSchema graph, driving Phase 1's
// startWorkflowRun/applyWorkflowRunEvent reducer. Node execution is injected per nodeId — this
// module performs no I/O of its own; it only decides WHEN a node's callback may run and applies
// the resulting transition.
//
// Trust doctrine, enforced structurally: a tool_commit node's callback is never invoked unless the
// run's approval is already { status: "approved", hostSigned: true } — checked before the callback
// runs, not only relied on via the reducer's own commit_started refusal.
//
// ponytail: no automatic edge/branch traversal here (that's Phase 3b's multi-approval-node work);
// callers step through nodes explicitly via runWorkflowNode, in the order their graph implies.

import type { WorkflowDefinition, WorkflowNodeDefinition } from "./marketplace.js";
import {
  applyWorkflowRunEvent,
  startWorkflowRun,
  type WorkflowRunCommandPreview,
  type WorkflowRunState,
  type WorkflowRunTransitionResult,
} from "./workflow-run-state.js";

export type WorkflowControllerNodeResult =
  | { kind: "preview"; ok: true; preview: WorkflowRunCommandPreview }
  | { kind: "preview"; ok: false; error: { code: string; message: string } }
  | { kind: "commit"; ok: true; receiptRef?: string }
  | { kind: "commit"; ok: false; error: { code: string; message: string } };

export type WorkflowControllerCallback = (
  run: WorkflowRunState,
  node: WorkflowNodeDefinition,
) => Promise<WorkflowControllerNodeResult> | WorkflowControllerNodeResult;

/** Callbacks keyed by nodeId — distinct tool_preview nodes (e.g. availability vs. reservation
 *  preview) need distinct behavior, so type-only keying would be ambiguous. */
export type WorkflowControllerCallbacks = Record<string, WorkflowControllerCallback>;

export function startControllerRun(
  definition: WorkflowDefinition,
  init: { runId: string; workflowVersionId: string; artifactId?: string | null },
): WorkflowRunState {
  return startWorkflowRun({
    type: "start",
    runId: init.runId,
    workflowId: definition.workflowId,
    workflowVersionId: init.workflowVersionId,
    artifactId: init.artifactId ?? null,
    facadeToolIds: definition.facadeToolIds,
    nodes: definition.nodes.map((node) => ({
      nodeId: node.nodeId,
      type: node.type,
      commandId: node.commandId,
      effect: node.effect,
    })),
    entryNodeId: definition.nodes[0]?.nodeId,
  });
}

/** Edge successors of a node — a one-line lookup, not a full graph walk (Phase 3b territory). */
export function nextNodeIds(definition: WorkflowDefinition, nodeId: string): string[] {
  return definition.edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to);
}

export async function runWorkflowNode(
  run: WorkflowRunState,
  definition: WorkflowDefinition,
  nodeId: string,
  callbacks: WorkflowControllerCallbacks,
): Promise<WorkflowRunTransitionResult> {
  const node = definition.nodes.find((entry) => entry.nodeId === nodeId);
  if (!node) return { ok: false, reason: "unknown_node", state: run };

  // Defense in depth alongside the schema's tool_preview/effect refine: a
  // mutating effect only ever executes through the tool_commit gate below,
  // regardless of what type the definition claims.
  const mutating = node.effect === "write" || node.effect === "destructive" || node.effect === "external";
  if (mutating && node.type !== "tool_commit") {
    return { ok: false, reason: "mutating_effect_requires_tool_commit_node", state: run };
  }

  if (node.type === "tool_preview") {
    const callback = callbacks[nodeId];
    if (!callback) return { ok: false, reason: "no_callback_registered", state: run };
    const result = await callback(run, node);
    if (result.kind !== "preview") return { ok: false, reason: "callback_kind_mismatch", state: run };
    if (!result.ok) return applyWorkflowRunEvent(run, { type: "node_error", nodeId, error: result.error });
    return applyWorkflowRunEvent(run, { type: "preview_ready", nodeId, preview: result.preview });
  }

  if (node.type === "tool_commit") {
    // Structural refusal (D005/D006): the injected write callback is never called unless the run
    // is already host-signed approved. Checked here, before the callback runs — not left to the
    // reducer's own (also-present) commit_started refusal, so a write side effect can never fire
    // on an unapproved run even if a future caller skips the reducer transition.
    if (run.approvalState.status !== "approved" || !run.approvalState.hostSigned) {
      return { ok: false, reason: "approval_required", state: run };
    }
    const started = applyWorkflowRunEvent(run, { type: "commit_started", nodeId });
    if (!started.ok) return started;
    const callback = callbacks[nodeId];
    if (!callback) return { ok: false, reason: "no_callback_registered", state: started.state };
    const result = await callback(started.state, node);
    if (result.kind !== "commit") return { ok: false, reason: "callback_kind_mismatch", state: started.state };
    return applyWorkflowRunEvent(started.state, {
      type: "commit_result",
      nodeId,
      receipt: {
        commandId: node.commandId,
        receiptRef: result.ok ? result.receiptRef : undefined,
        semanticStatus: result.ok ? "success" : "failure",
      },
    });
  }

  return { ok: false, reason: "unsupported_node_type", state: run };
}
