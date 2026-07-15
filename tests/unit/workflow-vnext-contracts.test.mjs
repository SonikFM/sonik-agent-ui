import assert from "node:assert/strict";
import {
  MAX_INLINE_OUTPUT_BYTES,
  WORKFLOW_EVENT_SCHEMA_VERSION,
  WORKFLOW_VNEXT_SCHEMA_VERSION,
  approvalDecisionSchema,
  bridgeLegacyWorkflowDefinitionToVNext,
  boundedNodeOutputSchema,
  canonicalWorkflowEventSchema,
  computeCapabilityReadiness,
  parseEngineRequestForRegistry,
  engineResponseSchema,
  publicApprovalDecisionRequestSchema,
  validateWorkflowForPublish,
  validateApprovalDecisionForCommit,
  workflowOrganizerPatchSchema,
  workflowWaitpointSchema,
  workflowSchemaRefKey,
  canTransitionEffectClaim,
} from "../../packages/tool-contracts/dist/workflow-vnext.js";

const digest = `sha256:${"a".repeat(64)}`;
const schemaRef = (schemaId) => ({ schemaId, version: 1, digest });
const descriptor = (nodeType, effect = "none") => ({
  nodeType,
  typeVersion: 1,
  configSchema: schemaRef(`${nodeType}.config`),
  inputSchema: schemaRef(`${nodeType}.input`),
  outputSchema: schemaRef(`${nodeType}.output`),
  effect,
});
const registry = [descriptor("trigger"), descriptor("tool_preview", "read"), descriptor("approval"), descriptor("tool_commit", "write")];
const runtimeRegistry = {
  descriptors: registry,
  schemas: new Map(registry.flatMap((item) => [
    [workflowSchemaRefKey(item.configSchema), { safeParse: (value) => ({ success: value !== null && typeof value === "object" && !Array.isArray(value) }), parse: (value) => value }],
    [workflowSchemaRefKey(item.inputSchema), { safeParse: () => ({ success: true }), parse: (value) => value }],
    [workflowSchemaRefKey(item.outputSchema), { safeParse: () => ({ success: true }), parse: (value) => value }],
  ])),
};
const node = (nodeId, nodeType, extra = {}) => ({
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
const definition = {
  schemaVersion: WORKFLOW_VNEXT_SCHEMA_VERSION,
  workflowId: "booking.create",
  definitionVersion: 1,
  title: "Create booking",
  entryNodeId: "start",
  facadeToolIds: ["booking.create.booking"],
  nodes: [
    node("start", "trigger"),
    node("preview", "tool_preview", { previewEffect: { commandId: "booking.create.booking", logicalEffectId: "booking.create.booking:input-a", resolvedInputHash: digest } }),
    node("approve", "approval", { approvalEffect: { commandId: "booking.create.booking", previewNodeId: "preview", approvalNodeId: "approve", commitNodeId: "commit", logicalEffectId: "booking.create.booking:input-a", resolvedInputHash: digest } }),
    node("commit", "tool_commit", {
      requiredHostContext: ["organizationId"],
      capabilityPins: ["booking.create.booking"],
      effectBinding: {
        commandId: "booking.create.booking",
        previewNodeId: "preview",
        approvalNodeId: "approve",
        logicalEffectId: "booking.create.booking:input-a",
        resolvedInputHash: digest,
      },
    }),
  ],
  edges: [
    { edgeId: "e1", from: "start", to: "preview" },
    { edgeId: "e2", from: "preview", to: "approve" },
    { edgeId: "e3", from: "approve", to: "commit" },
  ],
};

const publishResult = validateWorkflowForPublish(definition, runtimeRegistry);
assert.equal(publishResult.ok, true, `canonical definition publish-validates: ${JSON.stringify(publishResult)}`);
const unknownVersion = structuredClone(definition);
unknownVersion.nodes[0].typeVersion = 2;
assert.equal(validateWorkflowForPublish(unknownVersion, runtimeRegistry).ok, false, "unknown descriptor versions fail before execution");
const cycle = structuredClone(definition);
cycle.edges.push({ edgeId: "cycle", from: "commit", to: "start" });
assert.equal(validateWorkflowForPublish(cycle, runtimeRegistry).ok, false, "cycles fail initial publish validation");
const missingApproval = structuredClone(definition);
missingApproval.nodes[3].effectBinding.approvalNodeId = "preview";
assert.equal(validateWorkflowForPublish(missingApproval, runtimeRegistry).ok, false, "commit must bind an approval node");
const futureBinding = structuredClone(definition);
futureBinding.nodes[0].bindings = { invalid: { source: "node_output", nodeId: "commit", path: [] } };
assert.equal(validateWorkflowForPublish(futureBinding, runtimeRegistry).ok, false, "bindings may only reference prior node outputs");
const mismatchedPreview = structuredClone(definition);
mismatchedPreview.nodes[1].previewEffect.commandId = "booking.cancel.booking";
assert.equal(validateWorkflowForPublish(mismatchedPreview, runtimeRegistry).ok, false, "preview and commit bind the same exact effect instance");
const unpinnedCommitCommand = structuredClone(definition);
unpinnedCommitCommand.nodes[3].capabilityPins = ["booking.cancel.booking"];
assert.equal(validateWorkflowForPublish(unpinnedCommitCommand, runtimeRegistry).ok, false, "commit command must be explicitly capability-pinned");
const invalidConfig = structuredClone(definition);
invalidConfig.nodes[0].config = "not-an-object";
assert.equal(validateWorkflowForPublish(invalidConfig, runtimeRegistry).ok, false, "publish validation resolves descriptor config schemas");

const inlineValue = { ok: true };
const byteLength = new TextEncoder().encode(JSON.stringify(inlineValue)).byteLength;
assert.equal(boundedNodeOutputSchema.safeParse({ storage: "inline", value: inlineValue, byteLength }).success, true);
assert.equal(boundedNodeOutputSchema.safeParse({ storage: "inline", value: inlineValue, byteLength: byteLength + 1 }).success, false);
assert.equal(boundedNodeOutputSchema.safeParse({ storage: "inline", value: "x", byteLength: MAX_INLINE_OUTPUT_BYTES + 1 }).success, false);

assert.equal(workflowWaitpointSchema.safeParse({ kind: "answer", waitpointId: "w1", runId: "r1", nodeId: "ask", subjectId: "u1" }).success, true);
assert.equal(workflowWaitpointSchema.safeParse({ kind: "delayed_retry", waitpointId: "w2" }).success, false, "unproven delayed retries stay excluded");
assert.equal(engineResponseSchema.safeParse({ status: "succeeded", output: { storage: "inline", value: null, byteLength: 4 }, receipt: { receiptId: "r", semanticStatus: "failure" } }).success, false, "success receipts require semantic success");

const approval = {
  decisionId: "decision-1", decision: "approved", runId: "run-1", approvalNodeId: "approve", previewNodeId: "preview",
  commitNodeId: "commit", commandId: "booking.create.booking", logicalEffectId: "booking.create.booking:input-a", organizationId: "org-1", approverId: "user-1",
  grantEvidenceDigest: digest, resolvedInputHash: digest, issuedAt: "2026-07-15T12:00:00.000Z", expiresAt: "2026-07-15T12:05:00.000Z", hostSigned: true,
};
assert.equal(approvalDecisionSchema.safeParse(approval).success, true);
assert.equal(publicApprovalDecisionRequestSchema.safeParse(approval).success, false, "public DTO rejects hostSigned");
assert.equal(validateApprovalDecisionForCommit(approval, definition, "commit").decision, "approved");
assert.throws(() => validateApprovalDecisionForCommit({ ...approval, logicalEffectId: "sibling" }, definition, "commit"), /approval_effect_binding_mismatch/);
const swappedCommand = structuredClone(definition);
swappedCommand.nodes[3].effectBinding.commandId = "booking.cancel.booking";
assert.throws(() => validateApprovalDecisionForCommit(approval, swappedCommand, "commit"), /approval_effect_binding_mismatch/, "approval is invalid after the workflow command changes");
const { hostSigned: _hostSigned, ...publicApproval } = approval;
assert.equal(publicApprovalDecisionRequestSchema.safeParse(publicApproval).success, true, "server derives hostSigned after public DTO validation");
for (const field of [
  "decisionId", "decision", "runId", "approvalNodeId", "previewNodeId", "commitNodeId", "commandId", "logicalEffectId",
  "organizationId", "approverId", "grantEvidenceDigest", "resolvedInputHash", "issuedAt", "expiresAt", "hostSigned",
]) {
  const invalid = structuredClone(approval);
  delete invalid[field];
  assert.equal(approvalDecisionSchema.safeParse(invalid).success, false, `approval requires immutable ${field}`);
}

const allowedEffectTransitions = new Set(["claimed:in_flight", "in_flight:succeeded", "in_flight:failed", "in_flight:outcome_unknown", "outcome_unknown:reconciled"]);
for (const from of ["claimed", "in_flight", "succeeded", "failed", "outcome_unknown", "reconciled"]) {
  for (const to of ["claimed", "in_flight", "succeeded", "failed", "outcome_unknown", "reconciled"]) {
    assert.equal(canTransitionEffectClaim(from, to), allowedEffectTransitions.has(`${from}:${to}`), `${from} -> ${to} transition is frozen`);
  }
}

const capabilityRegistry = { schemaVersion: "sonik-agent-ui.capability-registry.v1", capabilities: [{ capabilityId: "booking.create.booking", version: 1, title: "Create booking", effect: "write", status: "active", implies: [] }] };
const readiness = computeCapabilityReadiness({
  registry: { ...capabilityRegistry, capabilities: [] }, capabilityId: "booking.create.booking", implementedCapabilityIds: ["booking.create.booking"], authorable: true, definitionCompatible: true,
  mounted: true, contextReady: false, grantReady: false, previewable: false, committable: false, killSwitched: true, versionPinned: false,
});
assert.deepEqual(readiness.reasonCodes, ["not_registered", "not_implemented", "missing_context", "missing_host_grant", "kill_switched", "version_not_pinned", "preview_required"]);
assert.equal(readiness.callable, false);
assert.equal(readiness.nextAction, "not_registered");
assert.equal(computeCapabilityReadiness({ registry: capabilityRegistry, capabilityId: "booking.create.booking", implementedCapabilityIds: ["booking.create.booking"], authorable: true, definitionCompatible: true, mounted: true, contextReady: true, grantReady: true, killSwitched: false, versionPinned: true, previewable: true, committable: false, approvalGranted: true }).callable, false, "approval cannot make a non-committable write callable");
assert.equal(computeCapabilityReadiness({ capabilityId: "unknown.capability", implementedCapabilityIds: ["unknown.capability"], authorable: true, definitionCompatible: true, mounted: true, contextReady: true, grantReady: true, killSwitched: false, versionPinned: true, previewable: true, committable: true, approvalGranted: true }).callable, false, "unknown capabilities default deny regardless of caller booleans");

assert.equal(workflowOrganizerPatchSchema.safeParse({ expectedDraftRevision: 1, edits: [{ kind: "safe_patch", path: "nodes.commit.config.timeout", value: 10 }] }).success, true);
assert.equal(workflowOrganizerPatchSchema.safeParse({ expectedDraftRevision: 1, edits: [{ kind: "safe_patch", path: "nodes.commit.nodeType", value: "remote_execution" }] }).success, false);
for (const path of ["nodes.__proto__.config.x", "nodes.constructor.config.x", "nodes.commit.config.prototype.x"]) assert.equal(workflowOrganizerPatchSchema.safeParse({ expectedDraftRevision: 1, edits: [{ kind: "safe_patch", path, value: true }] }).success, false, `${path} is rejected`);

assert.equal(bridgeLegacyWorkflowDefinitionToVNext({ workflowId: "legacy", title: "Legacy", triggerPhrases: [], nodes: [{ nodeId: "start", type: "trigger", title: "Start", effect: "none", approvalPolicy: "none", requiredHostContext: [] }], edges: [], requiredSkills: [], requiredCommands: [], facadeToolIds: [], version: "1.0.0" }).requiresCanonicalUpgrade, true);
assert.throws(() => parseEngineRequestForRegistry({ workflowRunId: "r", workflowVersionId: "v", nodeId: "commit", nodeType: "tool_commit", typeVersion: 1, attempt: 1, attemptId: "a", logicalEffectId: "effect", input: {}, contextSnapshot: {}, capabilityPins: ["booking.create.booking"], idempotencyKey: "wrong" }, runtimeRegistry), /idempotencyKey|invalid_effect_idempotency/);

assert.equal(canonicalWorkflowEventSchema.safeParse({
  eventId: "event-1", schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION, eventVersion: 1, workflowRunId: "run-1", sequence: 1, revision: 1,
  actor: { kind: "system", id: "scheduler" }, subject: { kind: "run", id: "run-1" }, causationId: "request-1",
  correlationIds: ["trace-1"], timestamp: "2026-07-15T12:00:00.000Z", eventType: "run_status_changed",
  payload: { status: "succeeded", compatibilityPhase: "committed" },
}).success, true, "canonical event envelope is durable and versioned");
assert.equal(canonicalWorkflowEventSchema.safeParse({
  eventId: "event-secret", schemaVersion: WORKFLOW_EVENT_SCHEMA_VERSION, eventVersion: 1, workflowRunId: "run-1", sequence: 1, revision: 1,
  actor: { kind: "system", id: "scheduler" }, subject: { kind: "node", id: "work" }, causationId: "request-1",
  correlationIds: ["trace-1"], timestamp: "2026-07-15T12:00:00.000Z", eventType: "node_completed",
  payload: { nodeId: "work", output: { storage: "inline", value: { secret: "plaintext" }, byteLength: 22 } },
}).success, false, "canonical events store only redacted summaries or artifact references");

console.log("workflow vNext contract tests passed");
