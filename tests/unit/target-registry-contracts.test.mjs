import assert from "node:assert/strict";
import {
  DEFAULT_HOST_ACTION_ALLOWLIST,
  agentActionChannelVersion,
  createDefaultHostUiTargetRegistry,
  createHostActionRequest,
  createHostUiTargetKey,
  createHostUiTargetRegistry,
  evaluateHostActionRequest,
  findHostUiTarget,
  getHostUiTargetDomAttributes,
  hostUiTargetSchema,
  normalizeHostUiTarget,
  hostActionRequestSchema,
  resolveHostUiTargetBounds,
  targetRegistryVersion,
} from "../../packages/tool-contracts/src/target-registry.ts";

assert.equal(targetRegistryVersion, "sonik-agent-ui.target-registry.v0");
assert.equal(agentActionChannelVersion, "sonik.agent_ui.host_action.v1");
assert.ok(DEFAULT_HOST_ACTION_ALLOWLIST.includes("tour.highlight"));

const bookingEntity = { kind: "booking_context", id: "34bb4e79-95c6-46ae-bd03-25e0a108a7a8", label: "Main Course Tee Sheet" };
const scheduleTarget = normalizeHostUiTarget({
  targetId: "booking.ui.schedulePanel",
  targetInstanceId: "booking.ui.schedulePanel:34bb4e79",
  label: "Booking schedule",
  description: "Schedule editor for the active booking context.",
  surface: "booking-context",
  entityRef: bookingEntity,
  capabilities: ["highlight", "focus", "edit", "describe", "highlight"],
  locator: { kind: "data-sonik-target", value: "booking.ui.schedulePanel" },
});
assert.deepEqual(scheduleTarget.capabilities, ["highlight", "focus", "edit", "describe"], "capabilities normalize to unique values in declaration order");
assert.equal(createHostUiTargetKey(scheduleTarget), "booking.ui.schedulePanel#booking.ui.schedulePanel:34bb4e79");
assert.deepEqual(getHostUiTargetDomAttributes(scheduleTarget), {
  "data-sonik-target": "booking.ui.schedulePanel",
  "data-sonik-target-instance": "booking.ui.schedulePanel:34bb4e79",
  "data-sonik-entity-kind": "booking_context",
  "data-sonik-entity-id": bookingEntity.id,
});

assert.throws(() => hostUiTargetSchema.parse({
  targetId: "booking.ui.schedulePanel",
  label: "Bad selector",
  description: "Bad selector",
  surface: "booking-context",
  capabilities: ["highlight"],
  locator: { kind: "data-sonik-target", value: "#raw-css-selector" },
}), /must match targetId/, "target contracts reject raw selector masquerading as a semantic target locator");

for (const rawSelector of ["#foo", ".foo", "[data-x]", "booking context schedule"]) {
  assert.throws(() => hostUiTargetSchema.parse({
    targetId: rawSelector,
    label: "Raw selector",
    description: "Raw selector",
    surface: "booking-context",
    capabilities: ["highlight"],
  }), /stable semantic ids/, `targetId rejects raw selector-like value ${rawSelector}`);
  assert.throws(() => hostActionRequestSchema.parse({
    source: "sonik-agent-ui",
    type: "sonik:agent-ui:action-request",
    version: "sonik.agent_ui.host_action.v1",
    requestId: "req-raw-selector",
    actionKey: "tour.highlight",
    targetId: rawSelector,
  }), /stable semantic ids/, `request targetId rejects raw selector-like value ${rawSelector}`);
}

assert.throws(() => hostUiTargetSchema.parse({
  targetId: "artifact.approval-card",
  label: "Approval card",
  description: "Approval card",
  surface: "agent-canvas",
  capabilities: ["approve"],
  policy: { actionMode: "allow" },
}), /must not default to allow/, "approval targets cannot be allowed by default");

assert.throws(() => hostUiTargetSchema.parse({
  targetId: "booking.ui.inventoryPanel",
  label: "Inventory",
  description: "Inventory",
  surface: "booking-context",
  capabilities: ["highlight"],
  enabled: false,
}), /disabledReason/, "disabled targets expose why they are disabled");

const virtualTarget = normalizeHostUiTarget({
  targetId: "artifact.workflow.node",
  targetInstanceId: "artifact-123:node-456",
  label: "Workflow node",
  description: "Canvas node backed by renderer bounds rather than a DOM child.",
  surface: "agent-canvas",
  capabilities: ["highlight", "focus", "describe"],
  locator: { kind: "bounds", bounds: { x: 10, y: 20, width: 300, height: 160, coordinateSpace: "canvas" } },
});
assert.deepEqual(resolveHostUiTargetBounds(virtualTarget), { x: 10, y: 20, width: 300, height: 160, coordinateSpace: "canvas" }, "virtual/canvas targets resolve through renderer-owned bounds");

const registry = createHostUiTargetRegistry({
  provider: "unit-test",
  generatedAt: "2026-07-07T00:00:00.000Z",
  route: "/booking/context/34bb4e79",
  surface: "booking-context",
  targets: [scheduleTarget, virtualTarget],
});
assert.equal(registry.version, "sonik-agent-ui.target-registry.v0");
assert.equal(findHostUiTarget(registry, { targetId: "booking.ui.schedulePanel", entityRef: bookingEntity, capability: "highlight" })?.label, "Booking schedule");
assert.equal(findHostUiTarget(registry, { targetId: "booking.ui.schedulePanel", entityRef: { ...bookingEntity, id: "other" } }), undefined, "entity identity disambiguates repeated semantic targets");
assert.throws(() => createHostUiTargetRegistry({ provider: "dupe", generatedAt: "now", targets: [scheduleTarget, scheduleTarget] }), /Duplicate host UI target key/, "registry rejects duplicate semantic/entity target keys");

const highlightRequest = createHostActionRequest({
  requestId: "req-highlight-1",
  actionKey: "tour.highlight",
  targetId: "booking.ui.schedulePanel",
  entityRef: bookingEntity,
});
const highlightResult = evaluateHostActionRequest({ request: highlightRequest, registry });
assert.equal(highlightResult.ok, true);
assert.equal(highlightResult.status, "executed");
assert.equal(highlightResult.receipt?.targetId, "booking.ui.schedulePanel");
assert.deepEqual(highlightResult.receipt?.entityRef, bookingEntity);

for (const actionKey of ["tour.highlight", "tour.focusTarget", "artifact.submitAnswer"]) {
  const targetlessResult = evaluateHostActionRequest({ request: createHostActionRequest({ requestId: `req-targetless-${actionKey}`, actionKey }) });
  assert.equal(targetlessResult.ok, false, `${actionKey} requires a targetId`);
  assert.equal(targetlessResult.status, "invalid_request");
  assert.equal(targetlessResult.disabledReason, "target_required");
}

const registryUnavailable = evaluateHostActionRequest({ request: createHostActionRequest({ requestId: "req-no-registry", actionKey: "tour.highlight", targetId: "booking.ui.schedulePanel" }) });
assert.equal(registryUnavailable.ok, false);
assert.equal(registryUnavailable.status, "unavailable");
assert.equal(registryUnavailable.disabledReason, "target_registry_unavailable");

const hiddenTarget = normalizeHostUiTarget({ ...scheduleTarget, targetInstanceId: "hidden-instance", visible: false });
const hiddenRegistry = createHostUiTargetRegistry({ provider: "hidden", generatedAt: "2026-07-07T00:00:00.000Z", targets: [hiddenTarget] });
const hiddenResult = evaluateHostActionRequest({ request: createHostActionRequest({ requestId: "req-hidden", actionKey: "tour.highlight", targetId: "booking.ui.schedulePanel", targetInstanceId: "hidden-instance" }), registry: hiddenRegistry });
assert.equal(hiddenResult.ok, false);
assert.equal(hiddenResult.status, "requires_prerequisite");
assert.equal(hiddenResult.disabledReason, "target_not_visible");

const disabledTarget = normalizeHostUiTarget({ ...scheduleTarget, targetInstanceId: "disabled-instance", enabled: false, disabledReason: "schedule_locked" });
const disabledRegistry = createHostUiTargetRegistry({ provider: "disabled", generatedAt: "2026-07-07T00:00:00.000Z", targets: [disabledTarget] });
const disabledResult = evaluateHostActionRequest({ request: createHostActionRequest({ requestId: "req-disabled", actionKey: "tour.highlight", targetId: "booking.ui.schedulePanel", targetInstanceId: "disabled-instance" }), registry: disabledRegistry });
assert.equal(disabledResult.ok, false);
assert.equal(disabledResult.status, "blocked");
assert.equal(disabledResult.disabledReason, "schedule_locked");

const missingResult = evaluateHostActionRequest({ request: createHostActionRequest({ requestId: "req-missing", actionKey: "tour.highlight", targetId: "booking.ui.missing" }), registry });
assert.equal(missingResult.ok, false);
assert.equal(missingResult.status, "requires_prerequisite");
assert.equal(missingResult.disabledReason, "target_not_found_or_capability_unavailable");

const blockedAction = evaluateHostActionRequest({ request: createHostActionRequest({ requestId: "req-unknown", actionKey: "tour.clear" }), allowedActions: ["canvas.open"] });
assert.equal(blockedAction.ok, false);
assert.equal(blockedAction.status, "blocked");
assert.equal(blockedAction.disabledReason, "host_action_not_allowlisted");

const modelApprovalBypass = evaluateHostActionRequest({
  request: createHostActionRequest({
    requestId: "req-bypass",
    actionKey: "artifact.submitAnswer",
    input: { answer: "yes", approved: true },
  }),
  registry,
});
assert.equal(modelApprovalBypass.ok, false);
assert.equal(modelApprovalBypass.status, "invalid_request");
assert.equal(modelApprovalBypass.disabledReason, "model_supplied_approval_is_not_trusted");

const approvalPreviewRegistry = createDefaultHostUiTargetRegistry({
  provider: "unit-test",
  generatedAt: "2026-07-07T00:00:00.000Z",
  activeBookingContext: { id: bookingEntity.id, label: bookingEntity.label },
});
const approvalTarget = findHostUiTarget(approvalPreviewRegistry, { targetId: "booking.ui.commandApprovalPanel", entityRef: bookingEntity, capability: "approve" });
assert.equal(approvalTarget?.policy.actionMode, "ask", "default booking approval preview target is ask-gated");
const previewResult = evaluateHostActionRequest({
  request: createHostActionRequest({ requestId: "req-preview", actionKey: "approval.requestPreview", targetId: "booking.ui.commandApprovalPanel", entityRef: bookingEntity }),
  registry: approvalPreviewRegistry,
});
assert.equal(previewResult.ok, false);
assert.equal(previewResult.status, "approval_required");
assert.equal(previewResult.policyMode, "ask");

const approvalPreviewAgainstNonApprovalTarget = evaluateHostActionRequest({
  request: createHostActionRequest({ requestId: "req-preview-wrong-target", actionKey: "approval.requestPreview", targetId: "booking.ui.schedulePanel", entityRef: bookingEntity }),
  registry: approvalPreviewRegistry,
});
assert.equal(approvalPreviewAgainstNonApprovalTarget.ok, false);
assert.equal(approvalPreviewAgainstNonApprovalTarget.status, "requires_prerequisite");
assert.equal(approvalPreviewAgainstNonApprovalTarget.disabledReason, "target_not_found_or_capability_unavailable");

const targetlessApprovalPreview = evaluateHostActionRequest({
  request: createHostActionRequest({ requestId: "req-preview-targetless", actionKey: "approval.requestPreview" }),
});
assert.equal(targetlessApprovalPreview.ok, false);
assert.equal(targetlessApprovalPreview.status, "approval_required");
assert.equal(targetlessApprovalPreview.policyMode, "ask");

const trustedConfirmDenied = evaluateHostActionRequest({
  request: createHostActionRequest({ requestId: "req-confirm-denied", actionKey: "approval.confirmTrustedAction", input: { trustedApprovalRef: "approval-1" } }),
  allowedActions: ["approval.confirmTrustedAction"],
  trustedApprovalRefs: [],
});
assert.equal(trustedConfirmDenied.ok, false);
assert.equal(trustedConfirmDenied.disabledReason, "trusted_approval_ref_required");
const trustedConfirmExtraField = evaluateHostActionRequest({
  request: createHostActionRequest({ requestId: "req-confirm-extra", actionKey: "approval.confirmTrustedAction", input: { trustedApprovalRef: "approval-1", unmodeled: true } }),
  allowedActions: ["approval.confirmTrustedAction"],
  trustedApprovalRefs: ["approval-1"],
});
assert.equal(trustedConfirmExtraField.ok, false);
assert.equal(trustedConfirmExtraField.status, "invalid_request");
assert.equal(trustedConfirmExtraField.disabledReason, "trusted_approval_ref_required");
const trustedConfirmAllowed = evaluateHostActionRequest({
  request: createHostActionRequest({ requestId: "req-confirm-allowed", actionKey: "approval.confirmTrustedAction", input: { trustedApprovalRef: "approval-1" } }),
  allowedActions: ["approval.confirmTrustedAction"],
  trustedApprovalRefs: ["approval-1"],
});
assert.equal(trustedConfirmAllowed.ok, true, "trusted approval refs may execute only when provided by host-side trusted approval state");

console.log("target-registry contract tests passed");
