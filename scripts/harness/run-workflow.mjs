#!/usr/bin/env node
// Headless workflow driver CLI — P1 of
// docs/plans/high-volume-agent-harness-testing-2026-07-07.md.
//
// Runs a full booking-context-intake workflow against agent-ui's HTTP
// endpoints (no browser, no Playwright): create a session, seed an intake
// artifact, then loop { find next question -> answer it -> patch artifact
// state -> send a /api/generate turn } until the workflow reaches
// preview_ready (or stalls/errors). Emits a structured JSON result with the
// minimal P1 scorer's metrics and per-turn telemetry correlation ids.
//
// Usage:
//   node scripts/harness/run-workflow.mjs --target local [--json]
//   node scripts/harness/run-workflow.mjs --target deployed --scenario ./scenarios/foo.json
//
// See scripts/harness/README.md for target setup, scenario shape, and what
// the scores mean.

import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { EndpointClient, buildUserMessage, buildAssistantMessageFromReducedTurn } from "./lib/endpoint-client.mjs";
import { localHeaders, loginDeployedHostContext, deployedHeaders } from "./lib/host-context.mjs";
import { resolveScenario } from "./lib/scenario.mjs";
import { findNextQuestion, resolveWorkflowPhase, summarizeWorkflow } from "./lib/spec-walker.mjs";
import { buildAnswerStateChanges, buildQuestionAnswerTurnMessage } from "./lib/answer-picker.mjs";
import { scoreRun } from "./lib/scorer.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAX_QUESTION_TURNS = 12;

function parseArgs(argv) {
  const args = { target: "local", json: false, startServer: true, maxTurns: MAX_QUESTION_TURNS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--target") args.target = argv[++i];
    else if (arg === "--scenario") args.scenario = argv[++i];
    else if (arg === "--base-url") args.baseUrl = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--no-start-server") args.startServer = false;
    else if (arg === "--max-turns") args.maxTurns = Number(argv[++i]);
    else if (arg === "--run-id") args.runId = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`node scripts/harness/run-workflow.mjs --target local|deployed [options]

Options:
  --target local|deployed   Which environment to drive (default: local)
  --scenario <spec>         Inline JSON, a path to a .json file, or "default"
  --base-url <url>          Override the target base URL
  --json                    Print only the JSON result to stdout
  --no-start-server         Don't spawn "pnpm dev" for --target local
  --max-turns <n>           Question-answer turn cap (default: ${MAX_QUESTION_TURNS})
  --run-id <id>             Override the generated run id

Environment (deployed target):
  BOOKING_URL, TEST_EMAIL/TEST_PASSWORD (or AMPLIFY_TEST_EMAIL/AMPLIFY_TEST_PASSWORD)
  AGENT_UI_DEPLOYED_URL (default https://sonik-agent-ui.liam-trampota.workers.dev)

See scripts/harness/README.md.`);
}

async function isReachable(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReachable(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReachable(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return false;
}

async function ensureLocalServer(baseUrl, { startServer, log }) {
  if (await isReachable(baseUrl)) {
    log("app.server.reused", { baseUrl });
    return null;
  }
  if (!startServer) throw new Error(`Local app is not reachable at ${baseUrl}. Start it with "pnpm dev" or drop --no-start-server.`);
  log("app.server.start", { command: "pnpm dev", baseUrl });
  const child = spawn("pnpm", ["dev"], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  const ready = await waitForReachable(baseUrl, 180_000);
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error(`Local app did not become reachable at ${baseUrl} within 180s. See pnpm dev output.`);
  }
  return child;
}

async function driveLocalTarget({ baseUrl }) {
  return {
    client: new EndpointClient({ baseUrl, headers: localHeaders() }),
    smokeMock: true,
  };
}

async function driveDeployedTarget({ baseUrl }) {
  const bookingUrl = process.env.BOOKING_URL ?? "https://sonik-booking-app-pipe-b.liam-trampota.workers.dev";
  const email = process.env.TEST_EMAIL ?? process.env.AMPLIFY_TEST_EMAIL;
  const password = process.env.TEST_PASSWORD ?? process.env.AMPLIFY_TEST_PASSWORD;
  const { envelope } = await loginDeployedHostContext({ bookingUrl, email, password });
  return {
    client: new EndpointClient({ baseUrl, headers: deployedHeaders(envelope) }),
    smokeMock: false,
  };
}

async function driveQuestionAnswerLoop({ client, smokeMock, artifact, sessionId, log, maxTurns }) {
  const messages = [];
  const turns = [];
  let currentSpec = artifact.content;
  let currentVersion = artifact.version;
  let stopReason = null;

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    const phase = resolveWorkflowPhase(currentSpec);
    if (phase === "preview_ready") {
      stopReason = "preview_ready";
      break;
    }
    const question = findNextQuestion(currentSpec);
    if (!question) {
      stopReason = phase === "error" ? "visible_errors_unresolved" : "no_further_questions";
      break;
    }

    const { changes, submission } = buildAnswerStateChanges({
      question,
      artifactId: artifact.artifactId,
      sessionId,
    });
    const patchResult = await client.patchArtifactState(artifact.artifactId, {
      artifactId: artifact.artifactId,
      baseVersion: currentVersion,
      changes,
      requestId: `harness-state-patch:${artifact.artifactId}:${turnIndex}`,
      summary: `Harness answered ${question.id}`,
    });
    currentSpec = patchResult.artifact.content;
    currentVersion = patchResult.artifact.version;
    log("question.answered", { questionId: question.id, artifactVersion: currentVersion });

    const { text } = buildQuestionAnswerTurnMessage({ question, artifactId: artifact.artifactId, artifactVersion: currentVersion, submission });
    const userMessage = buildUserMessage(text);
    messages.push(userMessage);

    const reduced = await client.generateTurn({ messages, sessionId, smokeMock });
    const assistantMessage = buildAssistantMessageFromReducedTurn(reduced);
    messages.push(assistantMessage);
    turns.push(reduced);
    log("generate.turn", { turnIndex, questionId: question.id, toolCallCount: reduced.toolCalls.length, requestId: reduced.requestId });

    if (sessionId) {
      await client.appendSessionMessage(sessionId, { id: userMessage.id, role: "user", content: text, parts: userMessage.parts }).catch(() => undefined);
      await client.appendSessionMessage(sessionId, { id: assistantMessage.id, role: "assistant", content: reduced.text ?? "", parts: assistantMessage.parts }).catch(() => undefined);
    }
  }

  if (!stopReason) stopReason = "max_turns_reached";
  return { turns, finalSpec: currentSpec, finalVersion: currentVersion, stopReason };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.target !== "local" && args.target !== "deployed") {
    throw new Error(`--target must be "local" or "deployed" (got ${JSON.stringify(args.target)})`);
  }

  const runId = args.runId ?? `harness-run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const startedAt = Date.now();
  const responses = [];
  const events = [];
  const log = (event, payload = {}) => events.push({ at: new Date().toISOString(), event, ...payload });

  let devServerChild = null;
  const result = {
    schemaVersion: "sonik.agent_ui.harness_run.v1",
    runId,
    target: args.target,
    startedAt: new Date(startedAt).toISOString(),
    stages: {},
    responses,
    events,
  };

  try {
    const scenario = await resolveScenario(args.scenario);
    result.scenario = { artifactId: scenario.artifactId, contextName: scenario.contextName };

    let baseUrl = args.baseUrl;
    let driver;
    if (args.target === "local") {
      baseUrl = baseUrl ?? process.env.AGENT_UI_BASE_URL ?? "http://localhost:5173";
      devServerChild = await ensureLocalServer(baseUrl, { startServer: args.startServer, log });
      driver = await driveLocalTarget({ baseUrl });
    } else {
      baseUrl = baseUrl ?? process.env.AGENT_UI_DEPLOYED_URL ?? "https://sonik-agent-ui.liam-trampota.workers.dev";
      driver = await driveDeployedTarget({ baseUrl });
    }
    result.baseUrl = baseUrl;

    const client = new EndpointClient({ baseUrl, headers: driver.client.headers, onResponse: (entry) => responses.push(entry) });

    const session = await client.createSession({ name: `Harness ${scenario.contextName}` });
    result.stages.session = { ok: true, sessionId: session.id };
    log("session.created", { sessionId: session.id });

    const upserted = await client.upsertArtifact({
      id: scenario.artifactId,
      session_id: session.id,
      kind: "json-render",
      title: `${scenario.contextName} intake`,
      content: scenario.spec,
      source: "user",
      summary: "Harness-seeded booking context intake",
    });
    result.stages.artifact = { ok: true, artifactId: upserted.artifact.id, version: upserted.artifact.version };
    log("artifact.seeded", { artifactId: upserted.artifact.id, version: upserted.artifact.version });

    const loopResult = await driveQuestionAnswerLoop({
      client,
      smokeMock: driver.smokeMock,
      artifact: { artifactId: upserted.artifact.id, content: upserted.artifact.content, version: upserted.artifact.version },
      sessionId: session.id,
      log,
      maxTurns: args.maxTurns,
    });

    const finalSummary = summarizeWorkflow(loopResult.finalSpec);
    result.stages.questionAnswerLoop = {
      ok: loopResult.stopReason === "preview_ready",
      stopReason: loopResult.stopReason,
      turnCount: loopResult.turns.length,
      finalPhase: finalSummary.phase,
      finalArtifactVersion: loopResult.finalVersion,
    };
    result.finalWorkflowSummary = finalSummary;
    result.score = scoreRun({ turns: loopResult.turns });
    result.status = loopResult.stopReason === "preview_ready" ? "PASS" : "INCOMPLETE";
    result.reason = loopResult.stopReason === "preview_ready"
      ? "Drove the booking-context-intake workflow from a seeded draft to preview_ready with no browser and no live LLM call."
      : `Workflow loop stopped before preview_ready: ${loopResult.stopReason}.`;
  } catch (error) {
    result.status = "FAIL";
    result.reason = error instanceof Error ? error.message : String(error);
    result.errorStack = error instanceof Error ? error.stack : undefined;
  } finally {
    result.finishedAt = new Date().toISOString();
    result.durationMs = Date.now() - startedAt;
    if (devServerChild) devServerChild.kill("SIGTERM");
  }

  const logDir = path.join(repoRoot, ".omx", "logs");
  await mkdir(logDir, { recursive: true });
  const resultPath = path.join(logDir, `${runId}.json`);
  await writeFile(resultPath, JSON.stringify(result, null, 2));

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(JSON.stringify({ status: result.status, reason: result.reason, runId, resultPath, score: result.score, stages: result.stages }, null, 2));
  }
  process.exitCode = result.status === "PASS" ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
