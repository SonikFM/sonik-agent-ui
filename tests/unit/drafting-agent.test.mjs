import assert from "node:assert/strict";
import {
  EXAMPLE_DRAFTED_WORKFLOW,
  LIVE_WORKFLOW_NODE_TYPES,
  validateDraftedWorkflow,
} from "../../apps/standalone-sveltekit/src/lib/agent-workflows/drafting-agent.ts";

// Phase 6 (agent-creation-tool-plan-2026-07-13.md): the drafting agent's validation gate.
// validateDraftedWorkflow is stricter than workflowDefinitionSchema alone -- it also rejects
// controller-unsupported node types (Decision 2 / risk 3) and requires the graph shape the
// controller can actually run. Validation only; no model calls here.

assert.deepEqual(LIVE_WORKFLOW_NODE_TYPES, ["trigger", "ask_user", "tool_preview", "approval", "tool_commit"]);

function linearWorkflow(overrides = {}) {
  return {
    workflowId: "fixture.draft.linear",
    title: "Fixture linear draft",
    nodes: [
      { nodeId: "trigger", type: "trigger", title: "Start" },
      { nodeId: "preview", type: "tool_preview", title: "Preview", commandId: "fixture.command", effect: "read", approvalPolicy: "none" },
      { nodeId: "confirm", type: "approval", title: "Approve" },
      { nodeId: "commit", type: "tool_commit", title: "Commit", commandId: "fixture.command", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId"] },
    ],
    edges: [
      { edgeId: "e1", from: "trigger", to: "preview" },
      { edgeId: "e2", from: "preview", to: "confirm" },
      { edgeId: "e3", from: "confirm", to: "commit" },
    ],
    facadeToolIds: ["fixture.command"],
    version: "0.1.0",
    ...overrides,
  };
}

// A valid 5-type linear workflow passes.
{
  const result = validateDraftedWorkflow(linearWorkflow());
  assert.equal(result.ok, true, "valid linear draft must pass");
  assert.equal(result.workflow.workflowId, "fixture.draft.linear");
}

// The canonical example used in the model prompt is itself valid under this gate.
{
  const result = validateDraftedWorkflow(EXAMPLE_DRAFTED_WORKFLOW);
  assert.equal(result.ok, true, "the canonical prompt example must pass its own gate");
}

// A draft using `branch` (schema-valid, controller-unsupported) is rejected, naming branch.
{
  const draft = linearWorkflow({
    nodes: [
      { nodeId: "trigger", type: "trigger", title: "Start" },
      { nodeId: "split", type: "branch", title: "Branch" },
      { nodeId: "preview", type: "tool_preview", title: "Preview", commandId: "fixture.command", effect: "read", approvalPolicy: "none" },
      { nodeId: "confirm", type: "approval", title: "Approve" },
      { nodeId: "commit", type: "tool_commit", title: "Commit", commandId: "fixture.command", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId"] },
    ],
    edges: [
      { edgeId: "e1", from: "trigger", to: "split" },
      { edgeId: "e2", from: "split", to: "preview" },
      { edgeId: "e3", from: "preview", to: "confirm" },
      { edgeId: "e4", from: "confirm", to: "commit" },
    ],
  });
  const result = validateDraftedWorkflow(draft);
  assert.equal(result.ok, false, "a draft using branch must be rejected");
  assert.ok(result.reasons.some((reason) => reason.includes('"branch"')), `expected a reason naming branch, got: ${result.reasons.join(" | ")}`);
}

// A draft using `artifact` is rejected likewise.
{
  const draft = linearWorkflow({
    nodes: [
      { nodeId: "trigger", type: "trigger", title: "Start" },
      { nodeId: "receipt", type: "artifact", title: "Receipt artifact" },
      { nodeId: "preview", type: "tool_preview", title: "Preview", commandId: "fixture.command", effect: "read", approvalPolicy: "none" },
      { nodeId: "confirm", type: "approval", title: "Approve" },
      { nodeId: "commit", type: "tool_commit", title: "Commit", commandId: "fixture.command", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId"] },
    ],
    edges: [
      { edgeId: "e1", from: "trigger", to: "receipt" },
      { edgeId: "e2", from: "receipt", to: "preview" },
      { edgeId: "e3", from: "preview", to: "confirm" },
      { edgeId: "e4", from: "confirm", to: "commit" },
    ],
  });
  const result = validateDraftedWorkflow(draft);
  assert.equal(result.ok, false, "a draft using artifact must be rejected");
  assert.ok(result.reasons.some((reason) => reason.includes('"artifact"')), `expected a reason naming artifact, got: ${result.reasons.join(" | ")}`);
}

// Malformed JSON (not a workflow shape at all) is rejected via the schema layer.
{
  assert.equal(validateDraftedWorkflow("not a workflow").ok, false, "a non-object value must be rejected");
  assert.equal(validateDraftedWorkflow(null).ok, false, "null must be rejected");
  assert.equal(validateDraftedWorkflow({ nodes: "oops" }).ok, false, "a malformed shape must be rejected");
}

// An edge referencing a missing node is rejected.
{
  const draft = linearWorkflow({
    edges: [
      { edgeId: "e1", from: "trigger", to: "preview" },
      { edgeId: "e2", from: "preview", to: "confirm" },
      { edgeId: "e3", from: "confirm", to: "commit" },
      { edgeId: "e4", from: "commit", to: "nonexistent_node" },
    ],
  });
  const result = validateDraftedWorkflow(draft);
  assert.equal(result.ok, false, "an edge to a missing node must be rejected");
  assert.ok(result.reasons.some((reason) => reason.includes("existing nodeId")), `expected a reason about edge target, got: ${result.reasons.join(" | ")}`);
}

// A tool_commit with no preceding approval node is rejected.
{
  const draft = linearWorkflow({
    nodes: [
      { nodeId: "trigger", type: "trigger", title: "Start" },
      { nodeId: "preview", type: "tool_preview", title: "Preview", commandId: "fixture.command", effect: "read", approvalPolicy: "none" },
      { nodeId: "commit", type: "tool_commit", title: "Commit", commandId: "fixture.command", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId"] },
    ],
    edges: [
      { edgeId: "e1", from: "trigger", to: "preview" },
      { edgeId: "e2", from: "preview", to: "commit" },
    ],
  });
  const result = validateDraftedWorkflow(draft);
  assert.equal(result.ok, false, "a tool_commit with no preceding approval node must be rejected");
  assert.ok(result.reasons.some((reason) => reason.includes("no approval node preceding")), `expected a no-approval reason, got: ${result.reasons.join(" | ")}`);
}

console.log("drafting-agent.test.mjs passed");
