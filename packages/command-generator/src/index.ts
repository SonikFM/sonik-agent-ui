import {
  commandCatalogSchema,
  commandFamilyRegistrySchema,
  commandDescriptorSchema,
  createCommandCatalogFromToolManifest,
  createCommandFamilyRegistry,
  createToolManifest,
  inferEffectFromHttpMethod,
  inferEffectFromProcedureId,
  type CommandCatalog,
  type CommandDescriptor,
  type CommandFamilyDefinition,
  type CommandFamilyRegistry,
  type CommandLoadMode,
  type CommandShape,
  type ToolContractEntry,
  type ToolEffect,
  type ToolManifest,
  type ToolSource,
  type ToolUiTarget,
} from "@sonik-agent-ui/tool-contracts";

export type CommandGeneratorSourceAdapterKind = "openapi" | "orpc" | "cli-descriptor" | "mcp-descriptor";
export type CommandProjectionTarget = "cli" | "mcp";
export type GeneratedRuntimeStatus = "mounted" | "shadow" | "unknown";

export type OpenApiOperationLike = {
  operationId?: string;
  summary?: string;
  description?: string;
  security?: unknown[];
  tags?: string[];
  requestBody?: unknown;
  responses?: unknown;
  parameters?: unknown;
  [key: string]: unknown;
};

export type OpenApiDocumentLike = {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  security?: unknown[];
  paths?: Record<string, Record<string, OpenApiOperationLike>>;
  components?: Record<string, unknown>;
};

export type CommandAccessibilityConfig = {
  label?: string;
  description?: string;
  actionLabel?: string;
};

export type CommandGeneratorOperationOverride = {
  id?: string;
  title?: string;
  description?: string;
  familyId?: string;
  capabilities?: string[];
  searchTerms?: string[];
  examples?: Array<{ title: string; input: unknown }>;
  loadPolicy?: { mode: CommandLoadMode; priority?: number; profile?: string };
  contextHints?: {
    routes?: string[];
    surfaces?: string[];
    pageTypes?: string[];
    artifactTypes?: string[];
    skillFamilies?: string[];
    commandFamilies?: string[];
    requiredScopes?: string[];
  };
  uiTargets?: ToolUiTarget[];
  runtimeStatus?: Exclude<GeneratedRuntimeStatus, "mounted">;
  accessibility?: CommandAccessibilityConfig;
  shape?: CommandShape;
  projection?: {
    cli?: { command?: string; args?: string[] };
    mcp?: { toolName?: string };
  };
};

export type CommandGeneratorConfig = {
  provider: string;
  sourceAdapter: CommandGeneratorSourceAdapterKind;
  toolSource?: "openapi" | "orpc";
  generatedAt?: string;
  families: CommandFamilyDefinition[];
  defaultFamilyId?: string;
  defaultRuntimeStatus?: Exclude<GeneratedRuntimeStatus, "mounted">;
  defaultLoadPolicy?: { mode: CommandLoadMode; priority?: number; profile?: string };
  defaultContextHints?: {
    routes?: string[];
    surfaces?: string[];
    pageTypes?: string[];
    artifactTypes?: string[];
    skillFamilies?: string[];
    commandFamilies?: string[];
    requiredScopes?: string[];
  };
  defaultUiTargets?: ToolUiTarget[];
  tagFamilyMap?: Record<string, string>;
  tagCapabilityMap?: Record<string, string[]>;
  operationOverrides?: Record<string, CommandGeneratorOperationOverride>;
  projectionTargets?: CommandProjectionTarget[];
  projectionDefaults?: {
    cli?: { command?: string; args?: string[] };
    mcp?: { toolName?: string };
  };
};

export type CommandProjectionManifest = {
  version: "sonik-agent-ui.command-projection.v1";
  provider: string;
  target: CommandProjectionTarget;
  generatedAt: string;
  commands: CommandProjectionEntry[];
};

export type CommandProjectionEntry = {
  commandId: string;
  title: string;
  description: string;
  familyId: string;
  source: ToolSource;
  effect: ToolEffect;
  approval: string;
  readOnly: boolean;
  schemaRef?: string;
  outputResources: string[];
  accessible: Required<CommandAccessibilityConfig>;
  invocation: {
    kind: "catalog-command";
    commandId: string;
    executeTool: "executeCommand";
    commitTool: "commitCommand";
    learnTool: "learnCommand";
    cli?: { command: string; args: string[] };
    mcp?: { toolName: string };
  };
  provenance: {
    generated: true;
    sourceAdapter: CommandGeneratorSourceAdapterKind;
    transportProcedure?: string;
    method?: string;
    path?: string;
    sourceRuntimeStatus?: "mounted" | "shadow" | "unknown";
    sourceRuntimeAdapter?: string;
  };
};

export type CommandGeneratorOutput = {
  manifest: ToolManifest;
  catalog: CommandCatalog;
  registry: CommandFamilyRegistry;
  projections: Partial<Record<CommandProjectionTarget, CommandProjectionManifest>>;
};

export type CommandProviderArtifacts = CommandGeneratorOutput & {
  provider: string;
  generatedAt?: string;
  source?: unknown;
  summary?: Record<string, unknown>;
};

export type GlobalCommandRegistryArtifact = {
  version: "sonik-agent-ui.global-command-registry.v1";
  provider: string;
  generatedAt: string;
  summary: {
    providerCount: number;
    commandCount: number;
    familyCount: number;
    toolCount: number;
    cliProjectionCount: number;
    mcpProjectionCount: number;
  };
  providers: Array<{
    provider: string;
    commandCount: number;
    familyCount: number;
    toolCount: number;
    source?: unknown;
    summary?: Record<string, unknown>;
  }>;
  manifest: ToolManifest;
  registry: CommandFamilyRegistry;
  catalog: CommandCatalog;
  projections: Partial<Record<CommandProjectionTarget, CommandProjectionManifest>>;
};

const httpMethods = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const validProcedurePattern = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)+$/i;

export function generateCommandArtifactsFromOpenApi(input: {
  document: OpenApiDocumentLike;
  config: CommandGeneratorConfig;
}): CommandGeneratorOutput {
  assertSupportedSourceAdapter(input.config.sourceAdapter, "openapi");
  const generatedAt = input.config.generatedAt ?? new Date().toISOString();
  const registry = createGeneratorFamilyRegistry(input.config, generatedAt);
  const manifest = createGeneratorToolManifestFromOpenApi(input.document, input.config, generatedAt, registry);
  const catalog = createCommandCatalogFromToolManifest(manifest);
  const explicitCatalog = commandCatalogSchema.parse({
    ...catalog,
    commands: catalog.commands.map((command) => explicitCommandFromGeneratedTool(command, input.config)),
  });
  assertGeneratedCatalogFamilies(explicitCatalog, registry);
  const projections = createProjectionManifests(explicitCatalog, input.config, generatedAt);
  return { manifest, catalog: explicitCatalog, registry, projections };
}

export function createProjectionManifests(catalog: CommandCatalog, config: CommandGeneratorConfig, generatedAt = config.generatedAt ?? new Date().toISOString()): Partial<Record<CommandProjectionTarget, CommandProjectionManifest>> {
  const targets = config.projectionTargets ?? ["cli", "mcp"];
  const projections: Partial<Record<CommandProjectionTarget, CommandProjectionManifest>> = {};
  for (const target of targets) {
    projections[target] = {
      version: "sonik-agent-ui.command-projection.v1",
      provider: config.provider,
      target,
      generatedAt,
      commands: catalog.commands.map((command) => projectCommand(command, config, target)),
    };
  }
  return projections;
}

export function createCliDescriptorSourceManifest(input: {
  provider: string;
  commands: CommandDescriptor[];
  families: CommandFamilyDefinition[];
  generatedAt?: string;
}): { catalog: CommandCatalog; registry: CommandFamilyRegistry; projection: CommandProjectionManifest } {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const registry = createCommandFamilyRegistry(input.provider, input.families, generatedAt);
  const catalog = commandCatalogSchema.parse({ version: "sonik-agent-ui.command-catalog.v1", provider: input.provider, generatedAt, commands: input.commands });
  assertGeneratedCatalogFamilies(catalog, registry);
  const projection = createProjectionManifests(catalog, {
    provider: input.provider,
    sourceAdapter: "cli-descriptor",
    families: input.families,
    projectionTargets: ["cli"],
    generatedAt,
  }, generatedAt).cli!;
  return { catalog, registry, projection };
}

export function createGlobalCommandRegistryArtifact(input: {
  provider: string;
  generatedAt?: string;
  providers: CommandProviderArtifacts[];
}): GlobalCommandRegistryArtifact {
  const generatedAt = input.generatedAt ?? newestGeneratedAt(input.providers) ?? new Date().toISOString();
  if (input.providers.length === 0) throw new Error("Global command registry requires at least one provider artifact");

  const manifestTools: ToolContractEntry[] = [];
  const catalogCommands: CommandDescriptor[] = [];
  const familiesById = new Map<string, CommandFamilyDefinition>();
  const projections: Partial<Record<CommandProjectionTarget, CommandProjectionManifest>> = {};
  const providerSummaries: GlobalCommandRegistryArtifact["providers"] = [];

  for (const providerArtifact of input.providers) {
    const provider = providerArtifact.provider || providerArtifact.catalog.provider || providerArtifact.manifest.provider;
    const manifest = providerArtifact.manifest;
    const catalog = providerArtifact.catalog;
    const registry = providerArtifact.registry;
    assertGeneratedCatalogFamilies(catalog, registry);

    providerSummaries.push({
      provider,
      commandCount: catalog.commands.length,
      familyCount: registry.families.length,
      toolCount: manifest.tools.length,
      source: providerArtifact.source,
      summary: providerArtifact.summary,
    });

    manifestTools.push(...manifest.tools);
    catalogCommands.push(...catalog.commands);
    for (const family of registry.families) mergeFamilyDefinition(familiesById, family, provider);
    for (const target of ["cli", "mcp"] as const) {
      const projection = providerArtifact.projections[target];
      if (!projection) continue;
      const existing = projections[target];
      projections[target] = {
        version: "sonik-agent-ui.command-projection.v1",
        provider: input.provider,
        target,
        generatedAt,
        commands: [...(existing?.commands ?? []), ...projection.commands],
      };
    }
  }

  assertUniqueIds("global command ids", catalogCommands.map((command) => command.id));
  assertUniqueIds("global tool ids", manifestTools.map((tool) => tool.id));
  for (const target of ["cli", "mcp"] as const) {
    const projection = projections[target];
    if (!projection) continue;
    assertUniqueIds(`global ${target} projection command ids`, projection.commands.map((entry) => entry.commandId));
  }

  const registry = commandFamilyRegistrySchema.parse(createCommandFamilyRegistry(input.provider, [...familiesById.values()], generatedAt));
  const manifest = createToolManifest(input.provider, manifestTools, generatedAt);
  const catalog = commandCatalogSchema.parse({ version: "sonik-agent-ui.command-catalog.v1", provider: input.provider, generatedAt, commands: catalogCommands });
  assertGeneratedCatalogFamilies(catalog, registry);
  assertProjectionTargetsKnown(catalog, projections);

  return {
    version: "sonik-agent-ui.global-command-registry.v1",
    provider: input.provider,
    generatedAt,
    summary: {
      providerCount: input.providers.length,
      commandCount: catalog.commands.length,
      familyCount: registry.families.length,
      toolCount: manifest.tools.length,
      cliProjectionCount: projections.cli?.commands.length ?? 0,
      mcpProjectionCount: projections.mcp?.commands.length ?? 0,
    },
    providers: providerSummaries,
    manifest,
    registry,
    catalog,
    projections,
  };
}

function newestGeneratedAt(providers: CommandProviderArtifacts[]): string | undefined {
  const values = providers.map((provider) => provider.generatedAt ?? provider.catalog.generatedAt ?? provider.manifest.generatedAt).filter(Boolean) as string[];
  return values.sort().at(-1);
}

function mergeFamilyDefinition(target: Map<string, CommandFamilyDefinition>, family: CommandFamilyDefinition, provider: string): void {
  const existing = target.get(family.id);
  if (!existing) {
    target.set(family.id, family);
    return;
  }
  if (stableJson(existing) !== stableJson(family)) {
    throw new Error(`Conflicting command family definition for ${family.id} from provider ${provider}`);
  }
}

function assertUniqueIds(label: string, ids: string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size > 0) throw new Error(`Duplicate ${label}: ${[...duplicates].sort().join(", ")}`);
}

function assertProjectionTargetsKnown(catalog: CommandCatalog, projections: Partial<Record<CommandProjectionTarget, CommandProjectionManifest>>): void {
  const knownCommandIds = new Set(catalog.commands.map((command) => command.id));
  const unknown: string[] = [];
  for (const projection of Object.values(projections)) {
    for (const entry of projection?.commands ?? []) {
      if (!knownCommandIds.has(entry.commandId)) unknown.push(`${projection?.target}:${entry.commandId}`);
    }
  }
  if (unknown.length > 0) throw new Error(`Projection entries reference unknown command ids: ${unknown.sort().join(", ")}`);
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalizeJson(child)]),
  );
}

function createGeneratorToolManifestFromOpenApi(document: OpenApiDocumentLike, config: CommandGeneratorConfig, generatedAt: string, registry: CommandFamilyRegistry): ToolManifest {
  const tools: ToolContractEntry[] = [];
  const documentSecurity = document.security;
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!httpMethods.has(method.toLowerCase())) continue;
      const operationId = operation.operationId ?? `${method.toLowerCase()} ${path}`;
      const operationKey = normalizeOperationId(operationId, method, path);
      const override = findOperationOverride(config, operationId, operationKey, method, path);
      const commandId = override.id ?? operationKey;
      const effect = inferSafeOpenApiEffect(commandId, method);
      const familyId = resolveFamilyId(operation, override, config);
      const effectiveSecurity = resolveEffectiveSecurity(operation, documentSecurity);
      const scopes = extractSecurityScopes(effectiveSecurity);
      const contextHints = mergeContextHints(config.defaultContextHints, override.contextHints, familyId, scopes);
      const loadPolicy = override.loadPolicy ?? config.defaultLoadPolicy ?? { mode: "lazy", priority: 0, profile: config.sourceAdapter };
      const accessibility = resolveAccessibility(operation, override, commandId);
      const capabilities = resolveCapabilities(operation, override, config, familyId);
      const runtimeStatus = normalizeGeneratedRuntimeStatus(override.runtimeStatus ?? operation["x-command-runtime-status"] ?? config.defaultRuntimeStatus ?? "shadow");
      const sourceRuntimeStatus = normalizeSourceRuntimeStatus(operation["x-sonik-status"]);
      const sourceRuntimeAdapter = stringValue(operation["x-sonik-adapter"]);
      const uiTargets = override.uiTargets ?? config.defaultUiTargets ?? defaultTargetsForEffect(effect);
      const title = override.title ?? operation.summary ?? humanizeCommandId(commandId);
      const description = override.description ?? operation.description ?? title;
      const inputSchema = createOpenApiCommandInputSchema(document, operation);
      const examples = override.examples ?? createOpenApiCommandExamples(commandId, title, inputSchema);
      const inputConvention = inputSchema ? "pass path/query/body fields directly as command input; do not wrap JSON bodies in body unless binary or explicitly required by the schema" : undefined;
      const hostDerivedFields = inferHostDerivedFields(inputSchema);
      assertKnownFamily(familyId, registry);
      tools.push({
        id: commandId,
        source: normalizeGeneratedOpenApiSource(config.toolSource),
        title,
        description,
        effect,
        approval: effect === "read" ? "none" : "required",
        uiTargets,
        capabilities,
        input: inputSchema
          ? { kind: "json-schema", ref: `${method.toUpperCase()} ${path} request`, schema: inputSchema }
          : { kind: operationHasInput(operation) ? "openapi" : "unknown", ref: `${method.toUpperCase()} ${path} request` },
        output: { kind: operation.responses ? "openapi" : "unknown", ref: `${method.toUpperCase()} ${path} responses` },
        auth: { required: hasSecurity(effectiveSecurity), scopes, orgScoped: hasSecurity(effectiveSecurity) },
        transport: { method: method.toUpperCase(), path, procedure: operationId, runtimeStatus },
        metadata: {
          generated: true,
          generatorProvider: config.provider,
          sourceAdapter: config.sourceAdapter,
          familyId,
          loadPolicy,
          contextHints,
          accessibility,
          searchTerms: [...new Set([...(override.searchTerms ?? []), ...capabilities, ...tokenizeText(title), ...tokenizeText(description)])],
          examples,
          inputConvention,
          hostDerivedFields,
          forbiddenFields: hostDerivedFields,
          commonErrors: [
            "Do not send organizationId/orgId/currentOrganizationId; the booking service derives organization scope from the trusted host session.",
            "Use executeCommand for read-only commands and commitCommand for write/destructive commands.",
            "For path parameters, pass the path parameter name directly in input.",
            "For JSON request bodies, pass body fields directly in input.",
          ],
          commandShape: override.shape,
          projection: override.projection,
          sourceOperationId: operationId,
          sourceRuntimeStatus,
          sourceRuntimeAdapter,
          sourceMounted: sourceRuntimeStatus === "mounted" && sourceRuntimeAdapter === "mounted",
        },
      });
    }
  }
  return createToolManifest(config.provider, tools, generatedAt);
}

function explicitCommandFromGeneratedTool(command: CommandDescriptor, config: CommandGeneratorConfig): CommandDescriptor {
  const metadata = command.metadata;
  const loadPolicy = command.loadPolicy;
  const contextHints = command.contextHints;
  const accessibility = accessibilityFromMetadata(command);
  return commandDescriptorSchema.parse({
    ...command,
    searchTerms: [...new Set([...command.searchTerms, ...metadataArray(metadata.searchTerms), ...tokenizeText(accessibility.label), ...tokenizeText(accessibility.actionLabel)])],
    output: {
      ...command.output,
      resources: command.output.resources,
    },
    metadata: {
      ...metadata,
      familyId: command.familyId,
      loadPolicy,
      contextHints,
      accessibility,
      sourceAdapter: config.sourceAdapter,
      generated: true,
    },
  });
}

function createGeneratorFamilyRegistry(config: CommandGeneratorConfig, generatedAt: string): CommandFamilyRegistry {
  const families = [...config.families];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const family of families) {
    if (seen.has(family.id)) duplicates.add(family.id);
    seen.add(family.id);
  }
  if (duplicates.size > 0) throw new Error(`Duplicate command family ids in generator config: ${[...duplicates].sort().join(", ")}`);
  return commandFamilyRegistrySchema.parse(createCommandFamilyRegistry(config.provider, families, generatedAt));
}

function assertGeneratedCatalogFamilies(catalog: CommandCatalog, registry: CommandFamilyRegistry): void {
  const familyIds = new Set(registry.families.map((family) => family.id));
  const unknown = [...new Set(catalog.commands.map((command) => command.familyId).filter((familyId) => !familyIds.has(familyId)))].sort();
  if (unknown.length > 0) throw new Error(`Unknown generated command family ids: ${unknown.join(", ")}`);
}

function assertSupportedSourceAdapter(actual: CommandGeneratorSourceAdapterKind, expected: CommandGeneratorSourceAdapterKind): void {
  if (actual !== expected) throw new Error(`Unsupported source adapter for this generator: expected ${expected}, received ${actual}`);
}

function assertKnownFamily(familyId: string, registry: CommandFamilyRegistry): void {
  if (!registry.families.some((family) => family.id === familyId)) throw new Error(`Unknown generated command family id: ${familyId}`);
}

function projectCommand(command: CommandDescriptor, config: CommandGeneratorConfig, target: CommandProjectionTarget): CommandProjectionEntry {
  const accessibility = accessibilityFromMetadata(command);
  const projection = command.metadata.projection && typeof command.metadata.projection === "object" && !Array.isArray(command.metadata.projection)
    ? command.metadata.projection as { cli?: { command?: string; args?: string[] }; mcp?: { toolName?: string } }
    : {};
  return {
    commandId: command.id,
    title: command.title,
    description: command.description,
    familyId: command.familyId,
    source: command.source,
    effect: command.effect,
    approval: command.approval,
    readOnly: command.policy.readOnly,
    schemaRef: command.input.ref,
    outputResources: command.output.resources,
    accessible: accessibility,
    invocation: {
      kind: "catalog-command",
      commandId: command.id,
      executeTool: "executeCommand",
      commitTool: "commitCommand",
      learnTool: "learnCommand",
      cli: target === "cli" ? {
        command: projection.cli?.command ?? config.projectionDefaults?.cli?.command ?? "agent-command execute",
        args: projection.cli?.args ?? interpolateProjectionArgs(config.projectionDefaults?.cli?.args ?? ["--command-id", "{commandId}"], command.id),
      } : undefined,
      mcp: target === "mcp" ? { toolName: projection.mcp?.toolName ?? config.projectionDefaults?.mcp?.toolName ?? "agent_command_execute" } : undefined,
    },
    provenance: {
      generated: true,
      sourceAdapter: config.sourceAdapter,
      transportProcedure: command.transport.procedure,
      method: command.transport.method,
      path: command.transport.path,
      sourceRuntimeStatus: sourceRuntimeStatusFromMetadata(command.metadata.sourceRuntimeStatus),
      sourceRuntimeAdapter: stringValue(command.metadata.sourceRuntimeAdapter),
    },
  };
}

function interpolateProjectionArgs(args: string[], commandId: string): string[] {
  return args.map((arg) => arg.replaceAll("{commandId}", commandId));
}

function resolveFamilyId(operation: OpenApiOperationLike, override: CommandGeneratorOperationOverride, config: CommandGeneratorConfig): string {
  if (override.familyId) return override.familyId;
  const explicit = stringValue(operation["x-command-family"]);
  if (explicit) return explicit;
  for (const tag of operation.tags ?? []) {
    const mapped = config.tagFamilyMap?.[tag];
    if (mapped) return mapped;
  }
  return config.defaultFamilyId ?? "integration";
}

function resolveCapabilities(operation: OpenApiOperationLike, override: CommandGeneratorOperationOverride, config: CommandGeneratorConfig, familyId: string): string[] {
  const capabilities = new Set<string>();
  for (const capability of override.capabilities ?? []) capabilities.add(capability);
  for (const tag of operation.tags ?? []) {
    const mapped = config.tagCapabilityMap?.[tag];
    if (mapped) mapped.forEach((capability) => capabilities.add(capability));
    else capabilities.add(tag);
  }
  capabilities.add(familyId);
  return [...capabilities].filter(Boolean).sort();
}

function resolveAccessibility(operation: OpenApiOperationLike, override: CommandGeneratorOperationOverride, commandId: string): Required<CommandAccessibilityConfig> {
  const title = override.title ?? operation.summary ?? humanizeCommandId(commandId);
  const description = override.description ?? operation.description ?? title;
  return {
    label: override.accessibility?.label ?? title,
    description: override.accessibility?.description ?? description,
    actionLabel: override.accessibility?.actionLabel ?? title,
  };
}

function accessibilityFromMetadata(command: CommandDescriptor): Required<CommandAccessibilityConfig> {
  const raw = command.metadata.accessibility && typeof command.metadata.accessibility === "object" && !Array.isArray(command.metadata.accessibility)
    ? command.metadata.accessibility as CommandAccessibilityConfig
    : {};
  return {
    label: raw.label || command.title,
    description: raw.description || command.description || command.title,
    actionLabel: raw.actionLabel || command.title,
  };
}

function mergeContextHints(base: CommandGeneratorConfig["defaultContextHints"], override: CommandGeneratorOperationOverride["contextHints"], familyId: string, scopes: string[]) {
  return {
    routes: [...new Set([...(base?.routes ?? []), ...(override?.routes ?? [])])],
    surfaces: [...new Set([...(base?.surfaces ?? []), ...(override?.surfaces ?? [])])],
    pageTypes: [...new Set([...(base?.pageTypes ?? []), ...(override?.pageTypes ?? [])])],
    artifactTypes: [...new Set([...(base?.artifactTypes ?? []), ...(override?.artifactTypes ?? [])])],
    skillFamilies: [...new Set([...(base?.skillFamilies ?? []), ...(override?.skillFamilies ?? [])])],
    commandFamilies: [...new Set([...(base?.commandFamilies ?? []), ...(override?.commandFamilies ?? []), familyId])],
    requiredScopes: [...new Set([...(base?.requiredScopes ?? []), ...(override?.requiredScopes ?? []), ...scopes])],
  };
}

function findOperationOverride(config: CommandGeneratorConfig, operationId: string, operationKey: string, method: string, path: string): CommandGeneratorOperationOverride {
  return config.operationOverrides?.[operationId]
    ?? config.operationOverrides?.[operationKey]
    ?? config.operationOverrides?.[`${method.toUpperCase()} ${path}`]
    ?? {};
}

function resolveEffectiveSecurity(operation: OpenApiOperationLike, documentSecurity: unknown[] | undefined): unknown[] | undefined {
  return Array.isArray(operation.security) ? operation.security : documentSecurity;
}

function operationHasInput(operation: OpenApiOperationLike): boolean {
  return Boolean(operation.requestBody) || (Array.isArray(operation.parameters) && operation.parameters.length > 0);
}

function hasSecurity(security: unknown[] | undefined): boolean {
  return Array.isArray(security) && security.length > 0;
}

function extractSecurityScopes(security: unknown[] | undefined): string[] {
  if (!Array.isArray(security)) return [];
  const scopes = new Set<string>();
  for (const requirement of security) {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) continue;
    for (const value of Object.values(requirement as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      for (const scope of value) {
        if (typeof scope === "string" && scope) scopes.add(scope);
      }
    }
  }
  return [...scopes].sort();
}

function inferSafeOpenApiEffect(commandId: string, method: string): ToolEffect {
  const methodEffect = inferEffectFromHttpMethod(method);
  const procedureEffect = inferEffectFromProcedureId(commandId, methodEffect);
  if (methodEffect === "destructive") return "destructive";
  if (methodEffect === "write") return procedureEffect === "destructive" ? "destructive" : "write";
  return procedureEffect;
}

function normalizeGeneratedRuntimeStatus(value: unknown): GeneratedRuntimeStatus {
  return value === "shadow" || value === "unknown" ? value : "shadow";
}

function normalizeSourceRuntimeStatus(value: unknown): "mounted" | "shadow" | "unknown" {
  return value === "mounted" || value === "shadow" ? value : "unknown";
}

function sourceRuntimeStatusFromMetadata(value: unknown): "mounted" | "shadow" | "unknown" | undefined {
  const normalized = normalizeSourceRuntimeStatus(value);
  return normalized === "unknown" ? undefined : normalized;
}

function normalizeGeneratedOpenApiSource(source: CommandGeneratorConfig["toolSource"]): ToolSource {
  return source === "orpc" ? "orpc" : "openapi";
}

function defaultTargetsForEffect(effect: ToolEffect): ToolUiTarget[] {
  if (effect === "read") return ["chat", "artifact"];
  if (effect === "environment") return ["terminal"];
  return ["none"];
}

function normalizeOperationId(operationId: string, method: string, path: string): string {
  if (validProcedurePattern.test(operationId)) return operationId;
  const normalizedOperationId = operationId
    .replace(/([a-z0-9])([A-Z])/g, "$1.$2")
    .replace(/[^a-z0-9]+/gi, ".")
    .replace(/^\.|\.$/g, "")
    .toLowerCase();
  if (validProcedurePattern.test(normalizedOperationId)) return normalizedOperationId;
  return `${method.toLowerCase()}.${path.replace(/^\//, "").replace(/\{([^}]+)\}/g, "$1").replace(/[^a-z0-9]+/gi, ".").replace(/^\.|\.$/g, "")}`;
}

function humanizeCommandId(commandId: string): string {
  return commandId
    .split(/[._:-]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function tokenizeText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9:+_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !["and", "the", "for", "with", "from", "into"].includes(token));
}

function metadataArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function createOpenApiCommandInputSchema(document: OpenApiDocumentLike, operation: OpenApiOperationLike): Record<string, unknown> | undefined {
  const properties: Record<string, unknown> = {};
  const required = new Set<string>();
  const parameters = Array.isArray(operation.parameters) ? operation.parameters : [];

  for (const parameter of parameters) {
    if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) continue;
    const record = parameter as Record<string, unknown>;
    const name = stringValue(record.name);
    if (!name) continue;
    const location = stringValue(record.in);
    const schema = compactOpenApiSchema(document, record.schema);
    properties[name] = {
      ...(schema ?? { type: "string" }),
      description: [schemaDescription(schema), location ? `OpenAPI ${location} parameter.` : undefined].filter(Boolean).join(" "),
    };
    if (record.required === true || location === "path") required.add(name);
  }

  const requestBody = operation.requestBody && typeof operation.requestBody === "object" && !Array.isArray(operation.requestBody)
    ? operation.requestBody as Record<string, unknown>
    : undefined;
  const requestBodySchema = preferredRequestBodySchema(document, requestBody);
  if (requestBodySchema) {
    const normalizedBodySchema = compactOpenApiSchema(document, requestBodySchema);
    if (isPlainObjectSchema(normalizedBodySchema)) {
      const bodyProperties = normalizedBodySchema.properties && typeof normalizedBodySchema.properties === "object" && !Array.isArray(normalizedBodySchema.properties)
        ? normalizedBodySchema.properties as Record<string, unknown>
        : {};
      for (const [key, value] of Object.entries(bodyProperties)) properties[key] = value;
      for (const key of Array.isArray(normalizedBodySchema.required) ? normalizedBodySchema.required : []) {
        if (typeof key === "string") required.add(key);
      }
    } else {
      properties.body = normalizedBodySchema ?? { description: "Request body." };
      if (requestBody?.required === true) required.add("body");
    }
  }

  if (Object.keys(properties).length === 0) return undefined;

  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false,
  };
}

function preferredRequestBodySchema(document: OpenApiDocumentLike, requestBody: Record<string, unknown> | undefined): unknown {
  const content = requestBody?.content && typeof requestBody.content === "object" && !Array.isArray(requestBody.content)
    ? requestBody.content as Record<string, unknown>
    : undefined;
  if (!content) return undefined;
  const preferredContentType = ["application/json", "multipart/form-data", "application/octet-stream"].find((contentType) => contentType in content) ?? Object.keys(content).sort()[0];
  const media = preferredContentType && content[preferredContentType] && typeof content[preferredContentType] === "object" && !Array.isArray(content[preferredContentType])
    ? content[preferredContentType] as Record<string, unknown>
    : undefined;
  const schema = media?.schema;
  return schema ? dereferenceOpenApiSchema(document, schema) : undefined;
}

function compactOpenApiSchema(document: OpenApiDocumentLike, schema: unknown, seen = new Set<string>()): Record<string, unknown> | undefined {
  const resolved = dereferenceOpenApiSchema(document, schema, seen);
  if (!resolved || typeof resolved !== "object" || Array.isArray(resolved)) return undefined;
  const source = resolved as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["type", "format", "description", "minimum", "maximum", "minLength", "maxLength", "default", "const"]) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  if (Array.isArray(source.enum)) out.enum = source.enum;
  if (Array.isArray(source.required)) out.required = source.required.filter((value): value is string => typeof value === "string");
  if (source.additionalProperties !== undefined) out.additionalProperties = source.additionalProperties;
  if (source.propertyNames !== undefined) out.propertyNames = source.propertyNames;
  if (source.items !== undefined) {
    const items = compactOpenApiSchema(document, source.items, seen);
    if (items) out.items = items;
  }
  for (const compoundKey of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(source[compoundKey])) {
      out[compoundKey] = (source[compoundKey] as unknown[])
        .map((entry) => compactOpenApiSchema(document, entry, seen))
        .filter(Boolean);
    }
  }
  if (source.properties && typeof source.properties === "object" && !Array.isArray(source.properties)) {
    out.properties = Object.fromEntries(
      Object.entries(source.properties as Record<string, unknown>)
        .map(([key, value]) => [key, compactOpenApiSchema(document, value, seen) ?? {}]),
    );
  }
  return out;
}

function dereferenceOpenApiSchema(document: OpenApiDocumentLike, schema: unknown, seen = new Set<string>()): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const record = schema as Record<string, unknown>;
  const ref = stringValue(record.$ref);
  if (!ref) return schema;
  if (seen.has(ref)) return schema;
  seen.add(ref);
  const resolved = resolveJsonPointer(document, ref);
  return resolved ?? schema;
}

function resolveJsonPointer(document: OpenApiDocumentLike, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  return ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((current, part) => {
      if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
      return (current as Record<string, unknown>)[part];
    }, document);
}

function isPlainObjectSchema(schema: Record<string, unknown> | undefined): schema is Record<string, unknown> & { properties?: Record<string, unknown> } {
  return Boolean(schema && (schema.type === "object" || schema.properties));
}

function createOpenApiCommandExamples(commandId: string, title: string, inputSchema: Record<string, unknown> | undefined): Array<{ title: string; input: unknown }> {
  if (!inputSchema) return [];
  const input = sampleValueFromSchema(inputSchema, { root: true });
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length === 0) return [];
  return [{ title: `Example input for ${title || commandId}`, input }];
}

function sampleValueFromSchema(schema: unknown, options: { root?: boolean; key?: string } = {}): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return options.root ? {} : "value";
  const record = schema as Record<string, unknown>;
  if (record.const !== undefined) return record.const;
  if (record.default !== undefined) return record.default;
  if (Array.isArray(record.enum) && record.enum.length > 0) return record.enum[0];
  for (const compoundKey of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = record[compoundKey];
    if (Array.isArray(variants) && variants.length > 0) {
      const nonNull = variants.find((variant) => !(variant && typeof variant === "object" && !Array.isArray(variant) && (variant as Record<string, unknown>).type === "null"));
      return sampleValueFromSchema(nonNull ?? variants[0], options);
    }
  }
  if (record.type === "object" || record.properties) {
    const properties = record.properties && typeof record.properties === "object" && !Array.isArray(record.properties)
      ? record.properties as Record<string, unknown>
      : {};
    const declaredRequired = Array.isArray(record.required) ? record.required.filter((value): value is string => typeof value === "string") : [];
    const required = new Set(declaredRequired);
    const keys = declaredRequired.length > 0 ? Object.keys(properties) : Object.keys(properties).slice(0, 3);
    const entries: Array<[string, unknown]> = [];
    for (const key of keys) {
      if (!options.root && !required.has(key)) continue;
      if (!required.has(key) && declaredRequired.length > 0 && !isHelpfulOptionalExampleKey(key)) continue;
      entries.push([key, sampleValueFromSchema(properties[key], { key })]);
    }
    return Object.fromEntries(entries);
  }
  if (record.type === "array") return [sampleValueFromSchema(record.items, options)];
  if (record.type === "integer" || record.type === "number") return sampleNumberFromSchema(record, options.key);
  if (record.type === "boolean") return true;
  if (record.type === "null") return null;

  const key = options.key ?? "";
  const format = stringValue(record.format);
  const description = stringValue(record.description) ?? "";
  if (/^(userId|principalId)$/i.test(key)) return "CURRENT_HOST_PRINCIPAL_ID";
  if (format === "uuid" || /(^|_)(id|uuid)$/i.test(key)) return sampleUuidForKey(key);
  if (format === "date-time" || /at$/i.test(key) || isIsoDateRangeKey(key, description)) return sampleDateTimeForKey(key);
  if (format === "date") return "2026-07-01";
  if (format === "binary") return "<binary>";
  if (/timezone/i.test(key)) return "America/New_York";
  if (/currency/i.test(key)) return "USD";
  if (/email/i.test(key)) return "guest@example.com";
  if (/phone/i.test(key)) return "+15555550123";
  if (/slug/i.test(key)) return "demo";
  if (/kind/i.test(key)) return "venue_schedule";
  if (/source/i.test(key)) return "admin";
  if (/code/i.test(key)) return "base";
  if (/label/i.test(key)) return "Base";
  if (/name/i.test(key)) return "Demo";
  const fallback = key ? `example_${key}` : "example";
  return boundStringToSchema(fallback, record);
}

function sampleNumberFromSchema(schema: Record<string, unknown>, key: string | undefined): number {
  if (key && /amountCents|priceCents|cents/i.test(key)) return 1000;
  if (key && /partySize|capacity|quantity|count|limit/i.test(key)) return 2;
  const minimum = typeof schema.minimum === "number" ? schema.minimum : undefined;
  const maximum = typeof schema.maximum === "number" ? schema.maximum : undefined;
  if (minimum !== undefined && maximum !== undefined) {
    if (minimum <= 1 && maximum >= 1) return 1;
    if (minimum <= 1000 && maximum >= 1000) return 1000;
    return minimum;
  }
  if (minimum !== undefined) return Math.max(minimum, 1);
  if (maximum !== undefined) return Math.min(maximum, 1);
  return 1;
}

function boundStringToSchema(value: string, schema: Record<string, unknown>): string {
  const minLength = typeof schema.minLength === "number" ? schema.minLength : undefined;
  const maxLength = typeof schema.maxLength === "number" ? schema.maxLength : undefined;
  let next = value;
  if (maxLength !== undefined && next.length > maxLength) next = next.slice(0, maxLength);
  if (minLength !== undefined && next.length < minLength) next = next.padEnd(minLength, "x");
  return next;
}

function isHelpfulOptionalExampleKey(key: string): boolean {
  return /^(clientRequestId|partySize|source|name|config|slug|timezone|rule|windows|status|reason|displayName|email|role|fileName|ttlSeconds|resourceUnitId)$/i.test(key);
}

function isIsoDateRangeKey(key: string, description: string): boolean {
  return /^(from|to)$/i.test(key) && /iso|date|time|window|range/i.test(description);
}

function sampleDateTimeForKey(key: string): string {
  if (/^(to|endsAt)$/i.test(key)) return "2026-07-01T19:00:00.000Z";
  if (/^endsAt$/i.test(key)) return "2026-07-01T13:00:00.000Z";
  if (/^startsAt$/i.test(key)) return "2026-07-01T18:00:00.000Z";
  return "2026-07-01T18:00:00.000Z";
}

function sampleUuidForKey(key: string): string {
  const samples: Record<string, string> = {
    contextId: "11111111-1111-4111-8111-111111111111",
    bookingId: "22222222-2222-4222-8222-222222222222",
    holdId: "33333333-3333-4333-8333-333333333333",
    resourceUnitId: "44444444-4444-4444-8444-444444444444",
    resourceTypeId: "55555555-5555-4555-8555-555555555555",
    assetId: "66666666-6666-4666-8666-666666666666",
    customerId: "77777777-7777-4777-8777-777777777777",
  };
  return samples[key] ?? "00000000-0000-4000-8000-000000000001";
}

function schemaDescription(schema: Record<string, unknown> | undefined): string | undefined {
  return typeof schema?.description === "string" ? schema.description : undefined;
}

function inferHostDerivedFields(inputSchema: Record<string, unknown> | undefined): string[] {
  const fields = ["organizationId", "orgId", "currentOrganizationId", "principalId", "actorId", "currentUserId"];
  const properties = inputSchema?.properties && typeof inputSchema.properties === "object" && !Array.isArray(inputSchema.properties)
    ? inputSchema.properties as Record<string, unknown>
    : {};
  return fields.filter((field) => !(field in properties));
}
