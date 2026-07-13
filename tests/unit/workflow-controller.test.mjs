import assert from "node:assert/strict";
import { workflowDefinitionSchema } from "../../packages/tool-contracts/dist/marketplace.js";
import { applyWorkflowRunEvent } from "../../packages/tool-contracts/dist/workflow-run-state.js";
import { nextNodeIds, runWorkflowNode, startControllerRun } from "../../packages/tool-contracts/dist/workflow-controller.js";

// Phase 3a of the consensus plan (.omc/plans/workflow-state-machine-consensus-2026-07-10.md):
// workflow-controller.ts is the one generic graph walker over workflowDefinitionSchema +
// WorkflowRunState, with node execution injected per nodeId. Mocked callbacks here (no real I/O) --
// the reservation-specific integration proof lives in reservation-workflow-controller-integration.test.mjs.

const definition = workflowDefinitionSchema.parse({
  workflowId: "fixture.compound.commit",
  title: "Fixture compound commit workflow",
  nodes: [
    { nodeId: "trigger", type: "trigger", title: "Start" },
    { nodeId: "preview", type: "tool_preview", title: "Preview", commandId: "fixture.create", effect: "none", approvalPolicy: "none" },
    { nodeId: "commit", type: "tool_commit", title: "Commit", commandId: "fixture.create", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId"] },
  ],
  edges: [
    { edgeId: "e1", from: "trigger", to: "preview" },
    { edgeId: "e2", from: "preview", to: "commit" },
  ],
  facadeToolIds: ["fixture.create"],
  version: "0.1.0",
});

function freshRun() {
  return startControllerRun(definition, { runId: "run-fixture-1", workflowVersionId: "fixture.compound.commit@0.1.0" });
}

// nextNodeIds is a one-line edge lookup -- proves trigger -> preview -> commit is the graph shape.
assert.deepEqual(nextNodeIds(definition, "trigger"), ["preview"]);
assert.deepEqual(nextNodeIds(definition, "preview"), ["commit"]);
assert.deepEqual(nextNodeIds(definition, "commit"), []);

// Facade-size constraint: the schema itself caps facadeToolIds at 5, and the run copies it verbatim
// at start, so a run's pinned facade can never exceed the audit's <=5 tool ceiling.
{
  const run = freshRun();
  assert.deepEqual(run.facadeToolIds, ["fixture.create"]);
  assert.ok(run.facadeToolIds.length <= 5);
  assert.throws(
    () => workflowDefinitionSchema.parse({ ...definition, facadeToolIds: ["a", "b", "c", "d", "e", "f"] }),
    /too_big|max/i,
    "a 6-tool facade must be rejected at the schema layer",
  );
}

// Approval-gate refusal: a tool_commit node attempted before approval refuses, and -- critically --
// never invokes the injected write callback at all (structural refusal, not merely reducer-checked).
{
  let commitCalls = 0;
  const run = await advanceThroughPreview(freshRun());
  const result = await runWorkflowNode(run, definition, "commit", {
    commit: () => {
      commitCalls += 1;
      return { kind: "commit", ok: true, receiptRef: "should-not-run" };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "approval_required");
  assert.equal(commitCalls, 0, "the commit callback must never fire before a host-signed approval");
}

// Pinned run identity: runId/workflowId/workflowVersionId/facadeToolIds must not drift across the
// full preview -> approval -> commit sequence.
{
  let commitCalls = 0;
  const initial = freshRun();
  const identity = { runId: initial.runId, workflowId: initial.workflowId, workflowVersionId: initial.workflowVersionId, facadeToolIds: initial.facadeToolIds };

  let run = await advanceThroughPreview(initial);
  const requested = applyWorkflowRunEvent(run, { type: "request_approval", nodeId: "commit" });
  assert.equal(requested.ok, true);
  const approved = applyWorkflowRunEvent(requested.state, { type: "approve", hostSigned: true });
  assert.equal(approved.ok, true, "a host-signed approval is accepted");
  run = approved.state;

  // The compound commit node fires exactly ONE approval interaction for both underlying writes --
  // modeled here by a callback that reports two receipts but is invoked exactly once.
  const committed = await runWorkflowNode(run, definition, "commit", {
    commit: () => {
      commitCalls += 1;
      return { kind: "commit", ok: true, receiptRef: "writes:guest+booking" };
    },
  });
  assert.equal(committed.ok, true);
  assert.equal(committed.state.nodeStates.commit.status, "committed");
  assert.equal(commitCalls, 1, "the compound commit callback fires exactly once for both writes");
  assert.equal(committed.state.phase, "committed");

  assert.deepEqual(
    { runId: committed.state.runId, workflowId: committed.state.workflowId, workflowVersionId: committed.state.workflowVersionId, facadeToolIds: committed.state.facadeToolIds },
    identity,
    "run identity must not change across the run's lifetime",
  );
}

// A mutating effect can never smuggle past the commit gate under a preview node:
// rejected at the schema layer, and refused by the controller even if a
// definition somehow carried the shape anyway.
{
  const sneakyNodes = [
    { nodeId: "sneak", type: "tool_preview", title: "Sneaky write", commandId: "fixture.create", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId"] },
  ];
  assert.equal(
    workflowDefinitionSchema.safeParse({ workflowId: "sneaky.workflow", title: "Sneaky", version: "0.1.0", nodes: sneakyNodes }).success,
    false,
    "schema rejects tool_preview nodes with mutating effect",
  );

  const sneakyDefinition = {
    workflowId: "sneaky.workflow",
    title: "Sneaky",
    version: "0.1.0",
    triggerPhrases: [],
    facadeToolIds: [],
    requiredSkills: [],
    requiredCommands: [],
    edges: [],
    nodes: sneakyNodes,
  };
  const run = startControllerRun(sneakyDefinition, { runId: "run-sneak", workflowVersionId: "sneaky.workflow@0.1.0" });
  let callbackFired = false;
  const refused = await runWorkflowNode(run, sneakyDefinition, "sneak", {
    sneak: () => {
      callbackFired = true;
      return { kind: "preview", ok: true, preview: { commandId: "fixture.create", stableInputHash: "h", effect: "write", approvalRequired: true } };
    },
  });
  assert.deepEqual({ ok: refused.ok, reason: refused.reason }, { ok: false, reason: "mutating_effect_requires_tool_commit_node" });
  assert.equal(callbackFired, false, "the mutating callback never fires outside the commit gate");
}

async function advanceThroughPreview(run) {
  const result = await runWorkflowNode(run, definition, "preview", {
    preview: () => ({ kind: "preview", ok: true, preview: { commandId: "fixture.create", stableInputHash: "hash-1", effect: "write", approvalRequired: true } }),
  });
  assert.equal(result.ok, true);
  return result.state;
}

console.log("workflow-controller.test.mjs passed");
