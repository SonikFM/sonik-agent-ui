import assert from "node:assert/strict";

const [fsModule, intakeModule, contextIntakeModule, artifactStateModule, intakeToolModule, skillIntentModule, skillRegistryModule, workspaceStoreModule, commandFamilyModule] = await Promise.all([
  import("node:fs"),
  import("../../apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/booking-workflows/context-intake.ts"),
  import("../../apps/standalone-sveltekit/src/lib/tools/artifact-state.ts"),
  import("../../apps/standalone-sveltekit/src/lib/tools/intake-artifact.ts"),
  import("../../apps/standalone-sveltekit/src/lib/runtime-skill-intent.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/skill-registry.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/workspace-store.ts"),
  import("../../apps/standalone-sveltekit/src/lib/command-family-mount.ts"),
]);

const { readFileSync } = fsModule;
const { createIntakeArtifact, updateIntakeArtifactState } = intakeModule;
const { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE } = contextIntakeModule;
const { createArtifactStateTools, commitBookingContextIntakeCommand } = artifactStateModule;
const { createSubmitIntakeAnswerTool } = intakeToolModule;
const { resolveImplicitWorkflowSkillIds } = skillIntentModule;
const { learnRuntimeSkill } = skillRegistryModule;
const { resolveCommandFamilyMountDecision } = commandFamilyModule;
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
  ["q_business_name", "Dan's Club"],
]) {
  await updateIntakeArtifactState(null, {
    artifactId,
    submission: { questionId, value, artifactId, sessionId },
    requestId: `req-answer-${questionId}`,
  });
}

// The final answer is recorded through submitIntakeAnswer -- the model-callable chat-answer tool
// -- instead of the QuestionCard/updateIntakeArtifactState path used above, to prove the two
// paths interoperate on the same artifact: the tool must patch the SAME artifact in place (no
// recreate) so the rest of this seam (readActiveArtifactState, previewActiveIntakeCommand,
// commitBookingContextIntakeCommand) keeps working unchanged on the result.
const chatAnswerTool = createSubmitIntakeAnswerTool({ pageContext: { activeArtifactId: artifactId } });
const chatAnswerReceipt = await chatAnswerTool.execute({ questionId: "q_confirmation_mode", value: "instant_confirm" });
assert.equal(chatAnswerReceipt.ok, true, "submitIntakeAnswer must succeed for a valid in-seam chat answer");
assert.equal(chatAnswerReceipt.artifact.id, artifactId, "submitIntakeAnswer must patch the same artifact the QuestionCard path was using, not recreate one");

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

// Draft-only invariant (Slice A, 2026-07-08): commitActiveIntakeCommand is no
// longer a model-callable tool at all -- createArtifactStateTools never mounts
// it, under any context. Publishing runs through commitBookingContextIntakeCommand,
// invoked only by the deterministic /api/intake/commit endpoint (a human click),
// never by the agent's tool set. See command-catalog-tools-booking-runtime.test.mjs
// for the structural invariant closure across every skill combination.
const agentSource = readFileSync(new URL("../../apps/standalone-sveltekit/src/lib/agent.ts", import.meta.url), "utf8");
// booking.context.create turns must not mount the generic executeCommand catalog tools.
// The suppression logic lives in the dependency-free command-family-mount leaf (Slice E) so it
// can be asserted behaviorally instead of by brittle source grep; agent.ts must still WIRE it.
assert.equal(resolveCommandFamilyMountDecision({ skillIds: ["booking.context.create"] }).mounted, false, "booking.context.create turns must not mount the generic executeCommand catalog tools");
assert.ok(agentSource.includes("resolveCommandFamilyMountDecision"), "agent.ts must gate command-catalog tool mounting through the command-family mount decision");
assert.equal(agentSource.includes("allowIntakeCommandCommit"), false, "agent.ts must not thread an intake-commit-tool gate; the model never holds a commit tool");

const previewOnlyTools = createArtifactStateTools({ sessionId, pageContext });
assert.equal(typeof previewOnlyTools.readActiveArtifactState.execute, "function");
assert.equal(typeof previewOnlyTools.previewActiveIntakeCommand.execute, "function");
assert.equal(previewOnlyTools.commitActiveIntakeCommand, undefined, "createArtifactStateTools must never mount a commit tool");
assert.deepEqual(Object.keys(previewOnlyTools).sort(), ["previewActiveIntakeCommand", "readActiveArtifactState"], "the agent's mounted artifact-state tool set is exactly the draft/preview tools, nothing else");

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
assert.equal(preview.command.input.name, "Dan's Club", "business name should drive deterministic booking context preview name");
assert.equal(preview.command.input.slug, "dan-s-club", "business name should drive deterministic booking context slug");

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

const blockedArtifactId = `${artifactId}-blocked-errors`;
await createIntakeArtifact(null, {
  sessionId,
  artifactId: blockedArtifactId,
  title: "Blocked Intake",
  surface: { ...BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE, artifactId: blockedArtifactId },
  requestId: "req-blocked-intake-command-create",
});
for (const [questionId, value] of [
  ["q_intake_mode", "venue_schedule"],
  ["q_business_name", "Dan's Club"],
  ["q_inventory_core", "Restaurant reservations"],
  ["q_confirmation_mode", "instant_confirm"],
]) {
  await updateIntakeArtifactState(null, {
    artifactId: blockedArtifactId,
    submission: { questionId, value, artifactId: blockedArtifactId, sessionId },
    requestId: `req-blocked-answer-${questionId}`,
  });
}
const blockedArtifact = getWorkspaceArtifact(blockedArtifactId);
assert.ok(blockedArtifact, "blocked artifact should exist");
const blockedContent = structuredClone(blockedArtifact.content);
blockedContent.state.questionErrors = { q_open_days: "Answer could not be saved." };
blockedContent.state.questionStates = { ...blockedContent.state.questionStates, q_open_days: "errored" };
updateWorkspaceArtifact(blockedArtifactId, { content: blockedContent });
const blockedTools = createArtifactStateTools({ sessionId, pageContext: { ...pageContext, activeArtifactId: blockedArtifactId } });
const blockedPreview = await blockedTools.previewActiveIntakeCommand.execute({});
assert.equal(blockedPreview.ok, false, "intake previews must block unresolved QuestionCard save errors");
assert.equal(blockedPreview.command, null, "blocked intake previews must not return an approvable command");
assert.equal(blockedPreview.validation.blockingItems.some((issue) => issue.code === "question_answer_error"), true, "blocking items must name unresolved question save errors");

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
const unsupportedPreviewTools = createArtifactStateTools({ sessionId, pageContext: { ...pageContext, activeArtifactId: eventArtifactId } });
const unsupportedPreview = await unsupportedPreviewTools.previewActiveIntakeCommand.execute({});
assert.equal(unsupportedPreview.ok, false, "valid non-venue manifests must not return an approvable booking.create.context preview");
assert.equal(unsupportedPreview.error, "unsupported_manifest_type");
assert.equal(unsupportedPreview.command, null);

// Draft-only invariant: commitBookingContextIntakeCommand is not a model tool.
// It is the deterministic /api/intake/commit endpoint's implementation, called
// directly here (as the endpoint would) instead of through a mounted tool.
const unsupportedCommitFetchCalls = [];
const unsupportedCommitContext = {
  sessionId,
  pageContext: { ...pageContext, activeArtifactId: eventArtifactId },
  approvedCommandIds: ["booking.create.context"],
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "service-token", token: "test-service-token", source: "test" },
  bookingRuntimeFetcher: async (input, init = {}) => {
    unsupportedCommitFetchCalls.push({ url: String(input), method: init.method });
    return new Response("{}", { status: 500, headers: { "content-type": "application/json" } });
  },
};
const unsupportedCommit = await commitBookingContextIntakeCommand(unsupportedCommitContext);
assert.equal(unsupportedCommit.ok, false, "valid non-venue manifests must fail closed before runtime commit");
assert.equal(unsupportedCommit.error, "unsupported_manifest_type");
assert.equal(unsupportedCommit.command, null);
assert.equal(unsupportedCommitFetchCalls.length, 0, "unsupported manifests must not reach the booking runtime");

const fetchCalls = [];
const fetcher = async (input, init = {}) => {
  fetchCalls.push({ url: String(input), method: init.method, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : null });
  return new Response(JSON.stringify({ id: "ctx_dans_joint", name: "Dan's Joint Intake", kind: "venue_schedule" }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
};

const commitContext = {
  sessionId,
  requestId: "intake:artifact-intake-command:v6",
  pageContext,
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
};

const commit = await commitBookingContextIntakeCommand(commitContext);
assert.equal(commit.ok, true, "trusted approved command should commit through runtime");
assert.equal(commit.command.commandId, "booking.create.context");
assert.equal(fetchCalls.length, 1);
assert.equal(fetchCalls[0].method, "POST");
assert.equal(fetchCalls[0].headers.get("x-sonik-idempotency-key"), "intake:artifact-intake-command:v6:booking.create.context", "intake retries must reuse the durable approval idempotency key");
assert.equal(fetchCalls[0].body.kind, "venue_schedule");
assert.equal(fetchCalls[0].body.name, "Dan's Club", "commit should preserve the approved business/context name");
assert.equal(fetchCalls[0].body.slug, "dan-s-club", "commit should preserve the approved business/context slug");
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

const unapprovedContext = {
  sessionId,
  pageContext,
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
};
const denied = await commitBookingContextIntakeCommand(unapprovedContext, artifactId);
assert.equal(denied.ok, false, "user text alone must not bypass trusted approvedCommandIds");
assert.equal(denied.receipt.policy.reasons.includes("approval_required"), true);

// Agent Settings family mode "off" must block the endpoint-side commit even with
// a full trusted host approval grant (closes the hole: this path previously
// never consulted toolPermissionModes at all).
const familyOffContext = {
  sessionId,
  pageContext,
  approvedCommandIds: ["booking.create.context"],
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "service-token", token: "test-service-token", source: "test" },
  bookingRuntimeFetcher: fetcher,
  toolPermissionModes: { booking: "off" },
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
};
const familyOffFetchCallsBefore = fetchCalls.length;
const familyOffDenied = await commitBookingContextIntakeCommand(familyOffContext);
assert.equal(familyOffDenied.ok, false, "Agent Settings family mode off must refuse commitActiveIntakeCommand");
assert.equal(familyOffDenied.receipt.policy.reasons.includes("tool_policy_off"), true, "refusal must name tool_policy_off");
assert.equal(fetchCalls.length, familyOffFetchCallsBefore, "family-disabled commit must not reach the booking runtime");

console.log("intake command execution seam tests passed");
