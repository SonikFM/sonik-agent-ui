import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [
  propSafety,
  intakeModule,
  contextIntakeModule,
  storeModule,
] = await Promise.all([
  import("../../apps/standalone-sveltekit/src/lib/render/component-prop-safety.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/booking-workflows/context-intake.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/workspace-request-store.ts"),
]);

const { createQuestionErrorStatePath, createQuestionLifecycleStatePath } = await import("../../apps/standalone-sveltekit/src/lib/render/question-card-state.ts");
const { applyJsonRenderStateChanges } = await import("../../apps/standalone-sveltekit/src/lib/render/json-render-state-controller.ts");
const questionCardSource = await readFile("apps/standalone-sveltekit/src/lib/render/components/QuestionCard.svelte", "utf8");
assert.equal(questionCardSource.includes("data-question-card"), true, "QuestionCard root should expose a deterministic selector for ultratest");
assert.equal(questionCardSource.includes("data-question-option-value"), true, "QuestionCard options should expose deterministic answer values for ultratest");
assert.equal(questionCardSource.includes('data-question-action="submit"'), true, "QuestionCard submit button should expose a deterministic action selector");
assert.equal(questionCardSource.includes('data-question-action="skip"'), true, "QuestionCard skip button should expose a deterministic action selector");
assert.equal(questionCardSource.includes("Saving answer and asking the next question"), true, "QuestionCard must show a pending-save state instead of pretending persistence already succeeded");
assert.equal(questionCardSource.includes("Answer not saved. Retry this question before continuing."), true, "QuestionCard must expose a retryable failed-save state");
assert.equal(questionCardSource.includes("createQuestionErrorStatePath"), true, "QuestionCard state paths should use the shared JSON Pointer-safe question error helper");
assert.equal(questionCardSource.includes('data-question-action="select-all"'), true, "multi-choice QuestionCards should expose a deterministic select-all control for day/menu selection");
assert.equal(questionCardSource.includes('data-question-action="clear"'), true, "multi-choice QuestionCards should expose a deterministic clear control for day/menu selection");
assert.equal(questionCardSource.includes("stateContext.set(questionErrorPath"), true, "QuestionCard should clear/set escaped question error paths through one derived path");

const unsafeQuestionId = "q/open~days";
assert.equal(createQuestionErrorStatePath(unsafeQuestionId), "/questionErrors/q~1open~0days", "question error state paths should JSON Pointer-escape slash and tilde");
assert.equal(createQuestionLifecycleStatePath(unsafeQuestionId), "/questionStates/q~1open~0days", "question lifecycle state paths should JSON Pointer-escape slash and tilde");
const escapedStateSpec = applyJsonRenderStateChanges({ root: "root", elements: {}, state: {} }, [
  { path: createQuestionErrorStatePath(unsafeQuestionId), value: "Answer could not be saved." },
  { path: createQuestionLifecycleStatePath(unsafeQuestionId), value: "error" },
]);
assert.equal(escapedStateSpec.state.questionErrors[unsafeQuestionId], "Answer could not be saved.", "escaped question error path should write to the original question id key");
assert.equal(escapedStateSpec.state.questionStates[unsafeQuestionId], "error", "escaped question lifecycle path should write to the original question id key");

const { sanitizeChoiceCardsProps, sanitizeQuestionCardProps, formatQuestionSubmitError } = propSafety;
const { createIntakeArtifact, updateIntakeArtifactState } = intakeModule;
const { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE } = contextIntakeModule;
const { listRequestWorkspaceArtifactVersions } = storeModule;

const rawZodText = '[{"origin":"number","code":"too_small","minimum":0,"inclusive":false,"path":["maxSelections"],"message":"Invalid input"}]';
const rawErrorPattern = /too_small|"path"|"origin"|maxSelections/;

const invalidChoiceCards = sanitizeChoiceCardsProps({
  label: "Intake mode",
  mode: "invalid-mode",
  value: ["venue_schedule"],
  options: [
    { value: "venue_schedule", label: "Venue schedule", description: "Recurring inventory." },
    { value: {}, label: "Bad option" },
  ],
});
assert.equal(invalidChoiceCards.props.mode, "single", "invalid ChoiceCards props degrade to single-select");
assert.equal(invalidChoiceCards.props.options.length, 1, "invalid ChoiceCards options are dropped without breaking the component");
assert.equal(invalidChoiceCards.telemetry?.component, "ChoiceCards", "ChoiceCards invalid props emit telemetry metadata");

const invalidQuestion = sanitizeQuestionCardProps({
  questionId: "q_intake_mode",
  title: "What are we configuring?",
  body: "Choose one.",
  answerType: "choice_cards",
  choices: [{ value: "venue_schedule", label: "Venue schedule" }],
  maxSelections: 0,
});
assert.equal(invalidQuestion.props.answerType, "single_choice", "invalid question props degrade to safe single-select");
assert.equal(invalidQuestion.props.maxSelections, undefined, "invalid maxSelections is removed before question validation");
assert.equal(invalidQuestion.telemetry?.component, "QuestionCard", "QuestionCard invalid props emit telemetry metadata");

const formatted = formatQuestionSubmitError(new Error(rawZodText));
assert.equal(formatted.message, "Answer could not be saved. Please review the selected answer.");
assert.equal(rawErrorPattern.test(formatted.message), false, "raw Zod JSON is not formatted for end-user display");
assert.equal(formatted.telemetry?.component, "QuestionCard", "raw validation errors emit telemetry metadata");

const artifactId = `artifact-h3-choicecards-${Date.now()}`;
const created = await createIntakeArtifact(null, {
  sessionId: `session-h3-choicecards-${Date.now()}`,
  artifactId,
  surface: BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE,
});
const latest = (await listRequestWorkspaceArtifactVersions(null, created.id))[0];
const intakeModeQuestion = Object.values(latest.content.elements).find((element) => element.type === "QuestionCard" && element.props.questionId === "q_intake_mode");
assert.equal(intakeModeQuestion?.props.maxSelections, 1, "single-select intake ChoiceCards emit schema-safe maxSelections");

await updateIntakeArtifactState(null, {
  artifactId,
  submission: { questionId: "q_intake_mode", value: "venue_schedule" },
});
const answered = (await listRequestWorkspaceArtifactVersions(null, created.id))[0];
assert.equal(answered.content.state.answers.q_intake_mode, "venue_schedule", "normalized ChoiceCards question remains selectable and saves answer state");

console.log("h3 ChoiceCards validation tests passed");
