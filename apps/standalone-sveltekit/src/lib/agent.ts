import { ToolLoopAgent, stepCountIs } from "ai";
import { getWeather } from "./tools/weather";
// Demo starter tools from the upstream svelte-chat harness (github/crypto/HN)
// are unmounted for the booking surface: with them mounted, "what can you do"
// answers led with Bitcoin charts and HN stories instead of booking (pressure
// test F3, 2026-07-08). Weather stays as a harmless utility. Re-enable by
// uncommenting the imports and mounts.
// import { getGitHubRepo, getGitHubPullRequests } from "./tools/github";
// import { getCryptoPrice, getCryptoPriceHistory } from "./tools/crypto";
// import { getHackerNewsTop } from "./tools/hackernews";
import { webSearch } from "./tools/search";
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
import { gateway, resolveGatewayModelId } from "./ai-gateway";
import type { AgentRuntimeSettings } from "./agent-settings";
import type { SystemModelMessage } from "ai";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import type { BookingRuntimeAuthContext } from "$lib/server/host-command-runtime";
import type { Spec } from "@json-render/core";

export type AgentRuntimeContext = DocumentToolContext & { pageContext?: AgentPageContext; hostSession?: HostSessionEnvelope | null; approvedCommandIds?: string[]; bookingServiceBaseUrl?: string | null; bookingRuntimeAuth?: BookingRuntimeAuthContext | null; bookingRuntimeFetcher?: typeof fetch; skillIds?: string[]; agentSettings?: AgentRuntimeSettings; currentIntakeArtifactSpec?: Spec | null; toolsetContinuitySkillIds?: string[] };

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

export function hasBookingContextIntakeSkill(skillIds: string[] | undefined): boolean {
  const ids = normalizedSkillIds(skillIds);
  if (ids.some((id) => EXECUTION_RUNTIME_SKILL_IDS.has(id))) return false;
  return ids.some((id) => id === "booking.context.intake" || id === "booking-context-intake");
}

function hasBookingContextCreateSkill(skillIds: string[] | undefined): boolean {
  return normalizedSkillIds(skillIds).some((id) => id === "booking.context.create" || id === "booking-context-create");
}

function previewOnlySkillsAreContinuityOnly(skillIds: string[] | undefined, continuitySkillIds: string[] | undefined): boolean {
  const previewOnlyIds = normalizedSkillIds(skillIds).filter((id) => PREVIEW_ONLY_RUNTIME_SKILL_IDS.has(id));
  if (previewOnlyIds.length === 0) return false;
  const continuitySet = new Set(normalizedSkillIds(continuitySkillIds));
  return previewOnlyIds.every((id) => continuitySet.has(id));
}

export interface CommandFamilyMountDecision {
  /** Whether the booking command-catalog family is actually mounted for this turn. */
  mounted: boolean;
  /** What `mounted` would be if the Slice E continuity stability rule below were absent. */
  wouldMountWithoutStability: boolean;
}

/**
 * Decides whether the booking command-catalog tool family stays mounted this turn (R6/Slice E,
 * 2026-07-08). A preview-only runtime skill (e.g. booking.context.intake) normally suppresses the
 * command catalog while an intake/preview flow is active. But when that skill is present ONLY
 * because of runtime-skill-intent's continuity guard (an active workflow artifact carried it over
 * on an incidental keyword miss, not fresh explicit intent this turn), suppressing commands is the
 * exact churn Dan's transcript reported ("booking commands are gone -> check again -> back"). The
 * family only shrinks on an explicit context change now: fresh explicit preview-only intent, an
 * explicit booking.context.create (approve/commit) turn, or the workflow/artifact clearing (which
 * naturally drops the preview-only skill from skillIds entirely).
 */
export function resolveCommandFamilyMountDecision(context: Pick<AgentRuntimeContext, "skillIds" | "toolsetContinuitySkillIds">): CommandFamilyMountDecision {
  const previewOnlyRuntimeActive = hasPreviewOnlyRuntimeSkill(context.skillIds);
  const bookingContextCreateActive = hasBookingContextCreateSkill(context.skillIds);
  const previewSuppressesCommands = previewOnlyRuntimeActive || bookingContextCreateActive;
  const stabilityKeepsMounted = previewOnlyRuntimeActive
    && !bookingContextCreateActive
    && previewOnlySkillsAreContinuityOnly(context.skillIds, context.toolsetContinuitySkillIds);
  return {
    mounted: !previewSuppressesCommands || stabilityKeepsMounted,
    wouldMountWithoutStability: !previewSuppressesCommands,
  };
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
    skillModules: resolveRuntimeSkillPromptModules(context.skillIds, context.agentSettings?.skillPromptOverrides),
    promptModuleOverrides: context.agentSettings?.promptModuleOverrides,
    currentIntakeArtifactSpec: context.currentIntakeArtifactSpec,
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
  const bookingContextCreateActive = hasBookingContextCreateSkill(context.skillIds);
  const commandFamilyDecision = resolveCommandFamilyMountDecision(context);
  const commandCatalogTools = commandFamilyDecision.mounted
    ? createCommandCatalogTools({ sessionId: context.sessionId, pageContext: context.pageContext, hostSession: context.hostSession, approvedCommandIds: context.approvedCommandIds, bookingServiceBaseUrl: context.bookingServiceBaseUrl, bookingRuntimeAuth: context.bookingRuntimeAuth, bookingRuntimeFetcher: context.bookingRuntimeFetcher, toolPermissionModes: context.agentSettings?.toolPermissionModes })
    : {};
  const artifactStateTools = createArtifactStateTools({ sessionId: context.sessionId, pageContext: context.pageContext, persistence: context.persistence, hostSession: context.hostSession, approvedCommandIds: context.approvedCommandIds, bookingServiceBaseUrl: context.bookingServiceBaseUrl, bookingRuntimeAuth: context.bookingRuntimeAuth, bookingRuntimeFetcher: context.bookingRuntimeFetcher });
  const skillCatalogTools = createSkillCatalogTools({ sessionId: context.sessionId, pageContext: context.pageContext, hostSession: context.hostSession });
  const marketplaceWorkflowTools = createMarketplaceWorkflowTools({ sessionId: context.sessionId, pageContext: context.pageContext, hostSession: context.hostSession });
  return new ToolLoopAgent({
    model: gateway(resolveGatewayModelId(context.agentSettings?.modelId)),
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
        : { createJsonArtifact }),
      ...documentTools,
      ...artifactStateTools,
      ...toolManifestTools,
      ...skillCatalogTools,
      ...marketplaceWorkflowTools,
      ...commandCatalogTools,
    },
    stopWhen: stepCountIs(12),
    temperature: 0.35,
  });
}

export const agent = createAgent();
