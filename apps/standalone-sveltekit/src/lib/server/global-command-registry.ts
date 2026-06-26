import globalCommandRegistryArtifact from "./generated/sonik-global-command-registry.generated.json" with { type: "json" };
import {
  commandCatalogSchema,
  commandFamilyRegistrySchema,
  createStartupCommandIndex,
  createSurfaceCommandIndex,
  learnCommandDescriptor,
  searchCommandCatalogWithMetadata,
  type AgentPageContext,
  type CommandCatalog,
  type CommandIndex,
  type CommandIndexContext,
  type CommandLearnAspect,
  type CommandFamilyRegistry,
} from "@sonik-agent-ui/tool-contracts";

export type GlobalCommandRegistryArtifactSummary = {
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
    summary?: unknown;
  }>;
};

export type GlobalCommandRegistryRequestContext = AgentPageContext & {
  authenticated?: boolean;
  organizationId?: string | null;
  scopes?: string[];
};

export type GlobalCommandRegistrySearchInput = {
  query?: string;
  limit?: number;
  context?: GlobalCommandRegistryRequestContext;
};

export type GlobalCommandRegistryLearnInput = {
  commandId: string;
  aspects?: CommandLearnAspect[];
};

const artifact = globalCommandRegistryArtifact as {
  version: "sonik-agent-ui.global-command-registry.v1";
  provider: string;
  generatedAt: string;
  summary: GlobalCommandRegistryArtifactSummary["summary"];
  providers: GlobalCommandRegistryArtifactSummary["providers"];
  catalog: unknown;
  registry: unknown;
  manifest: unknown;
  projections: unknown;
};

const catalog = commandCatalogSchema.parse(artifact.catalog);
const registry = commandFamilyRegistrySchema.parse(artifact.registry);

export function getGlobalCommandRegistrySummary(): GlobalCommandRegistryArtifactSummary {
  return {
    version: artifact.version,
    provider: artifact.provider,
    generatedAt: artifact.generatedAt,
    summary: artifact.summary,
    providers: artifact.providers.map((provider) => ({
      provider: provider.provider,
      commandCount: provider.commandCount,
      familyCount: provider.familyCount,
      toolCount: provider.toolCount,
      source: provider.source,
      summary: provider.summary,
    })),
  };
}

export function getGlobalCommandCatalog(): CommandCatalog {
  return catalog;
}

export function getGlobalCommandFamilyRegistry(): CommandFamilyRegistry {
  return registry;
}

export function getGlobalCommandRegistryArtifact(input: { includeFull?: boolean; startupLimit?: number; context?: GlobalCommandRegistryRequestContext } = {}) {
  const summary = getGlobalCommandRegistrySummary();
  const startupIndex = createStartupCommandIndex(catalog, {
    registry,
    limit: boundLimit(input.startupLimit, 20, 12),
    context: normalizeGlobalCommandRegistryContext(input.context),
  });

  if (input.includeFull === true) {
    return {
      ...summary,
      registry,
      catalog,
      manifest: artifact.manifest,
      projections: artifact.projections,
      startupIndex,
    };
  }

  return {
    ...summary,
    registry: {
      version: registry.version,
      provider: registry.provider,
      generatedAt: registry.generatedAt,
      familyCount: registry.families.length,
      families: registry.families,
    },
    startupIndex,
  };
}

export function searchGlobalCommandRegistry(input: GlobalCommandRegistrySearchInput = {}) {
  const context = normalizeGlobalCommandRegistryContext(input.context);
  const contextIndex = createContextCommandIndex(context, 100);
  const contextCommandIds = new Set(contextIndex.commands.map((command) => command.id));
  const rawResult = searchCommandCatalogWithMetadata(catalog, input.query ?? "", 50);
  const limit = boundLimit(input.limit, 50, 10);
  const commands = [...rawResult.commands]
    .sort((a, b) => Number(contextCommandIds.has(b.id)) - Number(contextCommandIds.has(a.id)) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((command) => ({ ...command, contextLoaded: contextCommandIds.has(command.id) }));

  return {
    kind: "global-command-registry-search" as const,
    provider: catalog.provider,
    query: input.query ?? "",
    commands,
    totalMatches: rawResult.totalMatches,
    truncated: rawResult.totalMatches > limit,
    limit,
    contextIndex,
  };
}

export function learnGlobalCommand(input: GlobalCommandRegistryLearnInput) {
  const learned = learnCommandDescriptor(catalog, input.commandId, input.aspects);
  return {
    kind: "global-command-registry-learn" as const,
    provider: catalog.provider,
    ...learned,
  };
}

export function parseGlobalCommandRegistryContextFromSearchParams(searchParams: URLSearchParams): GlobalCommandRegistryRequestContext {
  return normalizeGlobalCommandRegistryContext({
    route: optionalParam(searchParams, "route"),
    surface: optionalParam(searchParams, "surface"),
    pageType: optionalParam(searchParams, "pageType"),
    title: optionalParam(searchParams, "title"),
    skillFamilies: listParam(searchParams, "skillFamilies"),
    commandFamilies: listParam(searchParams, "commandFamilies"),
    authenticated: searchParams.get("authenticated") === "true",
    organizationId: optionalParam(searchParams, "organizationId"),
    scopes: listParam(searchParams, "scopes"),
  });
}

export function parseCommandLearnAspects(value: string | null): CommandLearnAspect[] | undefined {
  if (!value) return undefined;
  const allowed = new Set<CommandLearnAspect>(["description", "schema", "examples", "policy", "output", "surfaces", "transport", "auth"]);
  const aspects = value.split(",").map((part) => part.trim()).filter((part): part is CommandLearnAspect => allowed.has(part as CommandLearnAspect));
  return aspects.length > 0 ? aspects : undefined;
}

function createContextCommandIndex(context: CommandIndexContext, limit: number): CommandIndex {
  const hasSurfaceContext = Boolean(
    context.route
      || context.surface
      || context.pageType
      || context.artifactType
      || context.skillFamilies?.length
      || context.commandFamilies?.length
  );
  if (!hasSurfaceContext) return createStartupCommandIndex(catalog, { registry, limit, context });
  return createSurfaceCommandIndex(catalog, context, { registry, limit });
}

function normalizeGlobalCommandRegistryContext(context: GlobalCommandRegistryRequestContext = {}): CommandIndexContext {
  return {
    route: context.route,
    surface: context.surface,
    pageType: context.pageType,
    title: context.title,
    activeEntity: context.activeEntity,
    activeArtifactId: context.activeArtifactId,
    activeDocumentId: context.activeDocumentId,
    artifactType: context.artifactType,
    visibleActions: context.visibleActions,
    skillFamilies: context.skillFamilies?.filter(Boolean),
    commandFamilies: context.commandFamilies?.filter(Boolean),
    authenticated: context.authenticated === true,
    organizationId: context.authenticated === true ? context.organizationId ?? null : null,
    scopes: context.authenticated === true ? [...new Set(context.scopes ?? [])].sort() : [],
  };
}

function boundLimit(value: number | undefined, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(Math.floor(value as number), max));
}

function optionalParam(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value || undefined;
}

function listParam(searchParams: URLSearchParams, key: string): string[] | undefined {
  const value = searchParams.get(key);
  if (!value) return undefined;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? [...new Set(parts)].sort() : undefined;
}
