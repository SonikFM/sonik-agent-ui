#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runId = process.env.AGENT_UI_EMBED_SMOKE_RUN_ID ?? `agent-ui-embed-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const baseUrl = process.env.AGENT_UI_BASE_URL ?? "http://localhost:5173";
const evidencePort = Number(process.env.AGENT_UI_EVIDENCE_PORT ?? 5175);
const evidenceBaseUrl = process.env.AGENT_UI_EVIDENCE_URL ?? `http://127.0.0.1:${evidencePort}`;
const telemetryLogPath = process.env.SONIK_AGENT_UI_TELEMETRY_LOG ?? path.join(repoRoot, ".omx", "logs", "agent-ui-telemetry.jsonl");
const evidencePath = path.join(repoRoot, ".omx", "logs", `${runId}.json`);
const startServer = process.env.AGENT_UI_SMOKE_START_SERVER !== "false";
const startedAtMs = Date.now();
const children = [];
const evidence = {
  schemaVersion: "sonik.agent_ui.embed_smoke.v1",
  runId,
  baseUrl,
  fakeHostUrl: `${baseUrl}/fake-booking-host.html`,
  evidenceBaseUrl,
  telemetryLogPath,
  status: "INCONCLUSIVE",
  events: [],
  errors: [],
  responses: [],
  pageContext: null,
  assertions: null,
  telemetry: { commandIndexContext: [], hostContextUpdated: [], ignoredHostMessages: [], runtimeErrors: [] },
};
const watchdog = setTimeout(() => void finish("FAIL", "Embed smoke timed out."), Number(process.env.AGENT_UI_EMBED_SMOKE_TIMEOUT_MS ?? 120_000));

function record(event, payload = {}) { evidence.events.push({ at: new Date().toISOString(), event, ...payload }); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function finish(status, reason, exitCode = status === "PASS" ? 0 : 1) {
  evidence.status = status;
  evidence.reason = reason;
  evidence.finishedAt = new Date().toISOString();
  clearTimeout(watchdog);
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await stopChildren();
  console.log(JSON.stringify({ status, reason, evidencePath }, null, 2));
  process.exit(exitCode);
}

async function stopChildren() {
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode) continue;
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
  }
}

async function isReachable(url, timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok || response.status < 500;
  } catch (error) {
    record("reachability.error", { url, error: error instanceof Error ? error.message : String(error) });
    return false;
  } finally { clearTimeout(timer); }
}

async function waitForReachable(url, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReachable(url)) return true;
    await sleep(750);
  }
  return false;
}

function spawnDevProcess(command, args, options = {}) {
  const child = spawn(command, args, { cwd: repoRoot, env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  child.stdout.on("data", (chunk) => record(`${options.name ?? command}.stdout`, { text: String(chunk).slice(0, 2000) }));
  child.stderr.on("data", (chunk) => record(`${options.name ?? command}.stderr`, { text: String(chunk).slice(0, 2000) }));
  child.on("exit", (code, signal) => record(`${options.name ?? command}.exit`, { code, signal }));
}

async function ensureAppServer() {
  if (await isReachable(baseUrl)) return record("app.server.reused", { baseUrl }), true;
  if (!startServer) return false;
  spawnDevProcess("pnpm", ["dev"], { name: "app.dev" });
  return waitForReachable(baseUrl);
}

async function ensureEvidenceServer() {
  if (await isReachable(`${evidenceBaseUrl}/health`)) return record("evidence.server.reused", { evidenceBaseUrl }), true;
  if (!startServer) return false;
  spawnDevProcess("node", ["scripts/agent-ui-dev-evidence-server.mjs"], { name: "evidence.dev" });
  return waitForReachable(`${evidenceBaseUrl}/health`, 20_000);
}

async function readTelemetryEvents() {
  let events = [];
  try {
    const response = await fetch(`${evidenceBaseUrl}/events`);
    if (response.ok) events = (await response.json()).events ?? [];
  } catch (error) {
    record("telemetry.fetch.error", { error: error instanceof Error ? error.message : String(error) });
  }
  if (events.length === 0 && existsSync(telemetryLogPath)) {
    const text = await readFile(telemetryLogPath, "utf8").catch(() => "");
    events = text.split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch (error) {
        record("telemetry.parse_error", { error: error instanceof Error ? error.message : String(error) });
        return null;
      }
    }).filter(Boolean);
  }
  return events.filter((event) => Date.parse(event.at ?? "") >= startedAtMs - 1_000);
}

function classifyTelemetry(events) {
  const requestIds = new Set(evidence.responses.map((response) => response.requestId).filter(Boolean));
  const sessionId = evidence.pageContext?.activeSessionId;
  const related = (event) => event.runId === runId || (event.requestId && requestIds.has(event.requestId)) || (sessionId && event.sessionId === sessionId);
  evidence.telemetry.commandIndexContext = events.filter((event) => event.event === "api.generate.command_index_context" && related(event));
  evidence.telemetry.hostContextUpdated = events.filter((event) => event.event === "host.page_context.updated");
  evidence.telemetry.ignoredHostMessages = events.filter((event) => event.event === "host.page_context.message_ignored");
  evidence.telemetry.runtimeErrors = events.filter((event) => ["client.runtime.error", "client.runtime.unhandledrejection"].includes(event.event) && related(event));
}

let chromium;
try { ({ chromium } = await import("playwright")); }
catch (error) { await finish("INCONCLUSIVE", `Playwright unavailable: ${error instanceof Error ? error.message : String(error)}`, 1); }

if (!(await ensureAppServer())) await finish("INCONCLUSIVE", `Local app not reachable at ${baseUrl}.`, 1);
await ensureEvidenceServer();

let browser;
try {
  browser = await chromium.launch({ headless: process.env.HEADLESS !== "false", args: ["--disable-gpu", "--no-sandbox"] });
  const page = await browser.newPage();
  page.on("pageerror", (error) => evidence.errors.push({ event: "pageerror", message: error.message, stack: error.stack }));
  page.on("crash", () => evidence.errors.push({ event: "page.crash", message: "Browser page crashed" }));
  page.on("response", async (response) => {
    try {
      const url = new URL(response.url());
      const base = new URL(baseUrl);
      if (url.origin !== base.origin) return;
      const headers = response.headers();
      evidence.responses.push({ path: url.pathname, status: response.status(), requestId: headers["x-sonik-request-id"], traceId: headers["x-sonik-trace-id"], at: new Date().toISOString() });
    } catch (error) {
      evidence.errors.push({ event: "response.classify_error", message: error instanceof Error ? error.message : String(error) });
    }
  });

  const hostUrl = `${baseUrl}/fake-booking-host.html?autoOpen=chat&smokeMockStream=1&smokeRunId=${encodeURIComponent(runId)}`;
  await page.goto(hostUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const initialEmbedMode = await page.evaluate(() => document.body.dataset.agentUiOpen);
  if (initialEmbedMode !== "chat") throw new Error(`fake host did not auto-open chat embed mode: ${initialEmbedMode}`);
  const frameElement = await page.waitForSelector("iframe#agent-frame", { timeout: 15_000 });
  const frame = await frameElement.contentFrame();
  if (!frame) throw new Error("agent iframe frame was not available");
  await frame.waitForFunction(() => Boolean(window.__sonikAgentUI?.getPageContext), undefined, { timeout: 20_000 });
  await frame.waitForFunction(() => window.__sonikAgentUI?.getPageContext?.().surface === "booking-console", undefined, { timeout: 10_000 });
  await frame.waitForFunction(() => window.__sonikAgentUI?.getAssertions?.().hasActiveSession === true, undefined, { timeout: 20_000 });

  evidence.pageContext = await frame.evaluate(() => window.__sonikAgentUI.getPageContext());
  evidence.assertions = await frame.evaluate(() => window.__sonikAgentUI.getAssertions());
  const submit = await frame.evaluate(async () => window.__sonikAgentUI.actions.submitPrompt({ prompt: "Using the current page context, summarize where I am in one sentence." }));
  if (!submit?.ok) throw new Error(`semantic submit failed: ${JSON.stringify(submit)}`);
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().isStreaming === true, undefined, { timeout: 10_000 });
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().isStreaming === false && window.__sonikAgentUI.getAssertions().messageCount >= 2, undefined, { timeout: 45_000 });
  await sleep(1500);
  evidence.pageContext = await frame.evaluate(() => window.__sonikAgentUI.getPageContext());
  evidence.assertions = await frame.evaluate(() => window.__sonikAgentUI.getAssertions());
  classifyTelemetry(await readTelemetryEvents());

  if (evidence.errors.length) await finish("FAIL", "Browser errors observed during embed smoke.");
  if (evidence.pageContext?.surface !== "booking-console") await finish("FAIL", "Iframe page context did not reflect host booking surface.");
  if (evidence.pageContext?.activeEntity?.label !== "Summer Jazz Night") await finish("FAIL", "Iframe page context did not include host active entity label.");
  if (!evidence.pageContext?.commandFamilies?.includes("booking")) await finish("FAIL", "Iframe page context did not include booking command family.");
  if (evidence.telemetry.commandIndexContext.length === 0) await finish("FAIL", "No command-index telemetry observed for embed prompt.");
  const commandEvent = evidence.telemetry.commandIndexContext.at(-1);
  if (commandEvent?.surface !== "booking-console") await finish("FAIL", "Command-index telemetry did not include booking surface.");
  if (commandEvent?.pageContext?.activeEntity?.label !== "Summer Jazz Night") await finish("FAIL", "Command-index telemetry did not include active entity label.");
  if (!commandEvent?.commandFamilies?.includes("booking")) await finish("FAIL", "Command-index telemetry did not include booking command family.");
  if (evidence.telemetry.runtimeErrors.length > 0) await finish("FAIL", "Client runtime error telemetry observed during embed smoke.");
  await page.click("#open-canvas");
  const canvasEmbedMode = await page.evaluate(() => document.body.dataset.agentUiOpen);
  if (canvasEmbedMode !== "canvas") await finish("FAIL", "Fake host canvas launcher did not switch to canvas mode.");
  const canvasFrameElement = await page.waitForSelector("iframe#agent-frame", { timeout: 15_000 });
  const canvasFrame = await canvasFrameElement.contentFrame();
  if (!canvasFrame) await finish("FAIL", "Agent iframe was not available after canvas launcher switch.");
  await canvasFrame.waitForFunction(() => {
    const root = document.querySelector(".workspace-root");
    return root?.getAttribute("data-layout-mode") === "canvas" && root?.getAttribute("data-rail-mode") === "collapsed";
  }, undefined, { timeout: 20_000 });
  await browser.close();
  await finish("PASS", "Iframe embed accepted host page context, sent it to generate, and emitted correlated command-index telemetry.");
} catch (error) {
  await browser?.close().catch(() => undefined);
  evidence.errors.push({ event: "harness.error", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
  await finish("FAIL", "Embed smoke failed before all assertions completed.");
}
