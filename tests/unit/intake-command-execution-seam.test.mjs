import assert from "node:assert/strict";

const [intakeModule, contextIntakeModule, artifactStateModule, skillIntentModule, skillRegistryModule] = await Promise.all([
  import("../../apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/booking-workflows/context-intake.ts"),
  import("../../apps/standalone-sveltekit/src/lib/tools/artifact-state.ts"),
  import("../../apps/standalone-sveltekit/src/lib/runtime-skill-intent.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/skill-registry.ts"),
]);

const { createIntakeArtifact, updateIntakeArtifactState } = intakeModule;
const { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE } = contextIntakeModule;
const { createArtifactStateTools } = artifactStateModule;
const { resolveImplicitWorkflowSkillIds } = skillIntentModule;
const { learnRuntimeSkill } = skillRegistryModule;

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

const previewOnlyTools = createArtifactStateTools({ sessionId, pageContext, allowIntakeCommandCommit: false });
assert.equal(typeof previewOnlyTools.readActiveArtifactState.execute, "function");
assert.equal(typeof previewOnlyTools.previewActiveIntakeCommand.execute, "function");
assert.equal(previewOnlyTools.commitActiveIntakeCommand, undefined, "preview-only intake mode must not mount the commit tool");

const readReceipt = await previewOnlyTools.readActiveArtifactState.execute({});
assert.equal(readReceipt.ok, true);
assert.equal(readReceipt.artifact.id, artifactId);
assert.equal(readReceipt.manifest.inventory.coreDescription, "Restaurant reservations with 20 two-top tables");

const preview = await previewOnlyTools.previewActiveIntakeCommand.execute({});
assert.equal(preview.ok, true);
assert.equal(preview.command.commandId, "booking.create.context");
assert.equal(preview.command.input.kind, "venue_schedule");
assert.equal(preview.command.input.timezone, "America/New_York");
assert.equal(preview.command.input.config.manifest.inventory.confirmationMode, "instant_confirm");

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

const unapprovedTools = createArtifactStateTools({
  sessionId,
  pageContext,
  allowIntakeCommandCommit: true,
  approvedCommandIds: [],
  bookingServiceBaseUrl: "https://booking.example.test",
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
