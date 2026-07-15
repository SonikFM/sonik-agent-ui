import assert from "node:assert/strict";
import {
  dispatchWorkflowNode,
  workflowNodeExecutorDescriptors,
} from "../../apps/standalone-sveltekit/src/lib/server/workflow-node-executors.ts";
import { handleWorkflowRunsAction } from "../../apps/standalone-sveltekit/src/lib/server/workflow-runs.ts";
import { createInMemoryWorkflowRunStore, wrapWorkflowRunStoreAsync } from "../../apps/standalone-sveltekit/src/lib/server/workflow-run-store.ts";
import { workflowEffectIdempotencyKey } from "../../packages/tool-contracts/src/workflow-vnext.ts";

const request = (nodeType, extra = {}) => ({
  workflowRunId: "run-registry",
  workflowVersionId: "generic@1",
  nodeId: nodeType,
  nodeType,
  typeVersion: 1,
  attempt: 1,
  attemptId: `attempt-${nodeType}`,
  input: { value: true },
  contextSnapshot: { organizationId: "org-1" },
  capabilityPins: [],
  idempotencyKey: `attempt-${nodeType}`,
  ...extra,
});

assert.deepEqual(
  workflowNodeExecutorDescriptors.map(({ nodeType, typeVersion }) => `${nodeType}@${typeVersion}`),
  ["trigger@1", "ask_user@1", "skill@1", "reasoning@1", "artifact@1", "evidence@1", "tool_preview@1", "approval@1", "tool_commit@1", "branch@1"],
);
await assert.rejects(() => dispatchWorkflowNode({ ...request("skill"), typeVersion: 2 }), /unsupported_node_version:skill@2/);
await assert.rejects(() => dispatchWorkflowNode(request("remote_execution")), /unsupported_node_version:remote_execution@1/);

const attempts = [];
const skill = await dispatchWorkflowNode(request("skill"), { onAttempt: (event) => attempts.push(event) });
assert.equal(skill.status, "succeeded");
assert.deepEqual(attempts.map(({ phase, correlationId }) => [phase, correlationId]), [
  ["started", "attempt-skill"],
  ["finished", "attempt-skill"],
]);

assert.equal((await dispatchWorkflowNode(request("ask_user"), { subjectId: "user-1" })).status, "waiting");
assert.deepEqual((await dispatchWorkflowNode(request("ask_user"), { answer: "Ada" })).output.value, "Ada");

let reasoningAdapterCalled = false;
const governed = await dispatchWorkflowNode(request("reasoning"), {
  reasoning: {
    structuredOutputSchema: { schemaId: "reasoning.output", version: 1, digest: `sha256:${"a".repeat(64)}` },
    budgets: { maxSteps: 1, maxTokens: 100, maxWallTimeMs: 1000 },
    nestedCapabilityEffects: ["write"],
  },
  executors: { reasoning: () => { reasoningAdapterCalled = true; return { status: "terminal_error", error: { code: "unexpected", message: "called", retrySafe: false } }; } },
});
assert.equal(governed.status, "terminal_error");
assert.equal(governed.error.code, "reasoning_contract_required");
assert.equal(reasoningAdapterCalled, false, "nested governed writes fail before adapter invocation");

const logicalEffectId = "effect:generic";
const committed = await dispatchWorkflowNode(request("tool_commit", {
  logicalEffectId,
  idempotencyKey: workflowEffectIdempotencyKey("run-registry", logicalEffectId),
}), {
  executors: {
    tool_commit: () => ({
      status: "succeeded",
      output: { storage: "inline", value: { ok: true }, byteLength: 11 },
      receipt: { receiptId: "receipt-generic", semanticStatus: "success" },
    }),
  },
});
assert.equal(committed.status, "succeeded");
assert.equal(committed.receipt.receiptId, "receipt-generic");

const genericWorkflow = {
  workflowId: "builder.generic.preview",
  title: "Builder generic preview",
  triggerPhrases: [],
  nodes: [
    { nodeId: "start", type: "trigger", title: "Start", effect: "none", approvalPolicy: "none", requiredHostContext: [] },
    { nodeId: "preview", type: "tool_preview", title: "Preview", commandId: "generic.read", effect: "read", approvalPolicy: "none", requiredHostContext: [] },
  ],
  edges: [{ edgeId: "start-preview", from: "start", to: "preview" }],
  requiredSkills: [],
  requiredCommands: ["generic.read"],
  facadeToolIds: ["generic.read"],
  version: "1.0.0",
};
const hostSession = {
  authenticated: true,
  organizationId: "org-1",
  userId: "user-1",
  principalId: "user-1",
  sessionId: "session-1",
  source: "embedded",
  metadata: {},
};
const store = wrapWorkflowRunStoreAsync(createInMemoryWorkflowRunStore());
const endpointAttempts = [];
const started = await handleWorkflowRunsAction({ action: "start", workflowId: genericWorkflow.workflowId, workflow: genericWorkflow }, { hostSession, store });
assert.equal(started.ok, true, "builder-authored workflow starts without workflow-ID registration");
const previewed = await handleWorkflowRunsAction({ action: "preview", runId: started.run.runId, nodeId: "preview" }, {
  hostSession,
  store,
  onNodeAttempt: (event) => endpointAttempts.push(event),
});
assert.equal(previewed.ok, true, "builder-authored node dispatches through the descriptor registry");
assert.equal(previewed.run.phase, "preview_ready");
assert.deepEqual(endpointAttempts.map(({ phase, nodeType }) => [phase, nodeType]), [["started", "tool_preview"], ["finished", "tool_preview"]]);

console.log(JSON.stringify({ ok: true, checked: "workflow-node-executor-registry" }));
