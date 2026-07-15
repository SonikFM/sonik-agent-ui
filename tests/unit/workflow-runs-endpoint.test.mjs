import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// P1 #5 (production-readiness-agent-creation-2026-07-13.md): the workflow controller + run-state
// reducer's first production caller. Drives $lib/server/workflow-runs.ts directly (plain module,
// no $env/$app imports -- same source-pinning precedent as reservation-commit-endpoint.test.mjs)
// through the full start -> preview -> approve -> commit lifecycle against the Amplify campaign
// fixture (the one workflow this endpoint has real, reviewed callbacks for; booking stays
// reads-only-by-construction here, unchanged from /api/reservation/commit).

const [workflowRunsModule, workflowRunStoreModule, knowledgeStoreModule, campaignWorkflowModule, workflowDefinitionModule, publicWorkflowRunsModule, workflowFixturesModule] = await Promise.all([
  import("../../apps/standalone-sveltekit/src/lib/server/workflow-runs.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts"),
  import("../../apps/standalone-sveltekit/src/lib/knowledge/knowledge-store.ts"),
  import("../../apps/standalone-sveltekit/src/lib/agent-workflows/amplify-campaign-workflow.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/workflow-definition-repository.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/workflow-runs-public.ts"),
  import("../../packages/tool-contracts/src/workflow-vnext-fixtures.ts"),
]);
const { handleWorkflowRunsAction, workflowRunOwnerFromHostSession } = workflowRunsModule;
const { createCloudWorkflowRunStore, createInMemoryWorkflowRunJournalStore, createInMemoryWorkflowRunStore, wrapWorkflowRunStoreAsync } = workflowRunStoreModule;
const { createKnowledgeStore } = knowledgeStoreModule;
const { assembleAmplifyCampaignContent } = campaignWorkflowModule;
const { createInMemoryWorkflowDefinitionRepository } = workflowDefinitionModule;
const { handlePublicWorkflowDriverAction } = publicWorkflowRunsModule;
const { train0SelectedPathRunState, train0WorkflowFixtures } = workflowFixturesModule;

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
const authenticatedHostSessionRotated = { ...authenticatedHostSession, sessionId: "session-workflow-runs-endpoint-rotated" };
const authenticatedHostSessionNoGrant = { ...authenticatedHostSession, metadata: { approvedCommandIds: [] } };
const otherUserHostSession = { ...authenticatedHostSession, sessionId: "foreign-user-host", userId: "foreign-user", principalId: "foreign-user" };
const otherOrgHostSession = { ...authenticatedHostSession, sessionId: "foreign-org-host", organizationId: "22222222-2222-4222-8222-222222222222" };
const owner = workflowRunOwnerFromHostSession(authenticatedHostSession);
const rotatedOwner = workflowRunOwnerFromHostSession(authenticatedHostSessionRotated);
const otherUserOwner = workflowRunOwnerFromHostSession(otherUserHostSession);
const otherOrgOwner = workflowRunOwnerFromHostSession(otherOrgHostSession);
assert.ok(owner && rotatedOwner && otherUserOwner && otherOrgOwner);

function createFakeWorkflowRunExecutor() {
  const rows = new Map();
  const statements = [];
  const key = (organizationId, userId, runId) => JSON.stringify([organizationId, userId, runId]);
  const clone = (row) => ({ ...row });

  return {
    rows,
    statements,
    async transaction(operation) {
      let context = null;
      return operation({
        async query(sql, params = []) {
          const normalized = sql.replace(/\s+/g, " ").trim();
          statements.push({ sql: normalized, params: [...params] });
          if (/select sonik_agent_ui\.set_request_context\(\$1, \$2\)/i.test(normalized)) {
            context = { organizationId: params[0], userId: params[1] };
            return { rows: [] };
          }
          assert.ok(context, "every cloud workflow-run query must establish request context first");

          if (/^insert into sonik_agent_ui\.agent_workflow_runs/i.test(normalized)) {
            const [organizationId, userId, hostSessionId, runId, workflowId, workflowVersionId, definition, input, state, now] = params;
            const rowKey = key(organizationId, userId, runId);
            if (rows.has(rowKey)) throw Object.assign(new Error("duplicate key"), { code: "23505" });
            const row = {
              organization_id: organizationId,
              user_id: userId,
              host_session_id: hostSessionId,
              run_id: runId,
              workflow_id: workflowId,
              workflow_version_id: workflowVersionId,
              definition: JSON.parse(definition),
              input: JSON.parse(input),
              state: JSON.parse(state),
              created_at: now,
              updated_at: now,
            };
            rows.set(rowKey, row);
            return { rows: [clone(row)] };
          }

          if (/^select /i.test(normalized) && /run_id = \$3/i.test(normalized)) {
            const row = rows.get(key(params[0], params[1], params[2]));
            return { rows: row ? [clone(row)] : [] };
          }

          if (/^select /i.test(normalized)) {
            return {
              rows: [...rows.values()]
                .filter((row) => row.organization_id === params[0] && row.user_id === params[1])
                .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
                .map(clone),
            };
          }

          if (/^update sonik_agent_ui\.agent_workflow_runs/i.test(normalized)) {
            const rowKey = key(params[0], params[1], params[2]);
            const existing = rows.get(rowKey);
            if (!existing) return { rows: [] };
            const updated = { ...existing, state: JSON.parse(params[3]), updated_at: params[4] };
            rows.set(rowKey, updated);
            return { rows: [clone(updated)] };
          }

          throw new Error(`Unexpected workflow-run SQL: ${normalized}`);
        },
      });
    },
  };
}

const knowledgeRoot = await mkdtemp(path.join(tmpdir(), "workflow-runs-endpoint-test-"));
try {
  const knowledgeStore = createKnowledgeStore(knowledgeRoot);
  const store = wrapWorkflowRunStoreAsync(createInMemoryWorkflowRunStore());
  const deps = (hostSession) => ({ hostSession, store, knowledgeStore });

  // 1. start: persists a run row keyed by the fixture's own workflowVersionId.
  const started = await handleWorkflowRunsAction({ action: "start", workflowId: "amplify.campaign.create", brief }, deps(authenticatedHostSession));
  assert.equal(started.ok, true, "start must succeed for the registered Amplify campaign workflow");
  const runId = started.run.runId;
  assert.equal(started.run.nodeStates.trigger.status, "active", "entry node is active from run start");
  const persistedAfterStart = await store.getRun(owner, runId);
  assert.ok(persistedAfterStart, "start persists a run row");
  assert.equal(persistedAfterStart.workflowVersionId, "sonik.amplify.campaign.workflow@0.1.0");

  // 2. preview: drives the tool_preview node through the shared controller.
  const previewed = await handleWorkflowRunsAction({ action: "preview", runId, nodeId: "preview" }, deps(authenticatedHostSessionRotated));
  assert.equal(previewed.ok, true, "preview node must succeed");
  assert.equal(previewed.run.phase, "preview_ready");
  assert.deepEqual(previewed.run.receipts, [], "no success state exists pre-receipt");

  // 3. NEGATIVE: commit before approval is structurally refused -- callback never invoked, and the
  // refusal is persisted (not silently dropped).
  const prematureCommit = await handleWorkflowRunsAction({ action: "commit", runId, nodeId: "commit" }, deps(authenticatedHostSession));
  assert.equal(prematureCommit.ok, false);
  assert.equal(prematureCommit.reason, "approval_required");
  assert.equal((await store.getRun(owner, runId)).state.phase, "preview_ready", "an approval_required refusal must not advance the persisted run");

  // 4. NEGATIVE: approving with no trusted host session is model-supplied approval, not host-signed --
  // rejected by the reducer itself, not a bespoke check duplicated in this endpoint.
  const modelSuppliedApproval = await handleWorkflowRunsAction({ action: "approve", runId, nodeId: "commit" }, deps(null));
  assert.equal(modelSuppliedApproval.ok, false);
  assert.equal(modelSuppliedApproval.reason, "authenticated_workspace_owner_required");
  assert.equal((await store.getRun(owner, runId)).state.phase, "preview_ready", "unauthenticated approval cannot read or mutate the run");

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

  const persistedAfterCommit = await store.getRun(owner, runId);
  assert.equal(persistedAfterCommit.state.phase, "committed", "the committed state is persisted on the run row");

  const files = await knowledgeStore.listFiles("sonik.knowledge.campaign-artifacts");
  assert.equal(files.length, 1);
  const persistedContent = await knowledgeStore.readFile("sonik.knowledge.campaign-artifacts", files[0].fileId);
  assert.deepEqual(JSON.parse(persistedContent), assembleAmplifyCampaignContent(brief));

  console.log("workflow-runs-endpoint: full lifecycle + persistence passed");

  // 7. NEGATIVE: a client-supplied runId colliding with an existing run must be a clean
  // conflict result, not an unhandled 500 (P3, production-readiness ledger).
  const collisionRunId = "workflow-run-collision-test";
  const firstStart = await handleWorkflowRunsAction({ action: "start", runId: collisionRunId, workflowId: "amplify.campaign.create", brief }, deps(authenticatedHostSession));
  assert.equal(firstStart.ok, true, "first start with an explicit runId succeeds");
  const collidingStart = await handleWorkflowRunsAction({ action: "start", runId: collisionRunId, workflowId: "amplify.campaign.create", brief }, deps(authenticatedHostSession));
  assert.equal(collidingStart.ok, false, "a colliding client-supplied runId must be rejected, not thrown");
  assert.equal(collidingStart.reason, "run_id_conflict");

  console.log("workflow-runs-endpoint: colliding client-supplied runId returns a clean conflict result");

  // 8. NEGATIVE: body-supplied trust markers are inert. Only deps.hostSession
  // can produce the reducer's host-signed event, and the rejected attempt must
  // not create another downstream campaign artifact.
  const maliciousStarted = await handleWorkflowRunsAction({ action: "start", workflowId: "amplify.campaign.create", brief }, deps(authenticatedHostSession));
  const maliciousRunId = maliciousStarted.run.runId;
  await handleWorkflowRunsAction({ action: "preview", runId: maliciousRunId, nodeId: "preview" }, deps(authenticatedHostSession));
  const filesBeforeMaliciousApproval = await knowledgeStore.listFiles("sonik.knowledge.campaign-artifacts");
  const maliciousApproval = await handleWorkflowRunsAction({
    action: "approve",
    runId: maliciousRunId,
    nodeId: "commit",
    hostSigned: true,
    approvedCommandIds: ["amplify.campaign.create"],
  }, deps(null));
  assert.equal(maliciousApproval.ok, false);
  assert.equal(maliciousApproval.reason, "authenticated_workspace_owner_required");
  const maliciousCommit = await handleWorkflowRunsAction({
    action: "commit",
    runId: maliciousRunId,
    nodeId: "commit",
    hostSigned: true,
    approvedCommandIds: ["amplify.campaign.create"],
  }, deps(null));
  assert.equal(maliciousCommit.ok, false);
  assert.equal(maliciousCommit.reason, "authenticated_workspace_owner_required");
  assert.equal(
    (await knowledgeStore.listFiles("sonik.knowledge.campaign-artifacts")).length,
    filesBeforeMaliciousApproval.length,
    "client-supplied approval text/fields must cause zero downstream writes",
  );

  // 9. Ownership is organization + user. Host-session rotation retains access and provenance,
  // while foreign users/orgs get the same run_not_found result for every lifecycle action before
  // any workflow callback or persistence update can run.
  const scopedRunId = "shared-client-workflow-run-id";
  const scopedStart = await handleWorkflowRunsAction(
    { action: "start", runId: scopedRunId, workflowId: "amplify.campaign.create", brief },
    deps(authenticatedHostSession),
  );
  assert.equal(scopedStart.ok, true);
  const scopedPreview = await handleWorkflowRunsAction(
    { action: "preview", runId: scopedRunId, nodeId: "preview" },
    deps(authenticatedHostSessionRotated),
  );
  assert.equal(scopedPreview.ok, true, "same owner retains a workflow run across host-session rotation");
  assert.equal((await store.getRun(rotatedOwner, scopedRunId))?.hostSessionId, authenticatedHostSession.sessionId, "rotation never rewrites insert-time host provenance");

  const artifactsBeforeForeignActions = await knowledgeStore.listFiles("sonik.knowledge.campaign-artifacts");
  const scopedStateBeforeForeignActions = (await store.getRun(owner, scopedRunId))?.state;
  for (const foreignHost of [otherUserHostSession, otherOrgHostSession]) {
    for (const action of [
      { action: "preview", runId: scopedRunId, nodeId: "preview" },
      { action: "approve", runId: scopedRunId, nodeId: "commit" },
      { action: "commit", runId: scopedRunId, nodeId: "commit" },
    ]) {
      const result = await handleWorkflowRunsAction(action, deps(foreignHost));
      assert.deepEqual(result, { ok: false, reason: "run_not_found" }, "foreign workflow-run actions fail closed without disclosing state");
    }
  }
  assert.deepEqual((await store.getRun(owner, scopedRunId))?.state, scopedStateBeforeForeignActions, "foreign actions perform zero owner-row updates");
  assert.equal(
    (await knowledgeStore.listFiles("sonik.knowledge.campaign-artifacts")).length,
    artifactsBeforeForeignActions.length,
    "foreign preview/approve/commit perform zero downstream callback writes",
  );
  assert.equal(await store.getRun(otherUserOwner, scopedRunId), null);
  assert.equal(await store.getRun(otherOrgOwner, scopedRunId), null);
  assert.deepEqual(await store.listRuns(otherUserOwner), []);
  assert.deepEqual(await store.listRuns(otherOrgOwner), []);
  assert.equal(await store.updateRunState(otherUserOwner, scopedRunId, scopedStateBeforeForeignActions), null);
  assert.equal(await store.updateRunState(otherOrgOwner, scopedRunId, scopedStateBeforeForeignActions), null);

  const otherUserSameId = await handleWorkflowRunsAction(
    { action: "start", runId: scopedRunId, workflowId: "amplify.campaign.create", brief },
    deps(otherUserHostSession),
  );
  const otherOrgSameId = await handleWorkflowRunsAction(
    { action: "start", runId: scopedRunId, workflowId: "amplify.campaign.create", brief },
    deps(otherOrgHostSession),
  );
  assert.equal(otherUserSameId.ok, true, "a foreign user may safely reuse an opaque client run id");
  assert.equal(otherOrgSameId.ok, true, "a foreign organization may safely reuse an opaque client run id");
  assert.equal((await store.getRun(owner, scopedRunId))?.state.phase, "preview_ready", "foreign run-id reuse cannot squat or replace the owner's row");

  const ownerRunCountBeforeUnauthenticatedActions = (await store.listRuns(owner)).length;
  const artifactsBeforeUnauthenticatedActions = (await knowledgeStore.listFiles("sonik.knowledge.campaign-artifacts")).length;
  for (const action of [
    { action: "start", runId: "unauthenticated-run", workflowId: "amplify.campaign.create", brief },
    { action: "preview", runId: scopedRunId, nodeId: "preview" },
    { action: "approve", runId: scopedRunId, nodeId: "commit" },
    { action: "commit", runId: scopedRunId, nodeId: "commit" },
  ]) {
    assert.deepEqual(
      await handleWorkflowRunsAction(action, deps(null)),
      { ok: false, reason: "authenticated_workspace_owner_required" },
      "unauthenticated workflow actions fail before any persistence access",
    );
  }
  assert.equal((await store.listRuns(owner)).length, ownerRunCountBeforeUnauthenticatedActions, "unauthenticated actions perform zero workflow-run writes");
  assert.equal((await knowledgeStore.listFiles("sonik.knowledge.campaign-artifacts")).length, artifactsBeforeUnauthenticatedActions, "unauthenticated actions perform zero callbacks");

  // 10. The production cloud store repeats the owner predicate in every statement in addition to
  // transaction-local RLS context. A deterministic executor proves the same-owner rotation and
  // cross-tenant isolation semantics without needing PostgreSQL in the unit lane.
  const fakeExecutor = createFakeWorkflowRunExecutor();
  const cloudStore = createCloudWorkflowRunStore(fakeExecutor);
  const cloudInput = {
    workflowId: persistedAfterStart.workflowId,
    workflowVersionId: persistedAfterStart.workflowVersionId,
    definition: persistedAfterStart.definition,
    input: persistedAfterStart.input,
    state: { ...persistedAfterStart.state, runId: "cloud-shared-run-id" },
  };
  const cloudCreated = await cloudStore.createRun(owner, cloudInput);
  assert.equal(cloudCreated.hostSessionId, owner.hostSessionId);
  assert.equal((await cloudStore.getRun(rotatedOwner, "cloud-shared-run-id"))?.runId, "cloud-shared-run-id");
  assert.deepEqual((await cloudStore.listRuns(rotatedOwner)).map((row) => row.runId), ["cloud-shared-run-id"]);
  assert.equal((await cloudStore.updateRunState(rotatedOwner, "cloud-shared-run-id", cloudInput.state))?.hostSessionId, owner.hostSessionId, "cloud updates preserve insert-time provenance");
  for (const foreignOwner of [otherUserOwner, otherOrgOwner]) {
    assert.equal(await cloudStore.getRun(foreignOwner, "cloud-shared-run-id"), null);
    assert.deepEqual(await cloudStore.listRuns(foreignOwner), []);
    assert.equal(await cloudStore.updateRunState(foreignOwner, "cloud-shared-run-id", cloudInput.state), null);
    const reused = await cloudStore.createRun(foreignOwner, cloudInput);
    assert.equal(reused.runId, "cloud-shared-run-id", "the composite owner key prevents cross-tenant client-runId squatting");
  }
  for (const statement of fakeExecutor.statements.filter(({ sql }) => /^(insert|select .*from|update) /i.test(sql))) {
    assert.match(statement.sql, /organization_id/i, "every workflow-run statement explicitly scopes organization_id");
    assert.match(statement.sql, /user_id/i, "every workflow-run statement explicitly scopes user_id");
    if (/^(select .*from|update) /i.test(statement.sql)) {
      assert.match(statement.sql, /where organization_id = \$1 and user_id = \$2/i, "reads/updates carry explicit owner predicates");
    }
    assert.doesNotMatch(statement.sql, /host_session_id\s*=/i, "host session is provenance, never a visibility predicate");
  }

  const [routeSource, publicRouteSource, storeSource, migrationSource, runnerSource] = await Promise.all([
    readFile(new URL("../../apps/standalone-sveltekit/src/routes/api/workflow-runs/+server.ts", import.meta.url), "utf8"),
    readFile(new URL("../../apps/standalone-sveltekit/src/lib/server/workflow-runs-public.ts", import.meta.url), "utf8"),
    readFile(new URL("../../apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../../packages/workspace-session/migrations/postgres/0013_workflow_run_owner_scope.sql", import.meta.url), "utf8"),
    readFile(new URL("../../scripts/run-postgres-migrations.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(routeSource, /createAgentHostSessionEnvelope\(event\)/);
  assert.match(routeSource, /workflowRunOwnerFromHostSession\(hostSession\)/);
  assert.match(routeSource, /status: 401/);
  assert.match(routeSource, /handlePublicWorkflowDriverAction/, "the HTTP route delegates driver actions to the executable public controller");
  assert.match(publicRouteSource, /store\.getRun\(owner, runId\)[\s\S]*repository\.getPublished\(owner, row\.workflowVersionId\)/, "public driver actions load the durable run before resolving its pinned version");
  assert.match(publicRouteSource, /runInput: row\.input/, "public driver recreation uses persisted input, not client input");
  assert.match(publicRouteSource, /publicResumeEventSchema\.safeParse/, "resume payloads cross a strict public DTO boundary");
  assert.match(publicRouteSource, /node\.nodeType === "ask_user"[\s\S]*answer: signedResumeEvent\.answer/, "validated answers reach ask-user execution");
  assert.match(publicRouteSource, /finally \{[\s\S]*releaseLease/, "server-owned leases are released after every public pump");
  assert.match(publicRouteSource, /cancel_run" && "lease" in action[\s\S]*public_lease_forbidden/, "cancel cannot accept a client-owned lease");
  assert.match(publicRouteSource, /action\.action !== "resume_run" && "resumeEvent" in publicRequest/, "only resume actions may carry a resume event");
  assert.doesNotMatch(publicRouteSource, /request\?\.runInput|request\?\.workflowVersionId/, "client version/input never recreate a persisted run");
  assert.match(storeSource, /set_request_context\(\$1, \$2\)/);
  assert.match(storeSource, /where organization_id = \$1 and user_id = \$2 and run_id = \$3/g);
  assert.match(migrationSource, /unique \(organization_id, user_id, run_id\)/i);
  assert.match(migrationSource, /force row level security/i);
  assert.match(migrationSource, /organization_id = sonik_agent_ui\.current_organization_id\(\)[\s\S]*user_id = sonik_agent_ui\.current_user_id\(\)/i);
  assert.match(migrationSource, /Rows created before this migration[\s\S]*intentionally invisible/i, "legacy unowned rows must fail closed");
  assert.match(runnerSource, /0013_workflow_run_owner_scope\.sql/);

  async function publicDriverHarness(definition, runId, input) {
    const baseStore = createInMemoryWorkflowRunStore();
    const store = wrapWorkflowRunStoreAsync(baseStore);
    const journal = createInMemoryWorkflowRunJournalStore(baseStore);
    const repository = createInMemoryWorkflowDefinitionRepository();
    const draft = await repository.createDraft(owner, definition, owner.userId);
    assert.ok(draft);
    const workflowVersionId = `${definition.workflowId}@1`;
    const dependencyPins = {
      ...structuredClone(train0SelectedPathRunState.dependencyPins),
      organizationId: owner.organizationId,
      workflowVersionId,
      definitionDigest: draft.definitionDigest,
    };
    const published = await repository.publish(owner, {
      workflowId: definition.workflowId,
      expectedRevision: draft.draftRevision,
      workflowVersionId,
      definitionDigest: draft.definitionDigest,
      dependencyPins,
      actorId: owner.userId,
    });
    assert.ok(published);
    baseStore.createRun(owner, { workflowId: definition.workflowId, workflowVersionId, definition: {}, input, state: { runId } });
    return { deps: { hostSession: authenticatedHostSession, store, journal, repository }, journal, published };
  }

  {
    const runId = "public-ask-resume";
    const { deps: publicDeps, journal } = await publicDriverHarness(train0WorkflowFixtures.askUser, runId, { persisted: true });
    const waiting = await handlePublicWorkflowDriverAction({ action: "run_until_blocked", request: { workflowRunId: runId } }, publicDeps);
    assert.equal(waiting.status, 200);
    assert.equal(waiting.result.ok, true);
    assert.equal(waiting.result.run.status, "waiting");
    const waitpoint = waiting.result.run.waits[0];
    const probeLease = { leaseId: "post-wait-probe", ownerId: "probe", expiresAt: new Date(Date.now() + 30_000).toISOString() };
    assert.equal(await journal.acquireLease(owner, runId, probeLease), true, "the public pump releases its server lease before the next request");
    assert.equal(await journal.releaseLease(owner, runId, probeLease.leaseId), true);
    const resumed = await handlePublicWorkflowDriverAction({
      action: "resume_run",
      request: {
        workflowRunId: runId,
        resumeEvent: { kind: "answer", answer: { name: "Ada" }, eventId: "answer-1", waitpointId: waitpoint.waitpointId, workflowRunId: runId, nodeId: waitpoint.nodeId, runRevision: waiting.result.run.revision, issuedAt: new Date().toISOString() },
      },
    }, publicDeps);
    assert.equal(resumed.result.ok, true);
    assert.equal(resumed.result.run.status, "succeeded", "an immediate public resume advances after lease release");
    assert.deepEqual(resumed.result.run.outputs.ask.value, { name: "Ada" }, "the validated public answer reaches ask_user execution");
  }

  {
    const runId = "public-cancel";
    const { deps: publicDeps } = await publicDriverHarness(train0WorkflowFixtures.linear, runId, null);
    const cancelled = await handlePublicWorkflowDriverAction({ action: "cancel_run", runId }, publicDeps);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.result.ok, true);
    assert.equal(cancelled.result.run.status, "cancelled", "cancel loads the persisted run/version instead of requiring a client version");
  }

  {
    const runId = "public-authority";
    const persistedDefinition = structuredClone(train0WorkflowFixtures.linear);
    persistedDefinition.workflowId = "train0.persisted-authority";
    persistedDefinition.nodes[0].bindings = { payload: { source: "run_input", path: [] } };
    const { deps: publicDeps, published } = await publicDriverHarness(persistedDefinition, runId, { source: "persisted" });
    let resolvedVersionId;
    const repository = {
      ...publicDeps.repository,
      getPublished: async (scope, versionId) => {
        resolvedVersionId = versionId;
        return publicDeps.repository.getPublished(scope, versionId);
      },
    };
    const completed = await handlePublicWorkflowDriverAction({ action: "run_until_blocked", request: { workflowRunId: runId } }, { ...publicDeps, repository });
    assert.equal(completed.result.ok, true);
    assert.equal(resolvedVersionId, published.workflowVersionId, "the persisted version ID is the only repository lookup authority");
    assert.deepEqual(completed.result.run.outputs.start.value, { payload: { source: "persisted" } }, "persisted input reaches execution");

    for (const field of ["workflowVersionId", "runInput", "lease", "hostSigned"]) {
      const rejected = await handlePublicWorkflowDriverAction({ action: "run_until_blocked", request: { workflowRunId: runId, [field]: field === "hostSigned" ? true : "attacker" } }, publicDeps);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.result.reason, `public_${field}_forbidden`);
    }
    const cancelLease = await handlePublicWorkflowDriverAction({ action: "cancel_run", runId, lease: { leaseId: "attacker" } }, publicDeps);
    assert.equal(cancelLease.result.reason, "public_lease_forbidden");
    const resumeBase = { kind: "answer", answer: "Ada", eventId: "answer", waitpointId: "wait", workflowRunId: runId, nodeId: "ask", runRevision: 1, issuedAt: new Date().toISOString() };
    for (const authority of [{ subjectId: "attacker" }, { organizationId: "attacker" }, { authenticationEvidenceDigest: `sha256:${"a".repeat(64)}` }, { hostSigned: true }]) {
      const rejected = await handlePublicWorkflowDriverAction({ action: "resume_run", request: { workflowRunId: runId, resumeEvent: { ...resumeBase, ...authority } } }, publicDeps);
      assert.equal(rejected.status, 400);
      assert.equal(rejected.result.reason, "invalid_resume_event");
    }
  }
} finally {
  await rm(knowledgeRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, checked: "workflow-runs-endpoint" }));
