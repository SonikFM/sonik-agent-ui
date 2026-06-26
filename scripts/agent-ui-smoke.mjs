#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runId = process.env.AGENT_UI_SMOKE_RUN_ID ?? `agent-ui-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const baseUrl = process.env.AGENT_UI_BASE_URL ?? "http://localhost:5173";
const useMockStream = process.env.AGENT_UI_SMOKE_REAL_MODEL !== "true";
const evidencePort = Number(process.env.AGENT_UI_EVIDENCE_PORT ?? 5175);
const evidenceBaseUrl = process.env.AGENT_UI_EVIDENCE_URL ?? `http://127.0.0.1:${evidencePort}`;
const telemetryLogPath = process.env.SONIK_AGENT_UI_TELEMETRY_LOG ?? path.join(repoRoot, ".omx", "logs", "agent-ui-telemetry.jsonl");
const evidencePath = path.join(repoRoot, ".omx", "logs", `${runId}.json`);
const screenshotPath = path.join(repoRoot, ".omx", "logs", `${runId}.png`);
const prompt = process.env.AGENT_UI_SMOKE_PROMPT ?? "In exactly three bullets, tell me what you can help with.";
const startServer = process.env.AGENT_UI_SMOKE_START_SERVER !== "false";
const waitMs = Number(process.env.AGENT_UI_SMOKE_WAIT_MS ?? 45_000);
const startedAtMs = Date.now();
const startedAt = new Date(startedAtMs).toISOString();
const childProcesses = [];
const watchdog = setTimeout(() => {
  void finish("FAIL", "Smoke harness timed out before browser/client persistence assertions completed.");
}, Number(process.env.AGENT_UI_SMOKE_TOTAL_TIMEOUT_MS ?? 120_000));

const evidence = {
  schemaVersion: "sonik.agent_ui.crash_regression.v1",
  runId,
  baseUrl,
  streamMode: useMockStream ? "dev-mock" : "real-model",
  evidenceBaseUrl,
  telemetryLogPath,
  promptClass: "three-bullet-stream-crash-regression",
  startedAt,
  status: "INCONCLUSIVE",
  events: [],
  errors: [],
  responses: [],
  headers: [],
  pageContext: null,
  assertions: null,
  sessions: null,
  telemetry: {
    serverDevSmokeStream: [],
    serverStreamFinished: [],
    serverStreamFailed: [],
    clientPersistEligible: [],
    clientPersistSuccess: [],
    clientPersistError: [],
    clientRuntimeErrors: [],
    lifecycleEvents: [],
  },
};

function record(event, payload = {}) {
  evidence.events.push({ at: new Date().toISOString(), event, ...payload });
}

async function finish(status, reason, exitCode = status === "PASS" || (status === "INCONCLUSIVE" && process.env.AGENT_UI_SMOKE_ALLOW_INCONCLUSIVE === "1") ? 0 : 1) {
  evidence.status = status;
  evidence.reason = reason;
  evidence.finishedAt = new Date().toISOString();
  clearTimeout(watchdog);
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await stopChildren();
  console.log(JSON.stringify({ status, reason, evidencePath, screenshotPath: existsSync(screenshotPath) ? screenshotPath : undefined }, null, 2));
  process.exit(exitCode);
}

async function stopChildren() {
  for (const child of childProcesses.reverse()) {
    if (child.exitCode !== null || child.signalCode) continue;
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
  }
}

process.on("SIGINT", () => void finish("INCONCLUSIVE", "Smoke interrupted by SIGINT", 130));
process.on("SIGTERM", () => void finish("INCONCLUSIVE", "Smoke interrupted by SIGTERM", 143));

async function isReachable(url, timeoutMs = 1_500) {
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

async function waitForReachable(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isReachable(url)) return true;
    await sleep(750);
  }
  return false;
}

function spawnDevProcess(command, args, options = {}) {
  const child = spawn(command, args, { cwd: repoRoot, env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
  childProcesses.push(child);
  child.stdout.on("data", (chunk) => record(`${options.name ?? command}.stdout`, { text: String(chunk).slice(0, 2000) }));
  child.stderr.on("data", (chunk) => record(`${options.name ?? command}.stderr`, { text: String(chunk).slice(0, 2000) }));
  child.on("exit", (code, signal) => record(`${options.name ?? command}.exit`, { code, signal }));
  return child;
}

async function ensureAppServer() {
  if (await isReachable(baseUrl)) {
    record("app.server.reused", { baseUrl });
    return true;
  }
  if (!startServer) return false;
  record("app.server.start", { command: "pnpm dev", baseUrl });
  spawnDevProcess("pnpm", ["dev"], { name: "app.dev" });
  return waitForReachable(baseUrl, 90_000);
}

async function ensureEvidenceServer() {
  if (await isReachable(`${evidenceBaseUrl}/health`)) {
    record("evidence.server.reused", { evidenceBaseUrl });
    return true;
  }
  if (!startServer) return false;
  record("evidence.server.start", { evidenceBaseUrl });
  spawnDevProcess("node", ["scripts/agent-ui-dev-evidence-server.mjs"], { name: "evidence.dev" });
  return waitForReachable(`${evidenceBaseUrl}/health`, 20_000);
}

async function readTelemetryEvents() {
  let events = [];
  try {
    const response = await fetch(`${evidenceBaseUrl}/events`);
    if (response.ok) events = (await response.json()).events ?? [];
  } catch {
    // Fall through to direct log read.
  }
  if (events.length === 0 && existsSync(telemetryLogPath)) {
    const text = await readFile(telemetryLogPath, "utf8").catch(() => "");
    events = text.split("\n").filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return { source: "playwright", event: "telemetry.parse_error", ok: false, line: index + 1, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }
  return events.filter((event) => Date.parse(event.at ?? "") >= startedAtMs - 1_000);
}

function classifyTelemetry(events) {
  const generateResponses = evidence.headers.filter((response) => response.path === "/api/generate");
  const requestIds = new Set(generateResponses.map((response) => response.requestId).filter(Boolean));
  const traceIds = new Set(generateResponses.map((response) => response.traceId).filter(Boolean));
  const activeSessionId = evidence.assertions?.hasActiveSession ? evidence.pageContext?.activeSessionId : undefined;
  evidence.telemetry.correlation = {
    runId,
    requestIds: [...requestIds],
    traceIds: [...traceIds],
    activeSessionId,
  };

  const isServerRunEvent = (event) => {
    if (event.runId === runId) return true;
    if (event.requestId && requestIds.has(event.requestId)) return true;
    if (event.traceId && traceIds.has(event.traceId)) return true;
    return false;
  };
  const isClientRunEvent = (event) => {
    if (event.runId === runId) return true;
    if (activeSessionId && event.sessionId === activeSessionId && Date.parse(event.at ?? "") >= startedAtMs) return true;
    return false;
  };
  const byServerName = (name) => events.filter((event) => event.event === name && isServerRunEvent(event));
  const byClientName = (name) => events.filter((event) => event.event === name && isClientRunEvent(event));

  evidence.telemetry.serverDevSmokeStream = byServerName("api.generate.dev_smoke_stream");
  evidence.telemetry.serverStreamFinished = byServerName("api.generate.stream_finished");
  evidence.telemetry.serverStreamFailed = byServerName("api.generate.stream_failed");
  evidence.telemetry.clientPersistEligible = byClientName("session.messages.persist_eligible");
  evidence.telemetry.clientPersistSuccess = byClientName("session.messages.persist_success");
  evidence.telemetry.clientPersistError = byClientName("session.messages.persist_error");
  evidence.telemetry.clientRuntimeErrors = events.filter((event) => (event.event === "client.runtime.error" || event.event === "client.runtime.unhandledrejection") && isClientRunEvent(event));
  evidence.telemetry.lifecycleEvents = byClientName("chat.stream.lifecycle");
}

function getAssistantText() {
  return typeof evidence.assistantText === "string" ? evidence.assistantText : "";
}

function hasProviderPrereqFailure() {
  const failedResponses = evidence.responses.filter((response) => response.path === "/api/generate" && response.status >= 400);
  const streamFailures = evidence.telemetry.serverStreamFailed;
  const prereqText = JSON.stringify([failedResponses, streamFailures]).toLowerCase();
  return /api key|provider|model|gateway|unauthorized|authentication|credentials/.test(prereqText);
}

async function evaluateWithTimeout(page, fn, timeoutMs = 2_000) {
  return Promise.race([
    page.evaluate(fn),
    sleep(timeoutMs).then(() => null),
  ]).catch(() => null);
}

async function waitForPageAssertion(page, predicate, timeoutMs, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastAssertions = null;
  while (Date.now() < deadline) {
    lastAssertions = await evaluateWithTimeout(page, () => window.__sonikAgentUI?.getAssertions?.() ?? null);
    if (lastAssertions && predicate(lastAssertions)) return lastAssertions;
    await sleep(intervalMs);
  }
  return lastAssertions;
}

async function capturePageControl(page) {
  return page.evaluate(() => {
    const control = window.__sonikAgentUI;
    return {
      hasControl: Boolean(control),
      pageContext: control?.getPageContext?.() ?? window.__SONIK_AGENT_UI_PAGE_CONTEXT__?.() ?? null,
      assertions: control?.getAssertions?.() ?? null,
    };
  }).catch((error) => ({ error: error instanceof Error ? error.message : String(error), hasControl: false, pageContext: null, assertions: null }));
}

async function submitPrompt(page) {
  const result = await page.evaluate(async (value) => {
    const action = window.__sonikAgentUI?.actions?.submitPrompt;
    if (!action) return { ok: false, disabledReason: "missing_page_action" };
    return action({ prompt: value });
  }, prompt).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  evidence.actionResult = result;
  if (result?.ok) return;
  throw new Error(`Page action submitPrompt failed: ${JSON.stringify(result)}`);
}

function relevantResponse(response) {
  try {
    const url = new URL(response.url());
    const base = new URL(baseUrl);
    return url.origin === base.origin;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch (error) {
  await finish("INCONCLUSIVE", `Playwright is not installed or cannot be imported: ${error instanceof Error ? error.message : String(error)}`);
}

if (!(await ensureAppServer())) await finish("INCONCLUSIVE", `Local app is not reachable at ${baseUrl}. Start it with pnpm dev or allow the smoke harness to start it.`);
const evidenceServerAvailable = await ensureEvidenceServer();
if (!evidenceServerAvailable) record("evidence.server.unavailable", { evidenceBaseUrl });

let browser;
try {
  const launchOptions = {
    headless: process.env.HEADLESS !== "false",
    args: ["--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox", "--disable-features=CanvasTextNg,FontationsFontBackend"],
  };
  const preferredChannel = process.env.PLAYWRIGHT_CHANNEL ?? "chrome";
  try {
    browser = await chromium.launch({ ...launchOptions, channel: preferredChannel });
    evidence.browser = { engine: "chromium", channel: preferredChannel };
  } catch (channelError) {
    record("browser.channel_recovery", { channel: preferredChannel, error: channelError instanceof Error ? channelError.message : String(channelError) });
    browser = await chromium.launch(launchOptions);
    evidence.browser = { engine: "chromium", channel: "bundled" };
  }
} catch (error) {
  await finish("INCONCLUSIVE", `Playwright browser is not installed/launchable: ${error instanceof Error ? error.message : String(error)}. Run pnpm exec playwright install chromium.`);
}

const page = await browser.newPage();
page.on("console", (message) => {
  const type = message.type();
  const text = message.text();
  record("browser.console", { type, text: text.slice(0, 2000) });
  if (type === "error") evidence.errors.push({ event: "browser.console.error", message: text.slice(0, 2000) });
});
page.on("pageerror", (error) => evidence.errors.push({ event: "pageerror", message: error.message, stack: error.stack }));
page.on("requestfailed", (request) => record("request.failed", { url: request.url(), failure: request.failure()?.errorText }));
page.on("response", async (response) => {
  if (!relevantResponse(response)) return;
  const url = new URL(response.url());
  const headers = response.headers();
  const responseRecord = {
    method: response.request().method(),
    path: url.pathname,
    status: response.status(),
    requestId: headers["x-sonik-request-id"],
    traceId: headers["x-sonik-trace-id"],
    traceparent: headers.traceparent,
    at: new Date().toISOString(),
  };
  evidence.responses.push(responseRecord);
  if (responseRecord.requestId || responseRecord.traceId || responseRecord.traceparent) evidence.headers.push(responseRecord);
});
page.on("crash", () => evidence.errors.push({ event: "page.crash", message: "Browser page crashed" }));

try {
  const smokeParams = new URLSearchParams();
  if (useMockStream) smokeParams.set("smokeMockStream", "1");
  smokeParams.set("smokeRunId", runId);
  const smokeUrl = `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${smokeParams.toString()}`;
  await page.goto(smokeUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(() => Boolean(window.__sonikAgentUI?.getPageContext), undefined, { timeout: 15_000 }).catch(() => undefined);
  const initialControl = await capturePageControl(page);
  evidence.pageContext = initialControl.pageContext;
  evidence.assertions = initialControl.assertions;
  if (!initialControl.hasControl) await finish("FAIL", "window.__sonikAgentUI page-control contract is missing.");
  await waitForPageAssertion(page, (assertions) => assertions.hasActiveSession === true, 20_000);

  await submitPrompt(page);
  await waitForPageAssertion(page, (assertions) => assertions.isStreaming === true, 10_000);
  await waitForPageAssertion(page, (assertions) => assertions.isStreaming === false && assertions.messageCount >= 2, waitMs);
  await sleep(1_500);

  const finalControl = await capturePageControl(page);
  evidence.pageContext = finalControl.pageContext;
  evidence.assertions = finalControl.assertions;
  evidence.assistantText = await evaluateWithTimeout(page, () => document.body?.innerText ?? "", 2_000);
  evidence.sessions = await page.request.get(`${baseUrl}/api/sessions`).then((res) => res.json()).catch((error) => ({ error: error.message }));
  const telemetryEvents = await readTelemetryEvents();
  classifyTelemetry(telemetryEvents);

  if (evidence.errors.length > 0) await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await browser.close();

  const fatalBrowserErrors = evidence.errors.filter((error) => ["page.crash", "pageerror"].includes(error.event));
  if (fatalBrowserErrors.length > 0) await finish("FAIL", "Browser crash/pageerror observed during streaming prompt.");
  if (evidence.telemetry.clientRuntimeErrors.length > 0) await finish("FAIL", "Client runtime error/unhandled rejection telemetry was emitted during streaming prompt.");
  if (evidence.headers.length === 0) await finish("FAIL", "No same-origin correlation headers observed for generate/local APIs.");
  if (useMockStream && evidence.telemetry.serverDevSmokeStream.length === 0) await finish("FAIL", "Deterministic smoke requested but api.generate.dev_smoke_stream telemetry was not observed for this run.");
  if (useMockStream && !getAssistantText().includes("I can help create and update workspace artifacts")) await finish("FAIL", "Deterministic smoke response text did not match the known mock stream.");
  if (evidence.telemetry.serverStreamFinished.length === 0) {
    await finish(hasProviderPrereqFailure() ? "INCONCLUSIVE" : "FAIL", "No api.generate.stream_finished telemetry observed for the smoke window.");
  }
  if (evidence.telemetry.clientPersistEligible.length === 0) await finish("FAIL", "No client persist_eligible telemetry observed after stream completion.");
  if (evidence.telemetry.clientPersistSuccess.length === 0) await finish("FAIL", "No client persist_success telemetry observed after stream completion.");
  if (evidence.telemetry.clientPersistError.length > 0) await finish("FAIL", "Client persistence error telemetry observed after stream completion.");
  if (!evidence.assertions?.hasActiveSession) await finish("FAIL", "Page assertions report no active session after smoke prompt.");
  if (!Array.isArray(evidence.sessions) || evidence.sessions.length === 0) await finish("FAIL", "No sessions returned after smoke prompt.");
  await finish("PASS", "Three-bullet streaming smoke completed with page-control assertions, correlated stream finish, and persisted client messages.");
} catch (error) {
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await browser.close().catch(() => undefined);
  evidence.errors.push({ event: "harness.error", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
  await finish("FAIL", "Smoke harness failed before completing browser assertions.");
}
