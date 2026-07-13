import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { amplifyCampaignWorkflowManifest } from "../../packages/tool-contracts/dist/marketplace-fixtures.js";
import { applyWorkflowRunEvent } from "../../packages/tool-contracts/dist/workflow-run-state.js";
import { runWorkflowNode, startControllerRun } from "../../packages/tool-contracts/dist/workflow-controller.js";
import { validateDraftedWorkflow } from "../../apps/standalone-sveltekit/src/lib/agent-workflows/drafting-agent.ts";
import { createApprovalAffordanceFromWorkflowRun } from "../../apps/standalone-sveltekit/src/lib/agent-workflows/approval-affordance.ts";
import { createKnowledgeStore } from "../../apps/standalone-sveltekit/src/lib/knowledge/knowledge-store.ts";
import {
  assembleAmplifyCampaignContent,
  commitAmplifyCampaignArtifact,
} from "../../apps/standalone-sveltekit/src/lib/agent-workflows/amplify-campaign-workflow.ts";

// Phase 7 (agent-creation-tool-plan-2026-07-13.md): the wow demo -- an Amplify campaign
// workflow executing end to end through the SAME generic controller the reservation
// regression floor runs (reservation-workflow-controller-integration.test.mjs, unmodified).
// This is the sole new live controller path this plan requires (CRITICAL_W4_SEMANTICS):
// startControllerRun -> runWorkflowNode(preview) -> host-signed approval EVENT (targeted at
// the commit node's commandId) -> runWorkflowNode(commit). runWorkflowNode is never called
// on trigger/ask_user/approval nodes.

// 1. The fixture must itself pass the drafting agent's gate -- proves a
//    drafting-agent-producible workflow is what actually runs here, not just a
//    schema-valid-by-construction literal.
const rawDefinition = amplifyCampaignWorkflowManifest.payload.workflow;
assert.ok(rawDefinition, "fixture must carry a workflow payload");
const draftValidation = validateDraftedWorkflow(rawDefinition);
assert.equal(draftValidation.ok, true, `campaign fixture must pass validateDraftedWorkflow: ${draftValidation.ok ? "" : draftValidation.reasons.join(" | ")}`);
const definition = draftValidation.workflow;

const brief = { productName: "Loyalty Weekend", audience: "returning_members", offer: "20% off", launchDate: "2026-08-01" };
const STORE_ID = "sonik.knowledge.campaign-artifacts";

async function withTempKnowledgeStore(run) {
  const root = await mkdtemp(path.join(tmpdir(), "amplify-campaign-workflow-test-"));
  try {
    await run(createKnowledgeStore(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await withTempKnowledgeStore(async (knowledgeStore) => {
  let previewInvocations = 0;
  let commitInvocations = 0;

  const previewCallback = () => {
    previewInvocations += 1;
    assembleAmplifyCampaignContent(brief); // deterministic assembly, no model call
    return {
      kind: "preview",
      ok: true,
      preview: { commandId: "amplify.campaign.create", stableInputHash: "campaign-hash", effect: "write", approvalRequired: true },
    };
  };
  const commitCallback = async () => {
    commitInvocations += 1;
    const content = assembleAmplifyCampaignContent(brief);
    const { receiptRef } = await commitAmplifyCampaignArtifact(knowledgeStore, STORE_ID, content);
    return { kind: "commit", ok: true, receiptRef };
  };

  // startControllerRun
  const run0 = startControllerRun(definition, { runId: "run-amplify-campaign-1", workflowVersionId: amplifyCampaignWorkflowManifest.packageVersionId });
  assert.equal(run0.nodeStates.trigger.status, "active", "entry node is active from run start");

  // runWorkflowNode(previewNodeId)
  const afterPreview = await runWorkflowNode(run0, definition, "preview", { preview: previewCallback });
  assert.equal(afterPreview.ok, true, "preview node must succeed");
  assert.equal(afterPreview.state.phase, "preview_ready");
  assert.equal(previewInvocations, 1);

  // (c) The ONLY legitimate card producer: build the approval affordance from the
  // real preview_ready run state and assert its shape, before any approval exists.
  const cardBeforeApproval = createApprovalAffordanceFromWorkflowRun(afterPreview.state, {
    title: "Approve the campaign",
    description: "Review the generated campaign content before publishing.",
    onRequestPreview: () => {},
    onApprove: () => {},
    onCancel: () => {},
  });
  assert.equal(cardBeforeApproval.status, "approval_required");
  assert.equal(cardBeforeApproval.disabled, false);
  assert.equal(cardBeforeApproval.commandId, "amplify.campaign.create");

  // (b) No success state exists pre-receipt.
  assert.notEqual(afterPreview.state.phase, "committed");
  assert.deepEqual(afterPreview.state.receipts, []);

  // NEGATIVE TEST: tool_commit refuses without the approval event -- structural
  // refusal, callback never invoked.
  const prematureCommit = await runWorkflowNode(afterPreview.state, definition, "commit", { commit: commitCallback });
  assert.equal(prematureCommit.ok, false);
  assert.equal(prematureCommit.reason, "approval_required");
  assert.equal(commitInvocations, 0, "commit callback must never fire before a host-signed approval");

  // A model-supplied (hostSigned: false) approval is rejected too -- (a) tool_commit
  // fires only under approvalState{status:"approved", hostSigned:true}.
  const requested = applyWorkflowRunEvent(afterPreview.state, { type: "request_approval", nodeId: "commit" });
  assert.equal(requested.ok, true);
  const modelApprove = applyWorkflowRunEvent(requested.state, { type: "approve", hostSigned: false, approvedCommandIds: ["amplify.campaign.create"] });
  assert.deepEqual({ ok: modelApprove.ok, reason: modelApprove.reason }, { ok: false, reason: "model_supplied_approval_is_not_trusted" });
  assert.equal(commitInvocations, 0, "commit callback must never fire on a model-supplied approval");

  // Apply the host-signed approval EVENT to run state, targeted at commandIds covering
  // the commit node (Phase-3b semantics).
  const approved = applyWorkflowRunEvent(requested.state, { type: "approve", hostSigned: true, approvedCommandIds: ["amplify.campaign.create"] });
  assert.equal(approved.ok, true);
  assert.equal(approved.state.approvalState.status, "approved");
  assert.equal(approved.state.approvalState.hostSigned, true);
  assert.deepEqual(approved.state.approvalState.approvedCommandIds, ["amplify.campaign.create"]);

  // runWorkflowNode(commitNodeId)
  const committed = await runWorkflowNode(approved.state, definition, "commit", { commit: commitCallback });
  assert.equal(committed.ok, true, "commit node must succeed once host-signed approved");
  assert.equal(committed.state.phase, "committed");
  assert.equal(committed.state.nodeStates.commit.status, "committed");
  assert.equal(commitInvocations, 1, "commit callback must fire exactly once");

  // (b) The success surface derives ONLY from the commit's semantic receipt payload:
  // the receipt carries the artifact ref, and the ref resolves to the real persisted file.
  assert.equal(committed.state.receipts.length, 1);
  const [receipt] = committed.state.receipts;
  assert.equal(receipt.nodeId, "commit");
  assert.equal(receipt.commandId, "amplify.campaign.create");
  assert.equal(receipt.semanticStatus, "success");
  assert.ok(receipt.receiptRef, "receipt must carry an artifact ref");

  const files = await knowledgeStore.listFiles(STORE_ID);
  assert.equal(files.length, 1);
  const persisted = await knowledgeStore.readFile(STORE_ID, files[0].fileId);
  const expectedContent = assembleAmplifyCampaignContent(brief);
  assert.deepEqual(JSON.parse(persisted), expectedContent, "the persisted artifact is the same deterministic content the preview assembled");

  console.log("amplify-campaign-workflow-integration: campaign wow demo passed");
});

console.log(JSON.stringify({ ok: true, checked: "amplify-campaign-workflow-integration" }));
