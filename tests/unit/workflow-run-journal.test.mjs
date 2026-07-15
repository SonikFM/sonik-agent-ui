import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createCloudWorkflowRunJournalStore,
  createInMemoryWorkflowRunJournalStore,
} from "../../apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts";
import { externalEffectIdempotencyKey, replayCanonicalWorkflowEvents } from "../../packages/tool-contracts/dist/workflow-vnext.js";
import { train0CanonicalEvent, train0SelectedPathRunState } from "../../packages/tool-contracts/dist/workflow-vnext-fixtures.js";

const owner = { organizationId: "org-1", userId: "user-1" };
const sameOrgOwner = { organizationId: "org-1", userId: "user-2" };
const otherOwner = { organizationId: "org-2", userId: "user-2" };
const sameOrgRunId = "run-same-org";
const otherOrgRunId = "run-other-org";
const runStore = {
  getRun(candidate, runId) {
    return (candidate.organizationId === owner.organizationId && candidate.userId === owner.userId && runId === train0CanonicalEvent.workflowRunId)
      || (candidate.organizationId === sameOrgOwner.organizationId && candidate.userId === sameOrgOwner.userId && runId === sameOrgRunId)
      || (candidate.organizationId === otherOwner.organizationId && candidate.userId === otherOwner.userId && runId === otherOrgRunId) ? {} : null;
  },
};
const journal = createInMemoryWorkflowRunJournalStore(runStore);
const initial = {
  ...structuredClone(train0SelectedPathRunState),
  status: "running",
  revision: 0,
  eventSequence: 0,
  selectedPath: [],
  outputs: {},
  outputRefs: {},
  compatibilityPhase: "saving",
};
const snapshot = replayCanonicalWorkflowEvents(initial, [train0CanonicalEvent]);
const future = new Date(Date.now() + 60_000).toISOString();

assert.equal(await journal.acquireLease(owner, train0CanonicalEvent.workflowRunId, { leaseId: "lease-a", ownerId: "worker-a", expiresAt: future }), true);
assert.equal(await journal.appendEventAndProject(owner, { expectedRevision: 0, leaseId: "lease-a", event: train0CanonicalEvent, snapshot }), true);
assert.equal(await journal.appendEventAndProject(owner, { expectedRevision: 0, leaseId: "lease-a", event: train0CanonicalEvent, snapshot }), false, "same-revision writers lose the CAS without creating a duplicate");
assert.deepEqual(await journal.listEvents(owner, train0CanonicalEvent.workflowRunId), [train0CanonicalEvent]);
assert.deepEqual(await journal.getSnapshot(owner, train0CanonicalEvent.workflowRunId), snapshot);
assert.deepEqual(await journal.listEvents(otherOwner, train0CanonicalEvent.workflowRunId), [], "journal reads remain tenant scoped");
assert.deepEqual(await journal.replayEvents(owner, initial), snapshot, "ordered journal replay reproduces the projected snapshot");
await assert.rejects(
  journal.appendEventAndProject(owner, { expectedRevision: 0, leaseId: "lease-a", event: { ...train0CanonicalEvent, sequence: 2 }, snapshot }),
  /invalid_workflow_event_order|invalid_workflow_event_projection/,
  "sequence gaps fail before persistence",
);

assert.equal(await journal.acquireLease(owner, train0CanonicalEvent.workflowRunId, { leaseId: "lease-b", ownerId: "worker-b", expiresAt: future }), false, "an active foreign lease is fenced out");
assert.equal(await journal.releaseLease(owner, train0CanonicalEvent.workflowRunId, "lease-b"), false, "only the lease token holder can release");
assert.equal(await journal.releaseLease(owner, train0CanonicalEvent.workflowRunId, "lease-a"), true);
assert.equal(await journal.acquireLease(owner, train0CanonicalEvent.workflowRunId, { leaseId: "expired", ownerId: "worker-a", expiresAt: new Date(Date.now() - 1).toISOString() }), false);

const waitpoint = { kind: "answer", waitpointId: "wait-1", runId: train0CanonicalEvent.workflowRunId, nodeId: "ask", subjectId: "user-1" };
assert.equal(await journal.createWaitpoint(owner, waitpoint), true);
assert.equal(await journal.createWaitpoint(owner, waitpoint), false, "waitpoint identity is one-shot");
assert.equal(await journal.resolveWaitpoint(owner, waitpoint.runId, waitpoint.waitpointId), true);
assert.equal(await journal.resolveWaitpoint(owner, waitpoint.runId, waitpoint.waitpointId), false, "a waitpoint cannot resume twice");
const expiredWaitpoint = { ...waitpoint, waitpointId: "wait-expired", expiresAt: new Date(Date.now() - 1).toISOString() };
assert.equal(await journal.createWaitpoint(owner, expiredWaitpoint), true);
assert.equal(await journal.resolveWaitpoint(owner, expiredWaitpoint.runId, expiredWaitpoint.waitpointId), false, "expired waits cannot resume");

const effectInput = {
  claimId: "claim-1",
  runId: train0CanonicalEvent.workflowRunId,
  logicalEffectId: "effect-1",
  attemptId: "attempt-1",
  externalEffectIdentity: { namespace: "booking:v1:create", keyDigest: `sha256:${"1".repeat(64)}`, commandId: "booking.create", resolvedInputHash: `sha256:${"2".repeat(64)}` },
  providerSupportsIdempotency: true,
};
effectInput.idempotencyKey = externalEffectIdempotencyKey(effectInput.externalEffectIdentity);
assert.equal((await journal.claimEffect(owner, effectInput)).created, true);
const retry = await journal.claimEffect(owner, { ...effectInput, claimId: "claim-2", attemptId: "attempt-2" });
assert.equal(retry.created, false, "retries reuse the durable logical-effect claim");
assert.equal(retry.claim.claimId, "claim-1");
const crossRun = await journal.claimEffect(sameOrgOwner, { ...effectInput, claimId: "claim-cross-run", runId: sameOrgRunId, attemptId: "attempt-cross-run" });
assert.equal(crossRun.created, false, "the same trusted external key dedupes across runs and users in one organization");
assert.equal(crossRun.claim.claimId, "claim-1");
assert.equal((await journal.claimEffect(otherOwner, { ...effectInput, claimId: "claim-other-org", runId: otherOrgRunId, attemptId: "attempt-other-org" })).created, true, "the same external key remains isolated across organizations");
await assert.rejects(() => journal.claimEffect(sameOrgOwner, { ...effectInput, claimId: "claim-conflict", runId: sameOrgRunId, attemptId: "attempt-conflict", externalEffectIdentity: { ...effectInput.externalEffectIdentity, commandId: "booking.cancel" } }), /external_effect_identity_conflict/);
const distinctIdentity = { ...effectInput.externalEffectIdentity, keyDigest: `sha256:${"3".repeat(64)}` };
assert.equal((await journal.claimEffect(sameOrgOwner, { ...effectInput, claimId: "claim-distinct", runId: sameOrgRunId, attemptId: "attempt-distinct", externalEffectIdentity: distinctIdentity, idempotencyKey: externalEffectIdempotencyKey(distinctIdentity) })).created, true, "distinct business keys may execute the same static workflow slot in separate runs");
assert.equal((await journal.transitionEffectClaim(owner, effectInput.claimId, "claimed", "in_flight")).status, "in_flight");
assert.equal(await journal.transitionEffectClaim(owner, effectInput.claimId, "claimed", "in_flight"), null, "effect claim transition is compare-and-swap");
assert.equal((await journal.transitionEffectClaim(owner, effectInput.claimId, "in_flight", "outcome_unknown")).status, "outcome_unknown");
const reconciled = await journal.transitionEffectClaim(owner, effectInput.claimId, "outcome_unknown", "reconciled", { receiptRef: "receipt-1" });
assert.equal(reconciled.status, "reconciled");
assert.deepEqual(reconciled.result, { receiptRef: "receipt-1" });
await assert.rejects(
  journal.claimEffect(owner, { ...effectInput, logicalEffectId: "effect-2", idempotencyKey: "attempt-scoped" }),
  /invalid_effect_idempotency/,
);

const statements = [];
const cloud = createCloudWorkflowRunJournalStore({
  async transaction(operation) {
    return operation({
      async query(sql) {
        statements.push(sql.replace(/\s+/g, " ").trim());
        return { rows: /set_request_context/.test(sql) ? [] : [{ event_id: train0CanonicalEvent.eventId }] };
      },
    });
  },
});
assert.equal(await cloud.appendEventAndProject(owner, { expectedRevision: 0, leaseId: "lease-a", event: train0CanonicalEvent, snapshot }), true);
const appendSql = statements.find((sql) => sql.startsWith("with projected as"));
assert.match(appendSql, /update sonik_agent_ui\.agent_workflow_runs[\s\S]*journal_revision = \$8[\s\S]*lease_id = \$12[\s\S]*insert into sonik_agent_ui\.agent_workflow_run_events/, "lease-fenced projection CAS and event insert share one SQL statement");

const [migration, externalEffectMigration, storeSource] = await Promise.all([
  readFile("packages/workspace-session/migrations/postgres/0017_workflow_run_journal.sql", "utf8"),
  readFile("packages/workspace-session/migrations/postgres/0018_org_scoped_external_effect_claims.sql", "utf8"),
  readFile("apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts", "utf8"),
]);
for (const table of ["agent_workflow_run_events", "agent_workflow_run_leases", "agent_workflow_run_waitpoints", "agent_workflow_effect_claims"]) {
  assert.match(migration, new RegExp(`alter table sonik_agent_ui\\.${table} force row level security`, "i"), `${table} forces RLS`);
}
assert.match(migration, /foreign key \(organization_id, user_id, run_id\)[\s\S]*references sonik_agent_ui\.agent_workflow_runs/g);
assert.match(migration, /unique \(organization_id, user_id, run_id, idempotency_key\)/i);
assert.match(externalEffectMigration, /effect_namespace text/i);
assert.match(externalEffectMigration, /external_effect_key_digest text/i);
assert.match(externalEffectMigration, /command_id text/i);
assert.match(externalEffectMigration, /resolved_input_hash text/i);
assert.match(externalEffectMigration, /unique index[\s\S]*\(organization_id, effect_namespace, external_effect_key_digest\)/i, "external effect claims dedupe across runs and users within an organization");
assert.match(externalEffectMigration, /using \(organization_id = sonik_agent_ui\.current_organization_id\(\)\)/i, "effect claim RLS permits org-internal dedupe without cross-org visibility");
assert.doesNotMatch(externalEffectMigration, /external_effect_key\s+text/i, "raw business idempotency values are never stored");
assert.match(externalEffectMigration, /user_id \|\| E'\\n' \|\| run_id \|\| E'\\n' \|\| idempotency_key \|\| E'\\n' \|\| claim_id/i, "legacy backfill includes stable provenance before installing org-wide uniqueness");
const legacyDigest = ({ userId, runId, idempotencyKey, claimId }) => createHash("sha256").update(`${userId}\n${runId}\n${idempotencyKey}\n${claimId}`).digest("hex");
const legacyA = legacyDigest({ userId: "user-a", runId: "run-shared", idempotencyKey: "workflow-run:run-shared:effect", claimId: "claim-a" });
const legacyB = legacyDigest({ userId: "user-b", runId: "run-shared", idempotencyKey: "workflow-run:run-shared:effect", claimId: "claim-b" });
assert.notEqual(legacyA, legacyB, "same-org legacy claims with the previously allowed duplicate run/idempotency tuple remain collision-free after backfill");
assert.match(storeSource, /agent_workflow_run_leases\.lease_expires_at <= now\(\)/, "production lease takeover uses database time");
assert.match(storeSource, /validateJournalAppend\(input\)/, "canonical envelopes and projections are validated before SQL");

console.log("workflow-run-journal.test.mjs OK");
