import {
  amplifyCampaignWorkflowManifest,
  bookingReservationWorkflowManifest,
} from "./marketplace-fixtures.js";
import type { WorkflowDefinition } from "./marketplace.js";
import {
  channelIntegrationDisabledReason,
  channelRuntimeMode,
  parseChannelDefinition,
  parseTriggerBinding,
  type ChannelDefinition,
  type TriggerBinding,
  type TriggerBindingWorkflowReference,
} from "./channels.js";

export const channelFixtureOrganizationId = "fixture.organization.channels";
export const channelFixtureWorkspaceId = "fixture.workspace.channels";

const rawChannelDefinitionFixtures = [
  {
    channelId: "fixture.whatsapp.unconfigured",
    organizationId: channelFixtureOrganizationId,
    workspaceId: channelFixtureWorkspaceId,
    kind: "whatsapp",
    label: "Fixture WhatsApp — Unconfigured",
    provisioningState: "unconfigured",
    identity: null,
  },
  {
    channelId: "fixture.whatsapp.pending",
    organizationId: channelFixtureOrganizationId,
    workspaceId: channelFixtureWorkspaceId,
    kind: "whatsapp",
    label: "Fixture WhatsApp — Pending",
    provisioningState: "pending",
    identity: null,
    statusMessage: "Fixture provisioning is pending.",
  },
  {
    channelId: "fixture.whatsapp.connected",
    organizationId: channelFixtureOrganizationId,
    workspaceId: channelFixtureWorkspaceId,
    kind: "whatsapp",
    label: "Fixture WhatsApp — Connected",
    provisioningState: "connected",
    identity: { displayName: "Fixture WhatsApp identity" },
  },
  {
    channelId: "fixture.whatsapp.error",
    organizationId: channelFixtureOrganizationId,
    workspaceId: channelFixtureWorkspaceId,
    kind: "whatsapp",
    label: "Fixture WhatsApp — Error",
    provisioningState: "error",
    identity: null,
    statusMessage: "Fixture provisioning error.",
  },
  {
    channelId: "fixture.slack.unconfigured",
    organizationId: channelFixtureOrganizationId,
    workspaceId: channelFixtureWorkspaceId,
    kind: "slack",
    label: "Fixture Slack — Unconfigured",
    provisioningState: "unconfigured",
    identity: null,
  },
  {
    channelId: "fixture.slack.pending",
    organizationId: channelFixtureOrganizationId,
    workspaceId: channelFixtureWorkspaceId,
    kind: "slack",
    label: "Fixture Slack — Pending",
    provisioningState: "pending",
    identity: null,
    statusMessage: "Fixture provisioning is pending.",
  },
  {
    channelId: "fixture.slack.connected",
    organizationId: channelFixtureOrganizationId,
    workspaceId: channelFixtureWorkspaceId,
    kind: "slack",
    label: "Fixture Slack — Connected",
    provisioningState: "connected",
    identity: { displayName: "Fixture Slack identity" },
  },
  {
    channelId: "fixture.slack.error",
    organizationId: channelFixtureOrganizationId,
    workspaceId: channelFixtureWorkspaceId,
    kind: "slack",
    label: "Fixture Slack — Error",
    provisioningState: "error",
    identity: null,
    statusMessage: "Fixture provisioning error.",
  },
] as const;

export const channelDefinitionFixtures: ReadonlyArray<ChannelDefinition> = Object.freeze(
  rawChannelDefinitionFixtures.map((fixture) => Object.freeze(parseChannelDefinition(fixture))),
);

function requireWorkflowFixture(
  workflow: WorkflowDefinition | undefined,
  fixtureName: string,
): WorkflowDefinition {
  if (!workflow) {
    throw new Error(`${fixtureName} must contain a workflow definition`);
  }
  return workflow;
}

const bookingWorkflow = requireWorkflowFixture(
  bookingReservationWorkflowManifest.payload.workflow,
  "bookingReservationWorkflowManifest",
);
const amplifyWorkflow = requireWorkflowFixture(
  amplifyCampaignWorkflowManifest.payload.workflow,
  "amplifyCampaignWorkflowManifest",
);

export const channelFixtureWorkflowReferences: ReadonlyArray<TriggerBindingWorkflowReference> =
  Object.freeze(
    [bookingWorkflow, amplifyWorkflow].map((workflow) =>
      Object.freeze({
        workflowId: workflow.workflowId,
        organizationId: channelFixtureOrganizationId,
        workspaceId: channelFixtureWorkspaceId,
        nodes: workflow.nodes.map((node) => ({ nodeId: node.nodeId, type: node.type })),
      }),
    ),
  );

const rawTriggerBindingFixtures = [
  {
    bindingId: "fixture.binding.whatsapp.booking",
    organizationId: channelFixtureOrganizationId,
    workspaceId: channelFixtureWorkspaceId,
    channelId: "fixture.whatsapp.connected",
    event: "message.received",
    workflowId: bookingWorkflow.workflowId,
    triggerNodeId: "trigger",
    inputMapping: [{ sourcePath: "/event/message", targetPath: "/input/request" }],
    runtimeMode: channelRuntimeMode,
    enabled: false,
    disabledReason: channelIntegrationDisabledReason,
  },
  {
    bindingId: "fixture.binding.slack.amplify",
    organizationId: channelFixtureOrganizationId,
    workspaceId: channelFixtureWorkspaceId,
    channelId: "fixture.slack.connected",
    event: "message.received",
    workflowId: amplifyWorkflow.workflowId,
    triggerNodeId: "trigger",
    inputMapping: [{ sourcePath: "/event/message", targetPath: "/input/request" }],
    runtimeMode: channelRuntimeMode,
    enabled: false,
    disabledReason: channelIntegrationDisabledReason,
  },
] as const;

export const triggerBindingFixtures: ReadonlyArray<TriggerBinding> = Object.freeze(
  rawTriggerBindingFixtures.map((fixture) => Object.freeze(parseTriggerBinding(fixture))),
);
