// Phase 6 (agent-creation-tool-plan-2026-07-13.md): draft-from-description support layer.
// Given a plain-language outcome, a drafting model should produce a workflowDefinitionSchema
// -valid graph constrained to the 5 node types the controller (workflow-controller.ts
// runWorkflowNode) actually executes. The schema itself also allows
// skill/artifact/remote_execution/evidence/branch for other marketplace surfaces (parse-only
// there); Decision 2 keeps those out of drafted workflows, so this module is the gate that
// rejects them -- loud, never a silently-rendered invalid draft.
//
// Pure and dependency-free (no "ai"/"ai-gateway" imports) so it unit-tests without a
// SvelteKit runtime, mirroring artifacts/json-artifact-spec.ts vs. tools/artifact.ts. The
// model-calling tool wrapper lives in tools/drafting-agent.ts.

import {
  workflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowNodeDefinition,
  type WorkflowNodeType,
} from "@sonik-agent-ui/tool-contracts/marketplace";

/** The only node types the controller runs (runWorkflowNode's switch). Everything else in
 *  workflowNodeTypeSchema is schema-valid but controller-unsupported. */
export const LIVE_WORKFLOW_NODE_TYPES: readonly WorkflowNodeType[] = ["trigger", "ask_user", "tool_preview", "approval", "tool_commit"];
const liveNodeTypeSet = new Set<WorkflowNodeType>(LIVE_WORKFLOW_NODE_TYPES);

export type DraftValidationResult =
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; reasons: string[] };

/**
 * Validates an unknown value as a drafted workflow: schema-valid AND restricted to the 5
 * live node types AND shaped so the controller can actually run it (a trigger exists; every
 * tool_commit is preceded on its graph path by an approval node -- the explicit human
 * checkpoint the builder canvas renders, distinct from the legacy reservation fixture which
 * predates this drafting gate and encodes approval only via tool_commit's approvalPolicy).
 */
export function validateDraftedWorkflow(json: unknown): DraftValidationResult {
  const parsed = workflowDefinitionSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reasons: parsed.error.issues.map((issue) => `${issue.path.join(".") || "workflow"}: ${issue.message}`) };
  }
  const workflow = parsed.data;
  const reasons: string[] = [];

  for (const node of workflow.nodes) {
    if (!liveNodeTypeSet.has(node.type)) {
      reasons.push(`Node "${node.nodeId}" uses type "${node.type}", which the controller does not execute. Allowed types: ${LIVE_WORKFLOW_NODE_TYPES.join(", ")}.`);
    }
  }

  if (!workflow.nodes.some((node) => node.type === "trigger")) {
    reasons.push("Workflow has no trigger node.");
  }

  // ponytail: ancestor walk over the edge graph, mirroring nextNodeIds' forward lookup
  // (workflow-controller.ts) just reversed. Decision 2 scopes drafts to linear graphs, so a
  // plain reverse-adjacency walk covers it; upgrade to full path enumeration if drafts start
  // branching multiple approval paths into one commit.
  const parentsOf = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    const parents = parentsOf.get(edge.to) ?? [];
    parents.push(edge.from);
    parentsOf.set(edge.to, parents);
  }
  const nodeById = new Map(workflow.nodes.map((node) => [node.nodeId, node] as const));
  for (const node of workflow.nodes) {
    if (node.type !== "tool_commit") continue;
    if (!hasApprovalAncestor(node.nodeId, parentsOf, nodeById)) {
      reasons.push(`tool_commit node "${node.nodeId}" has no approval node preceding it in the graph.`);
    }
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true, workflow };
}

function hasApprovalAncestor(
  nodeId: string,
  parentsOf: Map<string, string[]>,
  nodeById: Map<string, WorkflowNodeDefinition>,
  seen: Set<string> = new Set(),
): boolean {
  if (seen.has(nodeId)) return false;
  seen.add(nodeId);
  for (const parentId of parentsOf.get(nodeId) ?? []) {
    if (nodeById.get(parentId)?.type === "approval") return true;
    if (hasApprovalAncestor(parentId, parentsOf, nodeById, seen)) return true;
  }
  return false;
}

// Canonical example for the model prompt: same preview -> approve -> commit shape as the
// shipped booking reservation workflow (marketplace-fixtures.ts), with an explicit approval
// node added since drafts (unlike that legacy fixture) must graph the checkpoint.
export const EXAMPLE_DRAFTED_WORKFLOW: WorkflowDefinition = workflowDefinitionSchema.parse({
  workflowId: "example.preview_approve_commit",
  title: "Example: preview, then approve, then commit",
  nodes: [
    { nodeId: "trigger", type: "trigger", title: "Start" },
    { nodeId: "preview", type: "tool_preview", title: "Preview the change", commandId: "example.command", effect: "read", approvalPolicy: "none" },
    { nodeId: "confirm", type: "approval", title: "Human approval" },
    { nodeId: "commit", type: "tool_commit", title: "Apply the change", commandId: "example.command", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] },
  ],
  edges: [
    { edgeId: "e1", from: "trigger", to: "preview" },
    { edgeId: "e2", from: "preview", to: "confirm" },
    { edgeId: "e3", from: "confirm", to: "commit" },
  ],
  facadeToolIds: ["example.command"],
  version: "0.1.0",
});

export const DRAFT_WORKFLOW_INSTRUCTIONS = [
  "Draft a workflowDefinitionSchema-valid workflow graph (JSON) for the described outcome.",
  `Use ONLY these node types: ${LIVE_WORKFLOW_NODE_TYPES.join(", ")}. Any other type (skill, artifact, remote_execution, evidence, branch) will be rejected.`,
  "Every tool_commit node must be preceded in the graph by an approval node. A tool_commit's commandId must match a tool_preview node with the same commandId.",
  "Keep the graph linear: no branching.",
  "Canonical example:",
  JSON.stringify(EXAMPLE_DRAFTED_WORKFLOW, null, 2),
  "Respond with ONLY the JSON workflow definition -- no prose, no code fences.",
].join("\n\n");

export function buildDraftWorkflowPrompt(outcomeDescription: string, constraints?: string[]): string {
  const constraintLines = constraints?.length ? `\n\nAdditional constraints:\n${constraints.map((entry) => `- ${entry}`).join("\n")}` : "";
  return `${DRAFT_WORKFLOW_INSTRUCTIONS}\n\nOutcome to draft a workflow for: ${outcomeDescription}${constraintLines}`;
}

/** Best-effort JSON extraction from a model's text response (strips a code fence if present). */
export function extractDraftedWorkflowJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}
