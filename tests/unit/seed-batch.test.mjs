import assert from "node:assert/strict";
import { SEED_CORPUS, corpusCategories } from "../../scripts/harness/seed-corpus.mjs";
import { INTAKE_QUESTIONS, requiredAnswerIds, buildDraftIntakeSpec, buildAnswerStateChanges, findQuestion } from "../../scripts/harness/lib/intake-spec-builder.mjs";
import { planSeedRecords, buildRecordArtifact } from "../../scripts/harness/seed-batch.mjs";

const VALID_INTAKE_MODES = new Set(["venue_schedule", "event", "hybrid"]);
const VALID_CONFIRMATION_MODES = new Set(["instant_confirm", "manual_approval", "deposit_then_confirm", "request_to_book", "waitlist"]);
const VALID_OPEN_DAYS = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
const VALID_MENUS = new Set(["breakfast", "lunch", "dinner", "brunch", "drinks", "special_event"]);

// --- Corpus shape ---

assert.ok(Array.isArray(SEED_CORPUS) && SEED_CORPUS.length >= 25, `curated corpus should have at least 25 records, got ${SEED_CORPUS.length}`);
assert.ok(corpusCategories().length >= 5, `curated corpus should span at least 5 categories, got ${corpusCategories().length}`);

const requiredIds = requiredAnswerIds();
assert.deepEqual(requiredIds, INTAKE_QUESTIONS.map((q) => q.id), "requiredAnswerIds must match INTAKE_QUESTIONS order");

const seenVenueNames = new Set();
for (const record of SEED_CORPUS) {
  assert.equal(typeof record.venueName, "string", "venueName must be a string");
  assert.ok(record.venueName.trim().length > 0, "venueName must not be blank");
  assert.ok(!/^test\s*\d*$/i.test(record.venueName), `venueName must be realistic, not a placeholder: ${record.venueName}`);
  assert.ok(!seenVenueNames.has(record.venueName), `venueName must be unique across the corpus: ${record.venueName}`);
  seenVenueNames.add(record.venueName);

  assert.equal(typeof record.category, "string");
  assert.ok(record.category.length > 0);

  assert.ok(VALID_INTAKE_MODES.has(record.intakeMode), `intakeMode must be one of venue_schedule/event/hybrid, got ${record.intakeMode}`);
  assert.equal(record.answers.q_intake_mode, record.intakeMode, "q_intake_mode answer must match the record's intakeMode");

  for (const id of requiredIds) {
    assert.ok(id in record.answers, `record "${record.venueName}" is missing an answer for ${id}`);
  }

  assert.equal(typeof record.answers.q_inventory_core, "string");
  assert.ok(record.answers.q_inventory_core.length > 0);
  assert.equal(typeof record.answers.q_business_name, "string");
  assert.ok(record.answers.q_business_name.length > 0);

  assert.ok(Array.isArray(record.answers.q_open_days), "q_open_days must be an array");
  for (const day of record.answers.q_open_days) assert.ok(VALID_OPEN_DAYS.has(day), `invalid open day: ${day}`);

  assert.equal(typeof record.answers.q_operating_hours, "string");
  assert.equal(typeof record.answers.q_table_layout, "string");
  assert.equal(typeof record.answers.q_service_periods, "string");

  assert.ok(Array.isArray(record.answers.q_menu_requirements), "q_menu_requirements must be an array");
  for (const menu of record.answers.q_menu_requirements) assert.ok(VALID_MENUS.has(menu), `invalid menu requirement: ${menu}`);

  assert.ok(VALID_CONFIRMATION_MODES.has(record.answers.q_confirmation_mode), `invalid confirmation mode: ${record.answers.q_confirmation_mode}`);
}

// --- intake-spec-builder: draft spec shape ---

const draftSpec = buildDraftIntakeSpec({ contextName: "Test Venue", intakeMode: "venue_schedule", artifactId: "artifact-1" });
assert.equal(draftSpec.root, "main");
assert.ok(draftSpec.elements.main, "spec must have a main element");
assert.equal(draftSpec.state.manifest.manifestType, "venue_schedule");
assert.equal(draftSpec.state.manifest.status, "draft");
for (const question of INTAKE_QUESTIONS) {
  assert.equal(draftSpec.state.draftAnswers[question.id], null, `${question.id} should start unanswered`);
  assert.equal(draftSpec.state.questionStates[question.id], "draft", `${question.id} should start in draft lifecycle`);
}
const questionCardElements = Object.values(draftSpec.elements).filter((element) => element.type === "QuestionCard");
assert.equal(questionCardElements.length, INTAKE_QUESTIONS.length, "spec must render one QuestionCard per intake question");
const renderedQuestionIds = new Set(questionCardElements.map((element) => element.props.questionId));
for (const question of INTAKE_QUESTIONS) assert.ok(renderedQuestionIds.has(question.id), `missing rendered QuestionCard for ${question.id}`);

// --- intake-spec-builder: answer state changes ---

const openDaysQuestion = findQuestion("q_open_days");
const { changes: openDaysChanges, submission } = buildAnswerStateChanges({
  question: openDaysQuestion,
  value: ["monday", "tuesday"],
  artifactId: "artifact-1",
  sessionId: "session-1",
});
const pathsByPrefix = (prefix) => openDaysChanges.filter((change) => change.path.startsWith(prefix));
assert.equal(pathsByPrefix("/draftAnswers/q_open_days")[0].value.length, 2);
assert.deepEqual(pathsByPrefix("/answers/q_open_days")[0].value, ["monday", "tuesday"]);
assert.equal(pathsByPrefix("/questionStates/q_open_days")[0].value, "answered");
assert.equal(pathsByPrefix("/questionSubmissions/q_open_days").length, 1);
assert.equal(openDaysChanges.some((change) => change.path === "/lastQuestionSubmission"), true);
assert.equal(openDaysChanges.some((change) => change.path === "/manifest/schedule/openDays"), true, "writesTo pointer must be patched");
assert.equal(submission.questionId, "q_open_days");
assert.equal(submission.skipped, false);

// Single-choice, non-multi question should not produce an array-shaped writesTo write.
const confirmationQuestion = findQuestion("q_confirmation_mode");
const { changes: confirmationChanges } = buildAnswerStateChanges({
  question: confirmationQuestion,
  value: "instant_confirm",
  artifactId: "artifact-1",
  sessionId: "session-1",
});
const manifestWrite = confirmationChanges.find((change) => change.path === "/manifest/inventory/confirmationMode");
assert.ok(manifestWrite, "confirmation mode must write to its manifest pointer");
assert.equal(manifestWrite.value, "instant_confirm");

// --- seed-batch: record planning + artifact building ---

const smallPlan = planSeedRecords(3);
assert.equal(smallPlan.length, 3);
assert.deepEqual(smallPlan.map((p) => p.seedIndex), [0, 1, 2]);
assert.equal(smallPlan.every((p) => p.cycle === 0), true, "count below corpus length should not need cycle variation");
const smallPlanNames = new Set(smallPlan.map((p) => p.venueName));
assert.equal(smallPlanNames.size, 3, "planned names should be distinct within a single cycle");

const largePlan = planSeedRecords(SEED_CORPUS.length + 2);
assert.equal(largePlan.length, SEED_CORPUS.length + 2);
assert.equal(largePlan[0].venueName, SEED_CORPUS[0].venueName, "first cycle keeps the corpus's real venue name unsuffixed");
assert.ok(largePlan[SEED_CORPUS.length].venueName.includes("Location 2"), "wraparound records should carry a location-variation suffix");
assert.notEqual(largePlan[0].venueName, largePlan[SEED_CORPUS.length].venueName, "wraparound record must not collide with the original name");

const built = buildRecordArtifact(smallPlan[0], { artifactId: "demo-seed-test-0000" });
assert.equal(built.answerSteps.length, INTAKE_QUESTIONS.length);
for (const step of built.answerSteps) {
  assert.equal(step.value, smallPlan[0].answers[step.question.id], `answer step for ${step.question.id} must match the curated corpus value`);
}
assert.equal(built.spec.state.seedBatch.seedIndex, 0);
assert.equal(built.spec.state.seedBatch.category, smallPlan[0].category);

// buildRecordArtifact must fail loudly (not silently skip) if a corpus record is missing an answer.
assert.throws(
  () => buildRecordArtifact({ ...smallPlan[0], answers: { q_intake_mode: "venue_schedule" } }, { artifactId: "demo-seed-test-broken" }),
  /missing answers for/,
);

console.log("seed-batch tests passed");
