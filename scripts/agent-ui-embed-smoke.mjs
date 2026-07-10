#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runId = process.env.AGENT_UI_EMBED_SMOKE_RUN_ID ?? `agent-ui-embed-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const baseUrl = process.env.AGENT_UI_BASE_URL ?? "http://localhost:5173";
const localTelemetryRequired = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(?::|\/|$)/i.test(baseUrl);
const evidencePort = Number(process.env.AGENT_UI_EVIDENCE_PORT ?? 5175);
const evidenceBaseUrl = process.env.AGENT_UI_EVIDENCE_URL ?? `http://127.0.0.1:${evidencePort}`;
const telemetryLogPath = process.env.SONIK_AGENT_UI_TELEMETRY_LOG ?? path.join(repoRoot, ".omx", "logs", "agent-ui-telemetry.jsonl");
const evidencePath = path.join(repoRoot, ".omx", "logs", `${runId}.json`);
const artifactInputScenario = "artifact-input-stream";
const startServer = process.env.AGENT_UI_SMOKE_START_SERVER !== "false";
const useMockStream = process.env.AGENT_UI_EMBED_SMOKE_REAL_MODEL !== "true";
const smokeHostContextEnv = {
  SONIK_AGENT_UI_ENABLE_SMOKE_HOST_CONTEXT_SIGNER: process.env.SONIK_AGENT_UI_ENABLE_SMOKE_HOST_CONTEXT_SIGNER ?? "true",
  SONIK_AGENT_UI_HOST_CONTEXT_SECRET: process.env.SONIK_AGENT_UI_HOST_CONTEXT_SECRET ?? `agent-ui-embed-smoke-secret-${runId}`,
  SONIK_AGENT_UI_PERSISTENCE_MODE: process.env.AGENT_UI_EMBED_SMOKE_PERSISTENCE_MODE ?? "auto",
};
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
  autoCanvas: null,
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
  spawnDevProcess("pnpm", ["dev"], { name: "app.dev", env: smokeHostContextEnv });
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

async function captureCanvasWorkspaceState(frame) {
  return frame.evaluate(() => {
    const serialRect = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    };
    const isVisible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const root = document.querySelector(".workspace-root");
    const chatPane = document.querySelector(".workspace-pane--chat");
    const artifactPane = document.querySelector(".workspace-pane--artifact");
    const conversationHeader = document.querySelector('.workspace-pane--chat [role="log"] > header');
    const sessionRail = document.querySelector(".workspace-rail");
    return {
      href: window.location.href,
      root: {
        artifactOpen: root?.getAttribute("data-artifact-open") ?? null,
        hasRail: root?.getAttribute("data-has-rail") ?? null,
        layoutMode: root?.getAttribute("data-layout-mode") ?? null,
        railMode: root?.getAttribute("data-rail-mode") ?? null,
      },
      chatRect: serialRect(chatPane),
      artifactRect: serialRect(artifactPane),
      conversationHeaderVisible: isVisible(conversationHeader),
      sessionRailVisible: isVisible(sessionRail),
      sessionSwitcherVisible: isVisible(document.querySelector('[data-testid="agent-session-switcher"]')),
      assertions: window.__sonikAgentUI?.getAssertions?.() ?? null,
      pageContext: window.__sonikAgentUI?.getPageContext?.() ?? null,
      bodyText: document.body.innerText,
    };
  });
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

  const hostSession = process.env.AGENT_UI_EMBED_HOST_SESSION ?? "fixture";
  const hostSessionParam = hostSession ? `&hostSession=${encodeURIComponent(hostSession)}` : "";
  const hostUrl = `${baseUrl}/fake-booking-host.html?autoOpen=chat&smokeMockStream=${useMockStream ? "1" : "0"}&smokeRunId=${encodeURIComponent(runId)}&smokeScenario=${encodeURIComponent(artifactInputScenario)}${hostSessionParam}`;
  await page.goto(hostUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForFunction(() => document.body.dataset.agentUiOpen === "chat", undefined, { timeout: 20_000 });
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
  const chatFrameSrc = await page.locator("iframe#agent-frame").getAttribute("src");
  if (!chatFrameSrc?.includes(`smokeScenario=${encodeURIComponent(artifactInputScenario)}`)) throw new Error(`chat iframe src did not include artifact smoke scenario: ${chatFrameSrc}`);
  await frame.waitForFunction(() => Boolean(window.__sonikAgentUI?.getPageContext), undefined, { timeout: 20_000 });
  await frame.waitForFunction(() => window.__sonikAgentUI?.getPageContext?.().surface === "booking-console", undefined, { timeout: 10_000 });

  evidence.pageContext = await frame.evaluate(() => window.__sonikAgentUI.getPageContext());
  evidence.assertions = await frame.evaluate(() => window.__sonikAgentUI.getAssertions());
  evidence.contractVersions = await frame.evaluate(() => ({ pageControl: window.__sonikAgentUI?.schemaVersion ?? null, assertions: window.__sonikAgentUI?.getAssertions?.()?.schemaVersion ?? null }));
  if (evidence.contractVersions.pageControl !== "sonik.agent_ui.page_control.v1") throw new Error(`Unexpected page-control schemaVersion: ${evidence.contractVersions.pageControl}`);
  if (evidence.contractVersions.assertions !== "sonik.agent_ui.assertions.v1") throw new Error(`Unexpected assertions schemaVersion: ${evidence.contractVersions.assertions}`);
  if (evidence.pageContext?.surface !== "booking-console") throw new Error("Iframe page context did not reflect host booking surface before submit.");
  if (!evidence.pageContext?.activeEntity?.label) throw new Error("Iframe page context did not include a host active entity label before submit.");
  if (!evidence.pageContext?.commandFamilies?.includes("booking")) throw new Error("Iframe page context did not include booking command family before submit.");
  const preSessionId = evidence.pageContext?.activeSessionId ?? null;
  const session = await frame.evaluate(async () => window.__sonikAgentUI.actions.createSession());
  evidence.sessionBootstrap = { preSessionId, result: session };
  if (!session?.ok) throw new Error(`session bootstrap failed: ${JSON.stringify(session)}`);
  await frame.waitForFunction((expectedSessionId) => {
    const context = window.__sonikAgentUI?.getPageContext?.();
    const assertions = window.__sonikAgentUI?.getAssertions?.();
    return assertions?.hasActiveSession === true && Boolean(context?.activeSessionId) && context.activeSessionId !== expectedSessionId;
  }, preSessionId, { timeout: 20_000 });
  evidence.pageContext = await frame.evaluate(() => window.__sonikAgentUI.getPageContext());
  evidence.assertions = await frame.evaluate(() => window.__sonikAgentUI.getAssertions());
  if (preSessionId && evidence.pageContext?.activeSessionId === preSessionId) throw new Error(`session bootstrap reused stale active session: ${preSessionId}`);

  const submit = await frame.evaluate(async () => window.__sonikAgentUI.actions.submitPrompt({ prompt: "Create a compact visual dashboard artifact for this booking." }));
  if (!submit?.ok) throw new Error(`semantic submit failed: ${JSON.stringify(submit)}`);
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().isStreaming === true, undefined, { timeout: 10_000 });
  const streamSessionId = await frame.evaluate(() => window.__sonikAgentUI.getPageContext().activeSessionId ?? null);
  await page.waitForFunction(() => document.body.dataset.agentUiOpen === "canvas", undefined, { timeout: 20_000 });
  await page.waitForSelector("#canvas-window[data-open=\"true\"]", { timeout: 15_000 });
  evidence.layout.canvas = await captureEmbedLayout(page);
  const autoCanvasFrameElement = await page.waitForSelector("iframe#agent-frame", { timeout: 15_000 });
  const autoCanvasFrame = await autoCanvasFrameElement.contentFrame();
  if (!autoCanvasFrame) throw new Error("Agent iframe was not available after automatic canvas.open.");
  const canvasFrameSrc = await page.locator("iframe#agent-frame").getAttribute("src");
  if (canvasFrameSrc !== chatFrameSrc) throw new Error(`Automatic canvas.open changed iframe src: ${chatFrameSrc} -> ${canvasFrameSrc}`);
  if (evidence.layout.canvas.iframeParentId !== "canvas-frame-slot") await finish("FAIL", `Automatic canvas.open did not move iframe to canvas slot: ${evidence.layout.canvas.iframeParentId}`);
  await autoCanvasFrame.waitForFunction(() => {
    const root = document.querySelector(".workspace-root");
    return root?.getAttribute("data-layout-mode") === "canvas"
      && root?.getAttribute("data-rail-mode") === "hidden"
      && root?.getAttribute("data-artifact-open") === "true";
  }, undefined, { timeout: 20_000 });
  const autoCanvasState = await captureCanvasWorkspaceState(autoCanvasFrame);
  if (autoCanvasState.pageContext?.activeSessionId !== streamSessionId) throw new Error(`Active session changed during automatic canvas.open: ${streamSessionId} -> ${autoCanvasState.pageContext?.activeSessionId}`);
  if (autoCanvasState.assertions?.isStreaming !== true) throw new Error(`Automatic canvas.open did not preserve active stream state at open time: ${JSON.stringify(autoCanvasState.assertions)}`);
  if (!autoCanvasState.artifactRect || !autoCanvasState.chatRect || autoCanvasState.artifactRect.top > autoCanvasState.chatRect.top) throw new Error("Canvas layout did not render artifact above compact chat.");
  if (autoCanvasState.conversationHeaderVisible) throw new Error("Canvas layout did not hide duplicate AgentConversation header.");
  if (autoCanvasState.root.hasRail !== "false" || autoCanvasState.sessionRailVisible || autoCanvasState.sessionSwitcherVisible) throw new Error("Canvas layout did not hide duplicate session rail/session switcher.");
  evidence.autoCanvas = {
    usedManualLauncher: false,
    chatFrameSrc,
    canvasFrameSrc,
    streamSessionId,
    bodyMode: await page.evaluate(() => document.body.dataset.agentUiOpen ?? null),
    workspace: autoCanvasState,
  };
  await autoCanvasFrame.waitForFunction(() => window.__sonikAgentUI.getAssertions().isStreaming === false && window.__sonikAgentUI.getAssertions().messageCount >= 2, undefined, { timeout: useMockStream ? 45_000 : 90_000 });
  await sleep(1500);
  evidence.assistantText = await autoCanvasFrame.evaluate(() => document.body.innerText).catch(() => "");
  await autoCanvasFrame.waitForFunction(() => window.__sonikAgentUI?.getPageContext?.().surface === "booking-console", undefined, { timeout: 10_000 });
  evidence.pageContext = await autoCanvasFrame.evaluate(() => window.__sonikAgentUI.getPageContext());
  evidence.assertions = await autoCanvasFrame.evaluate(() => window.__sonikAgentUI.getAssertions());
  if (evidence.assertions?.hasActiveSession !== true) throw new Error(`Embedded prompt did not create an active session: ${JSON.stringify(evidence.assertions)}`);
  const chatSessionId = evidence.pageContext?.activeSessionId ?? null;
  classifyTelemetry(await readTelemetryEvents());

  if (evidence.errors.length) await finish("FAIL", "Browser errors observed during embed smoke.");
  if (evidence.pageContext?.surface !== "booking-console") await finish("FAIL", "Iframe page context did not reflect host booking surface.");
  const activeEntityLabel = evidence.pageContext?.activeEntity?.label;
  if (!activeEntityLabel) await finish("FAIL", "Iframe page context did not include a host active entity label.");
  if (!evidence.pageContext?.commandFamilies?.includes("booking")) await finish("FAIL", "Iframe page context did not include booking command family.");
  if (localTelemetryRequired && !useMockStream) {
    if (evidence.telemetry.commandIndexContext.length === 0) await finish("FAIL", "No command-index telemetry observed for embed prompt.");
    const commandEvent = evidence.telemetry.commandIndexContext.at(-1);
    if (commandEvent?.surface !== "booking-console") await finish("FAIL", "Command-index telemetry did not include booking surface.");
    if (commandEvent?.pageContext?.activeEntity?.label !== activeEntityLabel) await finish("FAIL", "Command-index telemetry did not include the current active entity label.");
    if (!commandEvent?.commandFamilies?.includes("booking")) await finish("FAIL", "Command-index telemetry did not include booking command family.");
  } else if (localTelemetryRequired && useMockStream) {
    record("telemetry.local_command_index_skipped", { reason: "mock_stream_does_not_call_generate_api", baseUrl });
  } else {
    record("telemetry.local_command_index_skipped", { reason: "remote_worker_url_uses_cloudflare_tail_not_local_jsonl", baseUrl });
  }
  if (!useMockStream && !new RegExp(`${activeEntityLabel?.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|booking-console|booking detail|event-booking-detail|booking_123`, "i").test(evidence.assistantText)) {
    await finish("FAIL", "Real-model embedded page-context answer did not mention the donated booking page context.");
  }
  if (evidence.telemetry.runtimeErrors.length > 0) await finish("FAIL", "Client runtime error telemetry observed during embed smoke.");
  const canvasEmbedMode = await page.evaluate(() => document.body.dataset.agentUiOpen);
  if (canvasEmbedMode !== "canvas") await finish("FAIL", "Artifact creation did not automatically switch the fake host to canvas mode.");
  await page.waitForSelector("#canvas-window[data-open=\"true\"]", { timeout: 15_000 });
  evidence.layout.canvas = await captureEmbedLayout(page);
  if (evidence.layout.canvas.canvasDisplay === "none") await finish("FAIL", "Canvas modal is not displayed after automatic canvas.open.");
  if (evidence.layout.canvas.iframeParentId !== "canvas-frame-slot") await finish("FAIL", `Canvas iframe was not mounted in canvas slot: ${evidence.layout.canvas.iframeParentId}`);
  if (evidence.layout.canvas.actionsDisplay !== "none" && overlaps(evidence.layout.canvas.actions, evidence.layout.canvas.canvas)) await finish("FAIL", "Host launcher controls overlap the canvas modal.");
  assertWithinViewport("canvas modal", evidence.layout.canvas.canvas, evidence.layout.canvas.viewport);
  assertWithinViewport("canvas iframe", evidence.layout.canvas.iframe, evidence.layout.canvas.viewport);
  const canvasFrameElement = await page.waitForSelector("iframe#agent-frame", { timeout: 15_000 });
  const canvasFrame = await canvasFrameElement.contentFrame();
  if (!canvasFrame) await finish("FAIL", "Agent iframe was not available after automatic canvas.open.");
  await canvasFrame.waitForFunction(() => {
    const root = document.querySelector(".workspace-root");
    return root?.getAttribute("data-layout-mode") === "canvas" && root?.getAttribute("data-rail-mode") === "hidden";
  }, undefined, { timeout: 20_000 });
  await canvasFrame.waitForFunction(() => window.__sonikAgentUI?.getAssertions?.().hasActiveSession === true, undefined, { timeout: 20_000 });
  const canvasContext = await canvasFrame.evaluate(() => window.__sonikAgentUI.getPageContext());
  if (chatSessionId && canvasContext?.activeSessionId !== chatSessionId) await finish("FAIL", `Session changed across chat to canvas switch: ${chatSessionId} -> ${canvasContext?.activeSessionId}`);
  await browser.close();
  await finish("PASS", localTelemetryRequired
    ? useMockStream
      ? "Iframe embed accepted signed host page context, created an active session, compressed chat into a non-overlapping sidecar, auto-opened canvas from artifact creation without reloading iframe src, preserved stream/session state, and rendered artifact above compact chat with duplicate chrome hidden."
      : "Iframe embed accepted host page context, compressed chat into a non-overlapping sidecar, auto-opened canvas from artifact creation without launcher overlap, and emitted correlated command-index telemetry."
    : "Remote iframe embed accepted host page context, compressed chat into a non-overlapping sidecar, auto-opened canvas from artifact creation, and skipped local JSONL telemetry because the deployed Worker uses Cloudflare/Pipe-B evidence.");
} catch (error) {
  await browser?.close().catch(() => undefined);
  evidence.errors.push({ event: "harness.error", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
  await finish("FAIL", "Embed smoke failed before all assertions completed.");
}
