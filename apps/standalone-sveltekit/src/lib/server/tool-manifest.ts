import {
  createStandaloneStartupCommandIndex,
  createStandaloneSurfaceCommandIndex,
  createStandaloneToolManifest,
  platformAdapterContextFromHostSession,
  type HostSessionEnvelope,
  type PlatformAdapterContext,
} from "@sonik-agent-ui/platform-adapters";
import {
  filterAvailableTools,
  summarizeToolManifest,
  type AgentPageContext,
  type CommandIndex,
  type CommandIndexContext,
  type ToolAvailabilityContext,
  type ToolManifest,
} from "@sonik-agent-ui/tool-contracts";
import { createStandaloneHostCommandIndex } from "./host-command-runtime.ts";
import { resolveStandaloneHostSession } from "./host-command-runtime.ts";
import type { BookingRuntimeAuthContext } from "./host-command-runtime.ts";

export type StandaloneToolManifestInput = {
  sessionId?: string | null;
  organizationId?: string | null;
  authenticated?: boolean;
  scopes?: string[];
  sourceMode?: ToolAvailabilityContext["sourceMode"];
  includeApprovalRequired?: boolean;
  pageContext?: AgentPageContext;
  indexContext?: CommandIndexContext;
  indexLimit?: number;
  includeHostRuntime?: boolean;
  hostSession?: HostSessionEnvelope | null;
  hostSessionMode?: "anonymous" | "standalone-demo" | "amplify-embedded";
  bookingServiceBaseUrl?: string | null;
  bookingRuntimeAuth?: BookingRuntimeAuthContext | null;
};

export function createStandaloneAvailableToolManifest(input: StandaloneToolManifestInput = {}): ToolManifest {
  const trustedContext = resolveStandaloneToolManifestContext(input);
  const baseManifest = createStandaloneToolManifest(trustedContext);
  return filterAvailableTools(baseManifest, {
    authenticated: trustedContext.authenticated ?? false,
    organizationId: trustedContext.organizationId ?? null,
    scopes: trustedContext.scopes ?? [],
    sourceMode: input.sourceMode ?? "all",
    includeApprovalRequired: input.includeApprovalRequired ?? true,
  });
}

export function createStandaloneToolManifestSummary(input: StandaloneToolManifestInput = {}): string {
  return summarizeToolManifest(createStandaloneAvailableToolManifest(input));
}

export function createStandaloneCommandIndex(input: StandaloneToolManifestInput = {}): CommandIndex {
  if (input.includeHostRuntime === true) return createStandaloneHostCommandIndex(input);
  const generatedAt = new Date().toISOString();
  const context = resolveStandaloneToolManifestContext(input);
  const indexContext = input.indexContext ?? input.pageContext;
  return indexContext
    ? createStandaloneSurfaceCommandIndex(context, indexContext, generatedAt, { limit: input.indexLimit ?? 20 })
    : createStandaloneStartupCommandIndex(context, generatedAt, { limit: input.indexLimit ?? 12 });
}

function resolveStandaloneToolManifestContext(input: StandaloneToolManifestInput = {}): PlatformAdapterContext {
  if ("hostSession" in input || input.hostSessionMode) {
    return platformAdapterContextFromHostSession(resolveStandaloneHostSession(input));
  }
  return {
    sessionId: input.sessionId,
    organizationId: input.organizationId,
    authenticated: input.authenticated,
    scopes: input.scopes,
  };
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
