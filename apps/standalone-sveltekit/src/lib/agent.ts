import { ToolLoopAgent, stepCountIs } from "ai";
import { getWeather } from "./tools/weather";
import { getGitHubRepo, getGitHubPullRequests } from "./tools/github";
import { getCryptoPrice, getCryptoPriceHistory } from "./tools/crypto";
import { getHackerNewsTop } from "./tools/hackernews";
import { webSearch } from "./tools/search";
import { createJsonArtifact } from "./tools/artifact";
import { composeAgentSystemPrompt, type ComposedAgentPrompt } from "./agent-prompt";
import { resolveRuntimeSkillPromptModules } from "./server/skill-registry";
import { createDocumentTools, type DocumentToolContext } from "./tools/document";
import { createToolManifestTools } from "./tools/tool-manifest";
import { createCommandCatalogTools } from "./tools/command-catalog";
import { createSkillCatalogTools } from "./tools/skill-catalog";
import { MODEL_ID, gateway } from "./ai-gateway";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import type { BookingRuntimeAuthContext } from "$lib/server/host-command-runtime";

export type AgentRuntimeContext = DocumentToolContext & { pageContext?: AgentPageContext; hostSession?: HostSessionEnvelope | null; approvedCommandIds?: string[]; bookingServiceBaseUrl?: string | null; bookingRuntimeAuth?: BookingRuntimeAuthContext | null; bookingRuntimeFetcher?: typeof fetch; skillIds?: string[] };

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
      hasBookingRuntime: Boolean(context.bookingRuntimeAuth || context.bookingServiceBaseUrl),
      hasDocumentTools: true,
      hasPageContext: Boolean(context.pageContext),
    },
    skillModules: resolveRuntimeSkillPromptModules(context.skillIds),
  });
}

export function createAgent(context: AgentRuntimeContext = {}) {
  const documentTools = createDocumentTools(context);
  const toolManifestTools = createToolManifestTools();
  const commandCatalogTools = createCommandCatalogTools({ sessionId: context.sessionId, pageContext: context.pageContext, hostSession: context.hostSession, approvedCommandIds: context.approvedCommandIds, bookingServiceBaseUrl: context.bookingServiceBaseUrl, bookingRuntimeAuth: context.bookingRuntimeAuth, bookingRuntimeFetcher: context.bookingRuntimeFetcher });
  const skillCatalogTools = createSkillCatalogTools({ sessionId: context.sessionId, pageContext: context.pageContext, hostSession: context.hostSession });
  return new ToolLoopAgent({
    model: gateway(MODEL_ID),
    instructions: resolveAgentPromptComposition(context).prompt,
    tools: {
      getWeather,
      getGitHubRepo,
      getGitHubPullRequests,
      getCryptoPrice,
      getCryptoPriceHistory,
      getHackerNewsTop,
      webSearch,
      createJsonArtifact,
      ...documentTools,
      ...toolManifestTools,
      ...skillCatalogTools,
      ...commandCatalogTools,
    },
    stopWhen: stepCountIs(12),
    temperature: 0.35,
  });
}

export const agent = createAgent();
