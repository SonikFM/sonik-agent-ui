import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// P1 #5 (production-readiness-agent-creation-2026-07-13.md): the workflow controller + run-state
// reducer's first production caller. Drives $lib/server/workflow-runs.ts directly (plain module,
// no $env/$app imports -- same source-pinning precedent as reservation-commit-endpoint.test.mjs)
// through the full start -> preview -> approve -> commit lifecycle against the Amplify campaign
// fixture (the one workflow this endpoint has real, reviewed callbacks for; booking stays
// reads-only-by-construction here, unchanged from /api/reservation/commit).

const [workflowRunsModule, workflowRunStoreModule, knowledgeStoreModule, campaignWorkflowModule] = await Promise.all([
  import("../../apps/standalone-sveltekit/src/lib/server/workflow-runs.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts"),
  import("../../apps/standalone-sveltekit/src/lib/knowledge/knowledge-store.ts"),
  import("../../apps/standalone-sveltekit/src/lib/agent-workflows/amplify-campaign-workflow.ts"),
]);
const { handleWorkflowRunsAction } = workflowRunsModule;
const { createInMemoryWorkflowRunStore, wrapWorkflowRunStoreAsync } = workflowRunStoreModule;
const { createKnowledgeStore } = knowledgeStoreModule;
const { assembleAmplifyCampaignContent } = campaignWorkflowModule;

const brief = { productName: "Loyalty Weekend", audience: "returning_members", offer: "20% off", launchDate: "2026-08-01" };

const authenticatedHostSession = {
  source: "amplify-embedded",
  sessionId: "session-workflow-runs-endpoint",
  userId: "user-workflow-runs-endpoint",
  principalId: "user-workflow-runs-endpoint",
  organizationId: "11111111-1111-4111-8111-111111111111",
  authenticated: true,
  scopes: ["booking:read"],
  metadata: { approvedCommandIds: ["amplify.campaign.create"] },
};

const knowledgeRoot = await mkdtemp(path.join(tmpdir(), "workflow-runs-endpoint-test-"));
try {
  const knowledgeStore = createKnowledgeStore(knowledgeRoot);
  const store = wrapWorkflowRunStoreAsync(createInMemoryWorkflowRunStore());
  const deps = (hostSession) => ({ hostSession, store, knowledgeStore });

  // 1. start: persists a run row keyed by the fixture's own workflowVersionId.
  const started = await handleWorkflowRunsAction({ action: "start", workflowId: "amplify.campaign.create", brief }, deps(null));
  assert.equal(started.ok, true, "start must succeed for the registered Amplify campaign workflow");
  const runId = started.run.runId;
  assert.equal(started.run.nodeStates.trigger.status, "active", "entry node is active from run start");
  const persistedAfterStart = await store.getRun(runId);
  assert.ok(persistedAfterStart, "start persists a run row");
  assert.equal(persistedAfterStart.workflowVersionId, "sonik.amplify.campaign.workflow@0.1.0");

  // 2. preview: drives the tool_preview node through the shared controller.
  const previewed = await handleWorkflowRunsAction({ action: "preview", runId, nodeId: "preview" }, deps(null));
  assert.equal(previewed.ok, true, "preview node must succeed");
  assert.equal(previewed.run.phase, "preview_ready");
  assert.deepEqual(previewed.run.receipts, [], "no success state exists pre-receipt");

  // 3. NEGATIVE: commit before approval is structurally refused -- callback never invoked, and the
  // refusal is persisted (not silently dropped).
  const prematureCommit = await handleWorkflowRunsAction({ action: "commit", runId, nodeId: "commit" }, deps(null));
  assert.equal(prematureCommit.ok, false);
  assert.equal(prematureCommit.reason, "approval_required");
  assert.equal((await store.getRun(runId)).state.phase, "preview_ready", "an approval_required refusal must not advance the persisted run");

  // 4. NEGATIVE: approving with no trusted host session is model-supplied approval, not host-signed --
  // rejected by the reducer itself, not a bespoke check duplicated in this endpoint.
  const modelSuppliedApproval = await handleWorkflowRunsAction({ action: "approve", runId, nodeId: "commit" }, deps(null));
  assert.equal(modelSuppliedApproval.ok, false);
  assert.equal(modelSuppliedApproval.reason, "model_supplied_approval_is_not_trusted");
  assert.equal((await store.getRun(runId)).state.approvalState.hostSigned, false);

  // 5. approve: a trusted host session (the operator clicking Approve) makes this a host-signed EVENT.
  const approved = await handleWorkflowRunsAction({ action: "approve", runId, nodeId: "commit" }, deps(authenticatedHostSession));
  assert.equal(approved.ok, true, "approval with a trusted host session must succeed");
  assert.equal(approved.run.approvalState.status, "approved");
  assert.equal(approved.run.approvalState.hostSigned, true);
  assert.deepEqual(approved.run.approvalState.approvedCommandIds, ["amplify.campaign.create"]);

  // 6. commit: fires the registered commit callback exactly once, success derives only from the
  // semantic receipt, and the receipt persists to the real knowledge store.
  const committed = await handleWorkflowRunsAction({ action: "commit", runId, nodeId: "commit" }, deps(authenticatedHostSession));
  assert.equal(committed.ok, true, "commit must succeed once host-signed approved");
  assert.equal(committed.run.phase, "committed");
  assert.equal(committed.run.receipts.length, 1);
  const [receipt] = committed.run.receipts;
  assert.equal(receipt.semanticStatus, "success");
  assert.ok(receipt.receiptRef, "receipt must carry an artifact ref");

  const persistedAfterCommit = await store.getRun(runId);
  assert.equal(persistedAfterCommit.state.phase, "committed", "the committed state is persisted on the run row");

  const files = await knowledgeStore.listFiles("sonik.knowledge.campaign-artifacts");
  assert.equal(files.length, 1);
  const persistedContent = await knowledgeStore.readFile("sonik.knowledge.campaign-artifacts", files[0].fileId);
  assert.deepEqual(JSON.parse(persistedContent), assembleAmplifyCampaignContent(brief));

  console.log("workflow-runs-endpoint: full lifecycle + persistence passed");

  // 7. NEGATIVE: a client-supplied runId colliding with an existing run must be a clean
  // conflict result, not an unhandled 500 (P3, production-readiness ledger).
  const collisionRunId = "workflow-run-collision-test";
  const firstStart = await handleWorkflowRunsAction({ action: "start", runId: collisionRunId, workflowId: "amplify.campaign.create", brief }, deps(null));
  assert.equal(firstStart.ok, true, "first start with an explicit runId succeeds");
  const collidingStart = await handleWorkflowRunsAction({ action: "start", runId: collisionRunId, workflowId: "amplify.campaign.create", brief }, deps(null));
  assert.equal(collidingStart.ok, false, "a colliding client-supplied runId must be rejected, not thrown");
  assert.equal(collidingStart.reason, "run_id_conflict");

  console.log("workflow-runs-endpoint: colliding client-supplied runId returns a clean conflict result");
} finally {
  await rm(knowledgeRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, checked: "workflow-runs-endpoint" }));
