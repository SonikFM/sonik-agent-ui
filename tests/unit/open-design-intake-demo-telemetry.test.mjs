import assert from "node:assert/strict";

const [intakeModule, skillToolsModule, storeModule] = await Promise.all([
  import("../../apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts"),
  import("../../apps/standalone-sveltekit/src/lib/tools/skill-catalog.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/workspace-request-store.ts"),
]);

const {
  createIntakeArtifact,
  recordIntakeQuestionAsked,
  updateIntakeArtifactState,
  validateIntakeManifest,
  exportIntakeManifest,
} = intakeModule;
const { createSkillCatalogTools } = skillToolsModule;
const { listRequestWorkspaceArtifactVersions, listRequestWorkspaceTelemetryEvents } = storeModule;

const runId = Date.now();
const sessionId = `session-open-design-intake-demo-${runId}`;
const artifactId = `artifact-booking-context-intake-demo-${runId}`;
const organizationId = "11111111-1111-4111-8111-111111111111";
const sourceCopy = [
  "Pine Ridge Country Club offers member tee times every 10 minutes from 7am to 6pm.",
  "Private dining rooms can be requested for member dinners and corporate events.",
  "Staff should confirm any private dining policy before publishing cancellation rules.",
].join(" ");

const pageContext = {
  route: "/booking/contexts/new",
  surface: "booking-console",
  pageType: "booking-context",
  activeEntity: { type: "booking-context", id: "ctx_pine_ridge_draft", label: "Pine Ridge Country Club" },
  commandFamilies: ["booking", "booking-contexts"],
  skillFamilies: ["booking-context-intake"],
  visibleActions: ["create-booking-context-intake", "validate-manifest"],
  authenticated: true,
  organizationId,
  scopes: ["booking:read"],
};

const hostSession = {
  source: "booking-embedded",
  sessionId,
  userId: "user_open_design_intake_demo",
  principalId: "user_open_design_intake_demo",
  organizationId,
  authenticated: true,
  scopes: pageContext.scopes,
  metadata: { test: "open-design-intake-demo" },
};

const tools = createSkillCatalogTools({ sessionId, pageContext, hostSession });
const skillSearch = await tools.searchSkillCatalog.execute({ query: "create booking context", limit: 5 });
assert.equal(skillSearch.kind, "skill-catalog-search");
assert.equal(skillSearch.skills[0]?.id, "booking.context.intake", "page-scoped search should select booking.context.intake");

const learned = await tools.learnSkill.execute({ skillId: "booking.context.intake", aspects: ["workflow", "policy", "context", "commands"] });
assert.equal(learned.kind, "skill-learn");
assert.equal(learned.ok, true);
assert.deepEqual(learned.commandSequence, [], "intake skill is preview/manifest work, not command execution");
assert.equal(learned.metadata.execution, "none");
assert.equal(learned.metadata.approval, "not_granted");
assert.ok(learned.metadata.interactiveSurfaceTemplate.questions.some((question) => question.id === "q_intake_mode"));
for (const expectedQuestionId of ["q_open_days", "q_operating_hours", "q_table_layout", "q_service_periods", "q_menu_requirements"]) {
  assert.ok(learned.metadata.interactiveSurfaceTemplate.questions.some((question) => question.id === expectedQuestionId), `${expectedQuestionId} should be available before the model asks for schedule/table/menu setup`);
}

const surface = structuredClone(learned.metadata.interactiveSurfaceTemplate);
surface.artifactId = artifactId;
surface.state = {
  ...surface.state,
  sourceMaterials: [{ kind: "raw_copy", content: sourceCopy, source: "manual-paste" }],
  analysis: {
    inferredFields: {
      businessName: { value: "Pine Ridge Country Club", confidence: 0.91, source: "manual-paste" },
      scheduleHint: { value: "tee times every 10 minutes from 7am to 6pm", confidence: 0.87, source: "manual-paste" },
    },
    missingFields: ["confirmation_mode", "policy_confirmation"],
  },
};

const created = await createIntakeArtifact(null, {
  sessionId,
  artifactId,
  title: "Pine Ridge Booking Context Intake",
  surface,
  requestId: "req-open-design-intake-create",
});
assert.equal(created.id, artifactId);
assert.equal(created.version, 1);
assert.equal(created.content.state.sourceMaterials[0].content, sourceCopy, "source copy is persisted inside the intake artifact state");
assert.equal(created.content.state.analysis.inferredFields.businessName.value, "Pine Ridge Country Club");

const askedMode = await recordIntakeQuestionAsked(null, {
  artifactId,
  questionId: "q_intake_mode",
  requestId: "req-open-design-intake-ask-mode",
});
assert.equal(askedMode.question.id, "q_intake_mode");
assert.equal(askedMode.execution, "none");

await updateIntakeArtifactState(null, {
  artifactId,
  submission: { questionId: "q_intake_mode", value: "venue_schedule" },
  requestId: "req-open-design-intake-answer-mode",
});

const askedInventory = await recordIntakeQuestionAsked(null, {
  artifactId,
  questionId: "q_inventory_core",
  requestId: "req-open-design-intake-ask-inventory",
});
assert.equal(askedInventory.question.id, "q_inventory_core");

await updateIntakeArtifactState(null, {
  artifactId,
  submission: { questionId: "q_inventory_core", value: "Member tee times every 10 minutes plus private dining reservation requests" },
  requestId: "req-open-design-intake-answer-inventory",
});
await updateIntakeArtifactState(null, {
  artifactId,
  submission: { questionId: "q_open_days", value: ["tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] },
  requestId: "req-open-design-intake-answer-open-days",
});
await updateIntakeArtifactState(null, {
  artifactId,
  submission: { questionId: "q_operating_hours", value: "Tuesday through Sunday, 9am to 5pm" },
  requestId: "req-open-design-intake-answer-hours",
});
await updateIntakeArtifactState(null, {
  artifactId,
  submission: { questionId: "q_table_layout", value: "Tables 1-10 are 2-tops, 11-20 are 4-tops, and 21-25 are 6-tops" },
  requestId: "req-open-design-intake-answer-table-layout",
});
await updateIntakeArtifactState(null, {
  artifactId,
  submission: { questionId: "q_service_periods", value: "Breakfast 9-11, lunch 11-4, dinner 4-5; each service period needs a separate menu" },
  requestId: "req-open-design-intake-answer-service-periods",
});
await updateIntakeArtifactState(null, {
  artifactId,
  submission: { questionId: "q_menu_requirements", value: ["breakfast", "lunch", "dinner"] },
  requestId: "req-open-design-intake-answer-menus",
});
await updateIntakeArtifactState(null, {
  artifactId,
  submission: { questionId: "q_confirmation_mode", value: "instant_confirm" },
  requestId: "req-open-design-intake-answer-confirmation",
});

const validation = await validateIntakeManifest(null, { artifactId, requestId: "req-open-design-intake-validate" });
assert.equal(validation.validation.ok, true, JSON.stringify(validation.validation.blockingItems));
assert.equal(validation.validation.manifestType, "venue_schedule");
assert.equal(validation.manifest.intakeMode, "venue_schedule");
assert.equal(validation.manifest.inventory.coreDescription, "Member tee times every 10 minutes plus private dining reservation requests");
assert.deepEqual(validation.manifest.schedule.openDays, ["tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
assert.equal(validation.manifest.schedule.operatingHoursDescription, "Tuesday through Sunday, 9am to 5pm");
assert.equal(validation.manifest.inventory.tableLayoutDescription, "Tables 1-10 are 2-tops, 11-20 are 4-tops, and 21-25 are 6-tops");
assert.equal(validation.manifest.schedule.servicePeriodsDescription, "Breakfast 9-11, lunch 11-4, dinner 4-5; each service period needs a separate menu");
assert.deepEqual(validation.manifest.menus.required, ["breakfast", "lunch", "dinner"]);
assert.equal(validation.commandPreview[0].commandId, "booking.create.context");
assert.equal(validation.commandPreview[0].mode, "preview_only");
assert.equal(validation.execution, "none");
assert.equal(validation.approval, "not_granted");

const exported = await exportIntakeManifest(null, {
  artifactId,
  requestId: "req-open-design-intake-export",
  exportedAt: "2026-07-01T00:00:00.000Z",
});
assert.equal(exported.exportPayload.execution, "none");
assert.equal(exported.exportPayload.approval, "not_granted");
assert.equal(exported.exportPayload.manifest.status, "exported");
assert.equal(exported.exportPayload.commandPreview[0].commandId, "booking.create.context");

const versions = await listRequestWorkspaceArtifactVersions(null, artifactId);
const versionNumbers = versions.map((version) => version.version_number);
assert.equal(versionNumbers.length, 9, "deterministic intake answers should produce durable artifact versions");
assert.deepEqual(versionNumbers, [9, 8, 7, 6, 5, 4, 3, 2, 1], "artifact versions should remain latest-first and preserve every answer update");

const telemetry = await listRequestWorkspaceTelemetryEvents(null, sessionId);
const events = telemetry.map((event) => event.event);
const requiredEvents = [
  "tool.searchSkillCatalog",
  "tool.learnSkill",
  "tool.askUserQuestion",
  "tool.submitQuestionAnswer",
  "artifact.intake.created",
  "artifact.intake.version_created",
  "manifest.validated",
  "command.previewed",
];
for (const eventName of requiredEvents) {
  assert.equal(events.includes(eventName), true, `missing telemetry event ${eventName}: ${events.join(", ")}`);
}
assert.equal(telemetry.some((event) => event.event === "command.previewed" && event.payload?.commandPreview?.[0]?.mode === "preview_only"), true, "command preview telemetry must prove no live booking mutation occurred");
assert.equal(telemetry.some((event) => event.event === "tool.askUserQuestion" && event.payload?.execution === "none"), true, "ask-user telemetry must be non-executing");

console.log("open design intake demo telemetry tests passed");
