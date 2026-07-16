import assert from "node:assert/strict";
import { sanitizePageContext, sanitizeTelemetryValue } from "../../packages/agent-observability/src/index.ts";
import {
  createCloudWorkflowRunStore,
  createInMemoryWorkflowRunStore,
  createCloudWorkflowRunJournalStore,
  createInMemoryWorkflowRunJournalStore,
} from "../../apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts";
import { externalEffectIdempotencyKey, replayCanonicalWorkflowEvents } from "../../packages/tool-contracts/dist/workflow-vnext.js";
import { train0CanonicalEvent, train0SelectedPathRunState } from "../../packages/tool-contracts/dist/workflow-vnext-fixtures.js";
import { exportTranscriptMarkdown } from "../../apps/standalone-sveltekit/src/lib/support-export.ts";

const sentinel = `sk-${"persistence-secret".repeat(3)}`;
const serializedSafe = (value, boundary) => assert.equal(JSON.stringify(value).includes(sentinel), false, `${boundary} must not round-trip the sentinel`);

const owner = { organizationId: "org-redaction", userId: "user-redaction" };
const runId = "run-redaction";
const safeRunInput = { workflowId: "workflow-safe", workflowVersionId: "workflow-safe@1", definition: {}, input: { campaign: "safe" }, state: { runId } };
const unsafeRunInput = { ...safeRunInput, input: { apiKey: sentinel } };
const runStore = createInMemoryWorkflowRunStore();
assert.throws(
  () => runStore.createRun(owner, unsafeRunInput),
  /workflow_persistence_secret_rejected/,
  "in-memory run creation rejects secret-bearing input before persistence",
);
assert.equal(runStore.getRun(owner, runId), null, "rejected in-memory run input creates no row");
assert.deepEqual(runStore.createRun(owner, safeRunInput).input, safeRunInput.input, "safe run input remains exact");

const isolationRunId = "run-isolation";
const isolationInput = {
  workflowId: "workflow-isolation",
  workflowVersionId: "workflow-isolation@1",
  definition: { metadata: { label: "safe" } },
  input: { campaign: { name: "safe" } },
  state: { runId: isolationRunId, output: { status: "safe" } },
};
const isolationStore = createInMemoryWorkflowRunStore();
const createdRow = isolationStore.createRun(owner, isolationInput);
isolationInput.definition.metadata.label = sentinel;
isolationInput.input.campaign.name = sentinel;
isolationInput.state.output.status = sentinel;
createdRow.definition.metadata.label = sentinel;
createdRow.input.campaign.name = sentinel;
createdRow.state.output.status = sentinel;
const fetchedRow = isolationStore.getRun(owner, isolationRunId);
assert.equal(fetchedRow.definition.metadata.label, "safe", "create input and return are isolated from persisted definition");
assert.equal(fetchedRow.input.campaign.name, "safe", "create input and return are isolated from persisted input");
assert.equal(fetchedRow.state.output.status, "safe", "create input and return are isolated from persisted state");
fetchedRow.input.campaign.name = sentinel;
const listedRow = isolationStore.listRuns(owner).find(({ runId: listedRunId }) => listedRunId === isolationRunId);
assert.equal(listedRow.input.campaign.name, "safe", "get returns are isolated from persisted rows");
listedRow.definition.metadata.label = sentinel;
assert.equal(isolationStore.getRun(owner, isolationRunId).definition.metadata.label, "safe", "list returns are isolated from persisted rows");
const nextState = { runId: isolationRunId, output: { status: "updated" } };
const updatedRow = isolationStore.updateRunState(owner, isolationRunId, nextState);
nextState.output.status = sentinel;
updatedRow.state.output.status = sentinel;
const canonicalRow = isolationStore.getRun(owner, isolationRunId);
assert.equal(canonicalRow.state.output.status, "updated", "update input and return are isolated from persisted state");
serializedSafe(canonicalRow, "canonical in-memory workflow run");

const cloudRunQueries = [];
const cloudRunStore = createCloudWorkflowRunStore({
  async transaction(operation) {
    return operation({
      async query(sql, params = []) {
        cloudRunQueries.push({ sql, params });
        return { rows: [] };
      },
    });
  },
});
await assert.rejects(
  () => cloudRunStore.createRun(owner, { ...safeRunInput, state: { ...safeRunInput.state, password: sentinel } }),
  /workflow_persistence_secret_rejected/,
  "cloud run creation rejects secret-bearing state before SQL",
);
assert.equal(cloudRunQueries.length, 0, "rejected cloud run values never reach SQL");

const journal = createInMemoryWorkflowRunJournalStore({ getRun: () => ({}) });
const externalEffectIdentity = {
  namespace: "booking:v1:create",
  keyDigest: `sha256:${"1".repeat(64)}`,
  commandId: "booking.create.booking",
  resolvedInputHash: `sha256:${"2".repeat(64)}`,
};
const effect = {
  claimId: "claim-redaction",
  runId,
  logicalEffectId: "effect-redaction",
  attemptId: "attempt-redaction",
  externalEffectIdentity,
  idempotencyKey: externalEffectIdempotencyKey(externalEffectIdentity),
  providerSupportsIdempotency: true,
};
await assert.rejects(
  () => journal.claimEffect(owner, { ...effect, attemptId: `attempt-${sentinel}` }),
  /workflow_persistence_secret_rejected/,
  "attempt persistence rejects secret-shaped identities before claim creation",
);
const createdClaim = await journal.claimEffect(owner, effect);
createdClaim.claim.attemptId = "mutated-created-return";
const replayedCreatedClaim = await journal.claimEffect(owner, { ...effect, claimId: "claim-redaction-created-replay", attemptId: "attempt-redaction-created-replay" });
assert.equal(replayedCreatedClaim.claim.attemptId, effect.attemptId, "mutating a newly created claim cannot alter the persisted claim");
await journal.transitionEffectClaim(owner, effect.claimId, "claimed", "in_flight");
const longSafeString = "safe-replay-data-".repeat(300);
const longSafeList = Array.from({ length: 80 }, (_, index) => ({ index, value: `safe-${index}` }));
const deepSafeValue = { level1: { level2: { level3: { level4: { level5: { level6: "exact-safe-leaf" } } } } } };
const persistedClaim = await journal.transitionEffectClaim(owner, effect.claimId, "in_flight", "succeeded", {
  output: { storage: "inline", value: { longSafeString, longSafeList, deepSafeValue, authorization: sentinel, uploadedContent: sentinel }, byteLength: sentinel.length },
  receipt: { receiptId: "receipt-redaction", semanticStatus: "success", providerToken: sentinel },
});
serializedSafe(persistedClaim, "effect claim");
assert.equal(persistedClaim.result.output.value.authorization, "[REDACTED]");
assert.equal(persistedClaim.result.receipt.providerToken, "[REDACTED]");
assert.equal(persistedClaim.result.output.value.longSafeString, longSafeString, "safe long strings remain byte-for-byte replayable");
assert.deepEqual(persistedClaim.result.output.value.longSafeList, longSafeList, "safe lists are never telemetry-truncated");
assert.deepEqual(persistedClaim.result.output.value.deepSafeValue, deepSafeValue, "safe nested JSON preserves its full depth");
persistedClaim.result.receipt.providerToken = sentinel;
const replayedClaim = await journal.claimEffect(owner, { ...effect, claimId: "claim-redaction-replay", attemptId: "attempt-redaction-replay" });
assert.equal(replayedClaim.created, false);
assert.equal(replayedClaim.claim.result.receipt.providerToken, "[REDACTED]", "mutating a returned transition result cannot alter the persisted claim");
assert.deepEqual(replayedClaim.claim.result.output.value.longSafeList, longSafeList, "idempotent claim replay returns the complete safe payload");
assert.equal(replayedClaim.claim.result.output.value.longSafeString, longSafeString);
replayedClaim.claim.result.receipt.providerToken = sentinel;
const replayedAgain = await journal.claimEffect(owner, { ...effect, claimId: "claim-redaction-replay-again", attemptId: "attempt-redaction-replay-again" });
assert.equal(replayedAgain.claim.result.receipt.providerToken, "[REDACTED]", "mutating an idempotent replay cannot alter the persisted claim");

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
await journal.acquireLease(owner, train0CanonicalEvent.workflowRunId, { leaseId: "lease-redaction", ownerId: "worker-redaction", expiresAt: new Date(Date.now() + 60_000).toISOString() });
await assert.rejects(
  () => journal.appendEventAndProject(owner, { expectedRevision: 0, leaseId: "lease-redaction", event: { ...train0CanonicalEvent, attemptId: `attempt-${sentinel}` }, snapshot }),
  /workflow_persistence_secret_rejected/,
  "canonical event persistence rejects a secret-shaped attempt identity",
);
await assert.rejects(
  () => journal.appendEventAndProject(owner, { expectedRevision: 0, leaseId: "lease-redaction", event: train0CanonicalEvent, snapshot: { ...snapshot, source: { ...snapshot.source, workflowVersionId: `version-${sentinel}` } } }),
  /workflow_persistence_secret_rejected/,
  "snapshot persistence rejects secret-shaped source identifiers",
);

const secretOutputValue = { password: "hunter2" };
const secretKeySnapshot = {
  ...snapshot,
  outputs: {
    ...snapshot.outputs,
    unsafe: {
      storage: "inline",
      value: secretOutputValue,
      byteLength: new TextEncoder().encode(JSON.stringify(secretOutputValue)).byteLength,
    },
  },
};
await assert.rejects(
  () => journal.appendEventAndProject(owner, { expectedRevision: 0, leaseId: "lease-redaction", event: train0CanonicalEvent, snapshot: secretKeySnapshot }),
  /workflow_persistence_secret_rejected/,
  "in-memory canonical persistence rejects ordinary secret-bearing object keys",
);

const cloudQueries = [];
const cloudJournal = createCloudWorkflowRunJournalStore({
  async transaction(operation) {
    return operation({
      async query(sql, params = []) {
        cloudQueries.push({ sql, params });
        return { rows: [] };
      },
    });
  },
});
await assert.rejects(
  () => cloudJournal.appendEventAndProject(owner, { expectedRevision: 0, leaseId: "lease-redaction", event: train0CanonicalEvent, snapshot: secretKeySnapshot }),
  /workflow_persistence_secret_rejected/,
  "cloud canonical persistence rejects ordinary secret-bearing object keys before SQL serialization",
);
assert.equal(cloudQueries.length, 0, "rejected secret-keyed snapshots never reach cloud SQL parameters");

const artifactMetadata = sanitizeTelemetryValue({ artifactId: "artifact-1", digest: `sha256:${"3".repeat(64)}`, title: `upload ${sentinel}`, uploadedContent: sentinel, authorization: sentinel });
serializedSafe(artifactMetadata, "artifact metadata");
assert.equal(artifactMetadata.authorization, "[REDACTED]");

const hostContext = sanitizePageContext({
  route: "/chat",
  activeSessionId: "session-redaction",
  hostSession: { authorization: sentinel, uploadedDocument: sentinel },
  headers: { authorization: sentinel },
  correlation: { sessionId: "session-redaction", requestId: "request-redaction", status: "success", capturedAt: "2026-07-16T00:00:00.000Z", prompt: sentinel },
});
serializedSafe(hostContext, "host/support context");
assert.equal("hostSession" in hostContext, false, "raw authorized host context is not allowlisted");

const support = exportTranscriptMarkdown([{ role: "user", content: "fallback", parts: [{ type: "text", text: "visible" }, { type: "file", content: sentinel, name: "upload.txt" }, { type: "data-spec", spec: { secret: sentinel } }] }]);
serializedSafe(support, "support projection");
assert.equal(support.includes("visible"), true);

console.log("workflow-persistence-redaction.test.mjs passed");
