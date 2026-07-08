// Unit tests for the headless workflow harness's pure logic: the SSE
// parser/reducer, the spec-walker, the answer-picker, and the scorer. No
// network access — fixtures only. Wired into the root `pnpm test` chain.
import assert from "node:assert/strict";

import { parseSseText, readUiMessageStream, reduceUiMessageChunks } from "../../scripts/harness/lib/sse-stream.mjs";
import {
  getQuestionCards,
  getAnsweredQuestionIds,
  findNextQuestion,
  getVisibleErrors,
  isBookingIntakeArtifact,
  getIntakeApprovalReadiness,
  resolveWorkflowPhase,
  summarizeWorkflow,
} from "../../scripts/harness/lib/spec-walker.mjs";
import { pickAnswerValue, buildAnswerStateChanges, buildQuestionAnswerTurnMessage } from "../../scripts/harness/lib/answer-picker.mjs";
import { buildBookingContextIntakeScenario, resolveScenario, BOOKING_CONTEXT_INTAKE_SCENARIO_ID } from "../../scripts/harness/lib/scenario.mjs";
import { scoreRecipeAdherence, scoreExecuteVsNarrate, scoreTurnEconomy, scoreRefusalCorrectness, scoreRun } from "../../scripts/harness/lib/scorer.mjs";
import { encodeTrustedHostContextHeader, buildLocalUnsignedHostContext, localHeaders } from "../../scripts/harness/lib/host-context.mjs";

// ---------------------------------------------------------------------------
// sse-stream
// ---------------------------------------------------------------------------

{
  const sse = [
    'data: {"type":"start","messageId":"m1"}',
    "",
    'data: {"type":"text-start","id":"t1"}',
    "",
    'data: {"type":"text-delta","id":"t1","delta":"Hello "}',
    "",
    'data: {"type":"text-delta","id":"t1","delta":"world."}',
    "",
    'data: {"type":"text-end","id":"t1"}',
    "",
    'data: {"type":"tool-input-start","toolCallId":"c1","toolName":"readActiveArtifactState"}',
    "",
    'data: {"type":"tool-input-available","toolCallId":"c1","toolName":"readActiveArtifactState","input":{}}',
    "",
    'data: {"type":"tool-output-available","toolCallId":"c1","output":{"ok":true}}',
    "",
    'data: {"type":"finish","finishReason":"stop"}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");

  const chunks = parseSseText(sse);
  assert.equal(chunks.length, 9, "parseSseText should decode 9 chunks and skip [DONE]");
  assert.equal(chunks[0].type, "start");

  const reduced = reduceUiMessageChunks(chunks);
  assert.equal(reduced.text, "Hello world.", "text-delta chunks should concatenate in order");
  assert.equal(reduced.messageId, "m1");
  assert.equal(reduced.finishReason, "stop");
  assert.equal(reduced.toolCalls.length, 1);
  assert.equal(reduced.toolCalls[0].toolName, "readActiveArtifactState");
  assert.deepEqual(reduced.toolCalls[0].output, { ok: true });

  // readUiMessageStream against a fetch-like Response with a real ReadableStream,
  // split mid-frame to exercise the buffering path.
  const half1 = sse.slice(0, 40);
  const half2 = sse.slice(40);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(half1));
      controller.enqueue(new TextEncoder().encode(half2));
      controller.close();
    },
  });
  const seen = [];
  const streamedChunks = await readUiMessageStream({ body }, { onChunk: (chunk) => seen.push(chunk) });
  assert.equal(streamedChunks.length, 9, "readUiMessageStream should reassemble frames split across reads");
  assert.equal(seen.length, 9, "onChunk should fire once per chunk");
  const streamedReduced = reduceUiMessageChunks(streamedChunks);
  assert.equal(streamedReduced.text, "Hello world.");

  console.log("sse-stream: ok");
}

// ---------------------------------------------------------------------------
// spec-walker
// ---------------------------------------------------------------------------

{
  const { spec } = buildBookingContextIntakeScenario({ artifactId: "art-1", contextName: "Test Cafe" });

  assert.equal(isBookingIntakeArtifact(spec), true);
  assert.equal(resolveWorkflowPhase(spec), "intake");

  const cards = getQuestionCards(spec);
  assert.equal(cards.length, 3);
  assert.deepEqual(
    cards.map((card) => card.id),
    ["q_intake_mode", "q_business_name", "q_inventory_description"],
  );

  assert.equal(getAnsweredQuestionIds(spec).size, 0);
  const first = findNextQuestion(spec);
  assert.equal(first.id, "q_intake_mode");

  const readinessBefore = getIntakeApprovalReadiness(spec);
  assert.equal(readinessBefore.ready, false);

  // Simulate answering all three questions via the same state-patch shape
  // PATCH /api/artifact/:id/state applies.
  let workingSpec = spec;
  for (const question of cards) {
    const { changes } = buildAnswerStateChanges({ question, artifactId: "art-1", sessionId: "sess-1" });
    workingSpec = applyChangesForTest(workingSpec, changes);
  }

  assert.equal(getAnsweredQuestionIds(workingSpec).size, 3);
  assert.equal(findNextQuestion(workingSpec), null, "all questions answered -> no next question");
  assert.equal(getVisibleErrors(workingSpec).length, 0);
  const readinessAfter = getIntakeApprovalReadiness(workingSpec);
  assert.equal(readinessAfter.ready, true, `expected ready, got: ${readinessAfter.reason}`);
  assert.equal(resolveWorkflowPhase(workingSpec), "preview_ready");

  const summary = summarizeWorkflow(workingSpec);
  assert.equal(summary.phase, "preview_ready");
  assert.equal(summary.answeredCount, 3);
  assert.equal(summary.nextQuestion, null);

  // A question error should force phase "error" even with everything else answered.
  const errored = applyChangesForTest(workingSpec, [{ path: "/questionErrors/q_business_name", value: "invalid" }]);
  assert.equal(resolveWorkflowPhase(errored), "error");

  console.log("spec-walker: ok");
}

// ---------------------------------------------------------------------------
// answer-picker
// ---------------------------------------------------------------------------

{
  const singleChoice = { id: "q1", answerType: "single_choice", choices: [{ value: "a", label: "A" }, { value: "b", label: "B", disabled: true }] };
  assert.equal(pickAnswerValue(singleChoice), "a", "single_choice should pick the first enabled choice");

  const multiChoice = { id: "q2", answerType: "multi_choice", minSelections: 2, choices: [{ value: "a" }, { value: "b" }, { value: "c" }] };
  assert.deepEqual(pickAnswerValue(multiChoice), ["a", "b"], "multi_choice should honor minSelections");

  const boolQ = { id: "q3", answerType: "boolean" };
  assert.equal(pickAnswerValue(boolQ), true);

  const textQ = { id: "q4", answerType: "short_text" };
  assert.equal(pickAnswerValue(textQ), "Harness answer for q4");

  const question = { id: "q_business_name", answerType: "short_text", writesTo: "/manifest/business/name" };
  const { changes, value, submission } = buildAnswerStateChanges({ question, artifactId: "art-1", sessionId: "sess-1", now: "2026-07-07T00:00:00.000Z" });
  const paths = changes.map((change) => change.path);
  assert.ok(paths.includes("/answers/q_business_name"));
  assert.ok(paths.includes("/questionStates/q_business_name"));
  assert.ok(paths.includes("/questionSubmissions/q_business_name"));
  assert.ok(paths.includes("/lastQuestionSubmission"));
  assert.ok(paths.includes("/answerWrites/q_business_name"), "writesTo questions should record an answerWrites entry");
  assert.ok(paths.includes("/manifest/business/name"), "writesTo pointer should be patched directly");
  const writesToChange = changes.find((change) => change.path === "/manifest/business/name");
  assert.equal(writesToChange.value, value);
  assert.equal(submission.questionId, "q_business_name");
  assert.equal(submission.skipped, false);

  const skippable = { id: "q_optional", answerType: "short_text", skipValue: "unknown" };
  const skipped = buildAnswerStateChanges({ question: skippable, artifactId: "art-1", sessionId: "sess-1", skipped: true });
  assert.equal(skipped.value, "unknown");
  const skipStateChange = skipped.changes.find((change) => change.path === "/questionStates/q_optional");
  assert.equal(skipStateChange.value, "skipped");

  const { text, payload } = buildQuestionAnswerTurnMessage({ question, artifactId: "art-1", artifactVersion: 2, submission });
  assert.ok(text.includes("```sonik_question_answer"), "turn message must use the fenced block the app parses");
  assert.equal(payload.version, "sonik-agent-ui.question-answer-turn.v1");
  assert.equal(payload.artifact.version, 2);
  assert.equal(payload.answer.questionId, "q_business_name");

  console.log("answer-picker: ok");
}

// ---------------------------------------------------------------------------
// scenario
// ---------------------------------------------------------------------------

{
  const defaultScenario = await resolveScenario(undefined);
  assert.equal(defaultScenario.spec.state.surface.id, BOOKING_CONTEXT_INTAKE_SCENARIO_ID);

  const inline = await resolveScenario(JSON.stringify({ artifactId: "custom-1", contextName: "Custom", spec: { root: "main", elements: {} } }));
  assert.equal(inline.artifactId, "custom-1");
  assert.equal(inline.spec.root, "main");

  await assert.rejects(() => resolveScenario(JSON.stringify({ notASpec: true })), /must be an object with a .spec. field/);

  console.log("scenario: ok");
}

// ---------------------------------------------------------------------------
// scorer
// ---------------------------------------------------------------------------

{
  const fullRecipe = [
    { toolCalls: [{ toolName: "searchSkillCatalog" }] },
    { toolCalls: [{ toolName: "learnSkill" }] },
    { toolCalls: [{ toolName: "readActiveArtifactState" }] },
    { toolCalls: [{ toolName: "previewActiveIntakeCommand" }] },
    { toolCalls: [{ toolName: "commitActiveIntakeCommand", output: { ok: true, commandId: "booking.create.context" } }], text: "Created the booking context." },
  ];
  const adherence = scoreRecipeAdherence(fullRecipe);
  assert.equal(adherence.adhered, true);
  assert.equal(adherence.matchedSteps, 5);
  assert.deepEqual(adherence.offRecipeCalls, []);

  const partial = [{ toolCalls: [{ toolName: "searchSkillCatalog" }, { toolName: "someOtherTool" }] }];
  const partialAdherence = scoreRecipeAdherence(partial);
  assert.equal(partialAdherence.adhered, false);
  assert.equal(partialAdherence.matchedSteps, 1);
  assert.deepEqual(partialAdherence.offRecipeCalls, ["someOtherTool"]);

  const executeVsNarrate = scoreExecuteVsNarrate(fullRecipe);
  assert.equal(executeVsNarrate.hasReceipt, true);
  assert.equal(executeVsNarrate.narrateWithoutExecute, false);

  const narratesOnly = [{ toolCalls: [], text: "I created the booking context for you." }];
  const badExecute = scoreExecuteVsNarrate(narratesOnly);
  assert.equal(badExecute.hasReceipt, false);
  assert.equal(badExecute.narrateWithoutExecute, true, "narrating success without a commit call should be flagged");

  const economy = scoreTurnEconomy(fullRecipe);
  assert.equal(economy.turnCount, 5);
  assert.equal(economy.toolCallCount, 5);

  const refusalOk = scoreRefusalCorrectness([{ text: "I can't do that, it's outside my scope." }], { expectRefusal: true });
  assert.equal(refusalOk.refused, true);
  assert.equal(refusalOk.correct, true);

  const refusalMissed = scoreRefusalCorrectness([{ text: "Sure, running it now." }], { expectRefusal: true });
  assert.equal(refusalMissed.correct, false);

  const composite = scoreRun({ turns: fullRecipe });
  assert.equal(composite.schemaVersion, "sonik.agent_ui.harness_score.v1");
  assert.equal(composite.recipeAdherence.adhered, true);

  console.log("scorer: ok");
}

// ---------------------------------------------------------------------------
// host-context
// ---------------------------------------------------------------------------

{
  const context = buildLocalUnsignedHostContext({ organizationId: "org-1", userId: "user-1" });
  assert.equal(context.authenticated, true);
  assert.equal(context.hostSession.organizationId, "org-1");
  assert.equal(context.hostSession.userId, "user-1");

  const header = encodeTrustedHostContextHeader(context);
  assert.equal(typeof header, "string");
  assert.ok(!header.includes("+") && !header.includes("/") && !header.includes("="), "header must be base64url (no +, /, or = padding)");
  const decoded = JSON.parse(Buffer.from(header.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  assert.equal(decoded.organizationId, "org-1");
  assert.equal(decoded.hostSession.userId, "user-1");

  const headers = localHeaders({ organizationId: "org-2" });
  assert.ok(headers["x-sonik-agent-ui-host-context"]);
  assert.equal(headers["x-sonik-agent-ui-smoke-persistence-mode"], "memory");

  console.log("host-context: ok");
}

console.log("harness-driver tests passed");

// Minimal JSON-Pointer setter used only to exercise the answer-picker output
// against spec-walker in this test file, without pulling in the app's
// @json-render/core immutableSetByPath (a browser/workspace-package dep the
// harness itself deliberately avoids at runtime).
function applyChangesForTest(spec, changes) {
  let state = structuredClone(spec.state ?? {});
  for (const change of changes) {
    const segments = change.path.split("/").slice(1).map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
    state = setByPath(state, segments, change.value);
  }
  return { ...spec, state };
}

function setByPath(target, segments, value) {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;
  const nextTarget = target && typeof target === "object" ? { ...target } : {};
  nextTarget[head] = setByPath(nextTarget[head] ?? {}, rest, value);
  return nextTarget;
}
