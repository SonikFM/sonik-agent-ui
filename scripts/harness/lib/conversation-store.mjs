// Per-conversation state persistence for the persona harness. Each run's
// full state lives in a single JSON file under .omx/logs/persona-runs/<runId>.json
// so `persona-run.mjs` can be invoked turn by turn across separate process
// calls (Path A: a human/Claude reads one turn's output, decides the next
// persona message, then invokes the CLI again) without losing state.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractQuestions, diffNewQuestions } from "./question-extractor.mjs";
import { applySpecDataParts } from "./spec-reducer.mjs";
import { resolveWorkflowPhase } from "./spec-walker.mjs";

const ARTIFACT_CREATE_TOOL_NAME_PATTERN = /^create(Json|BookingIntake|Document)Artifact$/;

export function runStatePath(repoRoot, runId) {
  return path.join(repoRoot, ".omx", "logs", "persona-runs", `${runId}.json`);
}

export async function createRunState({ repoRoot, runId, persona, path: pathLabel, baseUrl, sessionId, bookingOrganizationId }) {
  const state = {
    schemaVersion: "sonik.agent_ui.persona_run.v1",
    runId,
    path: pathLabel,
    persona,
    baseUrl,
    bookingOrganizationId: bookingOrganizationId ?? null,
    sessionId,
    artifactId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    outcome: null,
    outcomeNotes: null,
    turnIndex: 0,
    turns: [],
    specHistory: [{ turnIndex: -1, at: new Date().toISOString(), spec: { root: "", elements: {} }, phase: "idle" }],
    questionsSeen: {},
    responses: [],
    telemetry: [],
  };
  await saveRunState(repoRoot, state);
  return state;
}

export async function loadRunState(repoRoot, runId) {
  const text = await readFile(runStatePath(repoRoot, runId), "utf8");
  return JSON.parse(text);
}

export async function saveRunState(repoRoot, state) {
  const target = runStatePath(repoRoot, runId(state));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(state, null, 2));
  return target;
}

function runId(state) {
  return state.runId;
}

/** Record a persona (user) message in the transcript. */
export function recordUserTurn(state, text) {
  state.turnIndex += 1;
  state.turns.push({ turnIndex: state.turnIndex, at: new Date().toISOString(), role: "user", text });
  return state;
}

/**
 * Record a reduced /api/generate turn (assistant side): text, tool calls,
 * spec evolution, workflow phase, and any newly-surfaced questions.
 */
export function recordAssistantTurn(state, { reduced, messageId }) {
  state.turnIndex += 1;
  const previousSpec = state.specHistory.at(-1).spec;
  const nextSpec = applySpecDataParts(previousSpec, reduced.specPatches);
  const phase = resolveWorkflowPhase(nextSpec);
  state.specHistory.push({ turnIndex: state.turnIndex, at: new Date().toISOString(), spec: nextSpec, phase });

  const newQuestions = diffNewQuestions(previousSpec, nextSpec);
  for (const question of newQuestions) {
    if (state.questionsSeen[question.id]) continue;
    state.questionsSeen[question.id] = { ...question, firstSeenTurn: state.turnIndex, answerGiven: null, answeredTurn: null };
  }

  if (!state.artifactId) {
    const artifactToolCall = (reduced.toolCalls ?? []).find((call) => ARTIFACT_CREATE_TOOL_NAME_PATTERN.test(call.toolName ?? ""));
    if (artifactToolCall) {
      state.artifactId = artifactToolCall.output?.id ?? `json-render-tool:${messageId ?? reduced.messageId ?? "unknown"}:${artifactToolCall.toolCallId}`;
    }
  }

  state.turns.push({
    turnIndex: state.turnIndex,
    at: new Date().toISOString(),
    role: "assistant",
    text: reduced.text ?? "",
    toolCalls: reduced.toolCalls ?? [],
    specPatchCount: (reduced.specPatches ?? []).length,
    finishReason: reduced.finishReason ?? null,
    error: reduced.error ?? null,
    requestId: reduced.requestId ?? null,
    traceId: reduced.traceId ?? null,
    workflowPhase: phase,
    newQuestionIds: newQuestions.map((question) => question.id),
  });
  return state;
}

/** After an assistant turn, mark any still-open questions as answered by the next user turn's text. */
export function backfillAnswers(state) {
  const userTurnsByIndex = new Map(state.turns.filter((turn) => turn.role === "user").map((turn) => [turn.turnIndex, turn.text]));
  for (const question of Object.values(state.questionsSeen)) {
    if (question.answerGiven) continue;
    const nextUserTurnIndex = [...userTurnsByIndex.keys()].filter((index) => index > question.firstSeenTurn).sort((a, b) => a - b)[0];
    if (nextUserTurnIndex !== undefined) {
      question.answerGiven = userTurnsByIndex.get(nextUserTurnIndex);
      question.answeredTurn = nextUserTurnIndex;
    }
  }
  return state;
}

/** Current workflow snapshot (phase, unanswered questions) for deciding the next persona message. */
export function currentSnapshot(state) {
  const latest = state.specHistory.at(-1);
  const { source, questions } = extractQuestions(latest.spec);
  const answeredIds = new Set(Object.values(state.questionsSeen).filter((question) => question.answerGiven).map((question) => question.id));
  return {
    phase: latest.phase,
    questionSource: source,
    openQuestions: questions.filter((question) => !answeredIds.has(question.id)),
    allQuestionsSeen: Object.values(state.questionsSeen),
  };
}
