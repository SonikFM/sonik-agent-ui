import { ToolLoopAgent, isStepCount } from "ai";
import { getWeather } from "./tools/weather";
// Demo starter tools from the upstream svelte-chat harness (github/crypto/HN)
// are unmounted for the booking surface: with them mounted, "what can you do"
// answers led with Bitcoin charts and HN stories instead of booking (pressure
// test F3, 2026-07-08). Weather stays as a harmless utility. Re-enable by
// uncommenting the imports and mounts.
// import { getGitHubRepo, getGitHubPullRequests } from "./tools/github";
// import { getCryptoPrice, getCryptoPriceHistory } from "./tools/crypto";
// import { getHackerNewsTop } from "./tools/hackernews";
import { createWebSearch } from "./tools/search";
import { createJsonArtifact } from "./tools/artifact";
import { createBookingIntakeArtifactTool, createSubmitIntakeAnswerTool } from "./tools/intake-artifact";
import { composeAgentSystemPrompt, type ComposedAgentPrompt } from "./agent-prompt";
import { resolveRuntimeSkillPromptModules } from "./server/skill-registry";
import { createDocumentTools, type DocumentToolContext } from "./tools/document";
import { createToolManifestTools } from "./tools/tool-manifest";
import { createCommandCatalogTools } from "./tools/command-catalog";
import { createArtifactStateTools } from "./tools/artifact-state";
import { createSkillCatalogTools } from "./tools/skill-catalog";
import { createMarketplaceWorkflowTools } from "./tools/marketplace-workflows";
import { createDraftWorkflow } from "./tools/drafting-agent";
import { shouldMountJsonArtifactTool, type WorkspaceDocumentIntent } from "./document-intent";
import { gateway, resolveGatewayModelId } from "./ai-gateway";
import type { AgentRuntimeSettings } from "./agent-settings";
import type { LanguageModel, SystemModelMessage } from "ai";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import type { BookingRuntimeAuthContext } from "$lib/server/host-command-runtime";
import type { AgentDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
import type { Spec } from "@json-render/core";
import {
  hasBookingContextCreateSkill,
  hasBookingContextIntakeSkill,
  hasPreviewOnlyRuntimeSkill,
  resolveCommandFamilyMountDecision,
} from "./command-family-mount";
import {
  AI_SDK_TELEMETRY_FUNCTION,
  createAiSdkTelemetryOptions,
  createAiSdkTelemetryRuntimeContext,
  type AiSdkTelemetryCorrelation,
} from "./server/ai-sdk-telemetry";

// Re-exported for existing `$lib/agent` importers; the logic lives in the dependency-free
// leaf module so it stays unit-testable (agent.ts itself can only be type-imported in plain node).
export { hasBookingContextIntakeSkill, resolveCommandFamilyMountDecision } from "./command-family-mount";
export type { CommandFamilyMountDecision } from "./command-family-mount";

export type AgentRuntimeContext = DocumentToolContext & { pageContext?: AgentPageContext; hostSession?: HostSessionEnvelope | null; approvedCommandIds?: string[]; bookingServiceBaseUrl?: string | null; bookingRuntimeAuth?: BookingRuntimeAuthContext | null; bookingRuntimeFetcher?: typeof fetch; skillIds?: string[]; agentSettings?: AgentRuntimeSettings; currentIntakeArtifactSpec?: Spec | null; toolsetContinuitySkillIds?: string[]; workspaceDocumentIntent?: WorkspaceDocumentIntent; productTourIntent?: boolean; model?: LanguageModel; aiTelemetry?: Partial<AiSdkTelemetryCorrelation>;
};

/**
 * Composes the per-turn system prompt for a run: the always-on core plus the
 * modules that seed for this context, plus any runtime skill bodies selected for
 * this turn only (from composer runtime-skill chips and/or page-context skill
 * families). Pure and deterministic for a given context, so the generate route
 * can call it to record the composed module/skill ids on the run without
 * building the agent twice.
 */
export function resolveAgentPromptComposition(context: AgentRuntimeContext = {}): ComposedAgentPrompt {
  return composeAgentSystemPrompt({
    context: {
      hasJsonArtifactTool: shouldMountJsonArtifactTool(context.workspaceDocumentIntent ?? "none"),
      hasBookingRuntime: !context.productTourIntent && Boolean(context.bookingRuntimeAuth || context.bookingServiceBaseUrl),
      hasDocumentTools: true,
      hasPageContext: Boolean(context.pageContext),
      previewOnlySkillActive: hasPreviewOnlyRuntimeSkill(context.skillIds),
    },
    skillModules: resolveRuntimeSkillPromptModules(context.skillIds, context.agentSettings?.skillPromptOverrides),
    promptModuleOverrides: context.agentSettings?.promptModuleOverrides,
    currentIntakeArtifactSpec: context.currentIntakeArtifactSpec,
  });
}


// AI SDK 7: instructions must be a plain string — passing a SystemModelMessage
// object (the v6 way to attach providerOptions to the system prompt) now throws
// AI_InvalidPromptError ("System messages are not allowed in the prompt or
// messages fields") on every turn. ZDR routing rides agent-level
// providerOptions in createAgent instead (2026-07-13 live-embed outage: every
// requireZdr turn 503'd).
function createAgentInstructions(context: AgentRuntimeContext): string {
  return resolveAgentPromptComposition(context).prompt;
}

export function createAgent(context: AgentRuntimeContext = {}) {
  const telemetryRuntimeContext = createAiSdkTelemetryRuntimeContext(context.aiTelemetry, AI_SDK_TELEMETRY_FUNCTION.main);
  const webSearch = createWebSearch(context.aiTelemetry);
  const draftWorkflow = createDraftWorkflow(context.aiTelemetry);
  const documentTools = createDocumentTools(context);
  const toolManifestTools = createToolManifestTools();
  const bookingContextIntakeActive = hasBookingContextIntakeSkill(context.skillIds);
  const bookingContextCreateActive = hasBookingContextCreateSkill(context.skillIds);
  const commandFamilyDecision = resolveCommandFamilyMountDecision({ ...context, suppressCommandCatalog: context.productTourIntent });
  const mountJsonArtifactTool = shouldMountJsonArtifactTool(context.workspaceDocumentIntent ?? "none");
  const commandCatalogTools = commandFamilyDecision.mounted
    ? createCommandCatalogTools({ sessionId: context.sessionId, pageContext: context.pageContext, hostSession: context.hostSession, approvedCommandIds: context.approvedCommandIds, bookingServiceBaseUrl: context.bookingServiceBaseUrl, bookingRuntimeAuth: context.bookingRuntimeAuth, bookingRuntimeFetcher: context.bookingRuntimeFetcher, toolPermissionModes: context.agentSettings?.toolPermissionModes })
    : {};
  const artifactStateTools = createArtifactStateTools({ sessionId: context.sessionId, pageContext: context.pageContext, persistence: context.persistence, hostSession: context.hostSession, approvedCommandIds: context.approvedCommandIds, bookingServiceBaseUrl: context.bookingServiceBaseUrl, bookingRuntimeAuth: context.bookingRuntimeAuth, bookingRuntimeFetcher: context.bookingRuntimeFetcher });
  const skillCatalogTools = createSkillCatalogTools({ sessionId: context.sessionId, pageContext: context.pageContext, hostSession: context.hostSession });
  const marketplaceWorkflowTools = createMarketplaceWorkflowTools({ sessionId: context.sessionId, pageContext: context.pageContext, hostSession: context.hostSession });
  return new ToolLoopAgent({
    model: context.model ?? gateway(resolveGatewayModelId(context.agentSettings?.modelId)),
    instructions: createAgentInstructions(context),
    tools: {
      getWeather,
      // getGitHubRepo,
      // getGitHubPullRequests,
      // getCryptoPrice,
      // getCryptoPriceHistory,
      // getHackerNewsTop,
      webSearch,
      ...(bookingContextIntakeActive
        ? { createBookingIntakeArtifact: createBookingIntakeArtifactTool({ pageContext: context.pageContext }), submitIntakeAnswer: createSubmitIntakeAnswerTool({ pageContext: context.pageContext, persistence: context.persistence }) }
        : mountJsonArtifactTool
          ? { createJsonArtifact }
          : {}),
      ...documentTools,
      ...artifactStateTools,
      ...toolManifestTools,
      ...skillCatalogTools,
      ...marketplaceWorkflowTools,
      ...commandCatalogTools,
      ...(context.agentSettings?.workflowBuilderMode ? { draftWorkflow } : {}),
    },
    // The generate route prepends per-turn workspace context (page summary,
    // command/skill startup indexes, knowledge) as a system message in
    // `messages` — legal in v6, rejected by default in v7 with
    // AI_InvalidPromptError, which 503'd every real embedded turn
    // (2026-07-13 live-embed outage).
    allowSystemInMessages: true,
    runtimeContext: telemetryRuntimeContext,
    telemetry: createAiSdkTelemetryOptions(AI_SDK_TELEMETRY_FUNCTION.main, Boolean(telemetryRuntimeContext.requestId)),
    ...(context.workspaceDocumentIntent === "create"
      ? {
          // Prompt rules are advisory. For an explicit create-document turn,
          // require the real artifact call on step 0 so a prose promise cannot
          // terminate the run without creating anything.
          prepareStep: ({ stepNumber }: { stepNumber: number }) => stepNumber === 0
            ? { toolChoice: { type: "tool" as const, toolName: "createDocumentArtifact" as const } }
            : {},
        }
      : {}),
    stopWhen: isStepCount(12),
    // AI SDK 7 wall-clock bounds (we previously had only the step cap): a stalled
    // provider stream or a hung tool now aborts instead of holding the request open.
    timeout: { totalMs: 120_000, stepMs: 60_000, toolMs: 30_000 },
    temperature: 0.35,
    // ZDR is a per-call gateway routing constraint in v7 (was a SystemModelMessage
    // providerOptions rider in v6 — see createAgentInstructions).
    ...(context.agentSettings?.requireZdr
      ? { providerOptions: { gateway: { zeroDataRetention: true } } }
      : {}),
  });
}

export const agent = createAgent();
