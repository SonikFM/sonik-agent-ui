import assert from "node:assert/strict";

const [
  intakeModule,
  contextIntakeModule,
  storeModule,
  controllerModule,
  contractsModule,
  answerLoopModule,
  skillRegistryModule,
] = await Promise.all([
  import("../../apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/booking-workflows/context-intake.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/workspace-request-store.ts"),
  import("../../apps/standalone-sveltekit/src/lib/render/json-render-state-controller.ts"),
  import("../../packages/tool-contracts/src/index.ts"),
  import("../../apps/standalone-sveltekit/src/lib/render/question-answer-loop.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/skill-registry.ts"),
]);

const { createIntakeArtifact } = intakeModule;
const { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE } = contextIntakeModule;
const { listRequestWorkspaceArtifactVersions, updateRequestWorkspaceArtifact } = storeModule;
const { applyJsonRenderStateChanges } = controllerModule;
const { createQuestionAnswerStateUpdates } = contractsModule;
const {
  createQuestionAnswerTurnPayload,
  parseQuestionAnswerTurnPayload,
  serializeQuestionAnswerTurnMessage,
} = answerLoopModule;
const { resolveRuntimeSkillPromptModules } = skillRegistryModule;

const sessionId = `session-question-answer-loop-${Date.now()}`;
const artifactId = `artifact-question-answer-loop-${Date.now()}`;

const created = await createIntakeArtifact(null, {
  sessionId,
  artifactId,
  title: "Question Answer Loop Test",
  surface: { ...BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE, artifactId },
  requestId: "req-question-answer-loop-create",
});

const firstQuestion = BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE.questions[0];
const nextQuestion = BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE.questions[1];
assert.ok(firstQuestion, "test fixture should include a first intake question");
assert.ok(nextQuestion, "test fixture should include a next intake question");

const answerState = createQuestionAnswerStateUpdates(firstQuestion, {
  questionId: firstQuestion.id,
  value: "venue_schedule",
  artifactId,
  sessionId,
}, { now: "2026-07-02T14:00:00.000Z" });
assert.equal(answerState.ok, true, "programmatic answer should validate against the real question contract");

const answeredContent = applyJsonRenderStateChanges(created.content, answerState.updates);
const persisted = await updateRequestWorkspaceArtifact(null, artifactId, {
  content: answeredContent,
  source: "user",
  summary: `Saved answer for ${firstQuestion.id}`,
});
assert.ok(persisted, "artifact state patch should persist a new artifact version");
assert.equal(persisted.version, 2, "answer persistence should create artifact version 2");
assert.equal(persisted.content.state.manifest.intakeMode, "venue_schedule", "writesTo path should patch the manifest draft");

const versions = await listRequestWorkspaceArtifactVersions(null, artifactId);
assert.deepEqual(versions.map((version) => version.version_number), [2, 1], "artifact versions should include the answer version and original version");

const payload = createQuestionAnswerTurnPayload({
  actionParams: { submission: answerState.submission },
  artifactId: persisted.id,
  artifactVersion: persisted.version,
  sessionId,
});
const turnText = serializeQuestionAnswerTurnMessage(payload);
const parsedPayload = parseQuestionAnswerTurnPayload(turnText);
assert.equal(parsedPayload?.entryFrom, "question_answer");
assert.equal(parsedPayload?.submission.questionId, firstQuestion.id);
assert.equal(parsedPayload?.answer.value, "venue_schedule");
assert.equal(parsedPayload?.answer.writesTo, "/manifest/intakeMode");
assert.equal(parsedPayload?.artifact.version, 2, "generate turn should reference the persisted answer version");

const generateRequest = {
  messages: [{ role: "user", parts: [{ type: "text", text: turnText }] }],
  analyticsHints: { entryFrom: "question_answer", turnIndex: 1, isFirstRun: false, hasExistingArtifact: true },
};
assert.equal(generateRequest.analyticsHints.entryFrom, "question_answer", "generate request should carry question_answer analytics entry point");
assert.equal(generateRequest.messages[0].parts[0].text.includes("```sonik_question_answer"), true, "generate request should carry a machine-readable answer block");

const nextQuestionElement = Object.values(persisted.content.elements).find((element) => element.type === "QuestionCard" && element.props?.questionId === nextQuestion.id);
assert.ok(nextQuestionElement, "the next intake question should still render from the persisted artifact");
assert.equal(persisted.content.state.questionStates[nextQuestion.id], "draft", "next question should remain available for the next agent turn");

const [intakeSkillPrompt] = resolveRuntimeSkillPromptModules(["booking.context.intake"]);
assert.ok(intakeSkillPrompt?.body.includes("sonik_question_answer"), "intake skill prompt should explain how to consume answer turns");
assert.ok(intakeSkillPrompt?.body.includes("ask the next highest-impact missing question"), "intake skill prompt should direct the agent to continue the question loop");
assert.ok(intakeSkillPrompt?.body.includes("Do not execute commands"), "answer turns must not imply write approval");

// Deterministic routing invariant: every QuestionCard's submit/skip action must
// read its answer value from the exact state pointer the card binds to.
// A divergent pointer submits null forever (the "Continue does nothing" bug).
for (const element of Object.values(created.content.elements)) {
  if (element?.type !== "QuestionCard") continue;
  const boundPointer = element.props?.value?.$bindState;
  assert.ok(typeof boundPointer === "string" && boundPointer.startsWith("/draftAnswers/"), "QuestionCard value must bind a /draftAnswers pointer");
  for (const trigger of ["submit", "skip"]) {
    const action = element.on?.[trigger];
    assert.equal(action?.action, "submitAnswer", `QuestionCard ${trigger} must route to submitAnswer`);
    assert.equal(action?.params?.value?.$state, boundPointer, `QuestionCard ${trigger} must submit the same pointer the card binds (${boundPointer})`);
    assert.ok(!("submission" in (action?.params ?? {})), `QuestionCard ${trigger} must not carry dead submission indirection`);
  }
  const pointerKey = boundPointer.slice("/draftAnswers/".length);
  assert.ok(pointerKey in created.content.state.draftAnswers, "bound pointer must resolve into initialized draftAnswers state");
}

console.log("question-answer loop tests passed");
