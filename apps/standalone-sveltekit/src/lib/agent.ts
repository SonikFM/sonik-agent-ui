import { ToolLoopAgent, stepCountIs } from "ai";
import { getWeather } from "./tools/weather";
import { getGitHubRepo, getGitHubPullRequests } from "./tools/github";
import { getCryptoPrice, getCryptoPriceHistory } from "./tools/crypto";
import { getHackerNewsTop } from "./tools/hackernews";
import { webSearch } from "./tools/search";
import { createJsonArtifact } from "./tools/artifact";
import { createBookingIntakeArtifact } from "./tools/intake-artifact";
import { composeAgentSystemPrompt, type ComposedAgentPrompt } from "./agent-prompt";
import { resolveRuntimeSkillPromptModules } from "./server/skill-registry";
import { createDocumentTools, type DocumentToolContext } from "./tools/document";
import { createToolManifestTools } from "./tools/tool-manifest";
import { createCommandCatalogTools } from "./tools/command-catalog";
import { createArtifactStateTools } from "./tools/artifact-state";
import { createSkillCatalogTools } from "./tools/skill-catalog";
import { gateway, resolveGatewayModelId } from "./ai-gateway";
import type { AgentRuntimeSettings } from "./agent-settings";
import type { SystemModelMessage } from "ai";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import type { BookingRuntimeAuthContext } from "$lib/server/host-command-runtime";

export type AgentRuntimeContext = DocumentToolContext & { pageContext?: AgentPageContext; hostSession?: HostSessionEnvelope | null; approvedCommandIds?: string[]; bookingServiceBaseUrl?: string | null; bookingRuntimeAuth?: BookingRuntimeAuthContext | null; bookingRuntimeFetcher?: typeof fetch; skillIds?: string[]; agentSettings?: AgentRuntimeSettings };

const PREVIEW_ONLY_RUNTIME_SKILL_IDS = new Set([
  "booking.context.intake",
  "booking-context-intake",
  "booking.event.create",
  "booking-event",
  "amplify.campaign.template.create",
  "amplify-campaign-template",
]);
const EXECUTION_RUNTIME_SKILL_IDS = new Set([
  "booking.reservation.create",
  "booking-reservation",
  "booking.context.create",
  "booking-context-create",
]);

function normalizedSkillIds(skillIds: string[] | undefined): string[] {
  return (skillIds ?? []).map((id) => String(id).trim()).filter(Boolean);
}

function hasPreviewOnlyRuntimeSkill(skillIds: string[] | undefined): boolean {
  const ids = normalizedSkillIds(skillIds);
  if (ids.some((id) => EXECUTION_RUNTIME_SKILL_IDS.has(id))) return false;
  return ids.some((id) => PREVIEW_ONLY_RUNTIME_SKILL_IDS.has(id));
}

function hasBookingContextIntakeSkill(skillIds: string[] | undefined): boolean {
  const ids = normalizedSkillIds(skillIds);
  if (ids.some((id) => EXECUTION_RUNTIME_SKILL_IDS.has(id))) return false;
  return ids.some((id) => id === "booking.context.intake" || id === "booking-context-intake");
}

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
      previewOnlySkillActive: hasPreviewOnlyRuntimeSkill(context.skillIds),
    },
    skillModules: resolveRuntimeSkillPromptModules(context.skillIds),
  });
}


function createAgentInstructions(context: AgentRuntimeContext): string | SystemModelMessage {
  const prompt = resolveAgentPromptComposition(context).prompt;
  if (!context.agentSettings?.requireZdr) return prompt;
  return {
    role: "system",
    content: prompt,
    providerOptions: {
      gateway: {
        zeroDataRetention: true,
      },
    },
  };
}

export function createAgent(context: AgentRuntimeContext = {}) {
  const documentTools = createDocumentTools(context);
  const toolManifestTools = createToolManifestTools();
  const bookingContextIntakeActive = hasBookingContextIntakeSkill(context.skillIds);
  const previewOnlyRuntimeActive = hasPreviewOnlyRuntimeSkill(context.skillIds);
  const commandCatalogTools = previewOnlyRuntimeActive
    ? {}
    : createCommandCatalogTools({ sessionId: context.sessionId, pageContext: context.pageContext, hostSession: context.hostSession, approvedCommandIds: context.approvedCommandIds, bookingServiceBaseUrl: context.bookingServiceBaseUrl, bookingRuntimeAuth: context.bookingRuntimeAuth, bookingRuntimeFetcher: context.bookingRuntimeFetcher, toolPermissionModes: context.agentSettings?.toolPermissionModes });
  const artifactStateTools = createArtifactStateTools({ sessionId: context.sessionId, pageContext: context.pageContext, persistence: context.persistence, hostSession: context.hostSession, approvedCommandIds: context.approvedCommandIds, bookingServiceBaseUrl: context.bookingServiceBaseUrl, bookingRuntimeAuth: context.bookingRuntimeAuth, bookingRuntimeFetcher: context.bookingRuntimeFetcher, allowIntakeCommandCommit: !previewOnlyRuntimeActive });
  const skillCatalogTools = createSkillCatalogTools({ sessionId: context.sessionId, pageContext: context.pageContext, hostSession: context.hostSession });
  return new ToolLoopAgent({
    model: gateway(resolveGatewayModelId(context.agentSettings?.modelId)),
    instructions: createAgentInstructions(context),
    tools: {
      getWeather,
      getGitHubRepo,
      getGitHubPullRequests,
      getCryptoPrice,
      getCryptoPriceHistory,
      getHackerNewsTop,
      webSearch,
      ...(bookingContextIntakeActive ? { createBookingIntakeArtifact } : { createJsonArtifact }),
      ...documentTools,
      ...artifactStateTools,
      ...toolManifestTools,
      ...skillCatalogTools,
      ...commandCatalogTools,
    },
    stopWhen: stepCountIs(12),
    temperature: 0.35,
  });
}

export const agent = createAgent();
