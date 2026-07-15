import { z } from "zod";

export const channelDefinitionSchemaVersion = "v1" as const;
export const triggerBindingSchemaVersion = "v1" as const;
export const channelRuntimeMode = "fixture_only" as const;
export const channelIntegrationDisabledReason = "integration_not_yet_available" as const;

export const channelKindSchema = z.enum(["whatsapp", "slack"]);
export type ChannelKind = z.infer<typeof channelKindSchema>;

export const channelProvisioningStateSchema = z.enum([
  "unconfigured",
  "pending",
  "connected",
  "error",
]);
export type ChannelProvisioningState = z.infer<typeof channelProvisioningStateSchema>;

export const channelContractIssueCodeSchema = z.enum([
  "invalid_state",
  "unsafe_json_pointer",
  "duplicate_target_path",
  "overlapping_target_path",
  "alias_conflict",
  "organization_mismatch",
  "workspace_mismatch",
  "workflow_not_found",
  "trigger_node_not_found",
  "node_not_trigger",
  "channel_not_found",
]);
export type ChannelContractIssueCode = z.infer<typeof channelContractIssueCodeSchema>;

type RefinementContext = Parameters<Parameters<z.ZodType["superRefine"]>[0]>[1];

function addContractIssue(
  ctx: RefinementContext,
  contractCode: ChannelContractIssueCode,
  path: PropertyKey[],
  message: string,
): void {
  ctx.addIssue({
    code: "custom",
    path,
    message,
    params: { contractCode },
  });
}

export function getChannelContractIssueCode(issue: unknown): ChannelContractIssueCode | undefined {
  if (!issue || typeof issue !== "object" || !("params" in issue)) {
    return undefined;
  }
  const params = (issue as { params?: unknown }).params;
  if (!params || typeof params !== "object" || !("contractCode" in params)) {
    return undefined;
  }
  const parsed = channelContractIssueCodeSchema.safeParse(
    (params as { contractCode?: unknown }).contractCode,
  );
  return parsed.success ? parsed.data : undefined;
}

const semanticIdSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/, "Expected a stable semantic identifier");

const tenantIdSchema = z.string().trim().min(1);
const channelIdentitySchema = z.strictObject({
  displayName: z.string().trim().min(1),
});

const defaultChannelLabel = (kind: ChannelKind): string =>
  kind === "whatsapp" ? "WhatsApp" : "Slack";

const channelDefinitionObjectSchema = z
  .strictObject({
    schemaVersion: z.literal(channelDefinitionSchemaVersion).default(channelDefinitionSchemaVersion),
    channelId: semanticIdSchema,
    organizationId: tenantIdSchema,
    workspaceId: tenantIdSchema.optional(),
    kind: channelKindSchema,
    label: z.string().trim().min(1).optional(),
    provisioningState: channelProvisioningStateSchema.default("unconfigured"),
    identity: channelIdentitySchema.nullable().default(null),
    statusMessage: z.string().nullable().default(null),
    runtimeMode: z.literal(channelRuntimeMode).default(channelRuntimeMode),
  })
  .superRefine((channel, ctx) => {
    if (channel.provisioningState === "connected" && channel.identity === null) {
      addContractIssue(ctx, "invalid_state", ["identity"], "Connected channels require an identity");
    }
    if (channel.provisioningState === "unconfigured" && channel.identity !== null) {
      addContractIssue(ctx, "invalid_state", ["identity"], "Unconfigured channels cannot have an identity");
    }
    if (channel.statusMessage !== null && channel.statusMessage.trim().length === 0) {
      addContractIssue(ctx, "invalid_state", ["statusMessage"], "Status messages cannot be blank");
    }
    if (channel.provisioningState === "error" && !channel.statusMessage?.trim()) {
      addContractIssue(ctx, "invalid_state", ["statusMessage"], "Error channels require a status message");
    }
  });

export const channelDefinitionSchema = channelDefinitionObjectSchema.transform((channel) => ({
  ...channel,
  label: channel.label ?? defaultChannelLabel(channel.kind),
  statusMessage: channel.statusMessage === null ? null : channel.statusMessage.trim(),
}));
export type ChannelDefinition = z.output<typeof channelDefinitionSchema>;

const unsafePointerSegments = new Set(["__proto__", "prototype", "constructor"]);

function canonicalizeJsonPointer(pointer: string, requiredRoot: "event" | "input"): string | null {
  if (!pointer.startsWith("/") || pointer === "/") {
    return null;
  }

  const rawSegments = pointer.slice(1).split("/");
  const decodedSegments: string[] = [];
  for (const rawSegment of rawSegments) {
    if (rawSegment.length === 0 || rawSegment === "-" || /~(?:[^01]|$)/u.test(rawSegment)) {
      return null;
    }
    const decoded = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (decoded.length === 0 || decoded === "-" || unsafePointerSegments.has(decoded)) {
      return null;
    }
    decodedSegments.push(decoded);
  }

  if (decodedSegments.length < 2 || decodedSegments[0] !== requiredRoot) {
    return null;
  }

  return `/${decodedSegments
    .map((segment) => segment.replaceAll("~", "~0").replaceAll("/", "~1"))
    .join("/")}`;
}

function jsonPointerSchema(requiredRoot: "event" | "input") {
  return z
    .string()
    .superRefine((pointer, ctx) => {
      if (canonicalizeJsonPointer(pointer, requiredRoot) === null) {
        addContractIssue(
          ctx,
          "unsafe_json_pointer",
          [],
          `Expected a safe non-root RFC 6901 pointer under /${requiredRoot}/...`,
        );
      }
    })
    .transform((pointer) => canonicalizeJsonPointer(pointer, requiredRoot) as string);
}

export const triggerInputMappingSchema = z.strictObject({
  sourcePath: jsonPointerSchema("event"),
  targetPath: jsonPointerSchema("input"),
});
export type TriggerInputMapping = z.infer<typeof triggerInputMappingSchema>;

const triggerBindingObjectSchema = z
  .strictObject({
    schemaVersion: z.literal(triggerBindingSchemaVersion).default(triggerBindingSchemaVersion),
    bindingId: semanticIdSchema,
    organizationId: tenantIdSchema,
    workspaceId: tenantIdSchema.optional(),
    channelId: semanticIdSchema,
    event: semanticIdSchema,
    workflowId: semanticIdSchema,
    triggerNodeId: semanticIdSchema.default("trigger"),
    inputMapping: z.array(triggerInputMappingSchema).default([]),
    runtimeMode: z.literal(channelRuntimeMode).default(channelRuntimeMode),
    enabled: z.literal(false).default(false),
    disabledReason: z
      .literal(channelIntegrationDisabledReason)
      .default(channelIntegrationDisabledReason),
  })
  .superRefine((binding, ctx) => {
    const targetPaths = new Map<string, number>();
    for (const [index, mapping] of binding.inputMapping.entries()) {
      const duplicateIndex = targetPaths.get(mapping.targetPath);
      if (duplicateIndex !== undefined) {
        addContractIssue(
          ctx,
          "duplicate_target_path",
          ["inputMapping", index, "targetPath"],
          `Target path duplicates inputMapping[${duplicateIndex}]`,
        );
        continue;
      }
      for (const [existingPath, existingIndex] of targetPaths.entries()) {
        if (
          mapping.targetPath.startsWith(`${existingPath}/`) ||
          existingPath.startsWith(`${mapping.targetPath}/`)
        ) {
          addContractIssue(
            ctx,
            "overlapping_target_path",
            ["inputMapping", index, "targetPath"],
            `Target path overlaps inputMapping[${existingIndex}]`,
          );
          break;
        }
      }
      targetPaths.set(mapping.targetPath, index);
    }
  });

export const triggerBindingSchema = triggerBindingObjectSchema;
export type TriggerBinding = z.infer<typeof triggerBindingSchema>;

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addAliasConflict(
  ctx: RefinementContext,
  value: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
): void {
  const camelValue = value[camelKey];
  const snakeValue = value[snakeKey];
  if (camelValue !== undefined && snakeValue !== undefined && !valuesEqual(camelValue, snakeValue)) {
    addContractIssue(
      ctx,
      "alias_conflict",
      [camelKey],
      `${camelKey} conflicts with ${snakeKey}`,
    );
  }
}

const channelIdentityWireSchema = z
  .strictObject({
    displayName: z.string().trim().min(1).optional(),
    display_name: z.string().trim().min(1).optional(),
  })
  .superRefine((identity, ctx) => addAliasConflict(ctx, identity, "displayName", "display_name"))
  .transform((identity) => ({
    displayName: identity.displayName ?? identity.display_name,
  }));

const channelDefinitionWireInputSchema = z
  .strictObject({
    schemaVersion: z.literal(channelDefinitionSchemaVersion).optional(),
    schema_version: z.literal(channelDefinitionSchemaVersion).optional(),
    channelId: semanticIdSchema.optional(),
    channel_id: semanticIdSchema.optional(),
    organizationId: tenantIdSchema.optional(),
    organization_id: tenantIdSchema.optional(),
    workspaceId: tenantIdSchema.optional(),
    workspace_id: tenantIdSchema.optional(),
    kind: channelKindSchema.optional(),
    label: z.string().trim().min(1).optional(),
    provisioningState: channelProvisioningStateSchema.optional(),
    provisioning_state: channelProvisioningStateSchema.optional(),
    identity: channelIdentityWireSchema.nullable().optional(),
    statusMessage: z.string().nullable().optional(),
    status_message: z.string().nullable().optional(),
    runtimeMode: z.literal(channelRuntimeMode).optional(),
    runtime_mode: z.literal(channelRuntimeMode).optional(),
  })
  .superRefine((channel, ctx) => {
    addAliasConflict(ctx, channel, "schemaVersion", "schema_version");
    addAliasConflict(ctx, channel, "channelId", "channel_id");
    addAliasConflict(ctx, channel, "organizationId", "organization_id");
    addAliasConflict(ctx, channel, "workspaceId", "workspace_id");
    addAliasConflict(ctx, channel, "provisioningState", "provisioning_state");
    addAliasConflict(ctx, channel, "statusMessage", "status_message");
    addAliasConflict(ctx, channel, "runtimeMode", "runtime_mode");
  })
  .transform((channel) => ({
    schemaVersion: channel.schemaVersion ?? channel.schema_version,
    channelId: channel.channelId ?? channel.channel_id,
    organizationId: channel.organizationId ?? channel.organization_id,
    workspaceId: channel.workspaceId ?? channel.workspace_id,
    kind: channel.kind,
    label: channel.label,
    provisioningState: channel.provisioningState ?? channel.provisioning_state,
    identity: channel.identity,
    statusMessage: channel.statusMessage ?? channel.status_message,
    runtimeMode: channel.runtimeMode ?? channel.runtime_mode,
  }) as z.input<typeof channelDefinitionSchema>);

export const channelDefinitionWireSchema = channelDefinitionWireInputSchema.pipe(
  channelDefinitionSchema,
);

const triggerInputMappingWireSchema = z
  .strictObject({
    sourcePath: z.string().optional(),
    source_path: z.string().optional(),
    targetPath: z.string().optional(),
    target_path: z.string().optional(),
  })
  .superRefine((mapping, ctx) => {
    addAliasConflict(ctx, mapping, "sourcePath", "source_path");
    addAliasConflict(ctx, mapping, "targetPath", "target_path");
  })
  .transform((mapping) => ({
    sourcePath: mapping.sourcePath ?? mapping.source_path,
    targetPath: mapping.targetPath ?? mapping.target_path,
  }))
  .pipe(triggerInputMappingSchema);

const triggerBindingWireInputSchema = z
  .strictObject({
    schemaVersion: z.literal(triggerBindingSchemaVersion).optional(),
    schema_version: z.literal(triggerBindingSchemaVersion).optional(),
    bindingId: semanticIdSchema.optional(),
    binding_id: semanticIdSchema.optional(),
    organizationId: tenantIdSchema.optional(),
    organization_id: tenantIdSchema.optional(),
    workspaceId: tenantIdSchema.optional(),
    workspace_id: tenantIdSchema.optional(),
    channelId: semanticIdSchema.optional(),
    channel_id: semanticIdSchema.optional(),
    event: semanticIdSchema.optional(),
    workflowId: semanticIdSchema.optional(),
    workflow_id: semanticIdSchema.optional(),
    triggerNodeId: semanticIdSchema.optional(),
    trigger_node_id: semanticIdSchema.optional(),
    inputMapping: z.array(triggerInputMappingWireSchema).optional(),
    input_mapping: z.array(triggerInputMappingWireSchema).optional(),
    runtimeMode: z.literal(channelRuntimeMode).optional(),
    runtime_mode: z.literal(channelRuntimeMode).optional(),
    enabled: z.literal(false).optional(),
    disabledReason: z.literal(channelIntegrationDisabledReason).optional(),
    disabled_reason: z.literal(channelIntegrationDisabledReason).optional(),
  })
  .superRefine((binding, ctx) => {
    addAliasConflict(ctx, binding, "schemaVersion", "schema_version");
    addAliasConflict(ctx, binding, "bindingId", "binding_id");
    addAliasConflict(ctx, binding, "organizationId", "organization_id");
    addAliasConflict(ctx, binding, "workspaceId", "workspace_id");
    addAliasConflict(ctx, binding, "channelId", "channel_id");
    addAliasConflict(ctx, binding, "workflowId", "workflow_id");
    addAliasConflict(ctx, binding, "triggerNodeId", "trigger_node_id");
    addAliasConflict(ctx, binding, "inputMapping", "input_mapping");
    addAliasConflict(ctx, binding, "runtimeMode", "runtime_mode");
    addAliasConflict(ctx, binding, "disabledReason", "disabled_reason");
  })
  .transform((binding) => ({
    schemaVersion: binding.schemaVersion ?? binding.schema_version,
    bindingId: binding.bindingId ?? binding.binding_id,
    organizationId: binding.organizationId ?? binding.organization_id,
    workspaceId: binding.workspaceId ?? binding.workspace_id,
    channelId: binding.channelId ?? binding.channel_id,
    event: binding.event,
    workflowId: binding.workflowId ?? binding.workflow_id,
    triggerNodeId: binding.triggerNodeId ?? binding.trigger_node_id,
    inputMapping: binding.inputMapping ?? binding.input_mapping,
    runtimeMode: binding.runtimeMode ?? binding.runtime_mode,
    enabled: binding.enabled,
    disabledReason: binding.disabledReason ?? binding.disabled_reason,
  }) as z.input<typeof triggerBindingSchema>);

export const triggerBindingWireSchema = triggerBindingWireInputSchema.pipe(triggerBindingSchema);

export interface ChannelDefinitionWire {
  schema_version: typeof channelDefinitionSchemaVersion;
  channel_id: string;
  organization_id: string;
  workspace_id?: string;
  kind: ChannelKind;
  label: string;
  provisioning_state: ChannelProvisioningState;
  identity: { display_name: string } | null;
  status_message: string | null;
  runtime_mode: typeof channelRuntimeMode;
}

export interface TriggerBindingWire {
  schema_version: typeof triggerBindingSchemaVersion;
  binding_id: string;
  organization_id: string;
  workspace_id?: string;
  channel_id: string;
  event: string;
  workflow_id: string;
  trigger_node_id: string;
  input_mapping: Array<{ source_path: string; target_path: string }>;
  runtime_mode: typeof channelRuntimeMode;
  enabled: false;
  disabled_reason: typeof channelIntegrationDisabledReason;
}

export const parseChannelDefinition = (input: unknown): ChannelDefinition =>
  channelDefinitionSchema.parse(input);
export const safeParseChannelDefinition = (input: unknown) => channelDefinitionSchema.safeParse(input);
export const parseChannelDefinitionWire = (input: unknown): ChannelDefinition =>
  channelDefinitionWireSchema.parse(input);
export const safeParseChannelDefinitionWire = (input: unknown) =>
  channelDefinitionWireSchema.safeParse(input);

export function toChannelDefinitionWire(input: unknown): ChannelDefinitionWire {
  const channel = parseChannelDefinition(input);
  return {
    schema_version: channel.schemaVersion,
    channel_id: channel.channelId,
    organization_id: channel.organizationId,
    ...(channel.workspaceId === undefined ? {} : { workspace_id: channel.workspaceId }),
    kind: channel.kind,
    label: channel.label,
    provisioning_state: channel.provisioningState,
    identity: channel.identity === null ? null : { display_name: channel.identity.displayName },
    status_message: channel.statusMessage,
    runtime_mode: channel.runtimeMode,
  };
}

export const parseTriggerBinding = (input: unknown): TriggerBinding =>
  triggerBindingSchema.parse(input);
export const safeParseTriggerBinding = (input: unknown) => triggerBindingSchema.safeParse(input);
export const parseTriggerBindingWire = (input: unknown): TriggerBinding =>
  triggerBindingWireSchema.parse(input);
export const safeParseTriggerBindingWire = (input: unknown) =>
  triggerBindingWireSchema.safeParse(input);

export function toTriggerBindingWire(input: unknown): TriggerBindingWire {
  const binding = parseTriggerBinding(input);
  return {
    schema_version: binding.schemaVersion,
    binding_id: binding.bindingId,
    organization_id: binding.organizationId,
    ...(binding.workspaceId === undefined ? {} : { workspace_id: binding.workspaceId }),
    channel_id: binding.channelId,
    event: binding.event,
    workflow_id: binding.workflowId,
    trigger_node_id: binding.triggerNodeId,
    input_mapping: binding.inputMapping.map((mapping) => ({
      source_path: mapping.sourcePath,
      target_path: mapping.targetPath,
    })),
    runtime_mode: binding.runtimeMode,
    enabled: binding.enabled,
    disabled_reason: binding.disabledReason,
  };
}

export interface TriggerBindingWorkflowReference {
  workflowId: string;
  organizationId: string;
  workspaceId?: string;
  nodes: ReadonlyArray<{ nodeId: string; type: string }>;
}

export interface TriggerBindingReferenceIssue {
  code: Extract<
    ChannelContractIssueCode,
    | "organization_mismatch"
    | "workspace_mismatch"
    | "workflow_not_found"
    | "trigger_node_not_found"
    | "node_not_trigger"
    | "channel_not_found"
  >;
  path: PropertyKey[];
  message: string;
}

export interface TriggerBindingReferenceValidation {
  valid: boolean;
  issues: TriggerBindingReferenceIssue[];
}

export function validateTriggerBindingReferences(input: {
  binding: TriggerBinding;
  channels: ReadonlyArray<ChannelDefinition>;
  workflows: ReadonlyArray<TriggerBindingWorkflowReference>;
}): TriggerBindingReferenceValidation {
  const issues: TriggerBindingReferenceIssue[] = [];
  const channel = input.channels.find((candidate) => candidate.channelId === input.binding.channelId);
  if (!channel) {
    issues.push({
      code: "channel_not_found",
      path: ["channelId"],
      message: "Binding references an unknown channel",
    });
  } else {
    if (channel.organizationId !== input.binding.organizationId) {
      issues.push({
        code: "organization_mismatch",
        path: ["organizationId"],
        message: "Binding and channel organization scopes differ",
      });
    }
    if (channel.workspaceId !== input.binding.workspaceId) {
      issues.push({
        code: "workspace_mismatch",
        path: ["workspaceId"],
        message: "Binding and channel workspace scopes differ",
      });
    }
  }

  const workflow = input.workflows.find(
    (candidate) => candidate.workflowId === input.binding.workflowId,
  );
  if (!workflow) {
    issues.push({
      code: "workflow_not_found",
      path: ["workflowId"],
      message: "Binding references an unknown workflow",
    });
  } else {
    if (workflow.organizationId !== input.binding.organizationId) {
      issues.push({
        code: "organization_mismatch",
        path: ["organizationId"],
        message: "Binding and workflow organization scopes differ",
      });
    }
    if (workflow.workspaceId !== input.binding.workspaceId) {
      issues.push({
        code: "workspace_mismatch",
        path: ["workspaceId"],
        message: "Binding and workflow workspace scopes differ",
      });
    }

    const node = workflow.nodes.find((candidate) => candidate.nodeId === input.binding.triggerNodeId);
    if (!node) {
      issues.push({
        code: "trigger_node_not_found",
        path: ["triggerNodeId"],
        message: "Binding references an unknown trigger node",
      });
    } else if (node.type !== "trigger") {
      issues.push({
        code: "node_not_trigger",
        path: ["triggerNodeId"],
        message: "Binding triggerNodeId must reference a trigger node",
      });
    }
  }

  return { valid: issues.length === 0, issues };
}
