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
        input: { kind: operation.requestBody || operation.parameters ? "openapi" : "unknown", ref: `${method.toUpperCase()} ${path} request` },
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
          examples: override.examples ?? [],
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
