import assert from "node:assert/strict";
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
const v2Pins = { ...v1Pins, workflowVersionId: "workflow@2", definitionDigest: digest("2") };
const pinned = await run(() => v1Pins, "v1-after-v2");
assert.equal(pinned.status, "succeeded", "publishing V2 cannot move an existing V1 run off its immutable pins");
assert.equal(pinned.source.workflowVersionId, "workflow@1");
assert.notDeepEqual(v2Pins, pinned.dependencyPins);

for (const key of Object.keys(v1Pins)) {
  const value = key === "organizationId" ? "org-2" : key === "workflowVersionId" ? "workflow@9" : digest("9");
  const drifted = await run(() => ({ ...v1Pins, [key]: value }), key);
  assert.equal(drifted.status, "failed", `${key} drift must stop dispatch`);
  assert.equal(drifted.compatibilityPhase, "dependency_pin_drift", `${key} drift is explicit`);
}

console.log("workflow-dependency-pinning.test.mjs passed");
