import {
  createStandaloneStartupCommandIndex,
  createStandaloneSurfaceCommandIndex,
  createStandaloneToolManifest,
} from "@sonik-agent-ui/platform-adapters";
import {
  filterAvailableTools,
  summarizeToolManifest,
  type CommandIndex,
  type CommandIndexContext,
  type ToolAvailabilityContext,
  type ToolManifest,
} from "@sonik-agent-ui/tool-contracts";

export type StandaloneToolManifestInput = {
  sessionId?: string | null;
  organizationId?: string | null;
  authenticated?: boolean;
  scopes?: string[];
  sourceMode?: ToolAvailabilityContext["sourceMode"];
  includeApprovalRequired?: boolean;
  indexContext?: CommandIndexContext;
  indexLimit?: number;
};

export function createStandaloneAvailableToolManifest(input: StandaloneToolManifestInput = {}): ToolManifest {
  const baseManifest = createStandaloneToolManifest({
    sessionId: input.sessionId,
    organizationId: input.organizationId,
    authenticated: input.authenticated,
    scopes: input.scopes,
  });
  return filterAvailableTools(baseManifest, {
    authenticated: input.authenticated ?? false,
    organizationId: input.organizationId ?? null,
    scopes: input.scopes ?? [],
    sourceMode: input.sourceMode ?? "all",
    includeApprovalRequired: input.includeApprovalRequired ?? true,
  });
}

export function createStandaloneToolManifestSummary(input: StandaloneToolManifestInput = {}): string {
  return summarizeToolManifest(createStandaloneAvailableToolManifest(input));
}

export function createStandaloneCommandIndex(input: StandaloneToolManifestInput = {}): CommandIndex {
  const generatedAt = new Date().toISOString();
  const context = {
    sessionId: input.sessionId,
    organizationId: input.organizationId,
    authenticated: input.authenticated,
    scopes: input.scopes,
  };
  return input.indexContext
    ? createStandaloneSurfaceCommandIndex(context, input.indexContext, generatedAt, { limit: input.indexLimit ?? 20 })
    : createStandaloneStartupCommandIndex(context, generatedAt, { limit: input.indexLimit ?? 12 });
}

export function createStandaloneCommandIndexSummary(input: StandaloneToolManifestInput = {}): string {
  const index = createStandaloneCommandIndex(input);
  const lines = [
    `Command index ${index.provider}: ${index.commands.length}/${index.totalMatches} loaded${index.truncated ? `, truncated at ${index.limit}` : ""}`,
    `families=${index.families.map((family) => `${family.id}:${family.source}`).join(",") || "none"}`,
  ];
  for (const command of index.commands) {
    lines.push(`- ${command.id} [${command.familyId}/${command.source}/${command.effect}/${command.approval}/${command.loadPolicy.mode}] surfaces=${command.surfaces.join(",") || "none"}: ${command.title}`);
  }
  lines.push("Use searchCommandCatalog for lazy/discovery commands and learnCommand for full schema/policy details.");
  return lines.join("\n");
}
