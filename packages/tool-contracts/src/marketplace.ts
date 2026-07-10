import { z } from "zod";

export const marketplaceSchemaVersionSchema = z.literal("1");
export type MarketplaceSchemaVersion = z.infer<typeof marketplaceSchemaVersionSchema>;

export const marketplacePackageKindSchema = z.enum([
  "bundle",
  "app",
  "workflow",
  "skill",
  "command_tool_pack",
  "agent",
  "artifact_template",
  "mcp_addon",
  "provider_integration",
  "managed_internal",
]);
export type MarketplacePackageKind = z.infer<typeof marketplacePackageKindSchema>;

export const legacyMarketplacePackageKindSchema = z.enum([
  "agent_template",
  "app_template",
  "workflow_template",
  "skill_template",
  "tool_pack",
  "artifact_template",
  "mcp_addon",
]);
export type LegacyMarketplacePackageKind = z.infer<typeof legacyMarketplacePackageKindSchema>;

export const marketplaceVisibilitySchema = z.enum(["private", "organization", "public", "marketplace", "managed_internal"]);
export const marketplaceInstallScopeSchema = z.enum(["user", "organization", "workspace", "environment"]);
export const packageInstallModeSchema = z.enum(["pinned", "copied", "forked", "subscribed"]);
export const packageUpdatePolicySchema = z.enum(["manual", "notify", "auto_patch"]);
export const marketplaceReadinessLabelSchema = z.enum(["EXISTS", "FIXTURE", "MISSING", "CANDIDATE-GAP", "FROZEN", "UNDECIDED"]);
export const marketplacePermissionModeSchema = z.enum(["off", "ask", "allow"]);
export const marketplaceCommandEffectSchema = z.enum(["read", "write", "destructive", "external", "none"]);
export const marketplaceApprovalPolicySchema = z.enum(["none", "preview", "preview_then_trusted_approval"]);
export const marketplaceRuntimeModeSchema = z.enum([
  "descriptor_only",
  "workflow_graph",
  "declarative_policy",
  "host_extension",
  "bundle_only",
  "managed_code",
  "adapter",
]);
export const marketplaceRuntimeEffectSchema = z.enum([
  "none",
  "frontend_projection",
  "host_command",
  "policy_declaration",
  "policy_gate",
  "record_write",
  "event_emit",
  "external_call",
  "installs_dependencies",
  "configures_installation",
]);
export const marketplaceProofTierSchema = z.enum([
  "docs-only",
  "scaffolded",
  "mock-backed",
  "adapter-backed",
  "sandbox-live",
  "production-live",
  "quarantined",
  "deprecated",
]);

const semverLikeSchema = z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/, "Expected semver-like version");
const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/i, "Expected sha256:<64 hex chars> manifest hash");
const packageIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/i, "Expected stable package id");
export const packageVersionIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*@\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/i, "Expected <packageId>@<semver>");

export const marketplacePublisherSchema = z.object({
  publisherId: z.string().min(1),
  displayName: z.string().min(1),
  type: z.enum(["sonik", "organization", "creator", "partner", "managed_internal"]).default("creator"),
}).strict();
export type MarketplacePublisher = z.infer<typeof marketplacePublisherSchema>;

export const marketplaceRuntimeCapabilitiesSchema = z.object({
  jsonRenderCanonical: z.boolean().default(true),
  htmlEscapeHatch: z.boolean().default(false),
  sandboxRuntime: z.boolean().default(false),
  commandBackedComponents: z.boolean().default(false),
  requiresHostContext: z.boolean().default(false),
  requiresTrustedApproval: z.boolean().default(false),
}).strict();
export type MarketplaceRuntimeCapabilities = z.infer<typeof marketplaceRuntimeCapabilitiesSchema>;

export const marketplacePermissionGrantSchema = z.object({
  targetId: z.string().min(1),
  targetKind: marketplacePackageKindSchema.or(z.literal("command")),
  mode: marketplacePermissionModeSchema,
  effect: marketplaceCommandEffectSchema.default("none"),
  approvalPolicy: marketplaceApprovalPolicySchema.default("none"),
  requiredHostContext: z.array(z.string()).default([]),
  reason: z.string().optional(),
}).strict().superRefine((grant, ctx) => {
  if ((grant.effect === "write" || grant.effect === "destructive" || grant.effect === "external") && grant.mode !== "off" && grant.approvalPolicy !== "preview_then_trusted_approval") {
    ctx.addIssue({ code: "custom", path: ["approvalPolicy"], message: "Write/destructive/external active grants require preview_then_trusted_approval" });
  }
  if ((grant.effect === "write" || grant.effect === "destructive" || grant.effect === "external") && grant.mode !== "off" && grant.requiredHostContext.length === 0) {
    ctx.addIssue({ code: "custom", path: ["requiredHostContext"], message: "Write/destructive/external active grants require trusted host context" });
  }
});
export type MarketplacePermissionGrant = z.infer<typeof marketplacePermissionGrantSchema>;

export const marketplaceCommandBindingSchema = z.object({
  bindingId: z.string().min(1),
  commandId: z.string().min(1),
  mode: z.enum(["preview", "commit"]),
  effect: marketplaceCommandEffectSchema,
  approvalPolicy: marketplaceApprovalPolicySchema.default("none"),
  inputSchemaRef: z.string().optional(),
  outputSchemaRef: z.string().optional(),
  requiredHostContext: z.array(z.string()).default([]),
  receiptRef: z.string().optional(),
}).strict().superRefine((binding, ctx) => {
  if (binding.mode === "commit" && binding.approvalPolicy !== "preview_then_trusted_approval") {
    ctx.addIssue({ code: "custom", path: ["approvalPolicy"], message: "Commit bindings require preview_then_trusted_approval" });
  }
  if ((binding.effect === "write" || binding.effect === "destructive" || binding.effect === "external") && binding.approvalPolicy !== "preview_then_trusted_approval") {
    ctx.addIssue({ code: "custom", path: ["approvalPolicy"], message: "Write/destructive/external bindings require trusted approval" });
  }
  if ((binding.effect === "write" || binding.effect === "destructive" || binding.effect === "external") && binding.requiredHostContext.length === 0) {
    ctx.addIssue({ code: "custom", path: ["requiredHostContext"], message: "Write/destructive/external bindings require trusted host context" });
  }
});
export type MarketplaceCommandBinding = z.infer<typeof marketplaceCommandBindingSchema>;

export const marketplaceAppActionSchema = z.object({
  actionId: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["state_update", "command_preview_request", "approval_request", "command_binding_ref", "navigate", "emit_event"]),
  bindingId: z.string().optional(),
  writesTo: z.array(z.string()).default([]),
}).strict();
export type MarketplaceAppAction = z.infer<typeof marketplaceAppActionSchema>;

export const htmlPresentationEscapeHatchSchema = z.object({
  enabled: z.boolean().default(false),
  sandbox: z.enum(["iframe", "shadow_dom", "none"]).default("iframe"),
  canonicalJsonStateRef: z.string().optional(),
  allowedCapabilities: z.array(z.enum(["render", "export", "print", "animate"])).default(["render"]),
}).strict().superRefine((html, ctx) => {
  if (html.enabled && !html.canonicalJsonStateRef) {
    ctx.addIssue({ code: "custom", path: ["canonicalJsonStateRef"], message: "HTML escape hatch requires canonical JSON state boundary" });
  }
  if (html.enabled && html.sandbox !== "iframe") {
    ctx.addIssue({ code: "custom", path: ["sandbox"], message: "Enabled HTML escape hatch must use an iframe sandbox" });
  }
});
export type HtmlPresentationEscapeHatch = z.infer<typeof htmlPresentationEscapeHatchSchema>;

export const commandBackedAppDefinitionSchema = z.object({
  appId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  jsonRender: z.object({
    componentRegistryRef: z.string().min(1),
    artifactTemplateRef: z.string().optional(),
    stateSchemaRef: z.string().min(1),
    initialState: z.record(z.string(), z.unknown()).default({}),
  }).strict(),
  actions: z.array(marketplaceAppActionSchema).default([]),
  commandBindings: z.array(marketplaceCommandBindingSchema).default([]),
  htmlPresentation: htmlPresentationEscapeHatchSchema.default({ enabled: false, sandbox: "iframe", allowedCapabilities: ["render"] }),
  requiredHostContext: z.array(z.string()).default([]),
  receipts: z.array(z.object({ receiptId: z.string().min(1), commandId: z.string().min(1), evidencePath: z.string().optional() }).strict()).default([]),
}).strict().superRefine((app, ctx) => {
  const bindingsById = new Map(app.commandBindings.map((binding) => [binding.bindingId, binding]));
  const previewCommandIds = new Set(app.commandBindings.filter((binding) => binding.mode === "preview").map((binding) => binding.commandId));
  for (const [index, binding] of app.commandBindings.entries()) {
    if (binding.mode === "commit" && !previewCommandIds.has(binding.commandId)) {
      ctx.addIssue({ code: "custom", path: ["commandBindings", index, "commandId"], message: "Commit bindings require a same-command preview binding" });
    }
  }
  for (const [index, action] of app.actions.entries()) {
    if (action.kind === "command_binding_ref") {
      ctx.addIssue({ code: "custom", path: ["actions", index, "kind"], message: "Renderer actions must request preview/approval, not bind directly to executable command bindings" });
    }
    if (action.kind === "command_preview_request" && action.bindingId) {
      const binding = bindingsById.get(action.bindingId);
      if (!binding) {
        ctx.addIssue({ code: "custom", path: ["actions", index, "bindingId"], message: "Command preview action references unknown binding" });
      } else if (binding.mode !== "preview") {
        ctx.addIssue({ code: "custom", path: ["actions", index, "bindingId"], message: "Command preview actions may only target preview bindings" });
      }
    }
    if (action.kind === "approval_request" && action.bindingId) {
      const binding = bindingsById.get(action.bindingId);
      if (!binding) {
        ctx.addIssue({ code: "custom", path: ["actions", index, "bindingId"], message: "Approval action references unknown binding" });
      } else if (binding.mode !== "commit") {
        ctx.addIssue({ code: "custom", path: ["actions", index, "bindingId"], message: "Approval actions may only target commit bindings" });
      }
    }
  }
});
export type CommandBackedAppDefinition = z.infer<typeof commandBackedAppDefinitionSchema>;

export const workflowNodeTypeSchema = z.enum(["trigger", "ask_user", "skill", "artifact", "tool_preview", "approval", "tool_commit", "remote_execution", "evidence", "branch"]);
export type WorkflowNodeType = z.infer<typeof workflowNodeTypeSchema>;

export const workflowNodeDefinitionSchema = z.object({
  nodeId: z.string().min(1),
  type: workflowNodeTypeSchema,
  title: z.string().min(1),
  commandId: z.string().optional(),
  skillId: z.string().optional(),
  effect: marketplaceCommandEffectSchema.default("none"),
  approvalPolicy: marketplaceApprovalPolicySchema.default("none"),
  requiredHostContext: z.array(z.string()).default([]),
}).strict().superRefine((node, ctx) => {
  if (node.type === "tool_commit" && node.approvalPolicy !== "preview_then_trusted_approval") {
    ctx.addIssue({ code: "custom", path: ["approvalPolicy"], message: "Tool commit workflow nodes require trusted approval policy" });
  }
  // A preview node is execution-inert by definition — a mutating effect under
  // tool_preview would let the controller run a write without the commit gate.
  if (node.type === "tool_preview" && (node.effect === "write" || node.effect === "destructive" || node.effect === "external")) {
    ctx.addIssue({ code: "custom", path: ["effect"], message: "tool_preview nodes must be effect none or read; mutating work belongs on a tool_commit node" });
  }
  if ((node.effect === "write" || node.effect === "destructive" || node.effect === "external") && node.approvalPolicy !== "preview_then_trusted_approval") {
    ctx.addIssue({ code: "custom", path: ["approvalPolicy"], message: "Write/destructive/external workflow nodes require preview_then_trusted_approval" });
  }
  if ((node.effect === "write" || node.effect === "destructive" || node.effect === "external") && node.requiredHostContext.length === 0) {
    ctx.addIssue({ code: "custom", path: ["requiredHostContext"], message: "Write/destructive/external workflow nodes require trusted host context" });
  }
});
export type WorkflowNodeDefinition = z.infer<typeof workflowNodeDefinitionSchema>;

export const workflowEdgeDefinitionSchema = z.object({
  edgeId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  condition: z.string().optional(),
}).strict();
export type WorkflowEdgeDefinition = z.infer<typeof workflowEdgeDefinitionSchema>;

export const workflowDefinitionSchema = z.object({
  workflowId: z.string().min(1),
  title: z.string().min(1),
  triggerPhrases: z.array(z.string()).default([]),
  nodes: z.array(workflowNodeDefinitionSchema).min(1),
  edges: z.array(workflowEdgeDefinitionSchema).default([]),
  requiredSkills: z.array(z.string()).default([]),
  requiredCommands: z.array(z.string()).default([]),
  /** Model-facing facade pinned for the run's lifetime (audit P0: <=5 tools,
   *  no toolset churn mid-workflow). Empty means the facade is host-derived —
   *  existing definitions parse unchanged. */
  facadeToolIds: z.array(z.string()).max(5).default([]),
  version: semverLikeSchema,
}).strict().superRefine((workflow, ctx) => {
  const previewCommandIds = new Set(workflow.nodes.filter((node) => node.type === "tool_preview" && node.commandId).map((node) => node.commandId as string));
  const nodeIds = new Set<string>();
  for (const [index, node] of workflow.nodes.entries()) {
    if (nodeIds.has(node.nodeId)) {
      ctx.addIssue({ code: "custom", path: ["nodes", index, "nodeId"], message: "Workflow nodeIds must be unique" });
    }
    nodeIds.add(node.nodeId);
    const mutatingEffect = node.effect === "write" || node.effect === "destructive" || node.effect === "external";
    if ((node.type === "tool_commit" || mutatingEffect) && !node.commandId) {
      ctx.addIssue({ code: "custom", path: ["nodes", index, "commandId"], message: "Mutating workflow nodes require a commandId" });
    }
    if ((node.type === "tool_commit" || mutatingEffect) && node.commandId && !previewCommandIds.has(node.commandId)) {
      ctx.addIssue({ code: "custom", path: ["nodes", index, "commandId"], message: "Mutating workflow nodes require a same-command preview node" });
    }
  }
  for (const [index, edge] of workflow.edges.entries()) {
    if (!nodeIds.has(edge.from)) {
      ctx.addIssue({ code: "custom", path: ["edges", index, "from"], message: "Workflow edge from must reference an existing nodeId" });
    }
    if (!nodeIds.has(edge.to)) {
      ctx.addIssue({ code: "custom", path: ["edges", index, "to"], message: "Workflow edge to must reference an existing nodeId" });
    }
  }
  // With a declared facade, every model-driven node (tool_preview is the only
  // model-callable node type; approval/commit stay host-side) must map to a
  // facade tool — otherwise the pinned toolset can't actually run the graph.
  if (workflow.facadeToolIds.length > 0) {
    const facade = new Set(workflow.facadeToolIds);
    for (const [index, node] of workflow.nodes.entries()) {
      if (node.type === "tool_preview" && node.commandId && !facade.has(node.commandId)) {
        ctx.addIssue({ code: "custom", path: ["nodes", index, "commandId"], message: "tool_preview node commandId must be one of facadeToolIds when a facade is declared" });
      }
    }
  }
});
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

export const skillDefinitionRefSchema = z.object({
  skillId: z.string().min(1),
  version: semverLikeSchema.optional(),
  source: z.enum(["sonik-skills", "workspace", "marketplace", "external"]).default("sonik-skills"),
  readiness: marketplaceReadinessLabelSchema.default("EXISTS"),
}).strict();
export type SkillDefinitionRef = z.infer<typeof skillDefinitionRefSchema>;

export const commandToolPackDefinitionSchema = z.object({
  toolPackId: z.string().min(1),
  canonicalKind: z.literal("command_tool_pack").default("command_tool_pack"),
  title: z.string().min(1),
  commandIds: z.array(z.string()).min(1),
  defaultPermissions: z.record(z.string(), marketplacePermissionModeSchema).default({}),
  commandBindings: z.array(marketplaceCommandBindingSchema).default([]),
  readiness: marketplaceReadinessLabelSchema.default("FIXTURE"),
}).strict().superRefine((toolPack, ctx) => {
  const previewCommandIds = new Set(toolPack.commandBindings.filter((binding) => binding.mode === "preview").map((binding) => binding.commandId));
  for (const [index, binding] of toolPack.commandBindings.entries()) {
    if (binding.mode === "commit" && !previewCommandIds.has(binding.commandId)) {
      ctx.addIssue({ code: "custom", path: ["commandBindings", index, "commandId"], message: "Command tool pack commit bindings require a same-command preview binding" });
    }
  }
});
export type CommandToolPackDefinition = z.infer<typeof commandToolPackDefinitionSchema>;

export const agentDefinitionSchema = z.object({
  agentId: z.string().min(1),
  title: z.string().min(1),
  modelPolicyRef: z.string().optional(),
  systemPromptRef: z.string().optional(),
  requiredSkills: z.array(z.string()).default([]),
  requiredToolPacks: z.array(z.string()).default([]),
  toolPolicy: z.record(z.string(), marketplacePermissionModeSchema).default({}),
}).strict();
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

export const artifactTemplateDefinitionSchema = z.object({
  artifactTemplateId: z.string().min(1),
  title: z.string().min(1),
  mode: z.enum(["json_render", "document", "html_escape_hatch"]),
  jsonRenderSpecRef: z.string().optional(),
  stateSchemaRef: z.string().optional(),
  htmlPresentation: htmlPresentationEscapeHatchSchema.optional(),
}).strict().superRefine((artifact, ctx) => {
  if (artifact.mode === "html_escape_hatch") {
    const parsed = htmlPresentationEscapeHatchSchema.safeParse(artifact.htmlPresentation ?? { enabled: true, sandbox: "iframe" });
    if (!parsed.success || !parsed.data.enabled || !parsed.data.canonicalJsonStateRef || parsed.data.sandbox !== "iframe") {
      ctx.addIssue({ code: "custom", path: ["htmlPresentation"], message: "HTML artifact templates require enabled sandboxed HTML with a canonical JSON state boundary" });
    }
  }
});
export type ArtifactTemplateDefinition = z.infer<typeof artifactTemplateDefinitionSchema>;

export const mcpAddonDefinitionSchema = z.object({
  addonId: z.string().min(1),
  title: z.string().min(1),
  serverRef: z.string().min(1),
  requiredScopes: z.array(z.string()).default([]),
  credentialRefKind: z.enum(["none", "vault_ref", "host_managed"]).default("none"),
}).strict();
export type McpAddonDefinition = z.infer<typeof mcpAddonDefinitionSchema>;

export const providerIntegrationDefinitionSchema = z.object({
  providerIntegrationId: z.string().min(1),
  title: z.string().min(1),
  providerKey: z.string().min(1),
  packageRef: z.string().optional(),
  credentialRefKind: z.enum(["none", "vault_ref", "host_managed"]).default("host_managed"),
  supportedOperations: z.array(z.string()).default([]),
  runtimeMode: marketplaceRuntimeModeSchema.default("adapter"),
}).strict();
export type ProviderIntegrationDefinition = z.infer<typeof providerIntegrationDefinitionSchema>;

export const marketplaceSubobjectPayloadSchema = z.object({
  app: commandBackedAppDefinitionSchema.optional(),
  workflow: workflowDefinitionSchema.optional(),
  skill: skillDefinitionRefSchema.optional(),
  commandToolPack: commandToolPackDefinitionSchema.optional(),
  agent: agentDefinitionSchema.optional(),
  artifactTemplate: artifactTemplateDefinitionSchema.optional(),
  mcpAddon: mcpAddonDefinitionSchema.optional(),
  providerIntegration: providerIntegrationDefinitionSchema.optional(),
}).strict().default({});
export type MarketplaceSubobjectPayload = z.infer<typeof marketplaceSubobjectPayloadSchema>;

export const bundleCompositionItemSchema = z.object({
  kind: marketplacePackageKindSchema.exclude(["bundle"]),
  packageRef: packageIdSchema.optional(),
  packageVersionId: packageVersionIdSchema.optional(),
  versionRange: z.string().optional(),
  embeddedDefinitionId: z.string().optional(),
  defaultInstallMode: packageInstallModeSchema.default("pinned"),
  updatePolicy: packageUpdatePolicySchema.default("manual"),
  required: z.boolean().default(true),
  permissions: z.array(marketplacePermissionGrantSchema).default([]),
  readiness: marketplaceReadinessLabelSchema.default("FIXTURE"),
}).strict().superRefine((item, ctx) => {
  const selectorCount = Number(Boolean(item.packageVersionId)) + Number(Boolean(item.versionRange)) + Number(Boolean(item.embeddedDefinitionId));
  if (selectorCount !== 1) {
    ctx.addIssue({ code: "custom", path: ["packageVersionId"], message: "Bundle composition item needs exactly one of packageVersionId, versionRange, or embeddedDefinitionId" });
  }
  if (item.versionRange && !item.packageRef) {
    ctx.addIssue({ code: "custom", path: ["packageRef"], message: "Version-range bundle entries require packageRef" });
  }
  if (item.packageVersionId && item.packageRef && item.packageRef !== item.packageVersionId.split("@")[0]) {
    ctx.addIssue({ code: "custom", path: ["packageRef"], message: "packageRef must match packageVersionId package id" });
  }
  if (item.defaultInstallMode === "subscribed" && item.permissions.some((permission) => permission.effect !== "read" && permission.effect !== "none")) {
    ctx.addIssue({ code: "custom", path: ["defaultInstallMode"], message: "Subscribed installs are limited to low-risk/read-only package entries" });
  }
  if ((item.defaultInstallMode === "subscribed" || item.updatePolicy === "auto_patch") && !hasExplicitReadOnlyPermissions(item.permissions)) {
    ctx.addIssue({ code: "custom", path: ["permissions"], message: "Subscribed/auto-patch bundle entries require explicit read-only permissions" });
  }
  if ((item.defaultInstallMode === "subscribed" || item.updatePolicy === "auto_patch") && ["command_tool_pack", "provider_integration", "managed_internal"].includes(item.kind)) {
    ctx.addIssue({ code: "custom", path: ["kind"], message: "Subscribed/auto-patch entries cannot target command packs, provider integrations, or managed internals in v0" });
  }
});
export type BundleCompositionItem = z.infer<typeof bundleCompositionItemSchema>;

export const bundleManifestSchema = z.object({
  bundleId: z.string().min(1),
  contains: z.array(bundleCompositionItemSchema).min(1),
  installOrder: z.array(z.string()).default([]),
  embeddedDefinitions: marketplaceSubobjectPayloadSchema.default({}),
}).strict().superRefine((bundle, ctx) => {
  const packageVersionRefs = new Set(bundle.contains.flatMap((item) => item.packageVersionId ? [item.packageVersionId] : []));
  const embeddedDefinitionRefs = new Set(bundle.contains.flatMap((item) => item.embeddedDefinitionId ? [item.embeddedDefinitionId] : []));
  const installableRefs = new Set([...packageVersionRefs, ...embeddedDefinitionRefs]);
  const seenContainsRefs = new Set<string>();
  for (const [index, item] of bundle.contains.entries()) {
    const ref = item.packageVersionId ?? item.embeddedDefinitionId ?? (item.packageRef && item.versionRange ? `${item.packageRef}@${item.versionRange}` : undefined);
    if (ref && seenContainsRefs.has(ref)) {
      ctx.addIssue({ code: "custom", path: ["contains", index], message: "Bundle contains entries must reference unique package versions, version ranges, or embedded definition ids" });
    }
    if (ref) seenContainsRefs.add(ref);
  }
  const seenInstallOrder = new Set<string>();
  for (const [index, ref] of bundle.installOrder.entries()) {
    if (!installableRefs.has(ref)) {
      ctx.addIssue({ code: "custom", path: ["installOrder", index], message: "installOrder entries must reference packageVersionId or embeddedDefinitionId values in contains" });
    }
    if (seenInstallOrder.has(ref)) {
      ctx.addIssue({ code: "custom", path: ["installOrder", index], message: "installOrder entries must be unique" });
    }
    seenInstallOrder.add(ref);
  }
  const embeddedKindsById = embeddedDefinitionKindsById(bundle.embeddedDefinitions);
  for (const [index, item] of bundle.contains.entries()) {
    if (item.embeddedDefinitionId && !embeddedKindsById.has(item.embeddedDefinitionId)) {
      ctx.addIssue({ code: "custom", path: ["contains", index, "embeddedDefinitionId"], message: "embeddedDefinitionId must resolve to an embedded definition id" });
    }
    if (item.embeddedDefinitionId && embeddedKindsById.has(item.embeddedDefinitionId) && embeddedKindsById.get(item.embeddedDefinitionId) !== item.kind) {
      ctx.addIssue({ code: "custom", path: ["contains", index, "kind"], message: "Bundle embedded definition kind must match the composition item kind" });
    }
  }
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;

const baseMarketplaceManifestSchema = z.object({
  marketplaceSchemaVersion: marketplaceSchemaVersionSchema,
  packageId: packageIdSchema,
  packageVersionId: packageVersionIdSchema,
  packageSemver: semverLikeSchema,
  kind: marketplacePackageKindSchema,
  title: z.string().min(1),
  summary: z.string().default(""),
  publisher: marketplacePublisherSchema,
  visibility: marketplaceVisibilitySchema.default("private"),
  installScopes: z.array(marketplaceInstallScopeSchema).default(["organization"]),
  runtimeMode: marketplaceRuntimeModeSchema.default("descriptor_only"),
  runtimeEffects: z.array(marketplaceRuntimeEffectSchema).default(["none"]),
  proofTier: marketplaceProofTierSchema.default("docs-only"),
  readiness: marketplaceReadinessLabelSchema.default("FIXTURE"),
  runtimeCapabilities: marketplaceRuntimeCapabilitiesSchema.default({ jsonRenderCanonical: true, htmlEscapeHatch: false, sandboxRuntime: false, commandBackedComponents: false, requiresHostContext: false, requiresTrustedApproval: false }),
  manifestHash: sha256Schema.optional(),
  migration: z.object({
    upgradeFrom: z.array(z.string()).default([]),
    migrationNotes: z.string().optional(),
    requiresReviewOnUpgrade: z.boolean().default(false),
  }).strict().default({ upgradeFrom: [], requiresReviewOnUpgrade: false }),
  permissions: z.array(marketplacePermissionGrantSchema).default([]),
  dependencies: z.array(bundleCompositionItemSchema).default([]),
  payload: marketplaceSubobjectPayloadSchema.default({}),
  bundle: bundleManifestSchema.optional(),
}).strict();

export const marketplaceManifestSchema = baseMarketplaceManifestSchema.superRefine((manifest, ctx) => {
  const packageIdFromVersion = manifest.packageVersionId.split("@")[0];
  const semverFromVersion = semverFromPackageVersionId(manifest.packageVersionId);
  if (packageIdFromVersion !== manifest.packageId) {
    ctx.addIssue({ code: "custom", path: ["packageVersionId"], message: "packageVersionId must start with packageId@" });
  }
  if (semverFromVersion !== manifest.packageSemver) {
    ctx.addIssue({ code: "custom", path: ["packageSemver"], message: "packageSemver must match packageVersionId semver" });
  }
  if (manifest.kind === "bundle" && !manifest.bundle) {
    ctx.addIssue({ code: "custom", path: ["bundle"], message: "Bundle packages require a bundle manifest" });
  }
  if (manifest.kind !== "bundle" && manifest.bundle) {
    ctx.addIssue({ code: "custom", path: ["bundle"], message: "Only kind=bundle packages may include bundle composition" });
  }
  const expectedPayloadKey = payloadKeyForKind(manifest.kind);
  if (expectedPayloadKey && !(manifest.payload as Record<string, unknown>)[expectedPayloadKey]) {
    ctx.addIssue({ code: "custom", path: ["payload", expectedPayloadKey], message: `${manifest.kind} packages require ${expectedPayloadKey} payload` });
  }
  const unexpectedPayloadKey = findUnexpectedTypedPayloadKey(manifest.kind, manifest.payload);
  if (unexpectedPayloadKey) {
    ctx.addIssue({ code: "custom", path: ["payload", unexpectedPayloadKey], message: `${manifest.kind} packages cannot include ${unexpectedPayloadKey} payload` });
  }
  if (manifest.kind === "app" && !manifest.runtimeCapabilities.jsonRenderCanonical) {
    ctx.addIssue({ code: "custom", path: ["runtimeCapabilities", "jsonRenderCanonical"], message: "App packages require canonical JSON-render state" });
  }
  if (manifest.runtimeMode === "managed_code" && manifest.kind !== "managed_internal") {
    ctx.addIssue({ code: "custom", path: ["runtimeMode"], message: "managed_code runtime mode is reserved for managed_internal packages" });
  }
  if (manifest.runtimeCapabilities.sandboxRuntime && manifest.kind !== "managed_internal") {
    ctx.addIssue({ code: "custom", path: ["runtimeCapabilities", "sandboxRuntime"], message: "sandboxRuntime capability is reserved for managed_internal packages in v0" });
  }
  const requiresTrustedRuntimeGate = manifest.runtimeEffects.some((effect) => effect === "record_write" || effect === "external_call");
  if (requiresTrustedRuntimeGate && !manifest.runtimeCapabilities.requiresTrustedApproval) {
    ctx.addIssue({ code: "custom", path: ["runtimeCapabilities", "requiresTrustedApproval"], message: "Runtime write/external effects require trusted approval" });
  }
  if (requiresTrustedRuntimeGate && !manifest.runtimeCapabilities.requiresHostContext) {
    ctx.addIssue({ code: "custom", path: ["runtimeCapabilities", "requiresHostContext"], message: "Runtime write/external effects require trusted host context" });
  }
  const secretPath = findSecretLikePath(manifest);
  if (secretPath) {
    ctx.addIssue({ code: "custom", path: secretPath, message: "Marketplace manifests must not embed secrets or tokens" });
  }
  const executablePath = findExecutableCodePath(manifest);
  if (executablePath) {
    ctx.addIssue({ code: "custom", path: executablePath, message: "Marketplace manifests must not embed executable source code" });
  }
});
export type MarketplaceManifest = z.infer<typeof marketplaceManifestSchema>;
export type MarketplaceBundleManifest = MarketplaceManifest & { kind: "bundle"; bundle: BundleManifest };

export const marketplacePackageSchema = z.object({
  packageId: packageIdSchema,
  kind: marketplacePackageKindSchema,
  title: z.string().min(1),
  summary: z.string().default(""),
  publisher: marketplacePublisherSchema,
  currentVersionId: packageVersionIdSchema,
  visibility: marketplaceVisibilitySchema.default("private"),
  tags: z.array(z.string()).default([]),
}).strict().superRefine((pkg, ctx) => {
  if (!pkg.currentVersionId.startsWith(`${pkg.packageId}@`)) {
    ctx.addIssue({ code: "custom", path: ["currentVersionId"], message: "currentVersionId must point to this package id" });
  }
});
export type MarketplacePackage = z.infer<typeof marketplacePackageSchema>;

export const marketplaceInstalledConfigSchema = z.object({
  title: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  environment: z.enum(["development", "staging", "production"]).optional(),
  values: z.record(z.string(), z.unknown()).optional(),
  featureFlags: z.record(z.string(), z.boolean()).optional(),
  hostContextPolicy: z.object({
    required: z.array(z.string()).default([]),
    optional: z.array(z.string()).default([]),
  }).strict().optional(),
}).strict();
export type MarketplaceInstalledConfig = z.infer<typeof marketplaceInstalledConfigSchema>;

export const marketplaceInstalledStateSchema = z.object({
  status: z.enum(["draft", "installed", "disabled", "exported"]).optional(),
  manifest: z.record(z.string(), z.unknown()).optional(),
  draft: z.record(z.string(), z.unknown()).optional(),
  answers: z.record(z.string(), z.unknown()).optional(),
  review: z.record(z.string(), z.unknown()).optional(),
  receipts: z.array(z.object({
    receiptId: z.string().min(1),
    commandId: z.string().min(1).optional(),
    evidencePath: z.string().optional(),
    createdAt: z.string().datetime().optional(),
  }).strict()).optional(),
  updatedAt: z.string().datetime().optional(),
}).strict();
export type MarketplaceInstalledState = z.infer<typeof marketplaceInstalledStateSchema>;

export const marketplacePackageVersionSchema = z.object({
  packageVersionId: packageVersionIdSchema,
  packageId: packageIdSchema,
  packageSemver: semverLikeSchema,
  marketplaceSchemaVersion: marketplaceSchemaVersionSchema,
  manifestHash: sha256Schema,
  manifest: marketplaceManifestSchema,
  changelog: z.string().default(""),
  createdAt: z.string().datetime().optional(),
}).strict().superRefine((version, ctx) => {
  const semverFromVersion = semverFromPackageVersionId(version.packageVersionId);
  if (version.packageVersionId !== version.manifest.packageVersionId) {
    ctx.addIssue({ code: "custom", path: ["manifest", "packageVersionId"], message: "Version envelope and manifest packageVersionId must match" });
  }
  if (version.packageId !== version.manifest.packageId || !version.packageVersionId.startsWith(`${version.packageId}@`)) {
    ctx.addIssue({ code: "custom", path: ["packageId"], message: "Version package identity must match manifest" });
  }
  if (version.marketplaceSchemaVersion !== version.manifest.marketplaceSchemaVersion) {
    ctx.addIssue({ code: "custom", path: ["marketplaceSchemaVersion"], message: "Version schema version must match manifest schema version" });
  }
  if (version.packageSemver !== semverFromVersion || version.packageSemver !== version.manifest.packageSemver) {
    ctx.addIssue({ code: "custom", path: ["packageSemver"], message: "Version semver must match packageVersionId and manifest semver" });
  }
  if (version.manifest.manifestHash && version.manifestHash !== version.manifest.manifestHash) {
    ctx.addIssue({ code: "custom", path: ["manifestHash"], message: "Version manifestHash must match manifest manifestHash when present" });
  }
});
export type MarketplacePackageVersion = z.infer<typeof marketplacePackageVersionSchema>;

export const marketplaceInstallationSchema = z.object({
  installationId: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceId: z.string().optional(),
  packageId: packageIdSchema,
  installedVersionId: packageVersionIdSchema,
  installedSchemaVersion: marketplaceSchemaVersionSchema,
  installMode: packageInstallModeSchema,
  updatePolicy: packageUpdatePolicySchema.default("manual"),
  sourcePackageVersionId: packageVersionIdSchema.optional(),
  installedConfig: marketplaceInstalledConfigSchema.default({}),
  installedState: marketplaceInstalledStateSchema.default({}),
  permissions: z.array(marketplacePermissionGrantSchema).default([]),
  installedBy: z.string().min(1),
  installedAt: z.string().datetime(),
}).strict().superRefine((install, ctx) => {
  if (!install.installedVersionId.startsWith(`${install.packageId}@`)) {
    ctx.addIssue({ code: "custom", path: ["installedVersionId"], message: "Installations must target an immutable version for the package" });
  }
  if ((install.installMode === "copied" || install.installMode === "forked") && !install.sourcePackageVersionId) {
    ctx.addIssue({ code: "custom", path: ["sourcePackageVersionId"], message: "Copied/forked installs must preserve source provenance" });
  }
  if ((install.installMode === "copied" || install.installMode === "forked") && install.sourcePackageVersionId && !install.sourcePackageVersionId.startsWith(`${install.packageId}@`)) {
    ctx.addIssue({ code: "custom", path: ["sourcePackageVersionId"], message: "Copied/forked source provenance must point to the same package lineage" });
  }
  if ((install.installMode === "subscribed" || install.updatePolicy === "auto_patch") && !hasExplicitReadOnlyPermissions(install.permissions)) {
    ctx.addIssue({ code: "custom", path: ["permissions"], message: "Subscribed/auto-patch installations require explicit read-only permissions" });
  }
  const secretPath = findSecretLikePath({ installedConfig: install.installedConfig, installedState: install.installedState });
  if (secretPath) {
    ctx.addIssue({ code: "custom", path: secretPath, message: "Marketplace installations must not embed secrets or tokens" });
  }
  const executablePath = findExecutableCodePath({ installedConfig: install.installedConfig, installedState: install.installedState });
  if (executablePath) {
    ctx.addIssue({ code: "custom", path: executablePath, message: "Marketplace installations must not embed executable source code" });
  }
});
export type MarketplaceInstallation = z.infer<typeof marketplaceInstallationSchema>;

export const marketplaceEndpointReadinessSchema = z.enum(["planned", "fixture", "mounted", "blocked"]);
export const marketplaceEndpointDefinitionSchema = z.object({
  endpointId: z.string().min(1),
  purpose: z.string().min(1),
  requestSchemaRef: z.string().min(1),
  responseSchemaRef: z.string().min(1),
  readiness: marketplaceEndpointReadinessSchema,
  execution: z.enum(["read", "preview", "trusted_write", "none"]),
}).strict();
export type MarketplaceEndpointDefinition = z.infer<typeof marketplaceEndpointDefinitionSchema>;

export function normalizeMarketplacePackageKind(kind: MarketplacePackageKind | LegacyMarketplacePackageKind): MarketplacePackageKind {
  switch (kind) {
    case "agent_template": return "agent";
    case "app_template": return "app";
    case "workflow_template": return "workflow";
    case "skill_template": return "skill";
    case "tool_pack": return "command_tool_pack";
    default: return kind;
  }
}

export function parseMarketplaceManifest(value: unknown): MarketplaceManifest {
  const normalized = normalizeLegacyManifestInput(value);
  return marketplaceManifestSchema.parse(normalized);
}

export type MarketplaceUpgradeResult =
  | { ok: true; manifest: MarketplaceManifest; originalSchemaVersion: string; upgradedSchemaVersion: MarketplaceSchemaVersion; requiresReview: boolean; notes: string[] }
  | { ok: false; requiresReview: true; originalSchemaVersion: string | null; reason: string };

export function upgradeMarketplaceManifest(value: unknown): MarketplaceUpgradeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, requiresReview: true, originalSchemaVersion: null, reason: "manifest_not_object" };
  }
  const record = value as Record<string, unknown>;
  const originalSchemaVersion = typeof record.marketplaceSchemaVersion === "string" ? record.marketplaceSchemaVersion : null;
  if (originalSchemaVersion !== "1") {
    return { ok: false, requiresReview: true, originalSchemaVersion, reason: "unsupported_marketplace_schema_version" };
  }
  const manifest = parseMarketplaceManifest(record);
  return {
    ok: true,
    manifest,
    originalSchemaVersion: "1",
    upgradedSchemaVersion: "1",
    requiresReview: manifest.migration.requiresReviewOnUpgrade,
    notes: manifest.migration.migrationNotes ? [manifest.migration.migrationNotes] : [],
  };
}

export function isUpdateAvailable(input: { pkg: MarketplacePackage; installation: MarketplaceInstallation }): boolean {
  return input.pkg.packageId === input.installation.packageId && input.pkg.currentVersionId !== input.installation.installedVersionId;
}

export function createMarketplacePackageVersion(input: Omit<MarketplacePackageVersion, "manifestHash"> & { manifestHash?: string }): MarketplacePackageVersion {
  const manifestHash = input.manifestHash ?? input.manifest.manifestHash;
  if (!manifestHash) throw new Error("manifestHash_required");
  return marketplacePackageVersionSchema.parse({ ...input, manifestHash });
}

function payloadKeyForKind(kind: MarketplacePackageKind): keyof MarketplaceSubobjectPayload | null {
  switch (kind) {
    case "app": return "app";
    case "workflow": return "workflow";
    case "skill": return "skill";
    case "command_tool_pack": return "commandToolPack";
    case "agent": return "agent";
    case "artifact_template": return "artifactTemplate";
    case "mcp_addon": return "mcpAddon";
    case "provider_integration": return "providerIntegration";
    default: return null;
  }
}

const typedPayloadKeys = [
  "app",
  "workflow",
  "skill",
  "commandToolPack",
  "agent",
  "artifactTemplate",
  "mcpAddon",
  "providerIntegration",
] as const satisfies readonly (keyof MarketplaceSubobjectPayload)[];

function findUnexpectedTypedPayloadKey(kind: MarketplacePackageKind, payload: MarketplaceSubobjectPayload): keyof MarketplaceSubobjectPayload | null {
  const expectedPayloadKey = payloadKeyForKind(kind);
  for (const key of typedPayloadKeys) {
    if (key !== expectedPayloadKey && (payload as Record<string, unknown>)[key]) return key;
  }
  return null;
}

function hasExplicitReadOnlyPermissions(permissions: MarketplacePermissionGrant[]): boolean {
  return permissions.length > 0 && permissions.every((permission) => permission.effect === "read" || permission.effect === "none");
}

function embeddedDefinitionKindsById(payload: MarketplaceSubobjectPayload): Map<string, MarketplacePackageKind> {
  const kindsById = new Map<string, MarketplacePackageKind>();
  if (payload.app) kindsById.set(payload.app.appId, "app");
  if (payload.workflow) kindsById.set(payload.workflow.workflowId, "workflow");
  if (payload.skill) kindsById.set(payload.skill.skillId, "skill");
  if (payload.commandToolPack) kindsById.set(payload.commandToolPack.toolPackId, "command_tool_pack");
  if (payload.agent) kindsById.set(payload.agent.agentId, "agent");
  if (payload.artifactTemplate) kindsById.set(payload.artifactTemplate.artifactTemplateId, "artifact_template");
  if (payload.mcpAddon) kindsById.set(payload.mcpAddon.addonId, "mcp_addon");
  if (payload.providerIntegration) kindsById.set(payload.providerIntegration.providerIntegrationId, "provider_integration");
  return kindsById;
}

function semverFromPackageVersionId(packageVersionId: string): string {
  return packageVersionId.slice(packageVersionId.lastIndexOf("@") + 1);
}

function normalizeLegacyManifestInput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  if (typeof record.kind === "string") record.kind = normalizeMarketplacePackageKind(record.kind as MarketplacePackageKind | LegacyMarketplacePackageKind);
  const payload = record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
    ? { ...(record.payload as Record<string, unknown>) }
    : undefined;
  if (payload && payload.tool_pack && !payload.commandToolPack) {
    payload.commandToolPack = payload.tool_pack;
    delete payload.tool_pack;
  }
  if (payload) record.payload = payload;
  return record;
}

function findSecretLikePath(value: unknown, path: (string | number)[] = []): (string | number)[] | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const found = findSecretLikePath(child, [...path, index]);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (/^credentialRefKind$/i.test(key)) continue;
    if (/(secret|token|password|apiKey|api_key|privateKey|private_key|credential|credentials)/i.test(key)) return [...path, key];
    if (typeof child === "string" && looksLikeSecretValue(child)) return [...path, key];
    const found = findSecretLikePath(child, [...path, key]);
    if (found) return found;
  }
  return null;
}

function findExecutableCodePath(value: unknown, path: (string | number)[] = []): (string | number)[] | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const found = findExecutableCodePath(child, [...path, index]);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (/(executableCode|sourceCode|runtimeCode|inlineCode|evalSource)/i.test(key) || /^script$/i.test(key)) return [...path, key];
    if (typeof child === "string" && looksLikeExecutableCodeValue(child)) return [...path, key];
    const found = findExecutableCodePath(child, [...path, key]);
    if (found) return found;
  }
  return null;
}

function looksLikeSecretValue(value: string): boolean {
  return /^(?:sk|pk)[_-](?:live|test)[_-][A-Za-z0-9_-]{6,}$/.test(value)
    || /^Bearer\s+[A-Za-z0-9._-]{12,}$/i.test(value)
    || /^gh[pousr]_[A-Za-z0-9_]{20,}$/.test(value)
    || /^AKIA[A-Z0-9]{16}$/.test(value)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value);
}

function looksLikeExecutableCodeValue(value: string): boolean {
  return /\bfunction\s*[A-Za-z0-9_$]*\s*\(/.test(value)
    || /=>\s*[{(]/.test(value)
    || /\b(?:eval|Function|fetch|import)\s*\(/.test(value)
    || /\bconsole\.(?:log|error|warn|info)\s*\(/.test(value);
}
