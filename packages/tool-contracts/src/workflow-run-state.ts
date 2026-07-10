// Workflow run state contract — the single authoritative state machine for a
// workflow run (consensus plan .omc/plans/workflow-state-machine-consensus-2026-07-10.md,
// Phase 1). One interpreter walks workflowDefinitionSchema graphs; this module
// is that interpreter's state + pure reducer. No I/O — node execution is
// injected by the controller (Phase 3a), never performed here.
//
// Trust doctrine enforced structurally, not by convention:
// - approval is only ever host-signed; an approve event without the
//   host-signed marker is rejected (model_supplied_approval_is_not_trusted);
// - a commit transition is rejected unless the run's approval state is
//   approved (chat text is never approval);
// - the run's terminal "committed" phase requires a semantic-success receipt
//   (success copy derives from receipts, never transport status).

import { z } from "zod";
import type { AgentUiWorkflowPhase } from "@sonik-agent-ui/agent-observability";
import { marketplaceCommandEffectSchema, packageVersionIdSchema, workflowNodeTypeSchema } from "./marketplace.js";

export const WORKFLOW_RUN_PHASES = [
  "idle",
  "intake",
  "saving",
  "preview_ready",
  "approval_requested",
  "approved",
  "committing",
  "committed",
  "error",
  "cancelled",
] as const satisfies readonly (AgentUiWorkflowPhase | "cancelled")[];
export const workflowRunPhaseSchema = z.enum(WORKFLOW_RUN_PHASES);
export type WorkflowRunPhase = z.infer<typeof workflowRunPhaseSchema>;

export const workflowNodeRunStatusSchema = z.enum([
  "pending",
  "active",
  "awaiting_input",
  "preview_ready",
  "approval_requested",
  "approved",
  "committing",
  "committed",
  "error",
  "skipped",
]);
export type WorkflowNodeRunStatus = z.infer<typeof workflowNodeRunStatusSchema>;

export const workflowRunQuestionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  required: z.boolean().default(true),
  answerType: z.string().min(1),
  choices: z.array(z.object({
    value: z.union([z.string(), z.number(), z.boolean()]),
    label: z.string().min(1),
    disabled: z.boolean().optional(),
  }).strict()).optional(),
}).strict();
export type WorkflowRunQuestion = z.infer<typeof workflowRunQuestionSchema>;

export const workflowRunCommandPreviewSchema = z.object({
  commandId: z.string().min(1),
  stableInputHash: z.string().min(1),
  effect: marketplaceCommandEffectSchema,
  approvalRequired: z.boolean(),
}).strict();
export type WorkflowRunCommandPreview = z.infer<typeof workflowRunCommandPreviewSchema>;

export const workflowNodeRunErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  field: z.string().optional(),
}).strict();

export const workflowNodeRunStateSchema = z.object({
  nodeId: z.string().min(1),
  type: workflowNodeTypeSchema,
  status: workflowNodeRunStatusSchema,
  commandId: z.string().optional(),
  effect: marketplaceCommandEffectSchema.default("none"),
  /** ask_user nodes only: whether this question counts toward requiredCount. */
  required: z.boolean().default(false),
  question: workflowRunQuestionSchema.optional(),
  preview: workflowRunCommandPreviewSchema.optional(),
  error: workflowNodeRunErrorSchema.optional(),
}).strict();
export type WorkflowNodeRunState = z.infer<typeof workflowNodeRunStateSchema>;

// status "approved" without the host-signed marker is structurally invalid —
// the schema itself refuses to represent a model-granted approval.
export const workflowRunApprovalStateSchema = z.object({
  status: z.enum(["none", "requested", "approved", "rejected"]),
  hostSigned: z.boolean().default(false),
  approvedCommandIds: z.array(z.string()).default([]),
}).strict().superRefine((approval, ctx) => {
  if (approval.status === "approved" && !approval.hostSigned) {
    ctx.addIssue({ code: "custom", path: ["hostSigned"], message: "model_supplied_approval_is_not_trusted" });
  }
});
export type WorkflowRunApprovalState = z.infer<typeof workflowRunApprovalStateSchema>;

export const workflowRunReceiptSchema = z.object({
  nodeId: z.string().min(1),
  commandId: z.string().optional(),
  receiptRef: z.string().optional(),
  semanticStatus: z.enum(["success", "failure"]),
}).strict();
export type WorkflowRunReceipt = z.infer<typeof workflowRunReceiptSchema>;

export const workflowRunStateSchema = z.object({
  runId: z.string().min(1),
  workflowId: z.string().min(1),
  /** The packageVersionId this run executes, frozen at start (D002/D014). */
  workflowVersionId: packageVersionIdSchema,
  artifactId: z.string().nullable().default(null),
  phase: workflowRunPhaseSchema,
  currentNodeId: z.string().nullable().default(null),
  /** Model-facing toolset pinned at start; never changes mid-run. */
  facadeToolIds: z.array(z.string()).max(5).default([]),
  nodeStates: z.record(z.string(), workflowNodeRunStateSchema),
  approvalState: workflowRunApprovalStateSchema,
  receipts: z.array(workflowRunReceiptSchema).default([]),
}).strict();
export type WorkflowRunState = z.infer<typeof workflowRunStateSchema>;

export type WorkflowRunEvent =
  | {
      type: "start";
      runId: string;
      workflowId: string;
      workflowVersionId: string;
      artifactId?: string | null;
      facadeToolIds?: string[];
      nodes: Array<{ nodeId: string; type: WorkflowNodeRunState["type"]; commandId?: string; effect?: WorkflowNodeRunState["effect"]; required?: boolean; question?: WorkflowRunQuestion }>;
      entryNodeId?: string;
    }
  | { type: "node_active"; nodeId: string }
  | { type: "answer"; nodeId: string }
  | { type: "preview_ready"; nodeId: string; preview: WorkflowRunCommandPreview }
  | { type: "request_approval"; nodeId: string }
  | { type: "approve"; hostSigned: boolean; approvedCommandIds?: string[] }
  | { type: "commit_started"; nodeId: string }
  | { type: "commit_result"; nodeId: string; receipt: Omit<WorkflowRunReceipt, "nodeId"> }
  | { type: "node_error"; nodeId: string; error: z.infer<typeof workflowNodeRunErrorSchema> }
  | { type: "cancel" };

export type WorkflowRunTransitionResult =
  | { ok: true; state: WorkflowRunState }
  | { ok: false; reason: string; state: WorkflowRunState };

const TERMINAL_PHASES: ReadonlySet<WorkflowRunPhase> = new Set(["committed", "cancelled"]);

function reject(state: WorkflowRunState, reason: string): WorkflowRunTransitionResult {
  return { ok: false, reason, state };
}

function withNode(state: WorkflowRunState, nodeId: string, patch: Partial<WorkflowNodeRunState>): WorkflowRunState {
  const node = state.nodeStates[nodeId];
  if (!node) throw new Error(`unknown nodeId ${nodeId}`);
  return { ...state, nodeStates: { ...state.nodeStates, [nodeId]: { ...node, ...patch } } };
}

export function startWorkflowRun(event: Extract<WorkflowRunEvent, { type: "start" }>): WorkflowRunState {
  const nodeStates: Record<string, WorkflowNodeRunState> = {};
  for (const node of event.nodes) {
    nodeStates[node.nodeId] = workflowNodeRunStateSchema.parse({
      nodeId: node.nodeId,
      type: node.type,
      status: "pending",
      commandId: node.commandId,
      effect: node.effect ?? "none",
      required: node.required ?? false,
      question: node.question,
    });
  }
  const entryNodeId = event.entryNodeId ?? event.nodes[0]?.nodeId ?? null;
  let state = workflowRunStateSchema.parse({
    runId: event.runId,
    workflowId: event.workflowId,
    workflowVersionId: event.workflowVersionId,
    artifactId: event.artifactId ?? null,
    phase: "intake",
    currentNodeId: entryNodeId,
    facadeToolIds: event.facadeToolIds ?? [],
    nodeStates,
    approvalState: { status: "none", hostSigned: false, approvedCommandIds: [] },
    receipts: [],
  });
  if (entryNodeId) {
    const entry = state.nodeStates[entryNodeId];
    state = withNode(state, entryNodeId, { status: entry?.type === "ask_user" ? "awaiting_input" : "active" });
  }
  return state;
}

/**
 * Pure reducer. Rejections return { ok: false, reason } with the state
 * unchanged rather than throwing, so a bad event can never corrupt a run.
 */
export function applyWorkflowRunEvent(state: WorkflowRunState, event: WorkflowRunEvent): WorkflowRunTransitionResult {
  if (event.type === "start") return reject(state, "run_already_started");
  if (TERMINAL_PHASES.has(state.phase)) return reject(state, "run_is_terminal");

  switch (event.type) {
    case "node_active": {
      const node = state.nodeStates[event.nodeId];
      if (!node) return reject(state, "unknown_node");
      const next = withNode(state, event.nodeId, { status: node.type === "ask_user" ? "awaiting_input" : "active" });
      return { ok: true, state: { ...next, currentNodeId: event.nodeId } };
    }
    case "answer": {
      const node = state.nodeStates[event.nodeId];
      if (!node) return reject(state, "unknown_node");
      if (node.type !== "ask_user") return reject(state, "answer_requires_ask_user_node");
      if (node.status !== "awaiting_input" && node.status !== "active") return reject(state, "node_not_awaiting_input");
      return { ok: true, state: withNode(state, event.nodeId, { status: "committed" }) };
    }
    case "preview_ready": {
      const node = state.nodeStates[event.nodeId];
      if (!node) return reject(state, "unknown_node");
      if (node.type !== "tool_preview") return reject(state, "preview_requires_tool_preview_node");
      const next = withNode(state, event.nodeId, { status: "preview_ready", preview: event.preview });
      return { ok: true, state: { ...next, phase: "preview_ready", currentNodeId: event.nodeId } };
    }
    case "request_approval": {
      const node = state.nodeStates[event.nodeId];
      if (!node) return reject(state, "unknown_node");
      const next = withNode(state, event.nodeId, { status: "approval_requested" });
      return {
        ok: true,
        state: { ...next, phase: "approval_requested", approvalState: { ...state.approvalState, status: "requested" } },
      };
    }
    case "approve": {
      // Chat text / model output is never approval. Only a host-signed
      // approval event can move the run to approved.
      if (!event.hostSigned) return reject(state, "model_supplied_approval_is_not_trusted");
      if (state.approvalState.status !== "requested") return reject(state, "approval_not_requested");
      return {
        ok: true,
        state: {
          ...state,
          phase: "approved",
          approvalState: { status: "approved", hostSigned: true, approvedCommandIds: event.approvedCommandIds ?? [] },
        },
      };
    }
    case "commit_started": {
      const node = state.nodeStates[event.nodeId];
      if (!node) return reject(state, "unknown_node");
      if (node.type !== "tool_commit") return reject(state, "commit_requires_tool_commit_node");
      if (state.approvalState.status !== "approved" || !state.approvalState.hostSigned) {
        return reject(state, "approval_required");
      }
      const next = withNode(state, event.nodeId, { status: "committing" });
      return { ok: true, state: { ...next, phase: "committing", currentNodeId: event.nodeId } };
    }
    case "commit_result": {
      const node = state.nodeStates[event.nodeId];
      if (!node) return reject(state, "unknown_node");
      if (node.status !== "committing") return reject(state, "commit_not_started");
      const receipt = workflowRunReceiptSchema.parse({ ...event.receipt, nodeId: event.nodeId });
      const succeeded = receipt.semanticStatus === "success";
      const next = withNode(state, event.nodeId, {
        status: succeeded ? "committed" : "error",
        ...(succeeded ? {} : { error: { code: "commit_failed", message: "Commit reported semantic failure" } }),
      });
      // Phase "committed" only on a semantic-success receipt — never on
      // transport success alone.
      return {
        ok: true,
        state: { ...next, phase: succeeded ? "committed" : "error", receipts: [...state.receipts, receipt] },
      };
    }
    case "node_error": {
      if (!state.nodeStates[event.nodeId]) return reject(state, "unknown_node");
      const next = withNode(state, event.nodeId, { status: "error", error: event.error });
      return { ok: true, state: { ...next, phase: "error" } };
    }
    case "cancel": {
      const nodeStates = Object.fromEntries(
        Object.entries(state.nodeStates).map(([nodeId, node]) => [
          nodeId,
          node.status === "committed" || node.status === "error" ? node : { ...node, status: "skipped" as const },
        ]),
      );
      return { ok: true, state: { ...state, phase: "cancelled", nodeStates, currentNodeId: null } };
    }
    default:
      return reject(state, "unknown_event");
  }
}
