import assert from "node:assert/strict";
import {
  CAPABILITY_READINESS_REASON_ORDER,
  INITIAL_DELAYED_RETRY_SUPPORT,
  boundedNodeOutputSchema,
  canonicalWorkflowEventSchema,
  computeCapabilityReadiness,
  engineRequestSchema,
  engineResponseSchema,
  parseCanonicalWorkflowEvent,
  parseEngineRequestForRegistry,
  parseEngineResponseForRegistry,
  publishedWorkflowVersionSchema,
  replayCanonicalWorkflowEvents,
  validateWorkflowForPublish,
  workflowDefinitionRecordSchema,
  workflowRunSourceSchema,
  workflowVNextRunStateSchema,
  workflowWaitpointSchema,
} from "../../packages/tool-contracts/dist/workflow-vnext.js";
import {
  train0CanonicalEvent,
  train0CapabilityTruthSeed,
  train0EngineRequest,
  train0EngineResponses,
  train0InvalidWorkflowFixtures,
  train0NodeDescriptorRegistry,
  train0WorkflowRuntimeRegistry,
  train0PlainAiSdkExecutorFixture,
  train0SelectedPathRunState,
  train0WorkflowFixtures,
} from "../../packages/tool-contracts/dist/workflow-vnext-fixtures.js";

for (const [name, fixture] of Object.entries(train0WorkflowFixtures)) {
  const result = validateWorkflowForPublish(fixture, train0WorkflowRuntimeRegistry);
  assert.equal(result.ok, true, `${name} fixture must publish-validate: ${!result.ok ? JSON.stringify(result.issues) : ""}`);
}

const invalidCases = [
  ["invalidVersion", "schema_invalid"],
  ["danglingEdge", "dangling_edge"],
  ["futureBinding", "unbound_node_output"],
  ["unsupportedNode", "node_not_publishable"],
  ["reusedApproval", "approval_binding_reused"],
];
for (const [name, expectedCode] of invalidCases) {
  const result = validateWorkflowForPublish(train0InvalidWorkflowFixtures[name], train0WorkflowRuntimeRegistry);
  assert.equal(result.ok, false, `${name} must fail publish validation`);
  assert.ok(result.issues.some((issue) => issue.code === expectedCode), `${name} must report ${expectedCode}: ${JSON.stringify(result.issues)}`);
}
assert.equal(workflowWaitpointSchema.safeParse(train0InvalidWorkflowFixtures.malformedWait).success, false, "approval waits require expiry and logical-effect binding");
assert.equal(INITIAL_DELAYED_RETRY_SUPPORT, "excluded_until_queue_or_scheduled_wakeup_conformance");
for (const [name, mutate, code] of [
  ["missingEntry", (fixture) => { fixture.entryNodeId = "missing"; }, "missing_entry"],
  ["duplicateNode", (fixture) => { fixture.nodes.push(structuredClone(fixture.nodes[0])); }, "duplicate_node"],
  ["ambiguousLinear", (fixture) => { fixture.edges.push({ edgeId: "e2", from: "start", to: "work", default: false }); }, "ambiguous_outgoing_edge"],
  ["parallelFanIn", (fixture) => { fixture.nodes.push({ ...structuredClone(fixture.nodes[1]), nodeId: "other" }); fixture.edges.push({ edgeId: "e2", from: "other", to: "work", default: false }); }, "parallel_fan_in"],
  ["invalidEffectOrder", (fixture) => { fixture.entryNodeId = "commit"; fixture.edges = [{ edgeId: "x1", from: "commit", to: "preview", default: false }, { edgeId: "x2", from: "preview", to: "approval", default: false }]; }, "invalid_effect_order"],
]) {
  const fixture = structuredClone(name === "invalidEffectOrder" ? train0WorkflowFixtures.approval : train0WorkflowFixtures.linear);
  mutate(fixture);
  const result = validateWorkflowForPublish(fixture, train0WorkflowRuntimeRegistry);
  assert.equal(result.ok, false, `${name} must fail`);
  assert.ok(result.issues.some((issue) => issue.code === code), `${name} must report ${code}`);
}

const multiCommit = train0WorkflowFixtures.multiCommit.nodes.filter((node) => node.nodeType === "tool_commit");
assert.equal(new Set(multiCommit.map((node) => node.effectBinding.previewNodeId)).size, 2, "each commit owns an exact preview");
assert.equal(new Set(multiCommit.map((node) => node.effectBinding.approvalNodeId)).size, 2, "each commit owns an exact approval");
assert.equal(new Set(multiCommit.map((node) => node.effectBinding.logicalEffectId)).size, 2, "distinct resolved inputs own distinct effects");
assert.equal(new Set(multiCommit.map((node) => node.effectBinding.resolvedInputHash)).size, 2, "distinct resolved inputs own distinct hashes");

const runState = workflowVNextRunStateSchema.parse(train0SelectedPathRunState);
assert.deepEqual(runState.selectedPath, ["start", "choose", "yes"]);
assert.equal(runState.selectedPath.includes("no"), false, "unselected branch is not claimed as completed");
assert.equal(boundedNodeOutputSchema.safeParse(runState.outputs.yes).success, true, "selected-path durable output stays bounded");

assert.equal(engineRequestSchema.safeParse(train0EngineRequest).success, true);
assert.deepEqual(parseEngineRequestForRegistry(train0EngineRequest, train0WorkflowRuntimeRegistry), train0EngineRequest);
for (const response of train0EngineResponses) assert.equal(engineResponseSchema.safeParse(response).success, true, response.status);
assert.equal(parseEngineResponseForRegistry(train0EngineRequest, train0EngineResponses[0], train0WorkflowRuntimeRegistry).status, "succeeded");
assert.equal(train0EngineRequest.idempotencyKey, train0EngineRequest.logicalEffectId, "logical-effect key is stable across attempts");
assert.notEqual(train0EngineRequest.attemptId, train0EngineRequest.logicalEffectId, "attempt identity remains separate");

assert.equal(canonicalWorkflowEventSchema.safeParse(train0CanonicalEvent).success, true, "canonical event envelope is versioned and correlated");
const replayInitial = { ...structuredClone(train0SelectedPathRunState), status: "running", revision: 0, selectedPath: [], outputs: {}, compatibilityPhase: "saving" };
const replayed = replayCanonicalWorkflowEvents(replayInitial, [train0CanonicalEvent]);
assert.equal(replayed.status, "succeeded");
assert.equal(replayed.compatibilityPhase, "completed");
assert.throws(() => replayCanonicalWorkflowEvents(replayInitial, [{ ...train0CanonicalEvent, eventVersion: 2 }]), /unsupported_workflow_event_version/);
assert.throws(() => replayCanonicalWorkflowEvents(replayInitial, [{ ...train0CanonicalEvent, revision: 2 }]), /invalid_workflow_event_order/, "replay rejects revision gaps");
assert.equal(parseCanonicalWorkflowEvent({ ...train0CanonicalEvent, schemaVersion: "sonik.workflow.event.v0", eventVersion: 0 }, {
  "sonik.workflow.event.v0@0": (event) => ({ ...event, schemaVersion: train0CanonicalEvent.schemaVersion, eventVersion: 1 }),
}).eventVersion, 1, "event version evolution crosses an explicit upcaster boundary");

const now = "2026-07-15T12:00:00.000Z";
const lifecycleRecord = { organizationId: "org-1", workflowId: train0WorkflowFixtures.linear.workflowId, draftRevision: 1, draft: train0WorkflowFixtures.linear, createdBy: "user-1", updatedBy: "user-1", createdAt: now, updatedAt: now };
assert.deepEqual(workflowDefinitionRecordSchema.parse(JSON.parse(JSON.stringify(lifecycleRecord))), lifecycleRecord, "draft lifecycle is durable JSON");
assert.equal(publishedWorkflowVersionSchema.safeParse({ organizationId: "org-1", workflowId: train0WorkflowFixtures.linear.workflowId, versionId: "v1", definitionDigest: `sha256:${"e".repeat(64)}`, definition: train0WorkflowFixtures.linear, sourceDraftRevision: 1, publishedBy: "user-1", publishedAt: now }).success, true);
assert.equal(workflowRunSourceSchema.safeParse({ kind: "debug_draft", organizationId: "org-1", workflowId: "w", draftRevision: 1, definitionDigest: `sha256:${"e".repeat(64)}`, executionMode: "read_preview_only" }).success, true);
assert.equal(train0PlainAiSdkExecutorFixture.authority, "sonik");
assert.equal(train0PlainAiSdkExecutorFixture.supportsGovernedNestedWrites, false);
assert.equal((await train0PlainAiSdkExecutorFixture.execute(train0EngineRequest)).status, "succeeded", "plain AI adapter fixture executes through canonical request/response validation");

for (const invalid of [
  { status: "unknown" },
  { status: "waiting", waitpoint: { kind: "approval", waitpointId: "w", runId: "r", nodeId: "n", subjectId: "u" } },
  { status: "succeeded", output: { storage: "artifact", artifact: { artifactId: "a", organizationId: "o", contentType: "x", byteLength: 1, digest: "bad", createdByNodeId: "n" } } },
]) assert.equal(engineResponseSchema.safeParse(invalid).success, false, "malformed engine responses fail closed");

function* capabilityCases() {
  const keys = ["registered", "implemented", "authorable", "definitionCompatible", "mounted", "contextReady", "grantReady", "previewable", "committable", "killSwitched", "versionPinned", "approvalGranted"];
  for (const effectMode of ["read", "write"]) for (let mask = 0; mask < 2 ** keys.length; mask += 1) {
    const input = { capabilityId: "booking.create.booking", effectMode };
    keys.forEach((key, index) => { input[key] = Boolean(mask & (1 << index)); });
    const registry = { schemaVersion: "sonik-agent-ui.capability-registry.v1", capabilities: input.registered ? [{ capabilityId: input.capabilityId, version: 1, title: "Booking", effect: effectMode, status: "active", implies: [] }] : [] };
    yield { registry, capabilityId: input.capabilityId, implementedCapabilityIds: input.implemented ? [input.capabilityId] : [], authorable: input.authorable, definitionCompatible: input.definitionCompatible, mounted: input.mounted, contextReady: input.contextReady, grantReady: input.grantReady, previewable: input.previewable, committable: input.committable, killSwitched: input.killSwitched, versionPinned: input.versionPinned, approvalGranted: input.approvalGranted };
  }
}

try {
  for (const input of capabilityCases()) {
    const readiness = computeCapabilityReadiness(input);
    const positions = readiness.reasonCodes.map((reason) => CAPABILITY_READINESS_REASON_ORDER.indexOf(reason));
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), "readiness reasons preserve capability truth order");
    assert.equal(readiness.callable, readiness.reasonCodes.length === 0, "callable never hides a blocking truth axis");
  }
} catch (error) {
  error.message = `seed=${train0CapabilityTruthSeed.seed}: ${error.message}`;
  throw error;
}

console.log(`workflow vNext CT-01..04 conformance passed (seed=${train0CapabilityTruthSeed.seed})`);
