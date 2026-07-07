import assert from "node:assert/strict";

const [intakeModule, eventModule, campaignModule, storeModule, contractsModule] = await Promise.all([
  import("../../apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/booking-workflows/event-create.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/amplify-workflows/campaign-template-create.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/workspace-request-store.ts"),
  import("../../packages/tool-contracts/src/index.ts"),
]);

const {
  createIntakeArtifact,
  updateIntakeArtifactState,
  validateIntakeManifest,
  exportIntakeManifest,
} = intakeModule;
const { BOOKING_EVENT_CREATE_SURFACE_TEMPLATE } = eventModule;
const { AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_SURFACE_TEMPLATE } = campaignModule;
const { listRequestWorkspaceArtifactVersions, listRequestWorkspaceTelemetryEvents } = storeModule;
const { validateIntakeManifest: validateManifestContract, exportIntakeManifestPayload } = contractsModule;

const sessionId = `session-intake-${Date.now()}`;
const eventArtifactId = `artifact-event-intake-${Date.now()}`;

const created = await createIntakeArtifact(null, {
  sessionId,
  artifactId: eventArtifactId,
  title: "Event Intake Test",
  surface: { ...BOOKING_EVENT_CREATE_SURFACE_TEMPLATE, artifactId: eventArtifactId },
  requestId: "req-intake-create",
});
assert.equal(created.id, eventArtifactId);
assert.equal(created.version, 1);
assert.equal(created.kind, "json-render");

const firstValidation = await validateIntakeManifest(null, { artifactId: eventArtifactId, requestId: "req-intake-validate-1" });
assert.equal(firstValidation.validation.ok, false, "empty event manifest should not validate");
assert.deepEqual(firstValidation.commandPreview.map((preview) => preview.mode), ["preview_only"]);
assert.deepEqual(firstValidation.commandPreview.map((preview) => preview.approval), ["required"]);
assert.equal(firstValidation.execution, "none");
assert.equal(firstValidation.approval, "not_granted");

const titleQuestion = BOOKING_EVENT_CREATE_SURFACE_TEMPLATE.questions.find((question) => question.id === "q_event_title");
const timeQuestion = BOOKING_EVENT_CREATE_SURFACE_TEMPLATE.questions.find((question) => question.id === "q_event_time");
const inventoryQuestion = BOOKING_EVENT_CREATE_SURFACE_TEMPLATE.questions.find((question) => question.id === "q_event_inventory");
assert.ok(titleQuestion && timeQuestion && inventoryQuestion);

await updateIntakeArtifactState(null, {
  artifactId: eventArtifactId,
  question: { ...titleQuestion, writesTo: "/manifest/event/startsAt" },
  submission: { questionId: "q_event_title", value: "Summer Jazz Night", writesTo: "/manifest/event/startsAt" },
  requestId: "req-intake-answer-title",
});

const secondValidation = await validateIntakeManifest(null, { artifactId: eventArtifactId, requestId: "req-intake-validate-2" });
assert.equal(secondValidation.validation.ok, false, "latest version should include title but still fail on remaining fields");
assert.equal(secondValidation.manifest.event.title, "Summer Jazz Night", "validation must read latest persisted artifact version, not stale creation state");
assert.equal(secondValidation.manifest.event.startsAt, undefined, "caller-supplied forged writesTo must not override persisted question contract");
assert.equal(secondValidation.version.version_number, 2);

await updateIntakeArtifactState(null, {
  artifactId: eventArtifactId,
  question: timeQuestion,
  submission: { questionId: "q_event_time", value: "2026-07-04T20:00:00-04:00" },
  requestId: "req-intake-answer-time",
});
await updateIntakeArtifactState(null, {
  artifactId: eventArtifactId,
  question: inventoryQuestion,
  submission: { questionId: "q_event_inventory", value: "General admission tickets and VIP tables" },
  requestId: "req-intake-answer-inventory",
});

const finalValidation = await validateIntakeManifest(null, { artifactId: eventArtifactId, requestId: "req-intake-validate-final" });
assert.equal(finalValidation.validation.ok, true);
assert.equal(finalValidation.validation.manifestType, "event");
assert.equal(finalValidation.manifest.event.title, "Summer Jazz Night");
assert.equal(finalValidation.manifest.event.startsAt, "2026-07-04T20:00:00-04:00");
assert.equal(finalValidation.manifest.inventory.coreDescription, "General admission tickets and VIP tables");
assert.equal(finalValidation.commandPreview[0].commandId, "booking.create.event");
assert.equal(finalValidation.commandPreview[0].mode, "preview_only");

const exported = await exportIntakeManifest(null, { artifactId: eventArtifactId, requestId: "req-intake-export", exportedAt: "2026-07-01T00:00:00.000Z" });
assert.equal(exported.exportPayload.version, "sonik-agent-ui.intake-manifest-export.v1");
assert.equal(exported.exportPayload.exportedAt, "2026-07-01T00:00:00.000Z");
assert.equal(exported.exportPayload.execution, "none");
assert.equal(exported.exportPayload.approval, "not_granted");
assert.equal(exported.exportPayload.manifest.status, "exported");

const versions = await listRequestWorkspaceArtifactVersions(null, eventArtifactId);
assert.deepEqual(versions.map((version) => version.version_number), [4, 3, 2, 1]);

const telemetry = await listRequestWorkspaceTelemetryEvents(null, sessionId);
const eventNames = telemetry.map((event) => event.event);
assert.equal(eventNames.includes("artifact.intake.created"), true);
assert.equal(eventNames.includes("artifact.intake.version_created"), true);
assert.equal(eventNames.includes("tool.submitQuestionAnswer"), true);
assert.equal(eventNames.includes("manifest.validated"), true);
assert.equal(eventNames.includes("command.previewed"), true);

const campaignArtifact = await createIntakeArtifact(null, {
  sessionId,
  artifactId: `artifact-campaign-intake-${Date.now()}`,
  surface: AMPLIFY_CAMPAIGN_TEMPLATE_CREATE_SURFACE_TEMPLATE,
});
const campaignValidation = await validateIntakeManifest(null, { artifactId: campaignArtifact.id });
assert.equal(campaignValidation.validation.manifestType, "amplify_campaign_template");
assert.equal(campaignValidation.commandPreview[0].commandId, "amplify.create.campaign.template");

const invalidContract = validateManifestContract({ manifestType: "event", status: "draft", source: {} });
assert.equal(invalidContract.ok, false);
assert.equal(invalidContract.blockingItems.some((issue) => issue.path === "/event/title"), true);

const malformedContract = validateManifestContract({
  manifestType: "event",
  status: "draft",
  source: {},
  event: { title: "Bad Event", startsAt: { not: "a date" } },
  inventory: { coreDescription: { not: "text" } },
});
assert.equal(malformedContract.ok, false, "malformed required fields must not validate");
assert.equal(malformedContract.blockingItems.some((issue) => issue.code === "invalid_event_start"), true);
assert.equal(malformedContract.blockingItems.some((issue) => issue.code === "invalid_event_inventory"), true);
assert.throws(() => exportIntakeManifestPayload({
  manifestType: "event",
  status: "validated",
  source: {},
  event: { title: "Bad Event", startsAt: { not: "a date" } },
  inventory: { coreDescription: "Tickets" },
}), /Cannot export invalid intake manifest/);

const validContract = validateManifestContract({
  manifestType: "amplify_campaign_template",
  status: "draft",
  source: { skill: "amplify.campaign.template.create" },
  campaign: { goal: "booking_completed" },
  audience: { description: "Members in NYC" },
  channels: ["email"],
});
assert.equal(validContract.ok, true);
assert.equal(validContract.commandPreview[0].mode, "preview_only");

const exportPayload = exportIntakeManifestPayload({
  manifestType: "venue_schedule",
  status: "validated",
  source: { skill: "booking.context.intake" },
  intakeMode: "venue_schedule",
  inventory: { coreDescription: "Tee times", confirmationMode: "instant_confirm" },
}, { exportedAt: "2026-07-01T00:00:00.000Z" });
assert.equal(exportPayload.manifest.status, "exported");
assert.equal(exportPayload.commandPreview[0].commandId, "booking.create.context");

console.log("intake artifact persistence tests passed");
