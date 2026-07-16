import assert from "node:assert/strict";
import { createInMemoryWorkflowDefinitionRepository, workflowDefinitionDigest } from "../../apps/standalone-sveltekit/src/lib/server/workflow-definition-repository.ts";
import { createInMemoryWorkflowRunJournalStore } from "../../apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts";
import { WorkflowRunDriver } from "../../apps/standalone-sveltekit/src/lib/server/workflow-run-driver.ts";
import { train0SelectedPathRunState, train0WorkflowFixtures } from "../../packages/tool-contracts/src/workflow-vnext-fixtures.ts";

const owner = { organizationId: "org-1", userId: "user-1" };
const lease = (id) => ({ leaseId: id, ownerId: id, expiresAt: new Date(Date.now() + 60_000).toISOString() });
const digest = (value) => `sha256:${value.repeat(64)}`;

async function run(resolveDependencyPins, suffix) {
  const runId = `run-pin-${suffix}`;
  const definition = structuredClone(train0WorkflowFixtures.linear);
  const state = { ...structuredClone(train0SelectedPathRunState), workflowRunId: runId, source: { kind: "published", organizationId: owner.organizationId, workflowVersionId: "workflow@1", definitionDigest: digest("e") }, status: "ready", revision: 0, eventSequence: 0, selectedPath: [], schedulerFrontier: [definition.entryNodeId], outputs: {}, outputRefs: {}, waits: [], compatibilityPhase: "ready" };
  const journal = createInMemoryWorkflowRunJournalStore({ getRun: () => ({}) });
  return new WorkflowRunDriver({ journal, owner, definition, initialState: state, resolveDependencyPins }).start({ workflowRunId: runId, lease: lease(suffix), budget: { maxNodes: 20, maxWallTimeMs: 10_000 } });
}

const v1Pins = structuredClone(train0SelectedPathRunState.dependencyPins);
const repository = createInMemoryWorkflowDefinitionRepository();
const v1Definition = structuredClone(train0WorkflowFixtures.linear);
const v1Draft = await repository.createDraft(owner, v1Definition, owner.userId);
assert.ok(v1Draft);
const v1VersionId = `${v1Definition.workflowId}@1`;
const publishedV1 = await repository.publish(owner, { workflowId: v1Definition.workflowId, expectedRevision: 0, workflowVersionId: v1VersionId, definitionDigest: v1Draft.definitionDigest, dependencyPins: { ...v1Pins, workflowVersionId: v1VersionId, definitionDigest: v1Draft.definitionDigest }, actorId: owner.userId });
assert.ok(publishedV1, "V1 is published through the lifecycle repository");

const runId = "run-pin-v1-after-v2";
const journal = createInMemoryWorkflowRunJournalStore({ getRun: () => ({}) });
const state = { ...structuredClone(train0SelectedPathRunState), workflowRunId: runId, source: { kind: "published", organizationId: owner.organizationId, workflowVersionId: publishedV1.workflowVersionId, definitionDigest: publishedV1.definitionDigest }, dependencyPins: publishedV1.dependencyPins, status: "ready", revision: 0, eventSequence: 0, selectedPath: [], schedulerFrontier: [publishedV1.definition.entryNodeId], outputs: {}, outputRefs: {}, waits: [], compatibilityPhase: "ready" };
const driver = new WorkflowRunDriver({ journal, owner, definition: publishedV1.definition, initialState: state, resolveDependencyPins: () => publishedV1.dependencyPins });
const request = { workflowRunId: runId, lease: lease("v1-after-v2"), budget: { maxNodes: 1, maxWallTimeMs: 10_000 } };
assert.equal((await driver.start(request)).status, "waiting", "V1 starts and persists a resumable frontier before V2 exists");

const v2Definition = { ...v1Definition, definitionVersion: 2, title: "V2" };
const v2Draft = await repository.updateDraft(owner, v1Definition.workflowId, 0, v2Definition, owner.userId);
assert.ok(v2Draft);
const v2VersionId = `${v1Definition.workflowId}@2`;
const v2Pins = { ...publishedV1.dependencyPins, workflowVersionId: v2VersionId, definitionDigest: workflowDefinitionDigest(v2Definition) };
const publishedV2 = await repository.publish(owner, { workflowId: v1Definition.workflowId, expectedRevision: 1, workflowVersionId: v2VersionId, definitionDigest: v2Draft.definitionDigest, dependencyPins: v2Pins, actorId: owner.userId });
assert.ok(publishedV2, "V2 is published through the same lifecycle repository");
const pinned = await driver.resume({ ...request, budget: { maxNodes: 20, maxWallTimeMs: 10_000 } });
assert.equal(pinned.status, "succeeded", "publishing V2 cannot move an existing V1 run off its immutable pins");
assert.equal(pinned.source.workflowVersionId, v1VersionId);
assert.deepEqual(pinned.dependencyPins, publishedV1.dependencyPins);
assert.notDeepEqual(publishedV2.dependencyPins, pinned.dependencyPins);

for (const key of Object.keys(v1Pins)) {
  const value = key === "organizationId" ? "org-2" : key === "workflowVersionId" ? "workflow@9" : digest("9");
  const drifted = await run(() => ({ ...v1Pins, [key]: value }), key);
  assert.equal(drifted.status, "failed", `${key} drift must stop dispatch`);
  assert.equal(drifted.compatibilityPhase, "dependency_pin_drift", `${key} drift is explicit`);
}

console.log("workflow-dependency-pinning.test.mjs passed");
