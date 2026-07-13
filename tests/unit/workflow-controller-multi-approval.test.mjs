import assert from "node:assert/strict";
import { workflowDefinitionSchema } from "../../packages/tool-contracts/dist/marketplace.js";
import { applyWorkflowRunEvent } from "../../packages/tool-contracts/dist/workflow-run-state.js";
import { nextNodeIds, runWorkflowNode, startControllerRun } from "../../packages/tool-contracts/dist/workflow-controller.js";

// Phase 3b of the consensus plan (.omc/plans/workflow-state-machine-consensus-2026-07-10.md):
// proves the controller handles a run with TWO independently-gated tool_commit nodes in
// sequence -- something reservation (a single compound commit node, Phase 3a) never exercises.
// Fixture only, engine-coverage only: a two-step setup flow with genuine sequential human
// checkpoints (create a booking context, then separately approve publishing it). Not wired
// into any live UI and never added to packages/tool-contracts/src/marketplace-fixtures.ts --
// that file is production fixture surface, this is test-only.

const definition = workflowDefinitionSchema.parse({
  workflowId: "fixture.context.create_and_publish",
  title: "Fixture: create booking context, then separately approve publishing it",
  nodes: [
    { nodeId: "trigger", type: "trigger", title: "Start" },
    { nodeId: "context_preview", type: "tool_preview", title: "Preview context", commandId: "fixture.context.create", effect: "none", approvalPolicy: "none" },
    { nodeId: "context_commit", type: "tool_commit", title: "Create context", commandId: "fixture.context.create", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId"] },
    { nodeId: "publish_preview", type: "tool_preview", title: "Preview publish", commandId: "fixture.context.publish", effect: "none", approvalPolicy: "none" },
    { nodeId: "publish_commit", type: "tool_commit", title: "Publish context", commandId: "fixture.context.publish", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId"] },
  ],
  edges: [
    { edgeId: "e1", from: "trigger", to: "context_preview" },
    { edgeId: "e2", from: "context_preview", to: "context_commit" },
    { edgeId: "e3", from: "context_commit", to: "publish_preview" },
    { edgeId: "e4", from: "publish_preview", to: "publish_commit" },
  ],
  facadeToolIds: ["fixture.context.create", "fixture.context.publish"],
  version: "0.1.0",
});

assert.deepEqual(nextNodeIds(definition, "context_commit"), ["publish_preview"], "graph walks context_commit -> publish_preview, not straight to publish_commit");

function freshRun() {
  return startControllerRun(definition, { runId: "run-multi-approval-1", workflowVersionId: "fixture.context.create_and_publish@0.1.0" });
}

async function advanceThroughPreview(run, previewNodeId, commandId) {
  const result = await runWorkflowNode(run, definition, previewNodeId, {
    [previewNodeId]: () => ({ kind: "preview", ok: true, preview: { commandId, stableInputHash: `hash-${previewNodeId}`, effect: "write", approvalRequired: true } }),
  });
  assert.equal(result.ok, true, `${previewNodeId} preview must succeed`);
  return result.state;
}

function requestAndApprove(run, nodeId, commandId, hostSigned = true) {
  const requested = applyWorkflowRunEvent(run, { type: "request_approval", nodeId });
  assert.equal(requested.ok, true, `${nodeId} approval request must succeed`);
  return applyWorkflowRunEvent(requested.state, { type: "approve", hostSigned, approvedCommandIds: [commandId] });
}

// (d) A model-supplied (hostSigned: false) approval is rejected for either node.
{
  let run = freshRun();
  run = await advanceThroughPreview(run, "context_preview", "fixture.context.create");
  const modelApprove = requestAndApprove(run, "context_commit", "fixture.context.create", false);
  assert.deepEqual(
    { ok: modelApprove.ok, reason: modelApprove.reason },
    { ok: false, reason: "model_supplied_approval_is_not_trusted" },
    "model-supplied approval must be rejected for the first commit node",
  );

  // Same rejection shape reaches the second node's gate too -- the trust check
  // is not something only the first node in a run happens to hit.
  const hostApprovedContext = requestAndApprove(run, "context_commit", "fixture.context.create", true);
  assert.equal(hostApprovedContext.ok, true);
  let committedContext = await runWorkflowNode(hostApprovedContext.state, definition, "context_commit", {
    context_commit: () => ({ kind: "commit", ok: true, receiptRef: "receipts/context-created" }),
  });
  assert.equal(committedContext.ok, true);
  committedContext = { ...committedContext, state: await advanceThroughPreview(committedContext.state, "publish_preview", "fixture.context.publish") };
  const modelApprovePublish = requestAndApprove(committedContext.state, "publish_commit", "fixture.context.publish", false);
  assert.deepEqual(
    { ok: modelApprovePublish.ok, reason: modelApprovePublish.reason },
    { ok: false, reason: "model_supplied_approval_is_not_trusted" },
    "model-supplied approval must be rejected for the second commit node too",
  );
}

// (a) + (b): each commit node individually refuses without its own approval; approving node A
// never implicitly approves node B. Critical case: approve A, commit A, then attempt commit B
// WITHOUT a second approval -> structurally refused, callback never invoked.
{
  let run = freshRun();
  run = await advanceThroughPreview(run, "context_preview", "fixture.context.create");

  // context_commit refuses before any approval at all.
  let publishCallbackCalls = 0;
  const premature = await runWorkflowNode(run, definition, "context_commit", {
    context_commit: () => {
      publishCallbackCalls += 1;
      return { kind: "commit", ok: true, receiptRef: "should-not-run" };
    },
  });
  assert.equal(premature.ok, false);
  assert.equal(premature.reason, "approval_required");
  assert.equal(publishCallbackCalls, 0, "context_commit callback must never fire before its own approval");

  // Approve and commit A (context_commit) only.
  const approvedA = requestAndApprove(run, "context_commit", "fixture.context.create", true);
  assert.equal(approvedA.ok, true);
  let contextCommitCalls = 0;
  const committedA = await runWorkflowNode(approvedA.state, definition, "context_commit", {
    context_commit: () => {
      contextCommitCalls += 1;
      return { kind: "commit", ok: true, receiptRef: "receipts/context-created" };
    },
  });
  assert.equal(committedA.ok, true);
  assert.equal(contextCommitCalls, 1);
  assert.equal(committedA.state.nodeStates.context_commit.status, "committed");

  // The run is NOT terminal just because the first commit node succeeded --
  // publish_commit is still pending, so phase must not be "committed" yet.
  assert.notEqual(committedA.state.phase, "committed", "run must not read as terminal while publish_commit is still pending");

  // Advance to publish_preview (required before publish_commit per the same-command-preview rule).
  const afterPublishPreview = await advanceThroughPreview(committedA.state, "publish_preview", "fixture.context.publish");

  // Critical case: attempt publish_commit WITHOUT a second approval. The run's approvalState is
  // still "approved" from context_commit's approval, but that approval was scoped to
  // fixture.context.create only -- publish_commit's callback must never fire.
  let publishCommitCallsWithoutApproval = 0;
  const refusedB = await runWorkflowNode(afterPublishPreview, definition, "publish_commit", {
    publish_commit: () => {
      publishCommitCallsWithoutApproval += 1;
      return { kind: "commit", ok: true, receiptRef: "should-not-run" };
    },
  });
  assert.equal(refusedB.ok, false, "publish_commit must refuse without its own approval");
  assert.equal(refusedB.reason, "approval_does_not_cover_this_node");
  assert.equal(publishCommitCallsWithoutApproval, 0, "publish_commit callback must never fire when approving A didn't cover B");

  // (c) Both commits succeed when each is separately host-signed approved.
  const approvedB = requestAndApprove(afterPublishPreview, "publish_commit", "fixture.context.publish", true);
  assert.equal(approvedB.ok, true);
  let publishCommitCalls = 0;
  const committedB = await runWorkflowNode(approvedB.state, definition, "publish_commit", {
    publish_commit: () => {
      publishCommitCalls += 1;
      return { kind: "commit", ok: true, receiptRef: "receipts/context-published" };
    },
  });
  assert.equal(committedB.ok, true);
  assert.equal(publishCommitCalls, 1);
  assert.equal(committedB.state.nodeStates.publish_commit.status, "committed");

  // Now that BOTH tool_commit nodes are committed, the run is finally terminal.
  assert.equal(committedB.state.phase, "committed", "run reaches committed only once every tool_commit node has committed");
  assert.equal(committedB.state.receipts.length, 2);
}

// Untargeted approvals are structurally rejected in multi-commit graphs (Phase 3b
// review): one host approval with empty approvedCommandIds must not cover every
// commit node -- that would be the implicit-approval bug through a side door.
{
  const run = startControllerRun(definition, { runId: "run-untargeted", workflowVersionId: "fixture.context.create_and_publish@0.1.0" });
  const requested = applyWorkflowRunEvent(run, { type: "request_approval", nodeId: "context_commit" });
  assert.equal(requested.ok, true);
  const untargeted = applyWorkflowRunEvent(requested.state, { type: "approve", hostSigned: true, approvedCommandIds: [] });
  assert.deepEqual(
    { ok: untargeted.ok, reason: untargeted.reason },
    { ok: false, reason: "untargeted_approval_requires_explicit_commandIds" },
    "an untargeted approval is refused when more than one tool_commit node exists",
  );
  const omitted = applyWorkflowRunEvent(requested.state, { type: "approve", hostSigned: true });
  assert.equal(omitted.ok, false, "omitting approvedCommandIds entirely is refused the same way");
}

console.log("workflow-controller-multi-approval.test.mjs passed");
