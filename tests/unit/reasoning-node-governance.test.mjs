import assert from "node:assert/strict";
import { createInMemoryWorkflowRunJournalStore } from "../../apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts";
import { WorkflowRunDriver } from "../../apps/standalone-sveltekit/src/lib/server/workflow-run-driver.ts";
import { dispatchWorkflowNode } from "../../apps/standalone-sveltekit/src/lib/server/workflow-node-executors.ts";
import { train0SelectedPathRunState, train0WorkflowFixtures } from "../../packages/tool-contracts/src/workflow-vnext-fixtures.ts";

const owner = { organizationId: "org-1", userId: "user-1" };
const contract = { structuredOutputSchema: { schemaId: "reasoning.output", version: 1, digest: `sha256:${"a".repeat(64)}` }, budgets: { maxSteps: 1, maxTokens: 10, maxWallTimeMs: 100 }, nestedCapabilityEffects: [] };
const engineRequest = { workflowRunId: "run-reasoning", workflowVersionId: "workflow@1", nodeId: "reason", nodeType: "reasoning", typeVersion: 1, attempt: 1, attemptId: "run-reasoning:reason:1", input: { prompt: "safe" }, contextSnapshot: {}, capabilityPins: [], idempotencyKey: "reason-1" };

assert.equal((await dispatchWorkflowNode(engineRequest, {})).error.code, "reasoning_contract_required");
assert.equal((await dispatchWorkflowNode(engineRequest, { reasoning: { ...contract, nestedCapabilityEffects: ["write"] } })).error.code, "reasoning_contract_required", "nested governed writes fail closed at contract validation");

async function governedRun({ usage, output, inlineOutputByteLimit = 64, now, driverNow }) {
  const definition = structuredClone(train0WorkflowFixtures.linear);
  definition.nodes[1].nodeType = "reasoning";
  definition.nodes[1].reasoning = contract;
  const runId = `run-reasoning-${usage.steps}-${usage.tokens}-${inlineOutputByteLimit}`;
  const state = { ...structuredClone(train0SelectedPathRunState), workflowRunId: runId, source: { kind: "published", organizationId: owner.organizationId, workflowVersionId: "workflow@1", definitionDigest: `sha256:${"e".repeat(64)}` }, status: "ready", revision: 0, eventSequence: 0, selectedPath: [], schedulerFrontier: [definition.entryNodeId], outputs: {}, outputRefs: {}, waits: [], compatibilityPhase: "ready" };
  const journal = createInMemoryWorkflowRunJournalStore({ getRun: () => ({}) });
  const context = (node) => node.nodeType === "reasoning" ? { reasoning: contract, reasoningUsage: usage, inlineOutputByteLimit, now, executors: { reasoning: () => ({ status: "succeeded", output }) } } : {};
  const driver = new WorkflowRunDriver({ journal, owner, definition, initialState: state, executionContext: context, now: driverNow });
  const request = { workflowRunId: runId, lease: { leaseId: runId, ownerId: runId, expiresAt: new Date(Date.now() + 60_000).toISOString() }, budget: { maxNodes: 20, maxWallTimeMs: 10_000 } };
  return { state: await driver.start(request), driver, journal, request };
}

const resumableUsage = { steps: 2, tokens: 1 };
const cases = [
  { usage: resumableUsage, output: { storage: "inline", value: { ok: true }, byteLength: 11 } },
  { usage: { steps: 1, tokens: 11 }, output: { storage: "inline", value: { ok: true }, byteLength: 11 } },
  { usage: { steps: 1, tokens: 1 }, output: { storage: "inline", value: { text: "too large" }, byteLength: 20 }, inlineOutputByteLimit: 4 },
];
let resumable;
for (const input of cases) {
  const run = await governedRun(input);
  const yielded = run.state;
  assert.equal(yielded.status, "waiting", "reasoning exhaustion is a visible persisted yield, not terminal failure");
  assert.equal(yielded.waits[0].kind, "budget_yield");
  assert.deepEqual(yielded.schedulerFrontier, ["work"], "yield preserves the resumable reasoning frontier");
  assert.equal(yielded.outputs.work, undefined, "rejected reasoning output is not persisted inline at yield");
  const yieldEvent = (await run.journal.listEvents(owner, yielded.workflowRunId)).at(-1);
  assert.equal(yieldEvent.eventType, "wait_created", "yield is persisted as a canonical event");
  assert.equal(yieldEvent.payload.waitpoint.waitpointId, yielded.waits[0].waitpointId);
  resumable ??= run;
}
resumableUsage.steps = 1;
assert.equal((await resumable.driver.resume(resumable.request)).status, "succeeded", "a persisted reasoning yield resumes from the same frontier after budget replenishment");

const artifact = { storage: "artifact", artifact: { artifactId: "artifact-reasoning", organizationId: owner.organizationId, contentType: "application/json", byteLength: 1000, digest: `sha256:${"b".repeat(64)}`, createdByNodeId: "work" } };
const artifactRun = await governedRun({ usage: { steps: 1, tokens: 1 }, output: artifact, inlineOutputByteLimit: 1 });
assert.equal(artifactRun.state.status, "succeeded", "large safe output uses ArtifactRef instead of leaking inline data");
assert.deepEqual(artifactRun.state.outputRefs.work, artifact, "the persisted output reference is the bounded ArtifactRef");

let clock = 0;
const wallTimeRun = await governedRun({ usage: { steps: 1, tokens: 1 }, output: { storage: "inline", value: { secret: "must-not-persist" }, byteLength: 29 }, driverNow: () => (clock += 101) });
assert.equal(wallTimeRun.state.status, "waiting", "wall-time exhaustion yields instead of failing");
assert.equal(wallTimeRun.state.waits[0].wakeupReason, "wall_time_budget_exhausted");
assert.equal(wallTimeRun.state.outputs.work, undefined, "wall-time yield does not persist unsafe output");
assert.equal((await wallTimeRun.journal.listEvents(owner, wallTimeRun.state.workflowRunId)).at(-1).eventType, "wait_created", "wall-time yield is durably evented");

const ambiguous = structuredClone(train0WorkflowFixtures.conditional);
ambiguous.nodes[0].bindings = { available: { source: "constant", value: true } };
ambiguous.edges[2] = { ...ambiguous.edges[2], default: false, predicate: structuredClone(ambiguous.edges[1].predicate) };
const ambiguousId = "run-ambiguous-branch";
const ambiguousState = { ...structuredClone(train0SelectedPathRunState), workflowRunId: ambiguousId, source: { kind: "published", organizationId: owner.organizationId, workflowVersionId: "workflow@1", definitionDigest: `sha256:${"e".repeat(64)}` }, status: "ready", revision: 0, eventSequence: 0, selectedPath: [], schedulerFrontier: [ambiguous.entryNodeId], outputs: {}, outputRefs: {}, waits: [], compatibilityPhase: "ready" };
const ambiguousDriver = new WorkflowRunDriver({ journal: createInMemoryWorkflowRunJournalStore({ getRun: () => ({}) }), owner, definition: ambiguous, initialState: ambiguousState });
await assert.rejects(() => ambiguousDriver.start({ workflowRunId: ambiguousId, lease: { leaseId: ambiguousId, ownerId: ambiguousId, expiresAt: new Date(Date.now() + 60_000).toISOString() }, budget: { maxNodes: 20, maxWallTimeMs: 10_000 } }), /branch_ambiguous_match/, "runtime fails closed when more than one structured branch predicate matches");

console.log("reasoning-node-governance.test.mjs passed");
