import { z } from "zod";
import {
  CAPABILITY_READINESS_REASON_ORDER,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_VNEXT_NODE_TYPES,
  WORKFLOW_VNEXT_SCHEMA_VERSION,
  jsonValueSchema,
  parseEngineRequestForRegistry,
  parseEngineResponseForRegistry,
  workflowSchemaRefKey,
  type EngineRequest,
  type EngineResponse,
  type WorkflowNodeDescriptor,
  type WorkflowVNextDefinition,
  type WorkflowVNextNode,
} from "./workflow-vnext.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const schemaRef = (schemaId: string) => ({ schemaId, version: 1, digest: digest("a") });

const effects: Partial<Record<WorkflowVNextNode["nodeType"], WorkflowNodeDescriptor["effect"]>> = {
  tool_preview: "read",
  tool_commit: "write",
};

export const train0NodeDescriptorRegistry: WorkflowNodeDescriptor[] = WORKFLOW_VNEXT_NODE_TYPES.map((nodeType) => ({
  nodeType,
  typeVersion: 1,
  configSchema: schemaRef(`${nodeType}.config`),
  inputSchema: schemaRef(`${nodeType}.input`),
  outputSchema: schemaRef(`${nodeType}.output`),
  effect: effects[nodeType] ?? "none",
}));
export const train0WorkflowRuntimeRegistry = {
  descriptors: train0NodeDescriptorRegistry,
  schemas: new Map(train0NodeDescriptorRegistry.flatMap((descriptor) => [
    [workflowSchemaRefKey(descriptor.configSchema), z.record(z.string(), jsonValueSchema)],
    [workflowSchemaRefKey(descriptor.inputSchema), jsonValueSchema],
    [workflowSchemaRefKey(descriptor.outputSchema), jsonValueSchema],
  ])),
} as const;

const node = (nodeId: string, nodeType: WorkflowVNextNode["nodeType"], extra: Partial<WorkflowVNextNode> = {}): WorkflowVNextNode => ({
  nodeId,
  nodeType,
  typeVersion: 1,
  config: {},
  bindings: {},
  requiredHostContext: [],
  capabilityPins: [],
  output: { inlineByteLimit: 1024 },
  ...extra,
});

const definition = (
  workflowId: string,
  nodes: WorkflowVNextNode[],
  edges: WorkflowVNextDefinition["edges"],
  facadeToolIds: string[] = [],
): WorkflowVNextDefinition => ({
  schemaVersion: WORKFLOW_VNEXT_SCHEMA_VERSION,
  workflowId,
  definitionVersion: 1,
  title: workflowId,
  entryNodeId: nodes[0]!.nodeId,
  nodes,
  edges,
  facadeToolIds,
});

const edge = (edgeId: string, from: string, to: string) => ({ edgeId, from, to, default: false });
const commandId = "booking.create.booking";
const preview = (nodeId: string, effectId: string, hashCharacter: string) => node(nodeId, "tool_preview", {
  previewEffect: { commandId, logicalEffectId: effectId, resolvedInputHash: digest(hashCharacter) },
});
const approval = (nodeId: string, previewNodeId: string, commitNodeId: string, effectId: string, hashCharacter: string) => node(nodeId, "approval", {
  approvalEffect: {
    commandId,
    previewNodeId,
    approvalNodeId: nodeId,
    commitNodeId,
    logicalEffectId: effectId,
    resolvedInputHash: digest(hashCharacter),
  },
});
const commit = (nodeId: string, previewNodeId: string, approvalNodeId: string, effectId: string, hashCharacter: string) => node(nodeId, "tool_commit", {
  requiredHostContext: ["organizationId", "principalId"],
  capabilityPins: [commandId],
  effectBinding: {
    commandId,
    previewNodeId,
    approvalNodeId,
    logicalEffectId: effectId,
    resolvedInputHash: digest(hashCharacter),
  },
});

export const train0WorkflowFixtures = {
  linear: definition("train0.linear", [node("start", "trigger"), node("work", "skill")], [edge("e1", "start", "work")]),
  conditional: definition("train0.conditional", [
    node("start", "trigger"),
    node("choose", "branch", { bindings: { available: { source: "node_output", nodeId: "start", path: ["available"] } } }),
    node("yes", "evidence"),
    node("no", "artifact"),
  ], [
    edge("e1", "start", "choose"),
    { edgeId: "yes", from: "choose", to: "yes", default: false, predicate: { operator: "eq", left: { source: "node_output", nodeId: "start", path: ["available"] }, right: { value: true } } },
    { edgeId: "no", from: "choose", to: "no", default: true },
  ]),
  askUser: definition("train0.ask-user", [node("start", "trigger"), node("ask", "ask_user"), node("evidence", "evidence")], [edge("e1", "start", "ask"), edge("e2", "ask", "evidence")]),
  approval: definition("train0.approval", [
    node("start", "trigger"), preview("preview", "effect:approval", "b"), approval("approval", "preview", "commit", "effect:approval", "b"), commit("commit", "preview", "approval", "effect:approval", "b"),
  ], [edge("e1", "start", "preview"), edge("e2", "preview", "approval"), edge("e3", "approval", "commit")], [commandId]),
  failureRetry: definition("train0.failure-retry", [
    node("start", "trigger"), node("work", "skill", { config: { retry: { maxAttempts: 2, delayed: false }, terminalFailure: true } }), node("evidence", "evidence"),
  ], [edge("e1", "start", "work"), edge("e2", "work", "evidence")]),
  artifactEvidence: definition("train0.artifact-evidence", [node("start", "trigger"), node("artifact", "artifact"), node("evidence", "evidence")], [edge("e1", "start", "artifact"), edge("e2", "artifact", "evidence")]),
  multiCommit: definition("train0.multi-commit", [
    node("start", "trigger"),
    preview("preview-a", "effect:input-a", "c"), approval("approval-a", "preview-a", "commit-a", "effect:input-a", "c"), commit("commit-a", "preview-a", "approval-a", "effect:input-a", "c"),
    preview("preview-b", "effect:input-b", "d"), approval("approval-b", "preview-b", "commit-b", "effect:input-b", "d"), commit("commit-b", "preview-b", "approval-b", "effect:input-b", "d"),
  ], [
    edge("e1", "start", "preview-a"), edge("e2", "preview-a", "approval-a"), edge("e3", "approval-a", "commit-a"),
    edge("e4", "commit-a", "preview-b"), edge("e5", "preview-b", "approval-b"), edge("e6", "approval-b", "commit-b"),
  ], [commandId]),
} as const;

export const train0InvalidWorkflowFixtures = {
  invalidVersion: { ...structuredClone(train0WorkflowFixtures.linear), schemaVersion: "sonik.workflow.vnext.v0" },
  danglingEdge: { ...structuredClone(train0WorkflowFixtures.linear), edges: [{ edgeId: "bad", from: "start", to: "missing" }] },
  malformedWait: { kind: "approval", waitpointId: "wait", runId: "run", nodeId: "approval", subjectId: "user" },
  futureBinding: (() => {
    const fixture = structuredClone(train0WorkflowFixtures.linear);
    fixture.nodes[0]!.bindings = { future: { source: "node_output", nodeId: "work", path: [] } };
    return fixture;
  })(),
  unsupportedNode: definition("train0.unsupported", [node("start", "remote_execution")], []),
  reusedApproval: (() => {
    const fixture = structuredClone(train0WorkflowFixtures.multiCommit);
    fixture.nodes[6]!.effectBinding!.approvalNodeId = "approval-a";
    return fixture;
  })(),
} as const;

export const train0EngineRequest: EngineRequest = {
  workflowRunId: "run-1",
  workflowVersionId: "train0.approval@1",
  nodeId: "commit",
  nodeType: "tool_commit",
  typeVersion: 1,
  attempt: 2,
  attemptId: "attempt-2",
  logicalEffectId: "effect:approval",
  input: { guestName: "Ada" },
  contextSnapshot: { organizationId: "org-1" },
  capabilityPins: [commandId],
  idempotencyKey: "effect:approval",
};

export const train0EngineResponses: EngineResponse[] = [
  { status: "succeeded", output: { storage: "inline", value: { ok: true }, byteLength: 11 }, receipt: { receiptId: "receipt-1", semanticStatus: "success" } },
  { status: "waiting", waitpoint: { kind: "answer", waitpointId: "wait-answer", runId: "run-1", nodeId: "ask", subjectId: "user-1" } },
  { status: "retryable_error", error: { code: "provider_busy", message: "Retry immediately", retrySafe: true } },
  { status: "terminal_error", error: { code: "invalid_input", message: "Input rejected", retrySafe: false } },
];

export const train0PlainAiSdkExecutorFixture = {
  adapterId: "plain-ai-sdk",
  authority: "sonik",
  request: train0EngineRequest,
  responses: train0EngineResponses,
  supportsGovernedNestedWrites: false,
  delayedRetry: "excluded_until_queue_or_scheduled_wakeup_conformance",
  async execute(request: unknown, executor: (validated: EngineRequest) => Promise<unknown> = async () => train0EngineResponses[0]): Promise<EngineResponse> {
    const validated = parseEngineRequestForRegistry(request, train0WorkflowRuntimeRegistry);
    return parseEngineResponseForRegistry(validated, await executor(validated), train0WorkflowRuntimeRegistry);
  },
} as const;

export const train0SelectedPathRunState = {
  workflowRunId: "run-conditional",
  organizationId: "org-1",
  source: { kind: "published", organizationId: "org-1", workflowVersionId: "train0.conditional@1", definitionDigest: digest("e") },
  status: "succeeded",
  revision: 4,
  selectedPath: ["start", "choose", "yes"],
  schedulerFrontier: [],
  outputs: { yes: { storage: "inline", value: { selected: true }, byteLength: 17 } },
  waits: [],
  compatibilityPhase: "completed",
  dependencyPins: {
    organizationId: "org-1", workflowVersionId: "train0.conditional@1", definitionDigest: digest("e"),
    agentPublishedVersionId: "agent@1", nodeDescriptorsDigest: digest("f"), capabilityVersionsDigest: digest("1"),
    toolPackVersionsDigest: digest("2"), skillVersionsDigest: digest("3"), runtimePolicyDigest: digest("4"),
  },
} as const;

export const train0CanonicalEvent = {
  eventId: "event-1", schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION, eventVersion: 1, workflowRunId: "run-conditional",
  sequence: 1, revision: 1, actor: { kind: "system", id: "scheduler" }, subject: { kind: "run", id: "run-conditional" },
  causationId: "request-1", correlationIds: ["trace-1"], timestamp: "2026-07-15T12:00:00.000Z", eventType: "run_status_changed",
  payload: { status: "succeeded", compatibilityPhase: "completed" },
} as const;

export const train0CapabilityTruthSeed = {
  seed: 20260715,
  expectedReasonOrder: CAPABILITY_READINESS_REASON_ORDER,
} as const;
