import { createStandaloneToolManifest } from "@sonik-agent-ui/platform-adapters";
import { filterAvailableTools, summarizeToolManifest, type ToolAvailabilityContext, type ToolManifest } from "@sonik-agent-ui/tool-contracts";

export type StandaloneToolManifestInput = {
  sessionId?: string | null;
  organizationId?: string | null;
  authenticated?: boolean;
  scopes?: string[];
  sourceMode?: ToolAvailabilityContext["sourceMode"];
  includeApprovalRequired?: boolean;
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
