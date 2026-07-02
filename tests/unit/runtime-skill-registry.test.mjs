import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createInteractiveSurfaceJsonRenderSpec } from "../../packages/json-ui-runtime/src/intake.ts";
import { explorerCatalog } from "../../apps/standalone-sveltekit/src/lib/render/catalog.ts";
import {
  createRuntimeSkillIndex,
  createRuntimeSkillIndexSummary,
  getRuntimeSkillCatalog,
  learnRuntimeSkill,
  RUNTIME_SKILL_FAMILIES,
  searchRuntimeSkillCatalog,
} from "../../apps/standalone-sveltekit/src/lib/server/skill-registry.ts";
import { createSkillCatalogTools } from "../../apps/standalone-sveltekit/src/lib/tools/skill-catalog.ts";

const CONTEXT_ID = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";

const pageContext = {
  route: "/booking/bookings/booking_123",
  surface: "booking-admin",
  pageType: "event-booking-detail",
  activeEntity: { type: "booking-context", id: CONTEXT_ID, label: "Summer Jazz Night" },
  commandFamilies: ["booking-guests", "booking-reservations"],
  skillFamilies: ["booking-reservation"],
  visibleActions: ["view-availability", "create-booking"],
  authenticated: true,
  organizationId,
  scopes: ["booking:read", "booking:write"],
};

const intakePageContext = {
  route: "/booking/contexts/new",
  surface: "booking-console",
  pageType: "booking-context",
  activeEntity: { type: "booking-context", id: CONTEXT_ID, label: "Main Course Tee Sheet" },
  commandFamilies: ["booking", "booking-templates"],
  skillFamilies: ["booking-context-intake"],
  visibleActions: ["create-booking-context-intake"],
  authenticated: true,
  organizationId,
  scopes: ["booking:read"],
};

const eventPageContext = {
  route: "/booking/events/new",
  surface: "event-console",
  pageType: "event-setup",
  activeEntity: { type: "event-context", id: CONTEXT_ID, label: "Member Dinner" },
  commandFamilies: ["booking-events", "booking-templates"],
  skillFamilies: ["booking-event"],
  visibleActions: ["create-event-manifest"],
  authenticated: true,
  organizationId,
  scopes: ["booking:read"],
};

const campaignPageContext = {
  route: "/amplify/campaigns/new",
  surface: "amplify-campaign-wizard",
  pageType: "campaign-wizard",
  activeEntity: { type: "campaign-template", id: "campaign_template_draft", label: "VIP Table Offer" },
  commandFamilies: ["amplify-campaigns", "campaign-templates"],
  skillFamilies: ["amplify-campaign-template"],
  visibleActions: ["create-campaign-template"],
  authenticated: true,
  organizationId,
  scopes: ["amplify:read"],
};

const catalog = getRuntimeSkillCatalog();
assert.equal(catalog.version, "sonik-agent-ui.skill-catalog.v1");
assert.equal(catalog.provider, "sonik-agent-ui-runtime");
assert.equal(catalog.skills.length, 4, "runtime registry includes reservation execution guidance plus all Phase 4 intake skills");
assert.deepEqual([...RUNTIME_SKILL_FAMILIES].sort(), ["amplify-campaign-template", "booking-context-intake", "booking-event", "booking-reservation"]);
for (const skill of catalog.skills) {
  assert.ok(RUNTIME_SKILL_FAMILIES.includes(skill.familyId), `${skill.id} must use a centralized runtime skill family`);
}

function assertNonExecutingIntakeSkill(skill, expected) {
  assert.ok(skill, `${expected.id} is registered`);
  assert.equal(skill.familyId, expected.familyId);
  assert.equal(skill.loadPolicy.mode, "surface-eager");
  assert.deepEqual(skill.commandSequence, [], `${expected.id} must not execute commands`);
  assert.deepEqual(skill.requiredCommands, [], `${expected.id} must not require executable commands`);
  assert.ok(skill.contextHints.requiredScopes.includes(expected.requiredScope), `${expected.id} keeps its read scope visible`);
  for (const forbidden of expected.forbiddenCommands) {
    assert.ok(skill.forbiddenUnlessExplicit.includes(forbidden), `${expected.id} forbids ${forbidden} unless explicitly approved later`);
  }
  assert.equal(skill.metadata.execution, "none");
  assert.equal(skill.metadata.approval, "not_granted");
  assert.ok(skill.metadata.requiredTools.includes("ask_user_question"));
  assert.ok(skill.metadata.requiredTools.includes("create_or_update_intake_artifact"));
  assert.ok(skill.metadata.optionalTools.includes("manifest_validate"), `${expected.id} exposes Phase 5 validation as optional only`);
  assert.ok(skill.metadata.telemetryEvents.includes("tool.askUserQuestion"));
  assert.ok(skill.metadata.telemetryEvents.includes("artifact.intake.created"));
  assert.ok(skill.metadata.negativeRules.some((rule) => /Do not call executeCommand or commitCommand/i.test(rule)));
}

const reservationSkill = catalog.skills.find((entry) => entry.id === "booking.reservation.create");
assert.ok(reservationSkill, "reservation skill remains registered");
assert.equal(reservationSkill.familyId, "booking-reservation");
assert.equal(reservationSkill.loadPolicy.mode, "surface-eager");
assert.deepEqual(reservationSkill.commandSequence, ["booking.get.availability", "booking.create.guest", "booking.create.booking"]);
assert.ok(reservationSkill.forbiddenUnlessExplicit.includes("booking.create.hold"), "skill encodes hold as forbidden unless explicit");
assert.ok(reservationSkill.contextHints.skillFamilies.includes("booking-reservation"), "skill can be selected by donated page skill family");
assert.ok(reservationSkill.contextHints.requiredScopes.includes("booking:write"), "skill keeps write scope requirement visible");
assert.ok(reservationSkill.metadata.successEvidence.some((line) => /Pipe B telemetry/i.test(line)), "skill requires telemetry proof");

const intakeSkill = catalog.skills.find((entry) => entry.id === "booking.context.intake");
assertNonExecutingIntakeSkill(intakeSkill, {
  id: "booking.context.intake",
  familyId: "booking-context-intake",
  requiredScope: "booking:read",
  forbiddenCommands: ["booking.create.booking", "booking.create.hold"],
});

const eventSkill = catalog.skills.find((entry) => entry.id === "booking.event.create");
assertNonExecutingIntakeSkill(eventSkill, {
  id: "booking.event.create",
  familyId: "booking-event",
  requiredScope: "booking:read",
  forbiddenCommands: ["booking.create.event", "booking.create.ticket"],
});

const campaignSkill = catalog.skills.find((entry) => entry.id === "amplify.campaign.template.create");
assertNonExecutingIntakeSkill(campaignSkill, {
  id: "amplify.campaign.template.create",
  familyId: "amplify-campaign-template",
  requiredScope: "amplify:read",
  forbiddenCommands: ["amplify.create.campaign", "amplify.send.campaign"],
});

const noAuthIndex = createRuntimeSkillIndex({ ...pageContext, authenticated: false, organizationId: null, scopes: [] });
assert.equal(noAuthIndex.skills.length, 0, "runtime skills are hidden without trusted booking scopes");

const startupIndex = createRuntimeSkillIndex({ authenticated: true, organizationId, scopes: ["booking:read", "booking:write"] });
assert.equal(startupIndex.skills.length, 0, "surface-eager skills stay lazy until page context is donated");

const index = createRuntimeSkillIndex(pageContext);
assert.equal(index.skills[0].id, "booking.reservation.create", "booking reservation page prioritizes reservation workflow skill");
assert.equal(index.skills[0].commandSequence.join(" > "), "booking.get.availability > booking.create.guest > booking.create.booking");
assert.equal(index.skills.some((entry) => entry.id === "booking.context.intake"), false, "generic booking reservation pages must not eager-load context intake");

const intakeIndex = createRuntimeSkillIndex(intakePageContext);
assert.equal(intakeIndex.skills[0].id, "booking.context.intake", "booking context pages surface-eager-load the intake workflow skill");
assert.equal(intakeIndex.skills[0].commandSequence.length, 0, "loaded intake summary remains non-executable");

const eventIndex = createRuntimeSkillIndex(eventPageContext);
assert.equal(eventIndex.skills[0].id, "booking.event.create", "event setup pages surface-eager-load the event workflow skill first");
assert.equal(eventIndex.skills[0].commandSequence.length, 0, "loaded event summary remains non-executable");
assert.equal(eventIndex.skills.some((entry) => entry.id === "booking.context.intake"), false, "event setup pages must not co-surface generic booking context intake");

const campaignIndex = createRuntimeSkillIndex(campaignPageContext);
assert.equal(campaignIndex.skills[0].id, "amplify.campaign.template.create", "Amplify campaign wizard pages surface-eager-load the campaign template workflow skill");
assert.equal(campaignIndex.skills[0].commandSequence.length, 0, "loaded campaign template summary remains non-executable");
assert.equal(campaignIndex.skills.some((entry) => entry.id === "booking.context.intake"), false, "Amplify campaign pages must not co-surface booking context intake");

const summary = createRuntimeSkillIndexSummary(pageContext);
assert.match(summary, /booking\.reservation\.create/);
assert.match(summary, /Skills teach tool usage; they do not grant approval or authorization/);

const intakeSummary = createRuntimeSkillIndexSummary(intakePageContext);
assert.match(intakeSummary, /booking\.context\.intake/);
assert.match(intakeSummary, /commands=none/);

const eventSummary = createRuntimeSkillIndexSummary(eventPageContext);
assert.match(eventSummary, /booking\.event\.create/);
assert.match(eventSummary, /commands=none/);

const campaignSummary = createRuntimeSkillIndexSummary(campaignPageContext);
assert.match(campaignSummary, /amplify\.campaign\.template\.create/);
assert.match(campaignSummary, /commands=none/);

const search = searchRuntimeSkillCatalog({ query: "create reservation", context: pageContext });
assert.equal(search.skills[0].id, "booking.reservation.create", "reservation intent finds the reservation workflow skill");

const intakeSearch = searchRuntimeSkillCatalog({ query: "create booking context", context: intakePageContext });
assert.equal(intakeSearch.skills[0].id, "booking.context.intake", "booking context creation intent finds intake skill");

const lazyIntakeSearch = searchRuntimeSkillCatalog({ query: "create booking context", context: { authenticated: true, organizationId, scopes: ["booking:read"] } });
assert.equal(lazyIntakeSearch.skills[0].id, "booking.context.intake", "intake can still be discovered lazily outside matching page surfaces");

const eventSearch = searchRuntimeSkillCatalog({ query: "create event", context: eventPageContext });
assert.equal(eventSearch.skills[0].id, "booking.event.create", "event creation intent finds event workflow skill");

const lazyEventSearch = searchRuntimeSkillCatalog({ query: "create event", context: { authenticated: true, organizationId, scopes: ["booking:read"] } });
assert.equal(lazyEventSearch.skills[0].id, "booking.event.create", "event workflow can still be discovered lazily outside matching page surfaces");

const campaignSearch = searchRuntimeSkillCatalog({ query: "create campaign template", context: campaignPageContext });
assert.equal(campaignSearch.skills[0].id, "amplify.campaign.template.create", "campaign template intent finds Amplify campaign workflow skill");

const lazyCampaignSearch = searchRuntimeSkillCatalog({ query: "create campaign template", context: { authenticated: true, organizationId, scopes: ["amplify:read"] } });
assert.equal(lazyCampaignSearch.skills[0].id, "amplify.campaign.template.create", "campaign workflow can still be discovered lazily outside matching page surfaces");

const learned = learnRuntimeSkill({ skillId: "booking.reservation.create", aspects: ["description", "workflow", "examples", "policy", "context", "commands"] });
assert.equal(learned.ok, true);
assert.equal(learned.workflowRecipe.id, "booking.reservation.create");
assert.deepEqual(learned.commandSequence, ["booking.get.availability", "booking.create.guest", "booking.create.booking"]);
assert.ok(learned.forbiddenUnlessExplicit.includes("booking.create.hold"));
assert.ok(learned.negativeExamples[0].failIfCommandIds.includes("booking.create.hold"));

const learnedIntake = learnRuntimeSkill({ skillId: "booking.context.intake", aspects: ["description", "examples", "policy", "context", "commands"] });
assert.equal(learnedIntake.ok, true);
assert.deepEqual(learnedIntake.commandSequence, [], "learned intake command path is intentionally empty");
assert.deepEqual(learnedIntake.requiredCommands, [], "learned intake has no required command execution");
assert.ok(learnedIntake.forbiddenUnlessExplicit.includes("booking.create.booking"));
assert.equal(learnedIntake.metadata.execution, "none");
assert.equal(learnedIntake.metadata.approval, "not_granted");
assert.ok(learnedIntake.metadata.questionPolicy.neverInvent.includes("pricing"));
assert.ok(learnedIntake.metadata.interactiveSurfaceTemplate.questions.length >= 8, "booking context intake should expose deterministic setup questions beyond the first three basics");
const learnedIntakeQuestionIds = learnedIntake.metadata.interactiveSurfaceTemplate.questions.map((question) => question.id);
for (const expectedQuestionId of ["q_open_days", "q_operating_hours", "q_table_layout", "q_service_periods", "q_menu_requirements"]) {
  assert.ok(learnedIntakeQuestionIds.includes(expectedQuestionId), `${expectedQuestionId} must be a deterministic booking-intake field, not model-improvised JSON`);
}
assert.ok(learnedIntake.metadata.interactiveSurfaceTemplate.questions.every((question) => question.writesTo?.startsWith("/manifest/")), "all intake answers write only into manifest draft state");
assert.ok(!JSON.stringify(learnedIntake.metadata.interactiveSurfaceTemplate).includes("commitCommand"), "renderer template must not mention command execution");
assert.ok(!JSON.stringify(learnedIntake.metadata.interactiveSurfaceTemplate).includes("executeCommand"), "renderer template must not mention command execution");

const intakeSpec = createInteractiveSurfaceJsonRenderSpec(learnedIntake.metadata.interactiveSurfaceTemplate);
const validation = explorerCatalog.validate(intakeSpec);
assert.equal(validation.success, true, validation.success ? "" : JSON.stringify(validation.errors, null, 2));
assert.ok(Object.values(intakeSpec.elements).some((element) => element.type === "QuestionCard"), "intake template renders through the QuestionCard adapter");
assert.ok(Object.values(intakeSpec.elements).some((element) => element.type === "ManifestPreview"), "intake template renders a manifest preview");

for (const skillId of ["booking.event.create", "amplify.campaign.template.create"]) {
  const learnedIntakeWorkflow = learnRuntimeSkill({ skillId, aspects: ["description", "examples", "policy", "context", "commands"] });
  assert.equal(learnedIntakeWorkflow.ok, true, `${skillId} can be learned`);
  assert.deepEqual(learnedIntakeWorkflow.commandSequence, [], `${skillId} command path is intentionally empty`);
  assert.deepEqual(learnedIntakeWorkflow.requiredCommands, [], `${skillId} has no required command execution`);
  assert.equal(learnedIntakeWorkflow.metadata.execution, "none");
  assert.equal(learnedIntakeWorkflow.metadata.approval, "not_granted");
  assert.ok(learnedIntakeWorkflow.metadata.questionPolicy.neverInvent.length > 0, `${skillId} teaches non-invention policy`);
  assert.ok(learnedIntakeWorkflow.metadata.interactiveSurfaceTemplate.questions.length >= 3, `${skillId} returns a usable intake question set`);
  assert.ok(learnedIntakeWorkflow.metadata.interactiveSurfaceTemplate.questions.every((question) => question.writesTo?.startsWith("/manifest/")), `${skillId} answers write only into manifest draft state`);
  assert.ok(!JSON.stringify(learnedIntakeWorkflow.metadata.interactiveSurfaceTemplate).includes("commitCommand"), `${skillId} renderer template must not mention command execution`);
  assert.ok(!JSON.stringify(learnedIntakeWorkflow.metadata.interactiveSurfaceTemplate).includes("executeCommand"), `${skillId} renderer template must not mention command execution`);
  const spec = createInteractiveSurfaceJsonRenderSpec(learnedIntakeWorkflow.metadata.interactiveSurfaceTemplate);
  const specValidation = explorerCatalog.validate(spec);
  assert.equal(specValidation.success, true, specValidation.success ? "" : JSON.stringify(specValidation.errors, null, 2));
  assert.ok(Object.values(spec.elements).some((element) => element.type === "QuestionCard"), `${skillId} template renders through the QuestionCard adapter`);
  assert.ok(Object.values(spec.elements).some((element) => element.type === "ManifestPreview"), `${skillId} template renders a manifest preview`);
}

const tools = createSkillCatalogTools({
  sessionId: "session_skill_test",
  pageContext,
  hostSession: {
    source: "amplify-embedded",
    sessionId: "session_skill_test",
    userId: "user_skill_test",
    principalId: "user_skill_test",
    organizationId: pageContext.organizationId,
    authenticated: true,
    scopes: pageContext.scopes,
    metadata: {},
  },
});
const toolSearch = await tools.searchSkillCatalog.execute({ query: "book tee time", limit: 5 });
assert.equal(toolSearch.kind, "skill-catalog-search");
assert.equal(toolSearch.skills[0].id, "booking.reservation.create");

const toolLearn = await tools.learnSkill.execute({ skillId: "booking.reservation.create", aspects: ["workflow", "commands", "policy"] });
assert.equal(toolLearn.kind, "skill-learn");
assert.equal(toolLearn.ok, true);
assert.deepEqual(toolLearn.commandSequence, ["booking.get.availability", "booking.create.guest", "booking.create.booking"]);

const intakeTools = createSkillCatalogTools({
  sessionId: "session_intake_skill_test",
  pageContext: intakePageContext,
  hostSession: {
    source: "booking-embedded",
    sessionId: "session_intake_skill_test",
    userId: "user_intake_test",
    principalId: "user_intake_test",
    organizationId: intakePageContext.organizationId,
    authenticated: true,
    scopes: intakePageContext.scopes,
    metadata: {},
  },
});
const toolSearchIntake = await intakeTools.searchSkillCatalog.execute({ query: "create booking context", limit: 5 });
assert.equal(toolSearchIntake.kind, "skill-catalog-search");
assert.equal(toolSearchIntake.skills[0].id, "booking.context.intake");
const toolLearnIntake = await intakeTools.learnSkill.execute({ skillId: "booking.context.intake", aspects: ["policy", "context", "commands"] });
assert.equal(toolLearnIntake.kind, "skill-learn");
assert.equal(toolLearnIntake.ok, true);
assert.deepEqual(toolLearnIntake.commandSequence, []);
assert.equal(toolLearnIntake.metadata.execution, "none");
assert.equal(toolLearnIntake.metadata.interactiveSurfaceTemplate.kind, "question_group");

const eventTools = createSkillCatalogTools({
  sessionId: "session_event_skill_test",
  pageContext: eventPageContext,
  hostSession: {
    source: "booking-embedded",
    sessionId: "session_event_skill_test",
    userId: "user_event_test",
    principalId: "user_event_test",
    organizationId: eventPageContext.organizationId,
    authenticated: true,
    scopes: eventPageContext.scopes,
    metadata: {},
  },
});
const toolSearchEvent = await eventTools.searchSkillCatalog.execute({ query: "create event", limit: 5 });
assert.equal(toolSearchEvent.kind, "skill-catalog-search");
assert.equal(toolSearchEvent.skills[0].id, "booking.event.create");
const toolLearnEvent = await eventTools.learnSkill.execute({ skillId: "booking.event.create", aspects: ["policy", "context", "commands"] });
assert.equal(toolLearnEvent.kind, "skill-learn");
assert.equal(toolLearnEvent.ok, true);
assert.deepEqual(toolLearnEvent.commandSequence, []);
assert.equal(toolLearnEvent.metadata.execution, "none");
assert.equal(toolLearnEvent.metadata.interactiveSurfaceTemplate.kind, "question_group");

const campaignTools = createSkillCatalogTools({
  sessionId: "session_campaign_skill_test",
  pageContext: campaignPageContext,
  hostSession: {
    source: "amplify-embedded",
    sessionId: "session_campaign_skill_test",
    userId: "user_campaign_test",
    principalId: "user_campaign_test",
    organizationId: campaignPageContext.organizationId,
    authenticated: true,
    scopes: campaignPageContext.scopes,
    metadata: {},
  },
});
const toolSearchCampaign = await campaignTools.searchSkillCatalog.execute({ query: "create campaign template", limit: 5 });
assert.equal(toolSearchCampaign.kind, "skill-catalog-search");
assert.equal(toolSearchCampaign.skills[0].id, "amplify.campaign.template.create");
const toolLearnCampaign = await campaignTools.learnSkill.execute({ skillId: "amplify.campaign.template.create", aspects: ["policy", "context", "commands"] });
assert.equal(toolLearnCampaign.kind, "skill-learn");
assert.equal(toolLearnCampaign.ok, true);
assert.deepEqual(toolLearnCampaign.commandSequence, []);
assert.equal(toolLearnCampaign.metadata.execution, "none");
assert.equal(toolLearnCampaign.metadata.interactiveSurfaceTemplate.kind, "question_group");

const agentSource = await readFile("apps/standalone-sveltekit/src/lib/agent.ts", "utf8");
const agentPromptSource = await readFile("apps/standalone-sveltekit/src/lib/agent-prompt.ts", "utf8");
assert.equal(agentSource.includes("createSkillCatalogTools"), true, "agent runtime mounts skill catalog tools");
assert.equal(agentPromptSource.includes("searchSkillCatalog/learnSkill"), true, "base prompt teaches workflow discovery before command execution");

const generateSource = await readFile("apps/standalone-sveltekit/src/routes/api/generate/+server.ts", "utf8");
assert.equal(generateSource.includes("CONTEXT-RELEVANT SKILL STARTUP INDEX"), true, "generate route injects compact skill startup context");
assert.equal(generateSource.includes("api.generate.skill_index_context"), true, "generate route emits skill-index telemetry");

console.log(JSON.stringify({
  ok: true,
  skillIds: catalog.skills.map((entry) => entry.id),
  reservationCommandSequence: reservationSkill.commandSequence,
  intakeQuestionCount: learnedIntake.metadata.interactiveSurfaceTemplate.questions.length,
}));
