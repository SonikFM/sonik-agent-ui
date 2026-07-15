import type {
  AgentUiChannelSnapshot,
  AgentUiChannelsStateSnapshot,
  AgentUiTriggerBindingSnapshot,
} from "@sonik-agent-ui/agent-observability";
import {
  channelDefinitionFixtures,
  channelFixtureOrganizationId,
  channelFixtureWorkflowReferences,
  triggerBindingFixtures,
} from "@sonik-agent-ui/tool-contracts/channel-fixtures";
import {
  getChannelContractIssueCode,
  parseChannelDefinition,
  safeParseTriggerBinding,
  validateTriggerBindingReferences,
  type ChannelDefinition,
  type TriggerBinding,
  type TriggerBindingWorkflowReference,
} from "@sonik-agent-ui/tool-contracts/channels";
import type { WorkspacePageContextSnapshotRecord } from "@sonik-agent-ui/workspace-session";
import { z } from "zod";

export const CHANNELS_STATE_SCHEMA_VERSION = "sonik.agent_ui.channels_state.v1" as const;
export const LOCAL_CHANNEL_ORGANIZATION_ID = channelFixtureOrganizationId;
export const LOCAL_CHANNEL_USER_ID = "fixture.user.local.channels";

const storedInputMappingSchema = z.strictObject({
  sourcePath: z.string(),
  targetPath: z.string(),
});

const storedTriggerBindingSchema = z.strictObject({
  schemaVersion: z.literal("v1"),
  bindingId: z.string(),
  channelId: z.string(),
  event: z.string(),
  workflowId: z.string(),
  triggerNodeId: z.string(),
  inputMapping: z.array(storedInputMappingSchema),
  runtimeMode: z.literal("fixture_only"),
  enabled: z.literal(false),
  disabledReason: z.literal("integration_not_yet_available"),
});

export const channelsStateEnvelopeSchema = z.strictObject({
  schemaVersion: z.literal(CHANNELS_STATE_SCHEMA_VERSION),
  fixtureOnly: z.literal(true),
  triggerBindings: z.array(storedTriggerBindingSchema),
});
export type ChannelsStateEnvelope = z.infer<typeof channelsStateEnvelopeSchema>;
export type StoredTriggerBinding = z.infer<typeof storedTriggerBindingSchema>;

export interface ChannelsRequestScope {
  organizationId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
}

export interface FixtureTriggerBindingInput {
  bindingId?: string;
  channelId: string;
  event: string;
  workflowId: string;
  sourcePath: string;
  targetPath: string;
}

export type FixtureTriggerBindingResult =
  | { ok: true; binding: TriggerBinding }
  | { ok: false; disabledReason: string; message: string };

function integrationActionLabel(
  state: AgentUiChannelSnapshot["provisioningState"],
): AgentUiChannelSnapshot["integrationAction"]["label"] {
  if (state === "pending") return "Finish setup";
  if (state === "connected") return "Manage";
  if (state === "error") return "Retry";
  return "Connect";
}

function scopeChannelFixtures(scope: ChannelsRequestScope): ChannelDefinition[] {
  return channelDefinitionFixtures.map((fixture) =>
    parseChannelDefinition({
      schemaVersion: fixture.schemaVersion,
      channelId: fixture.channelId,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      kind: fixture.kind,
      label: fixture.label,
      provisioningState: fixture.provisioningState,
      identity: fixture.identity,
      statusMessage: fixture.statusMessage,
      runtimeMode: fixture.runtimeMode,
    }),
  );
}

function scopeWorkflowReferences(scope: ChannelsRequestScope): TriggerBindingWorkflowReference[] {
  return channelFixtureWorkflowReferences.map((workflow) => ({
    workflowId: workflow.workflowId,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    nodes: workflow.nodes.map((node) => ({ nodeId: node.nodeId, type: node.type })),
  }));
}

function toStoredTriggerBinding(binding: TriggerBinding): StoredTriggerBinding {
  return storedTriggerBindingSchema.parse({
    schemaVersion: binding.schemaVersion,
    bindingId: binding.bindingId,
    channelId: binding.channelId,
    event: binding.event,
    workflowId: binding.workflowId,
    triggerNodeId: binding.triggerNodeId,
    inputMapping: binding.inputMapping.map((mapping) => ({
      sourcePath: mapping.sourcePath,
      targetPath: mapping.targetPath,
    })),
    runtimeMode: binding.runtimeMode,
    enabled: binding.enabled,
    disabledReason: binding.disabledReason,
  });
}

function scopeStoredTriggerBinding(
  binding: StoredTriggerBinding,
  scope: ChannelsRequestScope,
): TriggerBinding | null {
  const parsed = safeParseTriggerBinding({
    ...binding,
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
  });
  return parsed.success ? parsed.data : null;
}

function defaultStoredTriggerBindings(): StoredTriggerBinding[] {
  return triggerBindingFixtures.map(toStoredTriggerBinding);
}

export function createDefaultChannelsEnvelope(): ChannelsStateEnvelope {
  return channelsStateEnvelopeSchema.parse({
    schemaVersion: CHANNELS_STATE_SCHEMA_VERSION,
    fixtureOnly: true,
    triggerBindings: defaultStoredTriggerBindings(),
  });
}

export function readLatestChannelsEnvelope(
  snapshots: ReadonlyArray<WorkspacePageContextSnapshotRecord<unknown>>,
): ChannelsStateEnvelope {
  const triggerBindings = new Map<string, StoredTriggerBinding>();
  let foundChannelsSnapshot = false;
  for (const snapshot of snapshots) {
    if (
      snapshot.route !== "/" ||
      snapshot.surface !== "channels" ||
      snapshot.page_type !== "standalone-agent-workspace" ||
      snapshot.source !== "browser-page-context" ||
      snapshot.authority !== "display-only"
    ) {
      continue;
    }
    const parsed = channelsStateEnvelopeSchema.safeParse(snapshot.context);
    if (!parsed.success) continue;
    foundChannelsSnapshot = true;
    // Snapshots are newest-first. First-write-per-binding therefore preserves
    // the latest replacement while merging distinct bindings from concurrent
    // append-only saves that may each have loaded the same prior envelope.
    for (const binding of parsed.data.triggerBindings) {
      if (!triggerBindings.has(binding.bindingId)) triggerBindings.set(binding.bindingId, binding);
    }
  }
  return foundChannelsSnapshot
    ? channelsStateEnvelopeSchema.parse({
        schemaVersion: CHANNELS_STATE_SCHEMA_VERSION,
        fixtureOnly: true,
        triggerBindings: [...triggerBindings.values()],
      })
    : createDefaultChannelsEnvelope();
}

function projectTriggerBinding(binding: TriggerBinding): AgentUiTriggerBindingSnapshot {
  return {
    schemaVersion: binding.schemaVersion,
    bindingId: binding.bindingId,
    channelId: binding.channelId,
    event: binding.event,
    workflowId: binding.workflowId,
    triggerNodeId: binding.triggerNodeId,
    inputMapping: binding.inputMapping.map((mapping) => ({ ...mapping })),
    runtimeMode: binding.runtimeMode,
    enabled: binding.enabled,
    disabledReason: binding.disabledReason,
  };
}

function freezeProjection<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeProjection(child);
  }
  return value;
}

export function createChannelsProjection(input: {
  scope: ChannelsRequestScope;
  envelope?: ChannelsStateEnvelope;
}): AgentUiChannelsStateSnapshot {
  const channels = scopeChannelFixtures(input.scope);
  const workflows = scopeWorkflowReferences(input.scope);
  const envelope = channelsStateEnvelopeSchema.parse(input.envelope ?? createDefaultChannelsEnvelope());
  const triggerBindings = envelope.triggerBindings.flatMap((stored) => {
    const binding = scopeStoredTriggerBinding(stored, input.scope);
    if (!binding) return [];
    const references = validateTriggerBindingReferences({ binding, channels, workflows });
    return references.valid ? [projectTriggerBinding(binding)] : [];
  });
  return freezeProjection({
    schemaVersion: CHANNELS_STATE_SCHEMA_VERSION,
    fixtureOnly: true,
    sessionId: input.scope.sessionId,
    status: "ready",
    workflows: workflows.map((workflow) => ({ workflowId: workflow.workflowId })),
    channels: channels.map((channel) => ({
      schemaVersion: channel.schemaVersion,
      channelId: channel.channelId,
      kind: channel.kind,
      label: channel.label,
      provisioningState: channel.provisioningState,
      identity: channel.identity ? { displayName: channel.identity.displayName } : null,
      statusMessage: channel.statusMessage,
      runtimeMode: channel.runtimeMode,
      integrationAction: {
        label: integrationActionLabel(channel.provisioningState),
        enabled: false,
        disabledReason: "integration_not_yet_available",
      },
    })),
    triggerBindings,
  });
}

function stableBindingId(input: FixtureTriggerBindingInput): string {
  if (input.bindingId?.trim()) return input.bindingId.trim();
  const seed = `${input.channelId}|${input.workflowId}|${input.event}`;
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `fixture.binding.saved.${(hash >>> 0).toString(36)}`;
}

export function createScopedFixtureTriggerBinding(
  input: FixtureTriggerBindingInput,
  scope: ChannelsRequestScope,
): FixtureTriggerBindingResult {
  const parsed = safeParseTriggerBinding({
    bindingId: stableBindingId(input),
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    channelId: input.channelId,
    event: input.event,
    workflowId: input.workflowId,
    triggerNodeId: "trigger",
    inputMapping: [{ sourcePath: input.sourcePath, targetPath: input.targetPath }],
    runtimeMode: "fixture_only",
    enabled: false,
    disabledReason: "integration_not_yet_available",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      disabledReason: issue ? getChannelContractIssueCode(issue) ?? "invalid_trigger_binding" : "invalid_trigger_binding",
      message: issue?.message ?? "Trigger binding is invalid.",
    };
  }

  const references = validateTriggerBindingReferences({
    binding: parsed.data,
    channels: scopeChannelFixtures(scope),
    workflows: scopeWorkflowReferences(scope),
  });
  if (!references.valid) {
    return {
      ok: false,
      disabledReason: references.issues[0]?.code ?? "invalid_trigger_reference",
      message: references.issues[0]?.message ?? "Trigger binding references are invalid.",
    };
  }
  return { ok: true, binding: parsed.data };
}

export function mergeTriggerBindingIntoEnvelope(
  envelope: ChannelsStateEnvelope,
  binding: TriggerBinding,
): ChannelsStateEnvelope {
  const stored = toStoredTriggerBinding(binding);
  const bindings = envelope.triggerBindings.filter((entry) => entry.bindingId !== stored.bindingId);
  return channelsStateEnvelopeSchema.parse({
    schemaVersion: CHANNELS_STATE_SCHEMA_VERSION,
    fixtureOnly: true,
    triggerBindings: [...bindings, stored],
  });
}

export function createChannelsSnapshotRecordInput(
  scope: ChannelsRequestScope,
  envelope: ChannelsStateEnvelope,
) {
  return {
    session_id: scope.sessionId,
    source: "browser-page-context" as const,
    authority: "display-only" as const,
    route: "/",
    surface: "channels",
    page_type: "standalone-agent-workspace",
    active_entity: null,
    command_families: [],
    skill_families: [],
    visible_actions: ["connectChannel", "enableTriggerBinding", "saveFixtureTriggerBinding"],
    context: channelsStateEnvelopeSchema.parse(envelope),
  };
}
