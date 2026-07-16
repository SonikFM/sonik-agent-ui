import assert from "node:assert/strict";
import { sanitizePageContext, sanitizeTelemetryValue } from "../../packages/agent-observability/src/index.ts";
import { createInMemoryWorkflowRunJournalStore } from "../../apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts";
import { externalEffectIdempotencyKey, replayCanonicalWorkflowEvents } from "../../packages/tool-contracts/dist/workflow-vnext.js";
import { train0CanonicalEvent, train0SelectedPathRunState } from "../../packages/tool-contracts/dist/workflow-vnext-fixtures.js";
import { exportTranscriptMarkdown } from "../../apps/standalone-sveltekit/src/lib/support-export.ts";

const sentinel = `sk-${"persistence-secret".repeat(3)}`;
const serializedSafe = (value, boundary) => assert.equal(JSON.stringify(value).includes(sentinel), false, `${boundary} must not round-trip the sentinel`);

const owner = { organizationId: "org-redaction", userId: "user-redaction" };
const runId = "run-redaction";
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
await journal.claimEffect(owner, effect);
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
