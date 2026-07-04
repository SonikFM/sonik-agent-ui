import assert from "node:assert/strict";

const [fsModule, intakeModule, contextIntakeModule, artifactStateModule, skillIntentModule, skillRegistryModule, workspaceStoreModule] = await Promise.all([
  import("node:fs"),
  import("../../apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/booking-workflows/context-intake.ts"),
  import("../../apps/standalone-sveltekit/src/lib/tools/artifact-state.ts"),
  import("../../apps/standalone-sveltekit/src/lib/runtime-skill-intent.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/skill-registry.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/workspace-store.ts"),
]);

const { readFileSync } = fsModule;
const { createIntakeArtifact, updateIntakeArtifactState } = intakeModule;
const { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE } = contextIntakeModule;
const { createArtifactStateTools } = artifactStateModule;
const { resolveImplicitWorkflowSkillIds } = skillIntentModule;
const { learnRuntimeSkill } = skillRegistryModule;
const { getWorkspaceArtifact, updateWorkspaceArtifact } = workspaceStoreModule;

const sessionId = `session-intake-command-${Date.now()}`;
const artifactId = `artifact-intake-command-${Date.now()}`;

const created = await createIntakeArtifact(null, {
  sessionId,
  artifactId,
  title: "Dan's Joint Intake",
  surface: { ...BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE, artifactId },
  requestId: "req-intake-command-create",
});

for (const [questionId, value] of [
  ["q_intake_mode", "venue_schedule"],
  ["q_inventory_core", "Restaurant reservations with 20 two-top tables"],
  ["q_confirmation_mode", "instant_confirm"],
]) {
  await updateIntakeArtifactState(null, {
    artifactId,
    submission: { questionId, value, artifactId, sessionId },
    requestId: `req-answer-${questionId}`,
  });
}

const pageContext = {
  surface: "booking-context-intake",
  pageType: "booking-context",
  title: "Dan's Joint Intake",
  activeArtifactId: artifactId,
  commandFamilies: ["booking"],
  skillFamilies: ["booking-context-create"],
};

assert.deepEqual(
  resolveImplicitWorkflowSkillIds({ userMessage: "approve this manifest and create the context", pageContext }),
  ["booking.context.create"],
  "approval/commit turns must switch from preview-only intake to execution skill",
);

const learnedCreate = learnRuntimeSkill({ skillId: "booking.context.create", aspects: ["workflow", "policy", "commands"] });
assert.equal(learnedCreate.ok, true, "booking.context.create must be learnable");
assert.ok(JSON.stringify(learnedCreate).includes("readActiveArtifactState"), "create skill must teach artifact-state read before commit");
assert.ok(JSON.stringify(learnedCreate).includes("Resource/table = inventory inside the context"), "create skill must teach booking ontology guardrails");

const agentSource = readFileSync(new URL("../../apps/standalone-sveltekit/src/lib/agent.ts", import.meta.url), "utf8");
assert.ok(agentSource.includes("allowIntakeCommandCommit: bookingContextCreateActive"), "commitActiveIntakeCommand must mount only for booking.context.create skill turns");
assert.ok(agentSource.includes("previewOnlyRuntimeActive || bookingContextCreateActive"), "booking.context.create turns must not mount the generic executeCommand/commitCommand catalog tools");

const previewOnlyTools = createArtifactStateTools({ sessionId, pageContext, allowIntakeCommandCommit: false });
assert.equal(typeof previewOnlyTools.readActiveArtifactState.execute, "function");
assert.equal(typeof previewOnlyTools.previewActiveIntakeCommand.execute, "function");
assert.equal(previewOnlyTools.commitActiveIntakeCommand, undefined, "preview-only intake mode must not mount the commit tool");

const readReceipt = await previewOnlyTools.readActiveArtifactState.execute({});
assert.equal(readReceipt.ok, true);
assert.equal(readReceipt.artifact.id, artifactId);
assert.equal(readReceipt.manifest.inventory.coreDescription, "Restaurant reservations with 20 two-top tables");

const staleRead = await previewOnlyTools.readActiveArtifactState.execute({ artifactId: `${artifactId}-old` });
assert.equal(staleRead.ok, false, "model-supplied stale artifact ids must not override the active canvas artifact");
assert.equal(staleRead.error, "stale_artifact_selection");

const preview = await previewOnlyTools.previewActiveIntakeCommand.execute({});
assert.equal(preview.ok, true);
assert.equal(preview.command.commandId, "booking.create.context");
assert.equal(preview.command.input.kind, "venue_schedule");
assert.equal(preview.command.input.timezone, "America/New_York");
assert.equal(preview.command.input.config.manifest.inventory.confirmationMode, "instant_confirm");

const activeArtifactBeforeScopePoison = getWorkspaceArtifact(artifactId);
assert.ok(activeArtifactBeforeScopePoison, "active intake artifact should be persisted for scope poisoning regression");
const poisonedContent = structuredClone(activeArtifactBeforeScopePoison.content);
poisonedContent.state.manifest.organizationId = "model_org_should_not_send";
poisonedContent.state.manifest.currentOrgId = "model_current_org_short_should_not_send";
poisonedContent.state.manifest.currentOrganizationId = "model_current_org_should_not_send";
poisonedContent.state.manifest["current-organization-id"] = "kebab_current_org_should_not_send";
poisonedContent.state.manifest.business = { ...poisonedContent.state.manifest.business, principalId: "model_principal_should_not_send", principal_id: "snake_principal_should_not_send", current_org_id: "snake_current_org_should_not_send" };
poisonedContent.state.manifest.inventory = { ...poisonedContent.state.manifest.inventory, nested: { userId: "model_user_should_not_send", "current-user-id": "kebab_user_should_not_send" } };
const poisonedArtifact = updateWorkspaceArtifact(artifactId, { content: poisonedContent });
assert.ok(poisonedArtifact, "scope poisoning fixture should update active artifact");
const sanitizedPreview = await previewOnlyTools.previewActiveIntakeCommand.execute({});
assert.equal(sanitizedPreview.ok, true);
assert.equal("organizationId" in sanitizedPreview.command.input.config.manifest, false, "trusted org scope must be stripped from nested manifest payload before command preview");
assert.equal("currentOrgId" in sanitizedPreview.command.input.config.manifest, false, "trusted current org short scope must be stripped from nested manifest payload before command preview");
assert.equal("currentOrganizationId" in sanitizedPreview.command.input.config.manifest, false, "trusted current org scope must be stripped from nested manifest payload before command preview");
assert.equal("current-organization-id" in sanitizedPreview.command.input.config.manifest, false, "trusted kebab current org scope must be stripped from nested manifest payload before command preview");
assert.equal("principalId" in sanitizedPreview.command.input.config.manifest.business, false, "trusted principal scope must be stripped from nested manifest payload before command preview");
assert.equal("current_org_id" in sanitizedPreview.command.input.config.manifest.business, false, "trusted snake current org scope must be stripped from nested manifest payload before command preview");
assert.equal("principal_id" in sanitizedPreview.command.input.config.manifest.business, false, "trusted snake_case principal scope must be stripped from nested manifest payload before command preview");
assert.equal("userId" in sanitizedPreview.command.input.config.manifest.inventory.nested, false, "trusted user scope must be stripped recursively before command preview");
assert.equal("current-user-id" in sanitizedPreview.command.input.config.manifest.inventory.nested, false, "trusted kebab-case user scope must be stripped recursively before command preview");

const eventContent = structuredClone(poisonedArtifact.content);
eventContent.state.manifest = {
  manifestType: "event",
  status: "draft",
  source: { createdBy: "agent" },
  event: { title: "Sunday Brunch Launch", startsAt: "2026-07-12T14:00:00.000Z" },
  inventory: { coreDescription: "Prix fixe brunch tickets" },
};
const eventArtifactId = `${artifactId}-event`;
await createIntakeArtifact(null, {
  sessionId,
  artifactId: eventArtifactId,
  title: "Event Intake",
  surface: { ...BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE, artifactId: eventArtifactId },
  requestId: "req-event-intake-command-create",
});
updateWorkspaceArtifact(eventArtifactId, { content: eventContent });
const unsupportedPreviewTools = createArtifactStateTools({ sessionId, pageContext: { ...pageContext, activeArtifactId: eventArtifactId }, allowIntakeCommandCommit: false });
const unsupportedPreview = await unsupportedPreviewTools.previewActiveIntakeCommand.execute({});
assert.equal(unsupportedPreview.ok, false, "valid non-venue manifests must not return an approvable booking.create.context preview");
assert.equal(unsupportedPreview.error, "unsupported_manifest_type");
assert.equal(unsupportedPreview.command, null);

const unsupportedCommitFetchCalls = [];
const unsupportedCommitTools = createArtifactStateTools({
  sessionId,
  pageContext: { ...pageContext, activeArtifactId: eventArtifactId },
  allowIntakeCommandCommit: true,
  approvedCommandIds: ["booking.create.context"],
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "service-token", token: "test-service-token", source: "test" },
  bookingRuntimeFetcher: async (input, init = {}) => {
    unsupportedCommitFetchCalls.push({ url: String(input), method: init.method });
    return new Response("{}", { status: 500, headers: { "content-type": "application/json" } });
  },
});
const unsupportedCommit = await unsupportedCommitTools.commitActiveIntakeCommand.execute({ confirmation: "APPROVE_AND_RUN" });
assert.equal(unsupportedCommit.ok, false, "valid non-venue manifests must fail closed before runtime commit");
assert.equal(unsupportedCommit.error, "unsupported_manifest_type");
assert.equal(unsupportedCommit.command, null);
assert.equal(unsupportedCommitFetchCalls.length, 0, "unsupported manifests must not reach the booking runtime");

const fetchCalls = [];
const fetcher = async (input, init = {}) => {
  fetchCalls.push({ url: String(input), method: init.method, body: init.body ? JSON.parse(String(init.body)) : null });
  return new Response(JSON.stringify({ id: "ctx_dans_joint", name: "Dan's Joint Intake", kind: "venue_schedule" }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
};

const commitTools = createArtifactStateTools({
  sessionId,
  pageContext,
  allowIntakeCommandCommit: true,
  approvedCommandIds: ["booking.create.context"],
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "service-token", token: "test-service-token", source: "test" },
  bookingRuntimeFetcher: fetcher,
  hostSession: {
    source: "amplify-embedded",
    sessionId,
    userId: "user_1",
    principalId: "user_1",
    organizationId: "org_1",
    authenticated: true,
    scopes: ["booking:read", "booking:write"],
    expiresAt: null,
    metadata: { approvedCommandIds: ["booking.create.context"] },
  },
});
assert.equal(typeof commitTools.commitActiveIntakeCommand.execute, "function", "execution mode mounts commit seam");

const commit = await commitTools.commitActiveIntakeCommand.execute({ confirmation: "APPROVE_AND_RUN" });
assert.equal(commit.ok, true, "trusted approved command should commit through runtime");
assert.equal(commit.command.commandId, "booking.create.context");
assert.equal(fetchCalls.length, 1);
assert.equal(fetchCalls[0].method, "POST");
assert.equal(fetchCalls[0].body.kind, "venue_schedule");
assert.equal(fetchCalls[0].body.config.manifest.inventory.coreDescription, "Restaurant reservations with 20 two-top tables");
assert.equal("organizationId" in fetchCalls[0].body, false, "org scope must remain host-derived, never model-sent");
assert.equal("organizationId" in fetchCalls[0].body.config.manifest, false, "org scope must also be stripped from nested manifest payloads");
assert.equal("currentOrgId" in fetchCalls[0].body.config.manifest, false, "short current org scope must also be stripped from nested manifest payloads");
assert.equal("currentOrganizationId" in fetchCalls[0].body.config.manifest, false, "current org scope must also be stripped from nested manifest payloads");
assert.equal("current-organization-id" in fetchCalls[0].body.config.manifest, false, "kebab current org scope must also be stripped from nested manifest payloads");
assert.equal("principalId" in fetchCalls[0].body.config.manifest.business, false, "principal scope must be stripped from nested manifest payloads");
assert.equal("current_org_id" in fetchCalls[0].body.config.manifest.business, false, "snake current org scope must be stripped from nested manifest payloads");
assert.equal("principal_id" in fetchCalls[0].body.config.manifest.business, false, "snake_case principal scope must be stripped from nested manifest payloads");
assert.equal("userId" in fetchCalls[0].body.config.manifest.inventory.nested, false, "user scope must be stripped recursively from nested manifest payloads");
assert.equal("current-user-id" in fetchCalls[0].body.config.manifest.inventory.nested, false, "kebab-case user scope must be stripped recursively from nested manifest payloads");

const unapprovedTools = createArtifactStateTools({
  sessionId,
  pageContext,
  allowIntakeCommandCommit: true,
  approvedCommandIds: [],
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "service-token", token: "test-service-token", source: "test" },
  bookingRuntimeFetcher: fetcher,
  hostSession: {
    source: "amplify-embedded",
    sessionId,
    userId: "user_1",
    principalId: "user_1",
    organizationId: "org_1",
    authenticated: true,
    scopes: ["booking:read", "booking:write"],
    expiresAt: null,
    metadata: { approvedCommandIds: [] },
  },
});
const denied = await unapprovedTools.commitActiveIntakeCommand.execute({ artifactId, confirmation: "APPROVE_AND_RUN" });
assert.equal(denied.ok, false, "user text alone must not bypass trusted approvedCommandIds");
assert.equal(denied.receipt.policy.reasons.includes("approval_required"), true);

console.log("intake command execution seam tests passed");
