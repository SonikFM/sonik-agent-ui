import assert from "node:assert/strict";
import {
  channelDefinitionSchema,
  getChannelContractIssueCode,
  parseChannelDefinition,
  parseChannelDefinitionWire,
  parseTriggerBinding,
  parseTriggerBindingWire,
  safeParseChannelDefinition,
  safeParseChannelDefinitionWire,
  safeParseTriggerBinding,
  safeParseTriggerBindingWire,
  toChannelDefinitionWire,
  toTriggerBindingWire,
  validateTriggerBindingReferences,
} from "../../packages/tool-contracts/dist/channels.js";
import {
  channelDefinitionFixtures,
  channelFixtureOrganizationId,
  channelFixtureWorkflowReferences,
  channelFixtureWorkspaceId,
  triggerBindingFixtures,
} from "../../packages/tool-contracts/dist/channel-fixtures.js";

function contractCodes(result) {
  assert.equal(result.success, false, "expected contract validation to fail");
  return result.error.issues.map(getChannelContractIssueCode).filter(Boolean);
}

function expectContractCode(result, code) {
  assert.ok(contractCodes(result).includes(code), `expected typed contract issue ${code}`);
}

const defaultChannel = parseChannelDefinition({
  channelId: "fixture.default.channel",
  organizationId: channelFixtureOrganizationId,
  kind: "whatsapp",
});
assert.deepEqual(defaultChannel, {
  schemaVersion: "v1",
  channelId: "fixture.default.channel",
  organizationId: channelFixtureOrganizationId,
  kind: "whatsapp",
  label: "WhatsApp",
  provisioningState: "unconfigured",
  identity: null,
  statusMessage: null,
  runtimeMode: "fixture_only",
});
assert.equal(
  safeParseChannelDefinition({ channelId: "fixture.no.authority", kind: "slack" }).success,
  false,
  "tenant authority must never be defaulted",
);
assert.equal(
  safeParseChannelDefinitionWire({ channel_id: "fixture.no.wire.authority", kind: "slack" }).success,
  false,
  "wire parsing must not invent tenant authority",
);

expectContractCode(
  safeParseChannelDefinition({
    channelId: "fixture.invalid.connected",
    organizationId: channelFixtureOrganizationId,
    kind: "slack",
    provisioningState: "connected",
  }),
  "invalid_state",
);
expectContractCode(
  safeParseChannelDefinition({
    channelId: "fixture.invalid.unconfigured",
    organizationId: channelFixtureOrganizationId,
    kind: "slack",
    identity: { displayName: "Fixture identity" },
  }),
  "invalid_state",
);
expectContractCode(
  safeParseChannelDefinition({
    channelId: "fixture.invalid.error",
    organizationId: channelFixtureOrganizationId,
    kind: "whatsapp",
    provisioningState: "error",
  }),
  "invalid_state",
);

const canonicalChannel = parseChannelDefinition({
  channelId: "fixture.roundtrip.channel",
  organizationId: channelFixtureOrganizationId,
  workspaceId: channelFixtureWorkspaceId,
  kind: "slack",
  label: "Fixture round-trip Slack",
  provisioningState: "connected",
  identity: { displayName: "Fixture Slack identity" },
  statusMessage: " Fixture status. ",
});
const channelWire = toChannelDefinitionWire(canonicalChannel);
assert.deepEqual(parseChannelDefinitionWire(channelWire), canonicalChannel);
assert.deepEqual(toChannelDefinitionWire(parseChannelDefinitionWire(channelWire)), channelWire);
const snakeChannelWire = {
  schema_version: "v1",
  channel_id: "fixture.snake.channel",
  organization_id: channelFixtureOrganizationId,
  workspace_id: channelFixtureWorkspaceId,
  kind: "whatsapp",
  label: "Fixture snake WhatsApp",
  provisioning_state: "connected",
  identity: { display_name: "Fixture WhatsApp identity" },
  status_message: null,
  runtime_mode: "fixture_only",
};
const snakeChannelCanonical = parseChannelDefinitionWire(snakeChannelWire);
assert.deepEqual(snakeChannelCanonical.identity, { displayName: "Fixture WhatsApp identity" });
assert.deepEqual(toChannelDefinitionWire(snakeChannelCanonical), snakeChannelWire);
expectContractCode(
  safeParseChannelDefinitionWire({
    channelId: "fixture.camel.channel",
    channel_id: "fixture.snake.channel",
    organizationId: channelFixtureOrganizationId,
    kind: "slack",
  }),
  "alias_conflict",
);
assert.equal(
  safeParseChannelDefinitionWire({
    channelId: "fixture.same.channel",
    channel_id: "fixture.same.channel",
    organizationId: channelFixtureOrganizationId,
    organization_id: channelFixtureOrganizationId,
    kind: "slack",
  }).success,
  true,
  "matching aliases are accepted",
);

const defaultBinding = parseTriggerBinding({
  bindingId: "fixture.binding.defaults",
  organizationId: channelFixtureOrganizationId,
  channelId: "fixture.slack.connected",
  event: "custom.topic.arrived",
  workflowId: "fixture.workflow.default",
});
assert.deepEqual(defaultBinding, {
  schemaVersion: "v1",
  bindingId: "fixture.binding.defaults",
  organizationId: channelFixtureOrganizationId,
  channelId: "fixture.slack.connected",
  event: "custom.topic.arrived",
  workflowId: "fixture.workflow.default",
  triggerNodeId: "trigger",
  inputMapping: [],
  runtimeMode: "fixture_only",
  enabled: false,
  disabledReason: "integration_not_yet_available",
});
assert.equal(
  safeParseTriggerBinding({
    bindingId: "fixture.binding.no.authority",
    channelId: "fixture.slack.connected",
    event: "message.received",
    workflowId: "fixture.workflow.default",
  }).success,
  false,
  "binding tenant authority is required",
);
assert.equal(
  safeParseTriggerBinding({
    bindingId: "fixture.binding.enabled",
    organizationId: channelFixtureOrganizationId,
    channelId: "fixture.slack.connected",
    event: "message.received",
    workflowId: "fixture.workflow.default",
    enabled: true,
  }).success,
  false,
  "contract-only bindings can never claim enabled runtime support",
);

const canonicalBinding = parseTriggerBinding({
  bindingId: "fixture.binding.roundtrip",
  organizationId: channelFixtureOrganizationId,
  workspaceId: channelFixtureWorkspaceId,
  channelId: "fixture.slack.connected",
  event: "message.received",
  workflowId: "amplify.campaign.create",
  inputMapping: [
    { sourcePath: "/event/message", targetPath: "/input/request" },
    { sourcePath: "/event/context", targetPath: "/input/context" },
  ],
});
const bindingWire = toTriggerBindingWire(canonicalBinding);
assert.deepEqual(parseTriggerBindingWire(bindingWire), canonicalBinding);
assert.deepEqual(toTriggerBindingWire(parseTriggerBindingWire(bindingWire)), bindingWire);
const snakeBindingWire = {
  schema_version: "v1",
  binding_id: "fixture.binding.whatsapp.booking",
  organization_id: channelFixtureOrganizationId,
  workspace_id: channelFixtureWorkspaceId,
  channel_id: "fixture.whatsapp.connected",
  event: "message.received",
  workflow_id: "booking.reservation.create",
  trigger_node_id: "trigger",
  input_mapping: [{ source_path: "/event/message", target_path: "/input/request" }],
  runtime_mode: "fixture_only",
  enabled: false,
  disabled_reason: "integration_not_yet_available",
};
const snakeBindingCanonical = parseTriggerBindingWire(snakeBindingWire);
assert.deepEqual(snakeBindingCanonical, triggerBindingFixtures[0]);
assert.deepEqual(toTriggerBindingWire(snakeBindingCanonical), snakeBindingWire);
expectContractCode(
  safeParseTriggerBindingWire({
    binding_id: "fixture.binding.alias",
    organization_id: channelFixtureOrganizationId,
    channel_id: "fixture.slack.connected",
    event: "message.received",
    workflow_id: "amplify.campaign.create",
    input_mapping: [
      {
        sourcePath: "/event/message",
        source_path: "/event/different",
        target_path: "/input/request",
      },
    ],
  }),
  "alias_conflict",
);

for (const unsafeSource of [
  "",
  "/",
  "/event",
  "/input/message",
  "/event//message",
  "/event/-",
  "/event/~2message",
  "/event/__proto__/value",
  "/event/prototype/value",
  "/event/constructor/value",
]) {
  expectContractCode(
    safeParseTriggerBinding({
      ...canonicalBinding,
      inputMapping: [{ sourcePath: unsafeSource, targetPath: "/input/request" }],
    }),
    "unsafe_json_pointer",
  );
}
expectContractCode(
  safeParseTriggerBinding({
    ...canonicalBinding,
    inputMapping: [
      { sourcePath: "/event/first", targetPath: "/input/request" },
      { sourcePath: "/event/second", targetPath: "/input/request" },
    ],
  }),
  "duplicate_target_path",
);
expectContractCode(
  safeParseTriggerBinding({
    ...canonicalBinding,
    inputMapping: [
      { sourcePath: "/event/first", targetPath: "/input/request" },
      { sourcePath: "/event/second", targetPath: "/input/request/name" },
    ],
  }),
  "overlapping_target_path",
);

assert.equal(channelDefinitionFixtures.length, 8);
assert.equal(new Set(channelDefinitionFixtures.map((channel) => channel.channelId)).size, 8);
for (const kind of ["whatsapp", "slack"]) {
  assert.deepEqual(
    new Set(
      channelDefinitionFixtures
        .filter((channel) => channel.kind === kind)
        .map((channel) => channel.provisioningState),
    ),
    new Set(["unconfigured", "pending", "connected", "error"]),
    `${kind} fixtures cover every contract-only provisioning state`,
  );
}
for (const channel of channelDefinitionFixtures) {
  assert.equal(channel.organizationId, channelFixtureOrganizationId);
  assert.equal(channel.workspaceId, channelFixtureWorkspaceId);
  assert.match(channel.label, /fixture/i);
  assert.equal(channel.runtimeMode, "fixture_only");
  assert.deepEqual(channelDefinitionSchema.parse(channel), channel);
}

assert.equal(triggerBindingFixtures.length, 2);
assert.equal(new Set(triggerBindingFixtures.map((binding) => binding.bindingId)).size, 2);
assert.deepEqual(
  triggerBindingFixtures.map((binding) => binding.workflowId),
  ["booking.reservation.create", "amplify.campaign.create"],
);
for (const binding of triggerBindingFixtures) {
  assert.equal(binding.enabled, false);
  assert.equal(binding.runtimeMode, "fixture_only");
  assert.equal(binding.disabledReason, "integration_not_yet_available");
  assert.equal(
    channelDefinitionFixtures.find((channel) => channel.channelId === binding.channelId)?.provisioningState,
    "connected",
  );
  assert.deepEqual(
    validateTriggerBindingReferences({
      binding,
      channels: channelDefinitionFixtures,
      workflows: channelFixtureWorkflowReferences,
    }),
    { valid: true, issues: [] },
  );
}

const referenceBinding = triggerBindingFixtures[1];
const validateReferences = (overrides = {}) =>
  validateTriggerBindingReferences({
    binding: overrides.binding ?? referenceBinding,
    channels: overrides.channels ?? channelDefinitionFixtures,
    workflows: overrides.workflows ?? channelFixtureWorkflowReferences,
  });
const referenceCodes = (validation) => validation.issues.map((issue) => issue.code);
assert.ok(referenceCodes(validateReferences({ channels: [] })).includes("channel_not_found"));
assert.ok(referenceCodes(validateReferences({ workflows: [] })).includes("workflow_not_found"));
assert.ok(
  referenceCodes(
    validateReferences({
      binding: { ...referenceBinding, organizationId: "fixture.organization.other" },
    }),
  ).includes("organization_mismatch"),
);
assert.ok(
  referenceCodes(
    validateReferences({ binding: { ...referenceBinding, workspaceId: "fixture.workspace.other" } }),
  ).includes("workspace_mismatch"),
);
assert.ok(
  referenceCodes(
    validateReferences({ binding: { ...referenceBinding, triggerNodeId: "fixture.missing.node" } }),
  ).includes("trigger_node_not_found"),
);
assert.ok(
  referenceCodes(
    validateReferences({ binding: { ...referenceBinding, triggerNodeId: "brief" } }),
  ).includes("node_not_trigger"),
);

for (const [label, invalid] of [
  ["channel root", { ...canonicalChannel, providerAccountId: "fixture-provider" }],
  [
    "channel identity",
    { ...canonicalChannel, identity: { ...canonicalChannel.identity, oauthToken: "fixture-token" } },
  ],
]) {
  assert.equal(safeParseChannelDefinition(invalid).success, false, `${label} rejects unknown integration fields`);
}
assert.equal(
  safeParseTriggerBinding({
    ...canonicalBinding,
    inputMapping: [
      { sourcePath: "/event/message", targetPath: "/input/request", webhookUrl: "fixture-webhook" },
    ],
  }).success,
  false,
  "mapping entries recursively reject integration fields",
);

const fixtureJson = JSON.stringify({ channelDefinitionFixtures, triggerBindingFixtures });
for (const forbiddenField of [
  "capability",
  "provider",
  "oauth",
  "token",
  "webhook",
  "endpoint",
  "send",
  "page",
  "storage",
  "persist",
]) {
  assert.equal(
    fixtureJson.toLowerCase().includes(forbiddenField),
    false,
    `fixtures must not smuggle ${forbiddenField} support`,
  );
}
assert.doesNotMatch(fixtureJson, /\b(?:live|production|supported|ready)\b/i);

console.log("channel contract tests passed");
