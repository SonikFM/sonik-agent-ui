// Answer synthesis + state-patch/turn-message construction for the headless
// driver's question-answer loop. Ports two small pieces of the app so the
// driver can produce the exact same wire shapes without a build step:
//   - packages/tool-contracts/src/index.ts: createQuestionAnswerStateUpdates
//     (the /answers, /questionStates, /questionSubmissions, /answerWrites
//     JSON Pointer paths persisted via PATCH /api/artifact/[id]/state)
//   - apps/standalone-sveltekit/src/lib/render/question-answer-loop.ts
//     (the fenced sonik_question_answer turn message sent to /api/generate)
//
// `pickAnswerValue` implements only the "valid" answer strategy for P1
// (scenarios/answer-strategy combinatorics are explicitly P2 scope per
// docs/plans/high-volume-agent-harness-testing-2026-07-07.md).

function escapeJsonPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Deterministically synthesize a "valid" answer for a QuestionCard. */
export function pickAnswerValue(question, { seed } = {}) {
  const choices = (question.choices ?? []).filter((choice) => choice && choice.disabled !== true);
  switch (question.answerType) {
    case "single_choice":
    case "choice_cards":
    case "confirmation":
      if (choices.length > 0) return choices[0].value;
      return question.answerType === "confirmation" ? true : "yes";
    case "multi_choice": {
      const minimum = Math.max(1, question.minSelections || 0);
      const take = Math.max(minimum, Math.min(choices.length, question.maxSelections || minimum || 1));
      return choices.slice(0, take).map((choice) => choice.value);
    }
    case "boolean":
      return true;
    case "number":
      return typeof seed === "number" ? seed : 1;
    case "list":
    case "structured_list":
      return [];
    case "date":
      return "2026-08-01";
    case "datetime":
      return "2026-08-01T09:00:00.000Z";
    case "weekly_schedule":
    case "short_text":
    case "long_text":
    case "textarea":
    default:
      return typeof seed === "string" ? seed : `Harness answer for ${question.id}`;
  }
}

/**
 * Build the JSON-render state-patch `changes` array for answering (or
 * skipping) a question, matching createQuestionAnswerStateUpdates's paths
 * exactly: /answers/<id>, /questionStates/<id>, /questionSubmissions/<id>,
 * /lastQuestionSubmission, and (when writesTo is set) /answerWrites/<id> plus
 * the writesTo pointer itself.
 */
export function buildAnswerStateChanges(input) {
  const { question, artifactId, sessionId, skipped = false, now = new Date().toISOString() } = input;
  const value = skipped ? question.skipValue ?? "unknown" : input.value ?? pickAnswerValue(question);
  const writesTo = question.writesTo;
  const segment = escapeJsonPointerSegment(question.id);
  const lifecycle = skipped ? "skipped" : "answered";
  const submission = {
    version: "sonik-agent-ui.question-answer-submission.v1",
    questionId: question.id,
    value,
    skipped,
    ...(writesTo ? { writesTo } : {}),
    artifactId,
    ...(sessionId ? { sessionId } : {}),
    answeredAt: now,
    metadata: { controller: "sonik-agent-ui.question-answer-state.v1", execution: "none", approval: "not_granted" },
  };

  const changes = [
    { path: `/answers/${segment}`, value },
    { path: `/questionStates/${segment}`, value: lifecycle },
    { path: `/questionSubmissions/${segment}`, value: submission },
    { path: "/lastQuestionSubmission", value: { questionId: question.id, lifecycle, answeredAt: now, ...(writesTo ? { writesTo } : {}) } },
  ];
  if (writesTo) {
    changes.push({ path: `/answerWrites/${segment}`, value: { questionId: question.id, writesTo, value, answeredAt: now } });
    if (writesTo.startsWith("/")) changes.push({ path: writesTo, value });
  }
  return { changes, value, submission };
}

export const QUESTION_ANSWER_TURN_VERSION = "sonik-agent-ui.question-answer-turn.v1";
export const QUESTION_ANSWER_TURN_FENCE = "sonik_question_answer";

/**
 * Port of createQuestionAnswerTurnPayload + serializeQuestionAnswerTurnMessage
 * (apps/standalone-sveltekit/src/lib/render/question-answer-loop.ts): the
 * machine-readable turn text sent to /api/generate after a state patch
 * persists, so the (real) model can continue the intake from the next
 * highest-impact missing question.
 */
export function buildQuestionAnswerTurnMessage(input) {
  const { question, artifactId, artifactVersion, submission } = input;
  const payload = {
    version: QUESTION_ANSWER_TURN_VERSION,
    kind: "question_answer",
    entryFrom: "question_answer",
    artifact: { id: artifactId, version: artifactVersion },
    submission,
    answer: {
      questionId: question.id,
      value: submission.value ?? null,
      skipped: submission.skipped === true,
      ...(submission.writesTo ? { writesTo: submission.writesTo } : {}),
      artifactId,
      artifactVersion,
      ...(submission.sessionId ? { sessionId: submission.sessionId } : {}),
      ...(submission.answeredAt ? { answeredAt: submission.answeredAt } : {}),
    },
  };
  const text = [
    "Question answered. Continue the intake workflow using this machine-readable answer block.",
    `\`\`\`${QUESTION_ANSWER_TURN_FENCE}`,
    JSON.stringify(payload, null, 2),
    "```",
    "Ask the next highest-impact missing question. Do not execute commands or treat this answer as approval.",
  ].join("\n");
  return { payload, text };
}
