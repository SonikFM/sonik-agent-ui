import { z } from "zod";

export const toolSourceSchema = z.enum(["orpc", "openapi", "mcp", "sandbox", "local-ui"]);
export const toolEffectSchema = z.enum(["read", "write", "destructive", "environment", "unknown"]);
export const toolApprovalSchema = z.enum(["none", "required", "denied"]);
export const toolUiTargetSchema = z.enum(["none", "chat", "inline-json", "artifact", "canvas", "document", "terminal"]);

export type ToolSource = z.infer<typeof toolSourceSchema>;
export type ToolEffect = z.infer<typeof toolEffectSchema>;
export type ToolApproval = z.infer<typeof toolApprovalSchema>;
export type ToolUiTarget = z.infer<typeof toolUiTargetSchema>;

export const toolSchemaRefSchema = z.object({
  kind: z.enum(["zod", "json-schema", "openapi", "unknown"]),
  ref: z.string().optional(),
  schema: z.unknown().optional(),
});

export const toolContractEntrySchema = z.object({
  id: z.string().min(1),
  source: toolSourceSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  effect: toolEffectSchema,
  approval: toolApprovalSchema.default("none"),
  uiTargets: z.array(toolUiTargetSchema).default(["chat"]),
  capabilities: z.array(z.string()).default([]),
  input: toolSchemaRefSchema.default({ kind: "unknown" }),
  output: toolSchemaRefSchema.default({ kind: "unknown" }),
  auth: z.object({
    required: z.boolean().default(false),
    scopes: z.array(z.string()).default([]),
    orgScoped: z.boolean().default(false),
  }).default({ required: false, scopes: [], orgScoped: false }),
  transport: z.object({
    procedure: z.string().optional(),
    method: z.string().optional(),
    path: z.string().optional(),
    runtimeStatus: z.enum(["mounted", "shadow", "unknown"]).default("unknown"),
  }).default({ runtimeStatus: "unknown" }),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const toolManifestSchema = z.object({
  version: z.literal("sonik-agent-ui.tool-manifest.v1"),
  generatedAt: z.string(),
  provider: z.string().min(1),
  tools: z.array(toolContractEntrySchema),
});

export type ToolSchemaRef = z.infer<typeof toolSchemaRefSchema>;
export type ToolContractEntry = z.infer<typeof toolContractEntrySchema>;
export type ToolManifest = z.infer<typeof toolManifestSchema>;

export type ToolAvailabilityContext = {
  authenticated?: boolean;
  organizationId?: string | null;
  scopes?: string[];
  allowMutations?: boolean;
  allowDestructive?: boolean;
  includeApprovalRequired?: boolean;
  sourceMode?: "all" | "orpc-app-state" | "mcp" | "sandbox" | "local-ui";
};

export type ToolPolicyDecision = {
  decision: "allow" | "approval_required" | "deny";
  reasons: string[];
};

const mutationVerbPattern = /(^|\.)(create|update|patch|delete|remove|cancel|confirm|assign|unassign|reserve|commit|send|upload|open|add|post)(\.|$)/i;
const destructiveVerbPattern = /(^|\.)(delete|remove|destroy|purge|void|revoke|unassign)(\.|$)/i;
const arbitraryEndpointPattern = /(^https?:\/\/)|[\s]|\//i;
const validProcedurePattern = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)+$/i;

export function createToolManifest(provider: string, tools: ToolContractEntry[], generatedAt = new Date().toISOString()): ToolManifest {
  return toolManifestSchema.parse({ version: "sonik-agent-ui.tool-manifest.v1", generatedAt, provider, tools });
}

export function inferEffectFromHttpMethod(method?: string): ToolEffect {
  const normalized = method?.toUpperCase();
  if (!normalized) return "unknown";
  if (["GET", "HEAD", "OPTIONS"].includes(normalized)) return "read";
  if (["POST", "PUT", "PATCH"].includes(normalized)) return "write";
  if (normalized === "DELETE") return "destructive";
  return "unknown";
}

export function inferEffectFromProcedureId(id: string, defaultEffect: ToolEffect = "unknown"): ToolEffect {
  if (destructiveVerbPattern.test(id)) return "destructive";
  if (mutationVerbPattern.test(id)) return "write";
  if (/(^|\.)(get|list|read|search|lookup|preview|learn|catalog|find)(\.|$)/i.test(id)) return "read";
  return defaultEffect;
}

export function isValidOrpcProcedureId(id: string): boolean {
  if (arbitraryEndpointPattern.test(id)) return false;
  return validProcedurePattern.test(id);
}

export function normalizeToolEntry(entry: ToolContractEntry): ToolContractEntry {
  const parsed = toolContractEntrySchema.parse(entry);
  const inferredEffect = parsed.effect === "unknown" ? inferEffectFromProcedureId(parsed.id, parsed.effect) : parsed.effect;
  return {
    ...parsed,
    effect: inferredEffect,
    approval: normalizeApproval(parsed.approval, inferredEffect),
  };
}

export function evaluateToolPolicy(tool: ToolContractEntry, context: ToolAvailabilityContext = {}): ToolPolicyDecision {
  const entry = normalizeToolEntry(tool);
  const reasons: string[] = [];

  if (context.sourceMode === "orpc-app-state" && entry.source !== "orpc" && entry.source !== "openapi") {
    return { decision: "deny", reasons: ["source_not_orpc_app_state"] };
  }
  if (context.sourceMode === "mcp" && entry.source !== "mcp") {
    return { decision: "deny", reasons: ["source_not_mcp"] };
  }
  if (context.sourceMode === "sandbox" && entry.source !== "sandbox") {
    return { decision: "deny", reasons: ["source_not_sandbox"] };
  }
  if (context.sourceMode === "local-ui" && entry.source !== "local-ui") {
    return { decision: "deny", reasons: ["source_not_local_ui"] };
  }

  if (entry.source === "orpc" && !isValidOrpcProcedureId(entry.transport.procedure ?? entry.id)) {
    reasons.push("invalid_orpc_procedure_id");
  }
  if (entry.source === "sandbox" && context.sourceMode === "orpc-app-state") {
    reasons.push("sandbox_not_app_state");
  }
  if (entry.auth.required && context.authenticated !== true) {
    reasons.push("auth_required");
  }
  if (entry.auth.orgScoped && !context.organizationId) {
    reasons.push("organization_required");
  }
  const contextScopes = new Set(context.scopes ?? []);
  const missingScopes = entry.auth.scopes.filter((scope) => !contextScopes.has(scope));
  if (missingScopes.length > 0) {
    reasons.push(`missing_scopes:${missingScopes.join(",")}`);
  }
  if (entry.approval === "denied") {
    reasons.push("tool_denied_by_manifest");
  }
  if (entry.effect === "unknown") {
    reasons.push("unknown_effect_denied");
  }
  if (entry.effect === "environment" && entry.source !== "sandbox") {
    reasons.push("environment_effect_requires_sandbox_source");
  }
  if (entry.effect === "write" && context.allowMutations !== true && entry.approval !== "required") {
    reasons.push("write_requires_approval_or_mutation_context");
  }
  if (entry.effect === "destructive" && context.allowDestructive !== true) {
    reasons.push("destructive_requires_explicit_approval");
  }

  if (reasons.length > 0) {
    const approvalGateOnly = reasons.every((reason) =>
      ["write_requires_approval_or_mutation_context", "destructive_requires_explicit_approval"].includes(reason)
    ) && entry.approval === "required";
    return approvalGateOnly ? { decision: "approval_required", reasons } : { decision: "deny", reasons };
  }

  if (entry.approval === "required") {
    return { decision: "approval_required", reasons: ["manifest_requires_approval"] };
  }

  return { decision: "allow", reasons: ["policy_allowed"] };
}

export function filterAvailableTools(manifest: ToolManifest, context: ToolAvailabilityContext = {}): ToolManifest {
  const tools = manifest.tools
    .map(normalizeToolEntry)
    .map((tool) => ({ tool, policy: evaluateToolPolicy(tool, context) }))
    .filter(({ policy }) => policy.decision === "allow" || (context.includeApprovalRequired === true && policy.decision === "approval_required"))
    .map(({ tool, policy }) => ({
      ...tool,
      approval: policy.decision === "approval_required" ? "required" : tool.approval,
      metadata: { ...tool.metadata, policyDecision: policy.decision, policyReasons: policy.reasons },
    }));

  return createToolManifest(manifest.provider, tools, manifest.generatedAt);
}

export function summarizeToolManifest(manifest: ToolManifest): string {
  const bySource = countBy(manifest.tools.map((tool) => tool.source));
  const byEffect = countBy(manifest.tools.map((tool) => tool.effect));
  const lines = [
    `Tool manifest ${manifest.provider}: ${manifest.tools.length} tools`,
    `sources=${formatCounts(bySource)}`,
    `effects=${formatCounts(byEffect)}`,
  ];
  for (const tool of manifest.tools.slice(0, 20)) {
    lines.push(`- ${tool.id} [${tool.source}/${tool.effect}/${tool.approval}] targets=${tool.uiTargets.join(",")}: ${tool.title}`);
  }
  if (manifest.tools.length > 20) lines.push(`- ...${manifest.tools.length - 20} more`);
  return lines.join("\n");
}

function normalizeApproval(approval: ToolApproval, effect: ToolEffect): ToolApproval {
  if (approval !== "none") return approval;
  if (effect === "write" || effect === "destructive" || effect === "environment") return "required";
  if (effect === "unknown") return "denied";
  return "none";
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts).map(([key, value]) => `${key}:${value}`).join(",") || "none";
}

export const commandShapeSchema = z.enum(["dispatch", "record", "catalog", "media", "local-ui", "composite"]);
export const commandExecutionSourceSchema = z.enum(["cli", "mcp", "agent-ui", "orpc", "sandbox", "surface", "test", "headless"]);
export const commandActionSchema = z.enum(["execute", "commit"]);
export const commandFamilySourceSchema = z.enum(["core", "host", "integration"]);
export const commandLoadModeSchema = z.enum(["eager-summary", "surface-eager", "lazy", "hidden"]);
export const commandPolicyDecisionSchema = z.object({
  decision: z.enum(["allow", "deny", "needs_approval", "approval_required"]),
  reasons: z.array(z.string()),
});

export const commandFamilyDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  parentId: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  source: commandFamilySourceSchema.default("core"),
});

export const commandFamilyRegistrySchema = z.object({
  version: z.literal("sonik-agent-ui.command-family-registry.v1"),
  generatedAt: z.string(),
  provider: z.string().min(1),
  families: z.array(commandFamilyDefinitionSchema),
});

export const commandLoadPolicySchema = z.object({
  mode: commandLoadModeSchema.default("lazy"),
  priority: z.number().default(0),
  profile: z.string().optional(),
});

export const commandContextHintsSchema = z.object({
  routes: z.array(z.string()).default([]),
  surfaces: z.array(z.string()).default([]),
  pageTypes: z.array(z.string()).default([]),
  artifactTypes: z.array(z.string()).default([]),
  skillFamilies: z.array(z.string()).default([]),
  commandFamilies: z.array(z.string()).default([]),
  requiredScopes: z.array(z.string()).default([]),
});

export const commandReceiptSchema = z.object({
  ok: z.boolean(),
  commandId: z.string().min(1),
  summary: z.unknown(),
  handle: z.string().optional(),
  resources: z.array(z.object({ uri: z.string(), title: z.string(), mimeType: z.string().optional() })).optional(),
  nextActions: z.array(z.string()).default([]),
  policy: commandPolicyDecisionSchema,
  trace: z.object({
    requestId: z.string().min(1),
    sessionId: z.string().nullable().optional(),
    durationMs: z.number().nonnegative(),
    provider: z.string().optional(),
    cache: z.enum(["hit", "miss"]).optional(),
    source: commandExecutionSourceSchema,
  }),
  errors: z.array(z.object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() })).optional(),
}).superRefine((receipt, ctx) => {
  if (receipt.resources && receipt.resources.length > 0 && !receipt.handle) {
    ctx.addIssue({ code: "custom", path: ["handle"], message: "Command receipts that return resources must include a stable handle." });
  }
});

export const commandDescriptorSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  familyId: z.string().min(1).default("integration"),
  source: toolSourceSchema,
  effect: toolEffectSchema,
  approval: toolApprovalSchema,
  shape: commandShapeSchema.default("composite"),
  loadPolicy: commandLoadPolicySchema.default({ mode: "lazy", priority: 0 }),
  contextHints: commandContextHintsSchema.default({ routes: [], surfaces: [], pageTypes: [], artifactTypes: [], skillFamilies: [], commandFamilies: [], requiredScopes: [] }),
  capabilities: z.array(z.string()).default([]),
  searchTerms: z.array(z.string()).default([]),
  examples: z.array(z.object({ title: z.string(), input: z.unknown() })).default([]),
  input: toolSchemaRefSchema.default({ kind: "unknown" }),
  inputSchemaJson: z.record(z.string(), z.unknown()).optional(),
  output: z.object({
    summary: z.string(),
    schema: toolSchemaRefSchema.optional(),
    handle: z.string().optional(),
    resources: z.array(z.string()).default([]),
  }),
  auth: z.object({
    required: z.boolean().default(false),
    scopes: z.array(z.string()).default([]),
    orgScoped: z.boolean().default(false),
  }).default({ required: false, scopes: [], orgScoped: false }),
  policy: z.object({
    tags: z.array(z.string()).default([]),
    hostProfiles: z.array(z.string()).default(["local"]),
    readOnly: z.boolean(),
    proofTier: z.string().optional(),
  }),
  transport: z.object({
    procedure: z.string().optional(),
    method: z.string().optional(),
    path: z.string().optional(),
    runtimeStatus: z.enum(["mounted", "shadow", "unknown"]).default("unknown"),
  }).default({ runtimeStatus: "unknown" }),
  surfaces: z.array(z.string()).default([]),
  uiTargets: z.array(toolUiTargetSchema).default(["chat"]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const commandCatalogSchema = z.object({
  version: z.literal("sonik-agent-ui.command-catalog.v1"),
  generatedAt: z.string(),
  provider: z.string().min(1),
  commands: z.array(commandDescriptorSchema),
});

export const commandIndexSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  familyId: z.string(),
  source: toolSourceSchema,
  effect: toolEffectSchema,
  approval: toolApprovalSchema,
  shape: commandShapeSchema,
  loadPolicy: commandLoadPolicySchema,
  capabilities: z.array(z.string()),
  surfaces: z.array(z.string()),
  uiTargets: z.array(toolUiTargetSchema),
});

export const commandIndexSchema = z.object({
  version: z.literal("sonik-agent-ui.command-index.v1"),
  provider: z.string(),
  generatedAt: z.string(),
  commands: z.array(commandIndexSummarySchema),
  totalMatches: z.number().int().nonnegative(),
  truncated: z.boolean(),
  limit: z.number().int().positive(),
  families: z.array(commandFamilyDefinitionSchema),
});

export type CommandShape = z.infer<typeof commandShapeSchema>;
export type CommandExecutionSource = z.infer<typeof commandExecutionSourceSchema>;
export type CommandAction = z.infer<typeof commandActionSchema>;
export type CommandFamilySource = z.infer<typeof commandFamilySourceSchema>;
export type CommandLoadMode = z.infer<typeof commandLoadModeSchema>;
export type CommandFamilyDefinition = z.infer<typeof commandFamilyDefinitionSchema>;
export type CommandFamilyRegistry = z.infer<typeof commandFamilyRegistrySchema>;
export type CommandLoadPolicy = z.infer<typeof commandLoadPolicySchema>;
export type CommandContextHints = z.infer<typeof commandContextHintsSchema>;
export type CommandPolicyDecision = z.infer<typeof commandPolicyDecisionSchema>;
export type CommandReceipt = z.infer<typeof commandReceiptSchema>;
export type CommandDescriptor = z.infer<typeof commandDescriptorSchema>;
export type CommandCatalog = z.infer<typeof commandCatalogSchema>;
export type CommandIndexSummary = z.infer<typeof commandIndexSummarySchema>;
export type CommandIndex = z.infer<typeof commandIndexSchema>;

export type CommandExecutionContext = {
  action?: CommandAction;
  source?: CommandExecutionSource;
  requestId?: string;
  sessionId?: string | null;
  principalId?: string | null;
  hostSessionSource?: string;
  hostSessionExpiresAt?: string | null;
  approved?: boolean;
  allowSandbox?: boolean;
  authenticated?: boolean;
  organizationId?: string | null;
  scopes?: string[];
};

export type CommandLearnAspect = "description" | "schema" | "examples" | "policy" | "output" | "surfaces" | "transport" | "auth";
export type CommandCatalogSearchResult = {
  commands: Array<Pick<CommandDescriptor, "id" | "title" | "description" | "familyId" | "capabilities" | "source" | "effect" | "approval" | "loadPolicy" | "surfaces" | "uiTargets">>;
  totalMatches: number;
  truncated: boolean;
  limit: number;
};
export type AgentPageContext = {
  route?: string;
  surface?: string;
  pageType?: string;
  title?: string;
  activeEntity?: { type: string; id: string; label?: string };
  activeArtifactId?: string;
  activeDocumentId?: string;
  artifactType?: string;
  visibleActions?: string[];
  skillFamilies?: string[];
  commandFamilies?: string[];
};

export type CommandIndexContext = AgentPageContext & {
  authenticated?: boolean;
  organizationId?: string | null;
  scopes?: string[];
};

const defaultCommandFamilies: CommandFamilyDefinition[] = [
  { id: "artifact", title: "Artifacts", description: "Generated UI artifacts and canvas state.", aliases: [], source: "core" },
  { id: "document", title: "Documents", description: "Documents, editors, imports, exports, and analysis.", aliases: [], source: "core" },
  { id: "ui", title: "UI Commands", description: "Local workspace, shell, layout, and application UI commands.", aliases: [], source: "core" },
  { id: "integration", title: "Integrations", description: "Host, ORPC, OpenAPI, MCP, or client integration commands.", aliases: [], source: "core" },
  { id: "data", title: "Data", description: "Data lookup, retrieval, and analysis commands.", aliases: [], source: "core" },
  { id: "sandbox", title: "Sandbox", description: "Environment and code execution commands.", aliases: [], source: "core" },
];

export function createCommandCatalog(provider: string, commands: CommandDescriptor[], generatedAt = new Date().toISOString()): CommandCatalog {
  return commandCatalogSchema.parse({ version: "sonik-agent-ui.command-catalog.v1", generatedAt, provider, commands });
}

export function createCommandFamilyRegistry(provider: string, families: CommandFamilyDefinition[] = defaultCommandFamilies, generatedAt = new Date().toISOString()): CommandFamilyRegistry {
  return commandFamilyRegistrySchema.parse({ version: "sonik-agent-ui.command-family-registry.v1", generatedAt, provider, families });
}

export function createDefaultCommandFamilyRegistry(generatedAt = new Date().toISOString()): CommandFamilyRegistry {
  return createCommandFamilyRegistry("sonik-agent-ui-core", defaultCommandFamilies, generatedAt);
}

export function validateCommandCatalogFamilies(catalog: CommandCatalog, registry = createDefaultCommandFamilyRegistry(catalog.generatedAt)): { ok: true; unknownFamilyIds: [] } | { ok: false; unknownFamilyIds: string[] } {
  const familyIds = new Set(registry.families.map((family) => family.id));
  const unknownFamilyIds = [...new Set(catalog.commands.map((command) => command.familyId).filter((familyId) => !familyIds.has(familyId)))].sort();
  return unknownFamilyIds.length === 0 ? { ok: true, unknownFamilyIds: [] } : { ok: false, unknownFamilyIds };
}

export function createCommandCatalogFromToolManifest(manifest: ToolManifest): CommandCatalog {
  return createCommandCatalog(manifest.provider, manifest.tools.map(commandDescriptorFromToolEntry), manifest.generatedAt);
}

export function createCommandIndexContextFromPageContext(pageContext: AgentPageContext = {}, trustedContext: Pick<CommandIndexContext, "authenticated" | "organizationId" | "scopes"> = {}): CommandIndexContext {
  return {
    ...pageContext,
    authenticated: trustedContext.authenticated,
    organizationId: trustedContext.organizationId,
    scopes: trustedContext.scopes,
  };
}

export function commandDescriptorFromToolEntry(entry: ToolContractEntry): CommandDescriptor {
  const tool = normalizeToolEntry(entry);
  const examples = Array.isArray(tool.metadata.examples) ? tool.metadata.examples : [];
  const outputResources = Array.isArray(tool.metadata.resources) ? tool.metadata.resources.filter((value): value is string => typeof value === "string") : [];
  return commandDescriptorSchema.parse({
    id: tool.id,
    title: tool.title,
    description: tool.description,
    familyId: inferCommandFamilyId(tool),
    source: tool.source,
    effect: tool.effect,
    approval: tool.approval,
    shape: inferCommandShape(tool),
    loadPolicy: inferCommandLoadPolicy(tool),
    contextHints: inferCommandContextHints(tool),
    capabilities: tool.capabilities,
    searchTerms: [...new Set([tool.id, tool.title, tool.description, ...tool.capabilities].flatMap(tokenizeCommandText))],
    examples,
    input: tool.input,
    inputSchemaJson: schemaJsonFromRef(tool.input),
    output: {
      summary: tool.description || tool.title,
      schema: tool.output,
      resources: outputResources,
    },
    auth: tool.auth,
    policy: {
      tags: [tool.source, tool.effect, tool.approval, tool.transport.runtimeStatus, ...tool.capabilities].filter(Boolean),
      hostProfiles: ["local", "agent-ui"],
      readOnly: tool.effect === "read",
      proofTier: typeof tool.metadata.proofTier === "string" ? tool.metadata.proofTier : undefined,
    },
    transport: tool.transport,
    surfaces: tool.uiTargets.filter((target) => target !== "none"),
    uiTargets: tool.uiTargets,
    metadata: tool.metadata,
  });
}

export function projectCommandToToolEntry(command: CommandDescriptor): ToolContractEntry {
  return normalizeToolEntry({
    id: command.id,
    source: command.source,
    title: command.title,
    description: command.description,
    effect: command.effect,
    approval: command.approval,
    uiTargets: command.uiTargets,
    capabilities: command.capabilities,
    input: command.input,
    output: command.output.schema ?? { kind: "unknown" },
    auth: command.auth,
    transport: command.transport,
    metadata: {
      ...command.metadata,
      familyId: command.familyId,
      loadPolicy: command.loadPolicy,
      contextHints: command.contextHints,
      commandShape: command.shape,
      commandSurfaces: command.surfaces,
      commandPolicy: command.policy,
    },
  });
}

export function searchCommandCatalog(catalog: CommandCatalog, query = "", limit = 20): CommandCatalogSearchResult["commands"] {
  return searchCommandCatalogWithMetadata(catalog, query, limit).commands;
}

export function searchCommandCatalogWithMetadata(catalog: CommandCatalog, query = "", limit = 20): CommandCatalogSearchResult {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 50));
  const normalized = query.trim().toLowerCase();
  const tokens = tokenizeCommandText(normalized);
  const matches = catalog.commands
    .filter((command) => command.loadPolicy.mode !== "hidden")
    .filter((command) => {
      if (tokens.length === 0) return true;
      const haystack = [command.id, command.title, command.description, command.familyId, ...command.capabilities, ...command.searchTerms, ...command.surfaces].join(" ").toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    commands: matches
      .slice(0, boundedLimit)
      .map(({ id, title, description, familyId, capabilities, source, effect, approval, surfaces, uiTargets, loadPolicy }) => ({
        id,
        title,
        description,
        familyId,
        capabilities,
        source,
        effect,
        approval,
        surfaces,
        uiTargets,
        loadPolicy,
      })),
    totalMatches: matches.length,
    truncated: matches.length > boundedLimit,
    limit: boundedLimit,
  };
}

export function createStartupCommandIndex(catalog: CommandCatalog, input: { registry?: CommandFamilyRegistry; limit?: number; context?: CommandIndexContext } = {}): CommandIndex {
  const registry = input.registry ?? createDefaultCommandFamilyRegistry(catalog.generatedAt);
  assertCommandFamiliesKnown(catalog, registry);
  assertExplicitVisibilityMetadata(catalog);
  return createCommandIndex(catalog, registry, catalog.commands.filter((command) => command.loadPolicy.mode === "eager-summary" && commandVisibleInIndexContext(command, input.context ?? {})), input.limit ?? 12);
}

export function createSurfaceCommandIndex(catalog: CommandCatalog, context: CommandIndexContext = {}, input: { registry?: CommandFamilyRegistry; limit?: number } = {}): CommandIndex {
  const registry = input.registry ?? createDefaultCommandFamilyRegistry(catalog.generatedAt);
  assertCommandFamiliesKnown(catalog, registry);
  assertExplicitVisibilityMetadata(catalog);
  const commands = catalog.commands.filter((command) => {
    if (command.loadPolicy.mode === "hidden") return false;
    if (!commandVisibleInIndexContext(command, context)) return false;
    if (command.loadPolicy.mode === "eager-summary") return true;
    if (command.loadPolicy.mode !== "surface-eager") return false;
    return commandMatchesIndexContext(command, context);
  });
  return createCommandIndex(catalog, registry, commands, input.limit ?? 20);
}

export function learnCommandDescriptor(catalog: CommandCatalog, commandId: string, aspects: CommandLearnAspect[] = ["description", "schema", "examples", "policy", "output", "surfaces", "transport", "auth"]): Record<string, unknown> {
  const command = catalog.commands.find((entry) => entry.id === commandId);
  if (!command) return { ok: false, error: "UNKNOWN_COMMAND", commandId };
  const learned: Record<string, unknown> = { ok: true, commandId: command.id, title: command.title, source: command.source, effect: command.effect, approval: command.approval };
  if (aspects.includes("description")) learned.description = command.description;
  if (aspects.includes("schema")) learned.inputSchema = command.inputSchemaJson ?? command.input;
  if (aspects.includes("examples")) learned.examples = command.examples;
  if (aspects.includes("policy")) learned.policy = command.policy;
  if (aspects.includes("output")) learned.output = command.output;
  if (aspects.includes("surfaces")) learned.surfaces = command.surfaces;
  if (aspects.includes("transport")) learned.transport = command.transport;
  if (aspects.includes("auth")) learned.auth = command.auth;
  return learned;
}

export function evaluateCommandPolicy(command: CommandDescriptor, context: CommandExecutionContext = {}): CommandPolicyDecision {
  const action = context.action ?? "execute";
  const reasons: string[] = [];
  if (command.transport.runtimeStatus !== "mounted") reasons.push(`runtime_not_mounted:${command.transport.runtimeStatus}`);
  if ((command.source === "orpc" || command.source === "openapi") && command.metadata.liveExecution !== true) reasons.push("orpc_execution_adapter_not_mounted");
  if (command.source === "mcp") reasons.push("mcp_projection_not_native_execution");
  if (command.source === "sandbox" && context.allowSandbox !== true) reasons.push("sandbox_execution_not_enabled");
  if (command.auth.required && context.authenticated !== true) reasons.push("auth_required");
  if (command.auth.orgScoped && !context.organizationId) reasons.push("organization_required");
  const contextScopes = new Set(context.scopes ?? []);
  const missingScopes = command.auth.scopes.filter((scope) => !contextScopes.has(scope));
  if (missingScopes.length > 0) reasons.push(`missing_scopes:${missingScopes.join(",")}`);
  if (action === "execute" && !command.policy.readOnly) reasons.push("use_commit_for_mutation_command");
  if (action === "commit" && command.policy.readOnly) reasons.push("read_only_command_uses_execute");
  if (action === "commit" && command.approval === "required" && context.approved !== true) reasons.push("approval_required");
  if (command.approval === "denied") reasons.push("command_denied_by_manifest");
  if (command.effect === "destructive" && context.approved !== true) reasons.push("destructive_requires_explicit_approval");
  if (reasons.length === 0) return { decision: "allow", reasons: ["policy_allowed"] };
  if (reasons.every((reason) => reason === "approval_required" || reason === "use_commit_for_mutation_command")) return { decision: "needs_approval", reasons };
  if (reasons.length === 1 && reasons[0] === "approval_required") return { decision: "needs_approval", reasons };
  return { decision: "deny", reasons };
}

export function executeCatalogCommand(catalog: CommandCatalog, commandId: string, input: unknown = {}, context: CommandExecutionContext = {}): CommandReceipt {
  const startedAt = Date.now();
  const source = context.source ?? "agent-ui";
  const requestId = context.requestId ?? commandReceiptRequestId(commandId, startedAt);
  const command = catalog.commands.find((entry) => entry.id === commandId);
  if (!command) {
    return commandReceiptSchema.parse({
      ok: false,
      commandId,
      summary: { message: "Unknown command" },
      nextActions: ["searchCommandCatalog"],
      policy: { decision: "deny", reasons: ["unknown_command"] },
      trace: { requestId, sessionId: context.sessionId, durationMs: Date.now() - startedAt, source },
      errors: [{ code: "UNKNOWN_COMMAND", message: `No command registered for ${commandId}`, retryable: true }],
    });
  }
  const action = context.action ?? "execute";
  const policy = evaluateCommandPolicy(command, { ...context, action });
  const ok = policy.decision === "allow";
  return commandReceiptSchema.parse({
    ok,
    commandId,
    summary: ok
      ? {
          message: `${action === "commit" ? "Committed" : "Executed"} ${command.title}`,
          command: { id: command.id, source: command.source, effect: command.effect, shape: command.shape },
          input,
          dryRun: command.metadata.liveExecution !== true,
        }
      : { message: `Command ${command.id} was not executed`, reasons: policy.reasons },
    nextActions: ok ? command.output.resources : policy.decision === "needs_approval" ? ["commitCommand"] : ["learnCommand"],
    policy,
    trace: { requestId, sessionId: context.sessionId, durationMs: Date.now() - startedAt, provider: catalog.provider, cache: "miss", source },
    errors: ok ? undefined : policy.reasons.map((reason) => ({ code: reason.toUpperCase().replace(/[^A-Z0-9]+/g, "_"), message: reason, retryable: policy.decision === "needs_approval" })),
  });
}

function createCommandIndex(catalog: CommandCatalog, registry: CommandFamilyRegistry, commands: CommandDescriptor[], limit: number): CommandIndex {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 50));
  const sorted = [...commands].sort((a, b) => (b.loadPolicy.priority - a.loadPolicy.priority) || a.id.localeCompare(b.id));
  const commandFamilyIds = new Set(sorted.slice(0, boundedLimit).map((command) => command.familyId));
  return commandIndexSchema.parse({
    version: "sonik-agent-ui.command-index.v1",
    provider: catalog.provider,
    generatedAt: catalog.generatedAt,
    commands: sorted.slice(0, boundedLimit).map(commandIndexSummary),
    totalMatches: sorted.length,
    truncated: sorted.length > boundedLimit,
    limit: boundedLimit,
    families: registry.families.filter((family) => commandFamilyIds.has(family.id)),
  });
}

function commandIndexSummary(command: CommandDescriptor): CommandIndexSummary {
  return commandIndexSummarySchema.parse({
    id: command.id,
    title: command.title,
    description: command.description,
    familyId: command.familyId,
    source: command.source,
    effect: command.effect,
    approval: command.approval,
    shape: command.shape,
    loadPolicy: command.loadPolicy,
    capabilities: command.capabilities,
    surfaces: command.surfaces,
    uiTargets: command.uiTargets,
  });
}

function assertCommandFamiliesKnown(catalog: CommandCatalog, registry: CommandFamilyRegistry): void {
  const validation = validateCommandCatalogFamilies(catalog, registry);
  if (!validation.ok) {
    throw new Error(`Unknown command family ids: ${validation.unknownFamilyIds.join(", ")}`);
  }
}

function assertExplicitVisibilityMetadata(catalog: CommandCatalog): void {
  const implicitVisibleCommands = catalog.commands
    .filter((command) => command.source !== "local-ui")
    .filter((command) => command.loadPolicy.mode === "eager-summary" || command.loadPolicy.mode === "surface-eager")
    .filter((command) => !hasExplicitVisibilityMetadata(command))
    .map((command) => command.id)
    .sort();
  if (implicitVisibleCommands.length > 0) {
    throw new Error(`Visible non-local commands require explicit family/load/context metadata: ${implicitVisibleCommands.join(", ")}`);
  }
}

function hasExplicitVisibilityMetadata(command: CommandDescriptor): boolean {
  return typeof command.metadata.familyId === "string"
    && command.metadata.loadPolicy !== undefined
    && command.metadata.contextHints !== undefined;
}

function commandVisibleInIndexContext(command: CommandDescriptor, context: CommandIndexContext): boolean {
  if (command.auth.required && context.authenticated !== true) return false;
  if (command.auth.orgScoped && !context.organizationId) return false;
  const scopes = new Set(context.scopes ?? []);
  const requiredScopes = [...new Set([...command.contextHints.requiredScopes, ...command.auth.scopes])];
  return requiredScopes.length === 0 || requiredScopes.every((scope) => scopes.has(scope));
}

function commandMatchesIndexContext(command: CommandDescriptor, context: CommandIndexContext): boolean {
  const hints = command.contextHints;
  return Boolean(
    (context.surface && hints.surfaces.includes(context.surface)) ||
    (context.route && hints.routes.includes(context.route)) ||
    (context.pageType && hints.pageTypes.includes(context.pageType)) ||
    (context.artifactType && hints.artifactTypes.includes(context.artifactType)) ||
    context.commandFamilies?.includes(command.familyId) ||
    context.skillFamilies?.some((family) => hints.skillFamilies.includes(family))
  );
}

function inferCommandShape(tool: ToolContractEntry): CommandShape {
  if (tool.source === "local-ui") return "local-ui";
  const text = `${tool.id} ${tool.title} ${tool.capabilities.join(" ")}`.toLowerCase();
  if (/\b(send|receive|dispatch|inbound|outbound|webhook)\b/.test(text)) return "dispatch";
  if (/\b(list|get|read|search|sync|analytics|insight|availability|preview|learn|catalog)\b/.test(text)) return "record";
  if (/\b(create|update|patch|delete|manage|assign|reserve|commit|confirm)\b/.test(text)) return "catalog";
  if (/\b(media|image|video|audio|file|document)\b/.test(text)) return "media";
  return "composite";
}

function inferCommandFamilyId(tool: ToolContractEntry): string {
  if (typeof tool.metadata.familyId === "string") return tool.metadata.familyId;
  if (tool.source === "sandbox") return "sandbox";
  if (tool.source === "mcp" || tool.source === "orpc" || tool.source === "openapi") return "integration";
  const text = `${tool.id} ${tool.title} ${tool.uiTargets.join(" ")} ${tool.capabilities.join(" ")}`.toLowerCase();
  if (/\b(document|markdown|editor|workspace)\b/.test(text)) return "document";
  if (/\b(artifact|canvas|json-render)\b/.test(text)) return "artifact";
  if (/\b(data|weather|crypto|github|hacker|search)\b/.test(text)) return "data";
  return "ui";
}

function inferCommandLoadPolicy(tool: ToolContractEntry): CommandLoadPolicy {
  const metadataPolicy = tool.metadata.loadPolicy;
  if (metadataPolicy && typeof metadataPolicy === "object" && !Array.isArray(metadataPolicy)) {
    return commandLoadPolicySchema.parse(metadataPolicy);
  }
  const familyId = inferCommandFamilyId(tool);
  if (familyId === "artifact" || familyId === "document" || familyId === "ui") {
    return { mode: "eager-summary", priority: tool.effect === "read" ? 20 : 10, profile: "core-ui" };
  }
  return { mode: "lazy", priority: 0, profile: tool.source === "local-ui" ? "standalone" : tool.source };
}

function inferCommandContextHints(tool: ToolContractEntry): CommandContextHints {
  const metadataHints = tool.metadata.contextHints;
  if (metadataHints && typeof metadataHints === "object" && !Array.isArray(metadataHints)) {
    return commandContextHintsSchema.parse(metadataHints);
  }
  const surfaces = tool.uiTargets.filter((target) => !["none", "chat", "inline-json"].includes(target));
  const familyId = inferCommandFamilyId(tool);
  return commandContextHintsSchema.parse({
    surfaces,
    commandFamilies: [familyId],
    requiredScopes: tool.auth.scopes,
  });
}

function schemaJsonFromRef(ref: ToolSchemaRef): Record<string, unknown> | undefined {
  return ref.kind === "json-schema" && ref.schema && typeof ref.schema === "object" && !Array.isArray(ref.schema)
    ? ref.schema as Record<string, unknown>
    : undefined;
}

function tokenizeCommandText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9:+_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !["and", "the", "for", "with", "from", "into"].includes(token));
}

function commandReceiptRequestId(commandId: string, startedAt: number): string {
  return `cmd_${commandId.replace(/[^a-z0-9]+/gi, "_")}_${startedAt}`;
}
