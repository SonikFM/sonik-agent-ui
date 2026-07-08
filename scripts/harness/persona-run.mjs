#!/usr/bin/env node
// Persona conversation harness — drives REAL conversations against the
// DEPLOYED agent-ui (no browser, no mock stream) using the verified plain-
// HTTP path: log in to the booking app, mint a signed
// x-sonik-agent-ui-host-context envelope, and call /api/generate directly.
//
// Two modes:
//   Path A (turn-by-turn, "YOU role-play them"): a human or Claude reads
//   each turn's rendered output and decides the next persona message by
//   hand, invoking this CLI once per turn. Subcommands: login, start, turn,
//   status, finalize.
//
//   Path B (`batch`): fully automated at scale. Each persona turn is
//   produced by a gateway LLM call (see lib/gateway-persona.mjs). Requires
//   AI_GATEWAY_API_KEY; refuses to run without it.
//
// Usage (Path A):
//   node scripts/harness/persona-run.mjs login
//   node scripts/harness/persona-run.mjs start --persona restaurant-gm-terse --run-id r1
//   node scripts/harness/persona-run.mjs turn --run-id r1 --message "..."
//   node scripts/harness/persona-run.mjs status --run-id r1
//   node scripts/harness/persona-run.mjs finalize --run-id r1 --outcome reached_preview --dataset .omx/logs/persona-dataset-<ts>.jsonl
//
// Usage (Path B, NOT run by this change — requires AI_GATEWAY_API_KEY):
//   AI_GATEWAY_API_KEY=... node scripts/harness/persona-run.mjs batch --count 50 --concurrency 4
//
// Environment:
//   BOOKING_URL            default https://sonik-booking-app-pipe-b.liam-trampota.workers.dev
//   AGENT_UI_BASE_URL      default https://sonik-agent-ui.liam-trampota.workers.dev
//   TEST_EMAIL/TEST_PASSWORD (or AMPLIFY_TEST_EMAIL/AMPLIFY_TEST_PASSWORD)
//   AI_GATEWAY_API_KEY     required only for `batch` (Path B)

import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { EndpointClient, buildUserMessage, buildAssistantMessageFromReducedTurn } from "./lib/endpoint-client.mjs";
import { deployedHeaders } from "./lib/host-context.mjs";
import { getOrRefreshHostContext } from "./lib/host-context-cache.mjs";
import { getPersona, listPersonaIds } from "./lib/personas.mjs";
import { createRunState, loadRunState, saveRunState, recordUserTurn, recordAssistantTurn, currentSnapshot } from "./lib/conversation-store.mjs";
import { buildDatasetRecord } from "./lib/extraction.mjs";
import { correlatePipeBEvidence } from "./lib/pipeb-tail.mjs";
import { hasGatewayCredentials, generatePersonaTurn } from "./lib/gateway-persona.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_BOOKING_URL = "https://sonik-booking-app-pipe-b.liam-trampota.workers.dev";
const DEFAULT_AGENT_UI_URL = "https://sonik-agent-ui.liam-trampota.workers.dev";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function resolveClient() {
  const bookingUrl = process.env.BOOKING_URL ?? DEFAULT_BOOKING_URL;
  const baseUrl = process.env.AGENT_UI_BASE_URL ?? DEFAULT_AGENT_UI_URL;
  const email = process.env.TEST_EMAIL ?? process.env.AMPLIFY_TEST_EMAIL;
  const password = process.env.TEST_PASSWORD ?? process.env.AMPLIFY_TEST_PASSWORD;
  const envelope = await getOrRefreshHostContext(repoRoot, { bookingUrl, email, password });
  return { baseUrl, envelope, client: new EndpointClient({ baseUrl, headers: deployedHeaders(envelope) }) };
}

/** Truncate large tool-call inputs (e.g. full spec payloads for artifact-creation calls) for readable stdout; full data is always in the saved state/dataset record. */
function summarizeToolCallsForDisplay(toolCalls) {
  return (toolCalls ?? []).map((call) => {
    const inputJson = JSON.stringify(call.input ?? {});
    return { toolName: call.toolName, input: inputJson.length > 300 ? `${inputJson.slice(0, 300)}…(${inputJson.length} chars total, full input saved in state)` : call.input };
  });
}

function summarizeOpenQuestionsForDisplay(openQuestions) {
  return (openQuestions ?? []).map((question) => ({ id: question.id, title: question.title, answerType: question.answerType, required: question.required }));
}

async function cmdLogin() {
  const { baseUrl, envelope } = await resolveClient();
  console.log(JSON.stringify({ ok: true, baseUrl, organizationId: envelope.organizationId, scopes: envelope.scopes, expiresAt: envelope.expiresAt }, null, 2));
}

function messagesFromState(state) {
  return state.turns.map((turn) => (turn.role === "user" ? buildUserMessage(turn.text, { id: `t${turn.turnIndex}` }) : { id: `t${turn.turnIndex}`, role: "assistant", parts: [{ type: "text", text: turn.text }] }));
}

async function runOneTurn({ state, client, personaText }) {
  recordUserTurn(state, personaText);
  const messages = messagesFromState(state);
  const startedAt = Date.now();
  const reduced = await client.generateTurn({ messages, sessionId: state.sessionId, pageContext: {} });
  const elapsedMs = Date.now() - startedAt;
  recordAssistantTurn(state, { reduced, messageId: reduced.messageId });
  const telemetryResult = await client.postTelemetry({
    event: "persona-harness.turn",
    source: "client",
    runId: state.runId,
    sessionId: state.sessionId,
    turnIndex: state.turnIndex,
    pageContext: { activeSessionId: state.sessionId, activeArtifactId: state.artifactId, workflowPhase: state.specHistory.at(-1)?.phase ?? "idle" },
  });
  state.telemetry.push({ at: new Date().toISOString(), turnIndex: state.turnIndex, result: telemetryResult });
  await saveRunState(repoRoot, state);
  const snapshot = currentSnapshot(state);
  return { elapsedMs, reduced, snapshot };
}

async function cmdStart(args) {
  if (!args.persona) throw new Error(`--persona is required. Known ids: ${listPersonaIds().join(", ")}`);
  const persona = getPersona(args.persona);
  const runId = args["run-id"] ?? `persona-${persona.id}-${Date.now()}`;
  const { baseUrl, envelope } = await resolveClient();
  const responses = [];
  const onResponse = (entry) => responses.push(entry);
  const trackedClient = new EndpointClient({ baseUrl, headers: deployedHeaders(envelope), onResponse });

  const session = await trackedClient.createSession({ name: `Persona: ${persona.name} (${persona.id})` });
  const state = await createRunState({ repoRoot, runId, persona, path: "A", baseUrl, sessionId: session.id, bookingOrganizationId: envelope.organizationId });
  state.responses.push(...responses);

  const openingMessage = args.message ?? persona.openers[Number(args["opener-index"] ?? 0)];
  const { elapsedMs, reduced, snapshot } = await runOneTurn({ state, client: trackedClient, personaText: openingMessage });

  console.log(
    JSON.stringify(
      {
        runId,
        sessionId: session.id,
        persona: { id: persona.id, name: persona.name, role: persona.role, voice: persona.voice },
        openingMessage,
        assistantText: reduced.text,
        toolCalls: summarizeToolCallsForDisplay(reduced.toolCalls),
        workflowPhase: snapshot.phase,
        questionSource: snapshot.questionSource,
        openQuestions: summarizeOpenQuestionsForDisplay(snapshot.openQuestions),
        elapsedMs,
        artifactId: state.artifactId,
      },
      null,
      2,
    ),
  );
}

async function cmdTurn(args) {
  if (!args["run-id"]) throw new Error("--run-id is required");
  if (!args.message) throw new Error("--message is required");
  const state = await loadRunState(repoRoot, args["run-id"]);
  const { baseUrl, envelope } = await resolveClient();
  const responses = [];
  const client = new EndpointClient({ baseUrl, headers: deployedHeaders(envelope), onResponse: (entry) => responses.push(entry) });

  const { elapsedMs, reduced, snapshot } = await runOneTurn({ state, client, personaText: args.message });
  state.responses.push(...responses);
  await saveRunState(repoRoot, state);

  console.log(
    JSON.stringify(
      {
        runId: state.runId,
        turnIndex: state.turnIndex,
        assistantText: reduced.text,
        toolCalls: summarizeToolCallsForDisplay(reduced.toolCalls),
        workflowPhase: snapshot.phase,
        questionSource: snapshot.questionSource,
        openQuestions: summarizeOpenQuestionsForDisplay(snapshot.openQuestions),
        newlyAnsweredCount: snapshot.allQuestionsSeen.filter((q) => q.answerGiven).length,
        elapsedMs,
        artifactId: state.artifactId,
      },
      null,
      2,
    ),
  );
}

async function cmdStatus(args) {
  if (!args["run-id"]) throw new Error("--run-id is required");
  const state = await loadRunState(repoRoot, args["run-id"]);
  const snapshot = currentSnapshot(state);
  console.log(JSON.stringify({ runId: state.runId, persona: state.persona.id, turnCount: state.turns.length, phase: snapshot.phase, openQuestions: snapshot.openQuestions, artifactId: state.artifactId }, null, 2));
}

async function cmdFinalize(args) {
  if (!args["run-id"]) throw new Error("--run-id is required");
  if (!args.outcome) throw new Error("--outcome is required (e.g. reached_preview, blocked, max_turns, error)");
  const state = await loadRunState(repoRoot, args["run-id"]);

  let pipeBEvidence = { attempted: false, note: "No --pipe-b-batch-id supplied; Pipe-B correlation skipped for this run." };
  if (args["pipe-b-batch-id"]) {
    pipeBEvidence = await correlatePipeBEvidence(repoRoot, args["pipe-b-batch-id"], [state.sessionId, state.runId, state.artifactId].filter(Boolean));
  }

  const record = buildDatasetRecord(state, { outcome: args.outcome, outcomeNotes: args.notes ?? null, pipeBEvidence });
  state.finishedAt = record.timestamps.finishedAt;
  state.outcome = args.outcome;
  state.outcomeNotes = args.notes ?? null;
  await saveRunState(repoRoot, state);

  const datasetPath = path.resolve(repoRoot, args.dataset ?? `.omx/logs/persona-dataset-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  await mkdir(path.dirname(datasetPath), { recursive: true });
  await appendFile(datasetPath, `${JSON.stringify(record)}\n`);

  console.log(JSON.stringify({ ok: true, runId: state.runId, datasetPath, outcome: args.outcome, finalPhase: record.outcome.finalPhase, turnCount: record.outcome.turnCount, questionsAskedCount: record.questionsAsked.length }, null, 2));
}

async function cmdBatch(args) {
  if (!hasGatewayCredentials()) {
    console.error("Path B (gateway batch) requires AI_GATEWAY_API_KEY to be set. Refusing to run without it.");
    console.error("Set AI_GATEWAY_API_KEY to run the gateway batch.");
    process.exitCode = 1;
    return;
  }
  const { PERSONAS } = await import("./lib/personas.mjs");
  const count = Number(args.count ?? 10);
  const concurrency = Number(args.concurrency ?? 4);
  const maxTurns = Number(args["max-turns"] ?? 6);
  const datasetPath = path.resolve(repoRoot, args.dataset ?? `.omx/logs/persona-dataset-gateway-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  await mkdir(path.dirname(datasetPath), { recursive: true });

  const { baseUrl, envelope } = await resolveClient();
  const apiKey = process.env.AI_GATEWAY_API_KEY;

  const jobs = Array.from({ length: count }, (_, index) => PERSONAS[index % PERSONAS.length]);
  let cursor = 0;
  let completed = 0;
  const results = [];

  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= jobs.length) return;
      const persona = jobs[index];
      const runId = `persona-gateway-${persona.id}-${index}-${Date.now()}`;
      try {
        const client = new EndpointClient({ baseUrl, headers: deployedHeaders(envelope), onResponse: () => {} });
        const session = await client.createSession({ name: `Gateway persona: ${persona.name} (${runId})` });
        const state = await createRunState({ repoRoot, runId, persona, path: "B", baseUrl, sessionId: session.id, bookingOrganizationId: envelope.organizationId });

        for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
          const snapshot = currentSnapshot(state);
          if (snapshot.phase === "preview_ready") break;
          const isOpeningTurn = turnIndex === 0;
          const personaText = await generatePersonaTurn({
            persona,
            transcript: state.turns,
            openQuestions: snapshot.openQuestions,
            isOpeningTurn,
            apiKey,
          });
          const { snapshot: nextSnapshot } = await runOneTurn({ state, client, personaText });
          if (nextSnapshot.phase === "preview_ready") break;
        }

        const finalSnapshot = currentSnapshot(state);
        const outcome = finalSnapshot.phase === "preview_ready" ? "reached_preview" : "max_turns";
        const record = buildDatasetRecord(state, { outcome, pipeBEvidence: { attempted: false, note: "Path B batch does not tail Pipe-B per-run; run persona-run.mjs finalize --pipe-b-batch-id separately if needed." } });
        state.finishedAt = record.timestamps.finishedAt;
        state.outcome = outcome;
        await saveRunState(repoRoot, state);
        await appendFile(datasetPath, `${JSON.stringify(record)}\n`);
        results.push({ runId, persona: persona.id, outcome });
      } catch (error) {
        results.push({ runId, persona: persona.id, outcome: "error", error: error instanceof Error ? error.message : String(error) });
      }
      completed += 1;
      console.error(`[batch] ${completed}/${jobs.length} complete`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  console.log(JSON.stringify({ ok: true, datasetPath, count: jobs.length, results }, null, 2));
}

const ARTIFACT_CREATE_TOOL_PATTERN = /^create(Json|BookingIntake|Document)Artifact$/;

/**
 * `smoke`: a single self-contained "Haiku user tests the chat" run against the
 * deployed agent-ui. One conversation, deterministic stop conditions, and a
 * one-line verdict that exits non-zero on anything but preview_ready — so it
 * can be a CI/demo gate, not just a data collector. The judge is NOT a model:
 * the terminal state is a pure function of the rendered artifact
 * (resolveWorkflowPhase / extractQuestions via currentSnapshot), so this tests
 * whether the WORKFLOW advances, not how the model scores itself.
 *
 * Two inline guards (the parts a naive `while (phase != preview_ready)` loop
 * gets wrong against the real chat):
 *   - stalled: an assistant turn produced no text, no tool call, and no spec
 *     change (the observed finishReason:"other" empty-turn failure) — the loop
 *     must not hang on it.
 *   - not_advancing: once a QuestionCard intake is open, forward progress must
 *     continue — flagged if the turn recreates an artifact instead of patching
 *     it (Bug #1: create*Artifact called again rather than submitIntakeAnswer),
 *     or if the open-question set fails to shrink across 2 consecutive answer
 *     turns.
 *
 * Persona-turn source: the gateway Haiku driver by default (needs
 * AI_GATEWAY_API_KEY); or `--script "msg1||msg2||..."` for a keyless,
 * deterministic run (pre-scripted natural-language answers, one per turn).
 */
async function cmdSmoke(args) {
  const persona = getPersona(args.persona ?? "restaurant-gm-terse");
  const maxTurns = Number(args["max-turns"] ?? 8);
  const runId = args["run-id"] ?? `smoke-${persona.id}-${Date.now()}`;

  const scripted = typeof args.script === "string" ? args.script.split("||").map((s) => s.trim()).filter(Boolean) : null;
  const useGateway = !scripted;
  if (useGateway && !hasGatewayCredentials()) {
    console.error("smoke needs a persona-turn source: set AI_GATEWAY_API_KEY for the Haiku driver, or pass --script \"msg1||msg2||...\" for a keyless deterministic run.");
    process.exitCode = 1;
    return;
  }
  const apiKey = process.env.AI_GATEWAY_API_KEY;

  const { baseUrl, envelope } = await resolveClient();
  const responses = [];
  const client = new EndpointClient({ baseUrl, headers: deployedHeaders(envelope), onResponse: (entry) => responses.push(entry) });
  const session = await client.createSession({ name: `Smoke: ${persona.name} (${runId})` });
  const state = await createRunState({ repoRoot, runId, persona, path: "smoke", baseUrl, sessionId: session.id, bookingOrganizationId: envelope.organizationId });

  let verdict = "max_turns";
  let verdictReason = `Reached max turns (${maxTurns}) without preview_ready.`;
  let intakeEstablished = false;
  let prevOpenCount = null;
  let noShrinkStreak = 0;
  const progression = [];

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    const preSnapshot = currentSnapshot(state);
    if (preSnapshot.phase === "preview_ready") {
      verdict = "preview_ready";
      verdictReason = "Workflow already at preview_ready before this turn.";
      break;
    }

    let personaText;
    if (scripted) {
      if (turnIndex >= scripted.length) {
        verdictReason = `Ran out of scripted answers after ${turnIndex} turns without reaching preview_ready.`;
        break;
      }
      personaText = scripted[turnIndex];
    } else {
      personaText = await generatePersonaTurn({ persona, transcript: state.turns, openQuestions: preSnapshot.openQuestions, isOpeningTurn: turnIndex === 0, apiKey });
    }

    const { reduced, snapshot } = await runOneTurn({ state, client, personaText });
    const openIds = snapshot.openQuestions.map((question) => question.id).sort();
    const createdThisTurn = (reduced.toolCalls ?? []).filter((call) => ARTIFACT_CREATE_TOOL_PATTERN.test(call.toolName ?? ""));
    const submitIntakeAnswerCalled = (reduced.toolCalls ?? []).some((call) => call.toolName === "submitIntakeAnswer");
    progression.push({
      turnIndex,
      personaText,
      phase: snapshot.phase,
      artifactId: state.artifactId,
      openQuestionCount: openIds.length,
      submitIntakeAnswerCalled,
      recreatedArtifact: intakeEstablished && createdThisTurn.length > 0,
      toolNames: (reduced.toolCalls ?? []).map((call) => call.toolName),
    });

    // GUARD 1 — stalled.
    const emptyTurn = !(reduced.text ?? "").trim() && (reduced.toolCalls?.length ?? 0) === 0 && (reduced.specPatches?.length ?? 0) === 0;
    if (emptyTurn) {
      verdict = "stalled";
      verdictReason = `Turn ${turnIndex} produced no text, no tool call, and no spec change (finishReason=${reduced.finishReason ?? "unknown"}).`;
      break;
    }

    if (snapshot.phase === "preview_ready") {
      verdict = "preview_ready";
      verdictReason = `Conversational answering advanced the intake to preview_ready in ${turnIndex + 1} turn(s)${submitIntakeAnswerCalled ? " (submitIntakeAnswer was called)" : ""}.`;
      break;
    }

    // GUARD 2 — not_advancing (only meaningful once a QuestionCard intake is open).
    if (intakeEstablished) {
      if (createdThisTurn.length > 0) {
        verdict = "not_advancing";
        verdictReason = `Intake already open, but turn ${turnIndex} recreated an artifact (${createdThisTurn.map((call) => call.toolName).join(", ")}) instead of patching via submitIntakeAnswer.`;
        break;
      }
      if (prevOpenCount !== null && openIds.length >= prevOpenCount) noShrinkStreak += 1;
      else noShrinkStreak = 0;
      if (noShrinkStreak >= 2) {
        verdict = "not_advancing";
        verdictReason = `Open-question count did not shrink across 2 consecutive answer turns (stuck at ${openIds.length}).`;
        break;
      }
    }

    if (snapshot.questionSource === "QuestionCard") intakeEstablished = true;
    prevOpenCount = openIds.length;
  }

  state.responses.push(...responses);
  state.outcome = verdict;
  state.outcomeNotes = verdictReason;
  state.finishedAt = new Date().toISOString();
  await saveRunState(repoRoot, state);

  const passed = verdict === "preview_ready";
  console.log(
    JSON.stringify(
      {
        verdict,
        verdictReason,
        runId,
        persona: persona.id,
        sessionId: session.id,
        artifactId: state.artifactId,
        assistantTurns: state.turns.filter((turn) => turn.role === "assistant").length,
        progression,
      },
      null,
      2,
    ),
  );
  console.log(`\nVERDICT: ${verdict}${passed ? "" : "  (non-preview — exit 1)"}`);
  process.exitCode = passed ? 0 : 1;
}

function printHelp() {
  console.log(`node scripts/harness/persona-run.mjs <command> [options]

Commands:
  login                                        Verify auth + print envelope summary
  start --persona <id> [--run-id <id>] [--message "..."]
  turn --run-id <id> --message "..."
  status --run-id <id>
  finalize --run-id <id> --outcome <status> [--notes "..."] [--dataset <path>] [--pipe-b-batch-id <id>]
  smoke --persona <id> [--max-turns 8] [--script "msg1||msg2||..."]   (Haiku-in-the-loop gate; needs AI_GATEWAY_API_KEY unless --script)
  batch --count <n> --concurrency <n> [--max-turns <n>] [--dataset <path>]   (Path B, requires AI_GATEWAY_API_KEY)

The smoke verdict is one of: preview_ready (workflow works, exit 0) |
not_advancing (workflow broke — recreated artifact / questions not shrinking) |
stalled (model produced an empty turn) | max_turns. Exit is non-zero on
anything but preview_ready.

Known persona ids: ${listPersonaIds().join(", ")}
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command || args.command === "--help" || args.command === "-h") {
    printHelp();
    return;
  }
  const commands = { login: cmdLogin, start: cmdStart, turn: cmdTurn, status: cmdStatus, finalize: cmdFinalize, smoke: cmdSmoke, batch: cmdBatch };
  const handler = commands[args.command];
  if (!handler) {
    printHelp();
    throw new Error(`Unknown command: ${args.command}`);
  }
  await handler(args);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
