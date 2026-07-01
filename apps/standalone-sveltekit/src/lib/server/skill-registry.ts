import {
  createSkillCatalog,
  createStartupSkillIndex,
  createSurfaceSkillIndex,
  learnSkillDescriptor,
  searchSkillCatalogWithMetadata,
  type AgentPageContext,
  type CommandIndexContext,
  type SkillCatalog,
  type SkillIndex,
  type SkillLearnAspect,
} from "@sonik-agent-ui/tool-contracts";
import { AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_SURFACE_TEMPLATE, AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW } from "./amplify-workflows/campaign-template-create.ts";
import { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE, BOOKING_CONTEXT_INTAKE_WORKFLOW } from "./booking-workflows/context-intake.ts";
import { BOOKING_EVENT_CREATE_SURFACE_TEMPLATE, BOOKING_EVENT_CREATE_WORKFLOW } from "./booking-workflows/event-create.ts";
import { BOOKING_RESERVATION_CREATE_RECIPE } from "./booking-workflows/reservation-create.ts";

export type RuntimeSkillRegistryContext = AgentPageContext & {
  authenticated?: boolean;
  organizationId?: string | null;
  scopes?: string[];
};

const generatedAt = "2026-06-30T00:00:00.000Z";

export const RUNTIME_SKILL_FAMILIES = [
  "amplify-campaign-template",
  "booking-context-intake",
  "booking-event",
  "booking-reservation",
] as const;

const catalog = createSkillCatalog("sonik-agent-ui-runtime", [
  {
    id: BOOKING_EVENT_CREATE_WORKFLOW.id,
    title: BOOKING_EVENT_CREATE_WORKFLOW.title,
    description: BOOKING_EVENT_CREATE_WORKFLOW.description,
    familyId: "booking-event",
    loadPolicy: { mode: "surface-eager", priority: 96, profile: "booking" },
    contextHints: {
      routes: [],
      surfaces: ["booking-event-intake", "event-console"],
      pageTypes: ["event-setup", "event-create", "event-intake"],
      artifactTypes: ["booking-event-intake", "event-context-manifest"],
      skillFamilies: ["booking-event", "booking-ops"],
      commandFamilies: ["booking-events"],
      requiredScopes: ["booking:read"],
    },
    intentAliases: [...BOOKING_EVENT_CREATE_WORKFLOW.intentAliases],
    commandSequence: [],
    requiredCommands: [],
    forbiddenUnlessExplicit: [...BOOKING_EVENT_CREATE_WORKFLOW.forbiddenUnlessExplicit],
    examples: [
      {
        title: "Create an event manifest from source copy",
        prompt: "Create an event manifest for this member dinner page and ask me only for missing ticket, access, and policy details.",
        expectedCommandPath: [],
      },
    ],
    negativeExamples: [
      {
        title: "Do not treat event manifest intake as an event write",
        prompt: "Create an event manifest and publish the event right away.",
        failIfCommandIds: ["booking.create.event", "booking.create.ticket", "booking.create.booking"],
        expectedCommandPath: [],
      },
    ],
    metadata: {
      workflowSteps: [...BOOKING_EVENT_CREATE_WORKFLOW.workflowSteps],
      questionPolicy: BOOKING_EVENT_CREATE_WORKFLOW.questionPolicy,
      requiredTools: [...BOOKING_EVENT_CREATE_WORKFLOW.requiredTools],
      optionalTools: [...BOOKING_EVENT_CREATE_WORKFLOW.optionalTools],
      interactiveSurfaceTemplate: BOOKING_EVENT_CREATE_SURFACE_TEMPLATE,
      successEvidence: [...BOOKING_EVENT_CREATE_WORKFLOW.successEvidence],
      telemetryEvents: [...BOOKING_EVENT_CREATE_WORKFLOW.telemetryEvents],
      negativeRules: [...BOOKING_EVENT_CREATE_WORKFLOW.negativeRules],
      execution: "none",
      approval: "not_granted",
    },
  },
  {
    id: AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW.id,
    title: AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW.title,
    description: AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW.description,
    familyId: "amplify-campaign-template",
    loadPolicy: { mode: "surface-eager", priority: 93, profile: "amplify" },
    contextHints: {
      routes: [],
      surfaces: ["amplify-campaign-wizard", "campaign-wizard", "amplify-console"],
      pageTypes: ["campaign-wizard", "campaign-template", "campaign-create"],
      artifactTypes: ["amplify-campaign-template-intake", "amplify-campaign-template-manifest"],
      skillFamilies: ["amplify-campaign-template", "campaign-ops"],
      commandFamilies: ["amplify-campaigns", "campaign-templates"],
      requiredScopes: ["amplify:read"],
    },
    intentAliases: [...AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW.intentAliases],
    commandSequence: [],
    requiredCommands: [],
    forbiddenUnlessExplicit: [...AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW.forbiddenUnlessExplicit],
    examples: [
      {
        title: "Create an Amplify campaign template manifest",
        prompt: "Create a campaign template for this VIP table offer and ask me only for missing audience, channel, and compliance details.",
        expectedCommandPath: [],
      },
    ],
    negativeExamples: [
      {
        title: "Do not treat campaign template intake as campaign publishing",
        prompt: "Create a campaign template and send it to everyone right now.",
        failIfCommandIds: ["amplify.create.campaign", "amplify.send.campaign", "amplify.publish.campaign.template"],
        expectedCommandPath: [],
      },
    ],
    metadata: {
      workflowSteps: [...AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW.workflowSteps],
      questionPolicy: AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW.questionPolicy,
      requiredTools: [...AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW.requiredTools],
      optionalTools: [...AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW.optionalTools],
      interactiveSurfaceTemplate: AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_SURFACE_TEMPLATE,
      successEvidence: [...AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW.successEvidence],
      telemetryEvents: [...AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW.telemetryEvents],
      negativeRules: [...AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_WORKFLOW.negativeRules],
      execution: "none",
      approval: "not_granted",
    },
  },
  {
    id: BOOKING_CONTEXT_INTAKE_WORKFLOW.id,
    title: BOOKING_CONTEXT_INTAKE_WORKFLOW.title,
    description: BOOKING_CONTEXT_INTAKE_WORKFLOW.description,
    familyId: "booking-context-intake",
    loadPolicy: { mode: "surface-eager", priority: 95, profile: "booking" },
    contextHints: {
      routes: [],
      surfaces: ["booking-context-intake"],
      pageTypes: ["booking-context", "venue-schedule"],
      artifactTypes: ["booking-context-intake", "booking-context-manifest"],
      skillFamilies: ["booking-context-intake", "booking-ops"],
      commandFamilies: [],
      requiredScopes: ["booking:read"],
    },
    intentAliases: [...BOOKING_CONTEXT_INTAKE_WORKFLOW.intentAliases],
    commandSequence: [],
    requiredCommands: [],
    forbiddenUnlessExplicit: [...BOOKING_CONTEXT_INTAKE_WORKFLOW.forbiddenUnlessExplicit],
    examples: [
      {
        title: "Create a booking context intake artifact from existing source copy",
        prompt: "Create a booking context intake for this country club tee-time schedule and ask me only for missing operational rules.",
        expectedCommandPath: [],
      },
    ],
    negativeExamples: [
      {
        title: "Do not treat intake as a booking mutation",
        prompt: "Create a booking context intake and go ahead and create the booking too.",
        failIfCommandIds: ["booking.create.booking", "booking.create.hold"],
        expectedCommandPath: [],
      },
    ],
    metadata: {
      workflowSteps: [...BOOKING_CONTEXT_INTAKE_WORKFLOW.workflowSteps],
      questionPolicy: BOOKING_CONTEXT_INTAKE_WORKFLOW.questionPolicy,
      requiredTools: [...BOOKING_CONTEXT_INTAKE_WORKFLOW.requiredTools],
      optionalTools: [...BOOKING_CONTEXT_INTAKE_WORKFLOW.optionalTools],
      interactiveSurfaceTemplate: BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE,
      successEvidence: [...BOOKING_CONTEXT_INTAKE_WORKFLOW.successEvidence],
      telemetryEvents: [...BOOKING_CONTEXT_INTAKE_WORKFLOW.telemetryEvents],
      negativeRules: [...BOOKING_CONTEXT_INTAKE_WORKFLOW.negativeRules],
      execution: "none",
      approval: "not_granted",
    },
  },
  {
    id: "booking.reservation.create",
    title: BOOKING_RESERVATION_CREATE_RECIPE.title,
    description: BOOKING_RESERVATION_CREATE_RECIPE.description,
    familyId: "booking-reservation",
    loadPolicy: { mode: "surface-eager", priority: 100, profile: "booking" },
    contextHints: {
      routes: [],
      surfaces: ["booking-admin", "booking-console", "booking-detail"],
      pageTypes: ["event-booking-detail", "booking-detail", "booking-context"],
      artifactTypes: [],
      skillFamilies: ["booking", "booking-reservation", "booking-ops"],
      commandFamilies: ["booking", "booking-guests", "booking-reservations"],
      requiredScopes: ["booking:read", "booking:write"],
    },
    intentAliases: BOOKING_RESERVATION_CREATE_RECIPE.intentAliases,
    commandSequence: BOOKING_RESERVATION_CREATE_RECIPE.commandSequence,
    requiredCommands: BOOKING_RESERVATION_CREATE_RECIPE.commandSequence,
    forbiddenUnlessExplicit: BOOKING_RESERVATION_CREATE_RECIPE.forbiddenUnlessExplicit,
    workflowRecipe: BOOKING_RESERVATION_CREATE_RECIPE,
    examples: [
      {
        title: "Create a durable booking reservation from the current page",
        prompt: BOOKING_RESERVATION_CREATE_RECIPE.canonicalRegressionPrompt,
        expectedCommandPath: BOOKING_RESERVATION_CREATE_RECIPE.commandSequence,
      },
    ],
    negativeExamples: [
      {
        title: "Do not downgrade a reservation into a temporary hold",
        prompt: BOOKING_RESERVATION_CREATE_RECIPE.negativeTranscriptRegression.prompt,
        failIfCommandIds: BOOKING_RESERVATION_CREATE_RECIPE.negativeTranscriptRegression.failIfCommandIds,
        expectedCommandPath: BOOKING_RESERVATION_CREATE_RECIPE.negativeTranscriptRegression.expectedCommandPath,
      },
    ],
    metadata: {
      trustedActorRules: BOOKING_RESERVATION_CREATE_RECIPE.trustedActorRules,
      actorFields: BOOKING_RESERVATION_CREATE_RECIPE.actorFields,
      guestFields: BOOKING_RESERVATION_CREATE_RECIPE.guestFields,
      pageContextRequirements: BOOKING_RESERVATION_CREATE_RECIPE.pageContextRequirements,
      successEvidence: BOOKING_RESERVATION_CREATE_RECIPE.successEvidence,
    },
  },
], generatedAt);

export function getRuntimeSkillCatalog(): SkillCatalog {
  return catalog;
}

export function createRuntimeSkillIndex(context: RuntimeSkillRegistryContext = {}, input: { limit?: number } = {}): SkillIndex {
  const normalized = normalizeSkillRegistryContext(context);
  const hasSurfaceContext = Boolean(
    normalized.route
      || normalized.surface
      || normalized.pageType
      || normalized.artifactType
      || normalized.skillFamilies?.length
      || normalized.commandFamilies?.length
  );
  return hasSurfaceContext
    ? createSurfaceSkillIndex(catalog, normalized, { limit: input.limit ?? 8 })
    : createStartupSkillIndex(catalog, { limit: input.limit ?? 8, context: normalized });
}

export function createRuntimeSkillIndexSummary(context: RuntimeSkillRegistryContext = {}, input: { limit?: number } = {}): string {
  const index = createRuntimeSkillIndex(context, input);
  const lines = [
    `Skill index ${index.provider}: ${index.skills.length}/${index.totalMatches} loaded${index.truncated ? `, truncated at ${index.limit}` : ""}`,
  ];
  for (const skill of index.skills) {
    lines.push(`- ${skill.id} [${skill.familyId}/${skill.loadPolicy.mode}] commands=${skill.commandSequence.join(" -> ") || "none"}: ${skill.title}`);
  }
  lines.push("Use searchSkillCatalog for workflow discovery and learnSkill for exact command path, examples, negative constraints, and success evidence. Skills teach tool usage; they do not grant approval or authorization.");
  return lines.join("\n");
}

export function searchRuntimeSkillCatalog(input: { query?: string; limit?: number; context?: RuntimeSkillRegistryContext } = {}) {
  return searchSkillCatalogWithMetadata(catalog, input.query ?? "", input.limit ?? 8, normalizeSkillRegistryContext(input.context));
}

export function learnRuntimeSkill(input: { skillId: string; aspects?: SkillLearnAspect[] }) {
  return {
    kind: "skill-learn" as const,
    provider: catalog.provider,
    ...learnSkillDescriptor(catalog, input.skillId, input.aspects),
  };
}

export function normalizeSkillRegistryContext(context: RuntimeSkillRegistryContext = {}): CommandIndexContext {
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
