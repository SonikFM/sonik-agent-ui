// Builds the "everything, one JSONL record per conversation" dataset record
// from a persona run's state (see conversation-store.mjs), per the harness
// task's extraction schema:
//   {runId, persona, timestamps, fullTranscript, questionsAsked, artifactId,
//    artifactSpecEvolution, telemetry, scores, outcome}

import { backfillAnswers } from "./conversation-store.mjs";
import { scoreRun } from "./scorer.mjs";

/** Assistant-role turns as {turns} input for scorer.mjs (toolCalls + text). */
function assistantTurnsForScoring(state) {
  return state.turns.filter((turn) => turn.role === "assistant").map((turn) => ({ text: turn.text, toolCalls: turn.toolCalls ?? [] }));
}

export function buildDatasetRecord(state, { outcome, outcomeNotes, finishedAt, pipeBEvidence } = {}) {
  backfillAnswers(state);

  const fullTranscript = state.turns.map((turn) => ({
    turnIndex: turn.turnIndex,
    role: turn.role,
    text: turn.text,
    at: turn.at,
    ...(turn.role === "assistant"
      ? { toolCalls: (turn.toolCalls ?? []).map((call) => ({ toolName: call.toolName, input: call.input, hasOutput: call.output !== undefined, error: call.error ?? null })), workflowPhase: turn.workflowPhase, requestId: turn.requestId, traceId: turn.traceId }
      : {}),
  }));

  const questionsAsked = Object.values(state.questionsSeen).map((question) => ({
    id: question.id,
    title: question.title,
    answerType: question.answerType,
    required: Boolean(question.required),
    source: question.source ?? "unknown",
    firstSeenTurn: question.firstSeenTurn,
    answeredTurn: question.answeredTurn,
    answerGiven: question.answerGiven,
  }));

  const artifactSpecEvolution = state.specHistory.map((snapshot) => ({
    turnIndex: snapshot.turnIndex,
    at: snapshot.at,
    phase: snapshot.phase,
    spec: snapshot.spec,
  }));

  const telemetry = {
    responses: state.responses,
    telemetryPosts: state.telemetry,
    pipeB: pipeBEvidence ?? { attempted: false, note: "Pipe-B tail not correlated for this run." },
  };

  const score = scoreRun({ turns: assistantTurnsForScoring(state) });

  return {
    schemaVersion: "sonik.agent_ui.persona_dataset_record.v1",
    runId: state.runId,
    path: state.path,
    persona: state.persona,
    baseUrl: state.baseUrl,
    sessionId: state.sessionId,
    artifactId: state.artifactId,
    timestamps: { startedAt: state.startedAt, finishedAt: finishedAt ?? new Date().toISOString() },
    fullTranscript,
    questionsAsked,
    artifactSpecEvolution,
    telemetry,
    scores: score,
    outcome: {
      status: outcome,
      notes: outcomeNotes ?? null,
      finalPhase: state.specHistory.at(-1)?.phase ?? "idle",
      turnCount: state.turns.filter((turn) => turn.role === "assistant").length,
    },
  };
}
