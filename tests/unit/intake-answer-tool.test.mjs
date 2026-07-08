import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const [
  intakeModule,
  contextIntakeModule,
  storeModule,
  toolModule,
  workflowModule,
] = await Promise.all([
  import("../../apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/booking-workflows/context-intake.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/workspace-request-store.ts"),
  import("../../apps/standalone-sveltekit/src/lib/tools/intake-artifact.ts"),
  import("../../apps/standalone-sveltekit/src/lib/agent-workflows/page-control-workflow.ts"),
]);

const { createIntakeArtifact } = intakeModule;
const { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE } = contextIntakeModule;
const { getRequestWorkspaceArtifact, listRequestWorkspaceArtifactVersions } = storeModule;
const { createSubmitIntakeAnswerTool } = toolModule;
const { createQuestionAnswerStateChanges, createAgentWorkflowSnapshot } = workflowModule;

const sessionId = `session-intake-answer-tool-${Date.now()}`;
const artifactId = `artifact-intake-answer-tool-${Date.now()}`;

const created = await createIntakeArtifact(null, {
  sessionId,
  artifactId,
  title: "Intake Answer Tool Test",
  surface: { ...BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE, artifactId },
  requestId: "req-intake-answer-tool-create",
});
assert.equal(created.id, artifactId);
assert.equal(created.version, 1);
assert.equal(created.content.state.surface.skillId, "booking.context.intake", "fixture artifact must carry the intake marker before the tool ever runs");

const firstQuestion = BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE.questions.find((question) => question.id === "q_intake_mode");
assert.ok(firstQuestion, "test fixture must include q_intake_mode");

// --- 1. The tool must produce the SAME state patch as the UI QuestionCard path for a given
//     {questionId, value}: derive the UI path's expected changes independently via
//     createQuestionAnswerStateChanges (the exact function +page.svelte's submitPageControlQuestionAnswer
//     calls), then diff against what the tool actually persisted.
const uiPathChanges = createQuestionAnswerStateChanges({
  artifact: { id: created.id, title: created.title, kind: created.kind, version: created.version, content: created.content },
  questionId: firstQuestion.id,
  value: "venue_schedule",
  sessionId,
}).changes;
const expectedAnswerChange = uiPathChanges.find((change) => change.path === `/answers/${firstQuestion.id}`);
const expectedStateChange = uiPathChanges.find((change) => change.path === `/questionStates/${firstQuestion.id}`);
assert.equal(expectedAnswerChange?.value, "venue_schedule");
assert.equal(expectedStateChange?.value, "answered");

const tool = createSubmitIntakeAnswerTool({ pageContext: { activeArtifactId: artifactId } });

const answered = await tool.execute({ questionId: firstQuestion.id, value: "venue_schedule" });
assert.equal(answered.ok, true, "submitIntakeAnswer must succeed for a valid question/value pair");
assert.equal(answered.artifact.id, artifactId, "submitIntakeAnswer must target the existing artifact id, never mint a new one");
assert.equal(answered.artifact.version, 2, "submitIntakeAnswer must version-bump the existing artifact, not recreate it");
assert.equal(answered.execution, "none");
assert.equal(answered.approval, "not_granted");

const patchedArtifact = await getRequestWorkspaceArtifact(null, artifactId);
assert.ok(patchedArtifact, "patched artifact must be readable by id after the tool call");
assert.equal(patchedArtifact.id, artifactId, "no second artifact should have been created");
assert.equal(patchedArtifact.content.state.answers[firstQuestion.id], expectedAnswerChange.value, "tool-persisted answer must match the UI path's computed patch");
assert.equal(patchedArtifact.content.state.questionStates[firstQuestion.id], expectedStateChange.value, "tool-persisted question lifecycle must match the UI path's computed patch");

// --- 2. No recreate: exactly one artifact id exists across the whole version chain (2 versions,
//     same id), not a second json-render-tool:* artifact.
const versions = await listRequestWorkspaceArtifactVersions(null, artifactId);
assert.deepEqual(versions.map((version) => version.version_number).sort(), [1, 2]);

// --- 3. The booking.context.intake marker survives the patch, so resolveWorkflowId (via
//     createAgentWorkflowSnapshot) resolves a non-null workflow id and the phase advances off
//     "idle" -- this is the exact demo-breaking symptom from the persona triage.
assert.equal(patchedArtifact.content.state.surface.skillId, "booking.context.intake", "the intake marker must survive a chat-answer patch, not just an artifact recreate");
const snapshot = createAgentWorkflowSnapshot({
  activeArtifact: { id: patchedArtifact.id, title: patchedArtifact.title, kind: patchedArtifact.kind, version: patchedArtifact.version, content: patchedArtifact.content },
  pendingChangeCount: 0,
  isStreaming: false,
  approvalReadiness: { ready: false, visible: true, reason: "Answer the remaining required questions." },
});
assert.equal(snapshot.activeWorkflowId, "booking.context.intake", "resolveWorkflowId must resolve a real workflow id after a chat-answer patch");
assert.notEqual(snapshot.phase, "idle", "phase must advance off idle once the model records a chat answer via submitIntakeAnswer");

// --- 4. An invalid questionId must be rejected, not silently accepted or used to recreate.
const invalidAnswer = await tool.execute({ questionId: "not_a_real_question_id", value: "whatever" });
assert.equal(invalidAnswer.ok, false, "an unknown questionId must be rejected");
assert.equal(invalidAnswer.error, "unknown_question_id");
const versionsAfterInvalid = await listRequestWorkspaceArtifactVersions(null, artifactId);
assert.equal(versionsAfterInvalid.length, 2, "a rejected invalid-questionId call must not create a new version or a new artifact");

// --- 5. Missing/absent active artifact must be rejected rather than silently recreating one.
const noActiveArtifactTool = createSubmitIntakeAnswerTool({ pageContext: {} });
const missingActive = await noActiveArtifactTool.execute({ questionId: firstQuestion.id, value: "venue_schedule" });
assert.equal(missingActive.ok, false, "submitIntakeAnswer must refuse to guess an artifact when none is active");
assert.equal(missingActive.error, "missing_active_artifact");

// A stale model-supplied artifact id that disagrees with the active page-context artifact must
// also be refused (mirrors readActiveArtifactState's stale_artifact_selection guard).
const staleAnswer = await tool.execute({ artifactId: `${artifactId}-stale`, questionId: firstQuestion.id, value: "venue_schedule" });
assert.equal(staleAnswer.ok, false);
assert.equal(staleAnswer.error, "stale_artifact_selection");

// --- 6. Trust/safety invariant: answering a question can never reach command execution. The
//     tool module must not reference the command-commit seam at all, and every successful
//     receipt must explicitly report execution:"none" / approval:"not_granted".
const toolSource = readFileSync(new URL("../../apps/standalone-sveltekit/src/lib/tools/intake-artifact.ts", import.meta.url), "utf8");
assert.equal(toolSource.includes("executeHostCatalogCommand"), false, "submitIntakeAnswer's module must not import/call the command-execution runtime");
assert.equal(toolSource.includes("commitCommand"), false, "submitIntakeAnswer's module must not reference commitCommand");
assert.equal(toolSource.includes("APPROVE_AND_RUN"), false, "submitIntakeAnswer's module must not reference the trusted-commit confirmation literal");
assert.equal(toolSource.includes("approvedCommandIds"), false, "submitIntakeAnswer's module must not consult approval grants -- it is not an approval-gated seam");

console.log("intake answer tool tests passed");
