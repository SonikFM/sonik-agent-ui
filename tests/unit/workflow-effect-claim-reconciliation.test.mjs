import assert from "node:assert/strict";
import { createInMemoryWorkflowRunJournalStore } from "../../apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts";
import { externalEffectIdempotencyKey } from "../../packages/tool-contracts/dist/workflow-vnext.js";

const owner = { organizationId: "org-effect", userId: "user-effect" };
const runId = "run-effect";
const runStore = { getRun: (candidate, candidateRunId) => candidate.organizationId === owner.organizationId && candidate.userId === owner.userId && candidateRunId === runId ? {} : null };
const journal = createInMemoryWorkflowRunJournalStore(runStore);
let sequence = 0;

function effect(label) {
  const externalEffectIdentity = {
    namespace: "booking:v1:create",
    keyDigest: `sha256:${String(++sequence).repeat(64).slice(0, 64)}`,
    commandId: "booking.create.booking",
    resolvedInputHash: `sha256:${"a".repeat(64)}`,
  };
  return {
    claimId: `claim-${label}`,
    runId,
    logicalEffectId: `effect-${label}`,
    attemptId: `attempt-${label}`,
    externalEffectIdentity,
    idempotencyKey: externalEffectIdempotencyKey(externalEffectIdentity),
    providerSupportsIdempotency: true,
  };
}

// Failpoint 1: crash after claim, before provider invocation.
{
  const input = effect("before-provider");
  assert.equal((await journal.claimEffect(owner, input)).created, true);
  const recovered = await journal.claimEffect(owner, { ...input, claimId: "retry-before-provider", attemptId: "retry-before-provider" });
  assert.equal(recovered.created, false);
  assert.equal(recovered.claim.status, "claimed");
  assert.equal(recovered.claim.claimId, input.claimId, "the durable claim reconstructs the undispatched effect");
}

// Failpoint 2: provider accepted, response lost before receipt persistence.
{
  const input = effect("accepted-no-receipt");
  let providerEffects = 0;
  await journal.claimEffect(owner, input);
  await journal.transitionEffectClaim(owner, input.claimId, "claimed", "in_flight");
  providerEffects += 1;
  await journal.transitionEffectClaim(owner, input.claimId, "in_flight", "outcome_unknown");
  const unknown = await journal.claimEffect(owner, { ...input, claimId: "retry-accepted", attemptId: "retry-accepted" });
  assert.equal(unknown.claim.status, "outcome_unknown");
  const receipt = { receiptId: "receipt-accepted", semanticStatus: "success" };
  const reconciled = await journal.transitionEffectClaim(owner, input.claimId, "outcome_unknown", "reconciled", { receipt });
  assert.equal(reconciled.status, "reconciled");
  assert.deepEqual(reconciled.result, { receipt });
  assert.equal(providerEffects, 1, "reconciliation produces one provider effect and one durable receipt");
}

// Failpoint 3: receipt persisted before canonical event/snapshot CAS.
{
  const input = effect("receipt-before-cas");
  await journal.claimEffect(owner, input);
  await journal.transitionEffectClaim(owner, input.claimId, "claimed", "in_flight");
  const result = { receipt: { receiptId: "receipt-before-cas", semanticStatus: "success" } };
  await journal.transitionEffectClaim(owner, input.claimId, "in_flight", "succeeded", result);
  const recovered = await journal.claimEffect(owner, { ...input, claimId: "retry-receipt", attemptId: "retry-receipt" });
  assert.equal(recovered.claim.status, "succeeded");
  assert.deepEqual(recovered.claim.result, result, "the durable receipt survives a later projection failure");
}

// Failpoint 4: reconciliation itself fails, then succeeds without redispatch.
{
  const input = effect("reconcile-failure");
  await journal.claimEffect(owner, input);
  await journal.transitionEffectClaim(owner, input.claimId, "claimed", "in_flight");
  await journal.transitionEffectClaim(owner, input.claimId, "in_flight", "outcome_unknown");
  assert.equal(await journal.transitionEffectClaim(owner, input.claimId, "claimed", "in_flight"), null, "stale reconciliation CAS cannot regress claim state");
  const stillUnknown = await journal.claimEffect(owner, { ...input, claimId: "retry-reconcile", attemptId: "retry-reconcile" });
  assert.equal(stillUnknown.claim.status, "outcome_unknown");
  const reconciled = await journal.transitionEffectClaim(owner, input.claimId, "outcome_unknown", "reconciled", { receipt: { receiptId: "receipt-reconciled", semanticStatus: "success" } });
  assert.equal(reconciled.status, "reconciled");
  await assert.rejects(() => journal.transitionEffectClaim(owner, input.claimId, "reconciled", "in_flight"), /invalid_effect_claim_transition/);
}

console.log("workflow-effect-claim-reconciliation.test.mjs passed");
