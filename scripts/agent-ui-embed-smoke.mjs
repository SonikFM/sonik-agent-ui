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
const useMockStream = process.env.AGENT_UI_EMBED_SMOKE_REAL_MODEL !== "true";
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
  layout: { chat: null, canvas: null },
  assistantText: "",
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

function overlaps(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function serialRect(rect) {
  if (!rect) return null;
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
}

async function captureEmbedLayout(page) {
  return page.evaluate(() => {
    const hostMain = document.querySelector("main")?.getBoundingClientRect();
    const hostPlaceholder = document.querySelector(".host-placeholder")?.getBoundingClientRect();
    const sidecar = document.querySelector("#agent-sidecar")?.getBoundingClientRect();
    const canvas = document.querySelector("#canvas-window")?.getBoundingClientRect();
    const actions = document.querySelector(".host-actions")?.getBoundingClientRect();
    const iframe = document.querySelector("#agent-frame")?.getBoundingClientRect();
    const sidecarStyle = document.querySelector("#agent-sidecar") ? getComputedStyle(document.querySelector("#agent-sidecar")) : null;
    const canvasStyle = document.querySelector("#canvas-window") ? getComputedStyle(document.querySelector("#canvas-window")) : null;
    const actionStyle = document.querySelector(".host-actions") ? getComputedStyle(document.querySelector(".host-actions")) : null;
    const hostShellStyle = document.querySelector(".host-shell") ? getComputedStyle(document.querySelector(".host-shell")) : null;
    return {
      mode: document.body.dataset.agentUiOpen ?? null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      hostGridColumns: hostShellStyle?.gridTemplateColumns ?? null,
      hostMain: hostMain ? { left: hostMain.left, right: hostMain.right, top: hostMain.top, bottom: hostMain.bottom, width: hostMain.width, height: hostMain.height } : null,
      hostPlaceholder: hostPlaceholder ? { left: hostPlaceholder.left, right: hostPlaceholder.right, top: hostPlaceholder.top, bottom: hostPlaceholder.bottom, width: hostPlaceholder.width, height: hostPlaceholder.height } : null,
      sidecar: sidecar ? { left: sidecar.left, right: sidecar.right, top: sidecar.top, bottom: sidecar.bottom, width: sidecar.width, height: sidecar.height } : null,
      canvas: canvas ? { left: canvas.left, right: canvas.right, top: canvas.top, bottom: canvas.bottom, width: canvas.width, height: canvas.height } : null,
      actions: actions ? { left: actions.left, right: actions.right, top: actions.top, bottom: actions.bottom, width: actions.width, height: actions.height } : null,
      iframe: iframe ? { left: iframe.left, right: iframe.right, top: iframe.top, bottom: iframe.bottom, width: iframe.width, height: iframe.height } : null,
      sidecarDisplay: sidecarStyle?.display ?? null,
      canvasDisplay: canvasStyle?.display ?? null,
      actionsDisplay: actionStyle?.display ?? null,
      iframeParentId: document.querySelector("#agent-frame")?.parentElement?.id ?? null,
    };
  });
}

function assertWithinViewport(name, rect, viewport, tolerance = 1) {
  if (!rect || !viewport) throw new Error(`${name} rect or viewport was not captured`);
  if (rect.top < -tolerance || rect.bottom > viewport.height + tolerance) {
    throw new Error(`${name} is clipped vertically: top=${rect.top}, bottom=${rect.bottom}, viewportHeight=${viewport.height}`);
  }
  if (rect.left < -tolerance || rect.right > viewport.width + tolerance) {
    throw new Error(`${name} is clipped horizontally: left=${rect.left}, right=${rect.right}, viewportWidth=${viewport.width}`);
  }
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

  const hostUrl = `${baseUrl}/fake-booking-host.html?autoOpen=chat&smokeMockStream=${useMockStream ? "1" : "0"}&smokeRunId=${encodeURIComponent(runId)}`;
  await page.goto(hostUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  const initialEmbedMode = await page.evaluate(() => document.body.dataset.agentUiOpen);
  if (initialEmbedMode !== "chat") throw new Error(`fake host did not auto-open chat embed mode: ${initialEmbedMode}`);
  await page.waitForSelector("#agent-sidecar[data-open=\"true\"]", { timeout: 15_000 });
  await page.waitForFunction(() => {
    const rect = document.querySelector("#agent-sidecar")?.getBoundingClientRect();
    return Boolean(rect && rect.width >= 320 && rect.right <= window.innerWidth + 1);
  }, undefined, { timeout: 15_000 });
  evidence.layout.chat = await captureEmbedLayout(page);
  if (evidence.layout.chat.sidecarDisplay === "none") throw new Error("chat sidecar is not displayed");
  if (evidence.layout.chat.iframeParentId !== "chat-frame-slot") throw new Error(`chat iframe was not mounted in chat slot: ${evidence.layout.chat.iframeParentId}`);
  if (overlaps(evidence.layout.chat.sidecar, evidence.layout.chat.hostPlaceholder)) throw new Error("chat sidecar overlaps host placeholder content instead of compressing it");
  if (overlaps(evidence.layout.chat.sidecar, evidence.layout.chat.hostMain)) throw new Error("chat sidecar overlaps host main instead of occupying its own grid column");
  assertWithinViewport("chat sidecar", evidence.layout.chat.sidecar, evidence.layout.chat.viewport);
  assertWithinViewport("chat iframe", evidence.layout.chat.iframe, evidence.layout.chat.viewport);
  if (!evidence.layout.chat.hostGridColumns || evidence.layout.chat.hostGridColumns.split(" ").length < 3) throw new Error(`host shell did not expose sidecar grid columns: ${evidence.layout.chat.hostGridColumns}`);
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
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().isStreaming === false && window.__sonikAgentUI.getAssertions().messageCount >= 2, undefined, { timeout: useMockStream ? 45_000 : 90_000 });
  await sleep(1500);
  evidence.assistantText = await frame.evaluate(() => document.body.innerText).catch(() => "");
  await frame.waitForFunction(() => window.__sonikAgentUI?.getPageContext?.().surface === "booking-console", undefined, { timeout: 10_000 });
  evidence.pageContext = await frame.evaluate(() => window.__sonikAgentUI.getPageContext());
  evidence.assertions = await frame.evaluate(() => window.__sonikAgentUI.getAssertions());
  const chatSessionId = evidence.pageContext?.activeSessionId ?? null;
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
  if (!useMockStream && !/Summer Jazz Night|booking-console|booking detail|event-booking-detail|booking_123/i.test(evidence.assistantText)) {
    await finish("FAIL", "Real-model embedded page-context answer did not mention the donated booking page context.");
  }
  if (evidence.telemetry.runtimeErrors.length > 0) await finish("FAIL", "Client runtime error telemetry observed during embed smoke.");
  await page.focus("#agent-fab-main");
  await page.waitForFunction(() => {
    const button = document.querySelector("#open-canvas");
    if (!button) return false;
    const style = getComputedStyle(button.closest(".fab-item") ?? button);
    return style.pointerEvents !== "none" && Number(style.opacity) > 0.9;
  }, undefined, { timeout: 10_000 });
  await page.click("#open-canvas");
  const canvasEmbedMode = await page.evaluate(() => document.body.dataset.agentUiOpen);
  if (canvasEmbedMode !== "canvas") await finish("FAIL", "Fake host canvas launcher did not switch to canvas mode.");
  await page.waitForSelector("#canvas-window[data-open=\"true\"]", { timeout: 15_000 });
  evidence.layout.canvas = await captureEmbedLayout(page);
  if (evidence.layout.canvas.canvasDisplay === "none") await finish("FAIL", "Canvas modal is not displayed after launcher switch.");
  if (evidence.layout.canvas.iframeParentId !== "canvas-frame-slot") await finish("FAIL", `Canvas iframe was not mounted in canvas slot: ${evidence.layout.canvas.iframeParentId}`);
  if (evidence.layout.canvas.actionsDisplay !== "none" && overlaps(evidence.layout.canvas.actions, evidence.layout.canvas.canvas)) await finish("FAIL", "Host launcher controls overlap the canvas modal.");
  assertWithinViewport("canvas modal", evidence.layout.canvas.canvas, evidence.layout.canvas.viewport);
  assertWithinViewport("canvas iframe", evidence.layout.canvas.iframe, evidence.layout.canvas.viewport);
  const canvasFrameElement = await page.waitForSelector("iframe#agent-frame", { timeout: 15_000 });
  const canvasFrame = await canvasFrameElement.contentFrame();
  if (!canvasFrame) await finish("FAIL", "Agent iframe was not available after canvas launcher switch.");
  await canvasFrame.waitForFunction(() => {
    const root = document.querySelector(".workspace-root");
    return root?.getAttribute("data-layout-mode") === "canvas" && root?.getAttribute("data-rail-mode") === "collapsed";
  }, undefined, { timeout: 20_000 });
  await canvasFrame.waitForFunction(() => window.__sonikAgentUI?.getAssertions?.().hasActiveSession === true, undefined, { timeout: 20_000 });
  const canvasContext = await canvasFrame.evaluate(() => window.__sonikAgentUI.getPageContext());
  if (chatSessionId && canvasContext?.activeSessionId !== chatSessionId) await finish("FAIL", `Session changed across chat to canvas switch: ${chatSessionId} -> ${canvasContext?.activeSessionId}`);
  await browser.close();
  await finish("PASS", "Iframe embed accepted host page context, compressed chat into a non-overlapping sidecar, opened canvas without launcher overlap, and emitted correlated command-index telemetry.");
} catch (error) {
  await browser?.close().catch(() => undefined);
  evidence.errors.push({ event: "harness.error", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
  await finish("FAIL", "Embed smoke failed before all assertions completed.");
}
