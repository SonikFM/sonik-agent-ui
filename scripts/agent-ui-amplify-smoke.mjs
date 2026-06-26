#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const startedAtMs = Date.now();
const runId = process.env.AGENT_UI_AUTH_SMOKE_RUN_ID ?? `agent-ui-auth-embed-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const marker = process.env.AGENT_UI_AUTH_SMOKE_MARKER ?? `agent-ui-auth-marker-${Date.now()}`;
const amplifyUrl = process.env.AMPLIFY_URL ?? "https://amplify-staging.liam-trampota.workers.dev/settings/integrations";
const agentOrigin = process.env.AGENT_UI_BASE_URL ?? "https://sonik-agent-ui.liam-trampota.workers.dev";
const email = process.env.AMPLIFY_TEST_EMAIL ?? process.env.TEST_EMAIL;
const password = process.env.AMPLIFY_TEST_PASSWORD ?? process.env.TEST_PASSWORD;
const requirePipeB = process.env.AGENT_UI_REQUIRE_PIPE_B === "1";
const pipeBWorker = process.env.AGENT_UI_PIPE_B_WORKER ?? "sonik-dev-observability-pipe-b";
const timeoutMs = Number(process.env.AGENT_UI_AUTH_SMOKE_TIMEOUT_MS ?? 240_000);
const outPath = path.join(repoRoot, ".omx", "logs", `${runId}.json`);
const screenshotPath = path.join(repoRoot, ".omx", "logs", `${runId}.png`);
const pipeBPath = path.join(repoRoot, ".omx", "logs", `${runId}.pipe-b.jsonl`);
const pipeBErrPath = path.join(repoRoot, ".omx", "logs", `${runId}.pipe-b.stderr.log`);

if (!email || !password) throw new Error("Missing AMPLIFY_TEST_EMAIL/AMPLIFY_TEST_PASSWORD for authenticated Amplify smoke.");

const evidence = {
  schemaVersion: "sonik.agent_ui.authenticated_embed_smoke.v1",
  runId,
  marker,
  amplifyUrl,
  agentOrigin,
  startedAt: new Date(startedAtMs).toISOString(),
  status: "INCONCLUSIVE",
  steps: [],
  responses: [],
  console: [],
  pageErrors: [],
  requestFailures: [],
  pipeB: { worker: pipeBWorker, path: pipeBPath, stderrPath: pipeBErrPath, status: "not_started", lineCount: 0, error: null },
  checks: null,
};
const children = [];
const watchdog = setTimeout(() => void saveAndExit("FAIL", "Authenticated Agent UI smoke timed out."), timeoutMs);

function redact(value) {
  return String(value ?? "")
    .replaceAll(email, "[email]")
    .replaceAll(password, "[redacted]")
    .replace(/(vck_[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/g, "[secret]");
}
function step(name, payload = {}) {
  evidence.steps.push({ at: new Date().toISOString(), name, ...payload });
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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

async function refreshPipeBStats() {
  try {
    const text = await readFile(pipeBPath, "utf8").catch(() => "");
    evidence.pipeB.lineCount = text.split("\n").filter(Boolean).length;
    if (["started", "started_no_events"].includes(evidence.pipeB.status)) evidence.pipeB.status = evidence.pipeB.lineCount > 0 ? "captured" : "started_no_events";
  } catch (error) {
    evidence.pipeB.error = redact(error instanceof Error ? error.message : String(error));
  }
  try {
    const info = await stat(pipeBErrPath).catch(() => null);
    evidence.pipeB.stderrBytes = info?.size ?? 0;
  } catch {}
}

async function startPipeBTail() {
  await mkdir(path.dirname(pipeBPath), { recursive: true });
  const stdout = createWriteStream(pipeBPath, { flags: "a" });
  const stderr = createWriteStream(pipeBErrPath, { flags: "a" });
  const child = spawn("pnpm", ["-C", "apps/standalone-sveltekit", "exec", "wrangler", "tail", pipeBWorker, "--format", "json"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  evidence.pipeB.status = "started";
  child.stdout.on("data", (chunk) => stdout.write(chunk));
  child.stderr.on("data", (chunk) => stderr.write(chunk));
  child.on("exit", (code, signal) => {
    evidence.pipeB.exit = { code, signal };
    if (code && evidence.pipeB.status === "started") evidence.pipeB.status = "unavailable";
  });
  await sleep(Number(process.env.AGENT_UI_PIPE_B_WARMUP_MS ?? 2500));
  await refreshPipeBStats();
  step("pipe-b-tail-started", { status: evidence.pipeB.status, path: pipeBPath });
}

async function saveAndExit(status, reason, exitCode = status === "PASS" ? 0 : 1) {
  evidence.status = status;
  evidence.reason = redact(reason);
  evidence.finishedAt = new Date().toISOString();
  clearTimeout(watchdog);
  await refreshPipeBStats();
  await stopChildren();
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status, reason: evidence.reason, outPath, screenshotPath, pipeB: evidence.pipeB, checks: evidence.checks }, null, 2));
  process.exit(exitCode);
}

function observePage(page) {
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    evidence.console.push({ at: new Date().toISOString(), type: message.type(), text: redact(message.text()).slice(0, 1600) });
  });
  page.on("pageerror", (error) => evidence.pageErrors.push(redact(error.stack || error.message).slice(0, 2000)));
  page.on("requestfailed", (request) => evidence.requestFailures.push({ at: new Date().toISOString(), method: request.method(), url: redact(request.url()).slice(0, 500), error: request.failure()?.errorText ?? null }));
  page.on("response", async (response) => {
    try {
      const url = new URL(response.url());
      if (!url.hostname.includes("sonik") && !url.hostname.includes("workers.dev")) return;
      const headers = response.headers();
      evidence.responses.push({
        at: new Date().toISOString(),
        method: response.request().method(),
        origin: url.origin,
        path: url.pathname,
        search: url.search.slice(0, 240),
        status: response.status(),
        requestId: headers["x-sonik-request-id"] ?? null,
        traceId: headers["x-sonik-trace-id"] ?? null,
        persistenceMode: headers["x-sonik-agent-ui-persistence-mode"] ?? null,
        persistencePolicy: headers["x-sonik-agent-ui-persistence-policy"] ?? null,
        hostAuthenticated: headers["x-sonik-agent-ui-host-authenticated"] ?? null,
        hostOrg: headers["x-sonik-agent-ui-host-org"] ?? null,
        hostUser: headers["x-sonik-agent-ui-host-user"] ?? null,
        memoryReason: headers["x-sonik-agent-ui-memory-reason"] ?? null,
        cloudError: headers["x-sonik-agent-ui-cloud-error"] ?? null,
      });
    } catch {}
  });
}

async function loginIfNeeded(page) {
  await page.goto(amplifyUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  const looksLoggedOut = async () => page.evaluate(() => /Operator Access|Sign in to Amplify/i.test(document.body.innerText) || location.pathname.includes("login")).catch(() => false);
  if (await looksLoggedOut()) {
    step("login-form-visible");
    const emailInput = page.locator('input[type="email"], input[name="email"], input[autocomplete="email"], input[placeholder*="email" i]').first();
    const passwordInput = page.locator('input[type="password"], input[name="password"], input[autocomplete="current-password"]').first();
    await emailInput.waitFor({ state: "visible", timeout: 30_000 });
    await emailInput.fill(email);
    await passwordInput.waitFor({ state: "visible", timeout: 30_000 });
    await passwordInput.fill(password);
    await page.locator("button").filter({ hasText: /^Sign in$/ }).last().click();
    await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined);
    await page.waitForFunction(() => !/Operator Access|Sign in to Amplify/i.test(document.body.innerText) && !location.pathname.includes("login"), undefined, { timeout: 45_000 }).catch(() => undefined);
  }
  await sleep(2500);
  const stillLoggedOut = await looksLoggedOut();
  const orgSetupModal = await page.evaluate(() => /Finish setting up your organization/i.test(document.body.innerText)).catch(() => false);
  step("amplify-authenticated", { url: page.url(), orgSetupModal, stillLoggedOut });
  if (stillLoggedOut) throw new Error("Amplify login did not complete; still on the login surface.");
}

async function openAgentFrame(page) {
  await page.waitForFunction(() => Boolean(document.body), undefined, { timeout: 45_000 });
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const existing = page.frames().find((candidate) => candidate.url().startsWith(agentOrigin));
    if (existing) {
      await existing.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
      await existing.waitForFunction(() => Boolean(window.__sonikAgentUI?.getPageContext && window.__sonikAgentUI?.getAssertions && window.__sonikAgentUI?.actions), undefined, { timeout: 45_000 });
      await existing.waitForFunction(() => window.__sonikAgentUI?.getAssertions?.().hasActiveSession === true, undefined, { timeout: 60_000 });
      return existing;
    }
    const openResult = await page.evaluate(async () => {
      const host = window.__sonikAgentHost;
      if (host?.schemaVersion === "sonik.agent_ui.host_controller.v1" && typeof host.openChat === "function") {
        host.openChat();
        return { target: "host-controller-openChat", state: host.getState?.() ?? null };
      }
      const visibleEnough = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const fire = (element) => element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      const describe = (element) => element ? { tag: element.tagName, id: element.id, cls: String(element.className || "").slice(0, 160), aria: element.getAttribute("aria-label"), testId: element.getAttribute("data-testid"), control: element.getAttribute("data-sonik-agent-ui-control"), text: element.textContent?.trim().slice(0, 80), rect: (() => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })() } : null;
      let chat = document.querySelector('[data-testid="sonik-agent-ui-open-chat"], [data-sonik-agent-ui-control="open-chat"], [aria-label="Open Sonik chat sidecar"]');
      if (visibleEnough(chat)) return { target: "open-chat-control", fired: fire(chat), chat: describe(chat) };
      const launcher = document.querySelector('[data-testid="sonik-agent-ui-launcher"], [data-sonik-agent-ui-control="launcher"], [aria-label="Open Sonik agent launcher"]');
      if (visibleEnough(launcher)) {
        const launcherFired = fire(launcher);
        await new Promise((resolve) => setTimeout(resolve, 450));
        chat = document.querySelector('[data-testid="sonik-agent-ui-open-chat"], [data-sonik-agent-ui-control="open-chat"], [aria-label="Open Sonik chat sidecar"]');
        if (chat) return { target: "launcher-then-open-chat-control", fired: Boolean(launcherFired && fire(chat)), launcher: describe(launcher), chat: describe(chat) };
        return { target: "launcher-only", fired: launcherFired, launcher: describe(launcher), chat: null };
      }
      return { target: "none", fired: false, hostControllerPresent: Boolean(host), chat: describe(chat), launcher: describe(launcher) };
    });
    step("agent-open-attempt", { attempt, openResult });
    await sleep(1000);
    await page.waitForFunction((origin) => [...document.querySelectorAll("iframe")].some((frame) => frame.src.startsWith(origin)), agentOrigin, { timeout: 12_000 }).catch(() => undefined);
    const frame = page.frames().find((candidate) => candidate.url().startsWith(agentOrigin));
    if (frame) {
      await frame.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
      await frame.waitForFunction(() => Boolean(window.__sonikAgentUI?.getPageContext && window.__sonikAgentUI?.getAssertions && window.__sonikAgentUI?.actions), undefined, { timeout: 45_000 });
      await frame.waitForFunction(() => window.__sonikAgentUI?.getAssertions?.().hasActiveSession === true, undefined, { timeout: 60_000 });
      return frame;
    }
  }
  const frameDebug = await page.evaluate(() => [...document.querySelectorAll("iframe")].map((frame) => ({ src: frame.src, rect: frame.getBoundingClientRect().toJSON?.() ?? null }))).catch(() => []);
  throw new Error(`No Agent UI iframe found for ${agentOrigin}. Iframes: ${JSON.stringify(frameDebug).slice(0, 1000)}`);
}

async function snapshot(frame, label) {
  const value = await frame.evaluate((marker) => ({
    context: window.__sonikAgentUI.getPageContext(),
    assertions: window.__sonikAgentUI.getAssertions(),
    actions: Object.keys(window.__sonikAgentUI.actions ?? {}).sort(),
    markerPresent: document.body.innerText.includes(marker),
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 12_000),
  }), marker);
  evidence[label] = value;
  return value;
}

let browser;
try {
  await startPipeBTail();
  browser = await chromium.launch({ headless: process.env.HEADLESS !== "false", args: ["--disable-gpu", "--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  const page = await context.newPage();
  observePage(page);

  await loginIfNeeded(page);
  const frame = await openAgentFrame(page);
  const before = await snapshot(frame, "before");
  if (!before.actions.includes("createSession")) throw new Error(`Agent UI page-control createSession action missing. Actions: ${before.actions.join(", ")}`);
  if (!before.actions.includes("submitPrompt")) throw new Error("Agent UI page-control submitPrompt action missing.");
  if (before.context?.surface !== "amplify-app") throw new Error(`Expected Amplify page context surface, got ${before.context?.surface}`);
  if (before.context?.hostSession?.authenticated !== true) throw new Error("Expected authenticated host session in donated page context.");

  const create = await frame.evaluate(async () => window.__sonikAgentUI.actions.createSession());
  evidence.createSession = create;
  if (!create?.ok) throw new Error(`createSession action failed: ${JSON.stringify(create)}`);
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().hasActiveSession === true && window.__sonikAgentUI.getPageContext().activeSessionId, undefined, { timeout: 45_000 });
  const fresh = await snapshot(frame, "fresh");
  const sessionId = fresh.context?.activeSessionId;
  if (!sessionId) throw new Error("Fresh semantic session did not expose an activeSessionId.");
  step("fresh-session-created", { sessionId });

  const prompt = `Create a JSON-render artifact titled "Authenticated embed smoke ${marker}". The artifact must visibly contain this exact marker text: ${marker}. Keep your chat answer to one short sentence.`;
  const submit = await frame.evaluate(async (prompt) => window.__sonikAgentUI.actions.submitPrompt({ prompt }), prompt);
  evidence.submitPrompt = submit;
  if (!submit?.ok) throw new Error(`submitPrompt action failed: ${JSON.stringify(submit)}`);
  step("prompt-submitted", { sessionId });
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().isStreaming === true, undefined, { timeout: 30_000 }).catch(() => step("streaming-start-not-observed"));
  await frame.waitForFunction(() => window.__sonikAgentUI.getAssertions().isStreaming === false && window.__sonikAgentUI.getAssertions().messageCount >= 2, undefined, { timeout: 180_000 });
  await sleep(4_000);
  const after = await snapshot(frame, "after");
  step("prompt-finished", { sessionId: after.context?.activeSessionId, activeArtifactId: after.context?.activeArtifactId });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined);
  const frame2 = await openAgentFrame(page);
  await frame2.waitForFunction((expectedSessionId) => window.__sonikAgentUI.getPageContext().activeSessionId === expectedSessionId, sessionId, { timeout: 45_000 }).catch(() => step("same-session-after-reload-not-observed"));
  await sleep(3_000);
  const restored = await snapshot(frame2, "restored");
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  await browser.close();

  await refreshPipeBStats();
  const agentResponses = evidence.responses.filter((entry) => entry.origin === agentOrigin);
  const generate = agentResponses.filter((entry) => entry.path === "/api/generate");
  const artifacts = agentResponses.filter((entry) => entry.path === "/api/artifact");
  const sessions = agentResponses.filter((entry) => entry.path === "/api/sessions" || entry.path.startsWith("/api/session"));
  const unexpectedFailures = agentResponses.filter((entry) => entry.status >= 400 && !entry.path.includes("favicon"));
  const agentOpenAttempts = evidence.steps.filter((entry) => entry.name === "agent-open-attempt");
  const hostControllerOpenAttempts = agentOpenAttempts.filter((entry) => entry.openResult?.target === "host-controller-openChat");
  evidence.checks = {
    usedDeterministicHostController: hostControllerOpenAttempts.length > 0,
    hostControllerOpenCount: hostControllerOpenAttempts.length,
    openTargets: agentOpenAttempts.map((entry) => entry.openResult?.target ?? "unknown"),
    freshSessionId: sessionId,
    afterSessionId: after.context?.activeSessionId ?? null,
    restoredSessionId: restored.context?.activeSessionId ?? null,
    sameSessionAfterPrompt: after.context?.activeSessionId === sessionId,
    sameSessionAfterReload: restored.context?.activeSessionId === sessionId,
    markerAfterPrompt: Boolean(after.markerPresent),
    markerAfterReload: Boolean(restored.markerPresent),
    activeArtifactAfterPrompt: after.context?.activeArtifactId ?? null,
    activeArtifactAfterReload: restored.context?.activeArtifactId ?? null,
    successfulGenerateCount: generate.filter((entry) => entry.status === 200).length,
    successfulArtifactCount: artifacts.filter((entry) => entry.status === 200).length,
    cloudSessionResponses: sessions.filter((entry) => entry.persistenceMode === "cloud" && entry.hostAuthenticated === "true" && entry.hostOrg === "present" && entry.hostUser === "present").length,
    unexpectedFailures: unexpectedFailures.map((entry) => `${entry.status} ${entry.path}`),
    pipeBStatus: evidence.pipeB.status,
    pipeBLineCount: evidence.pipeB.lineCount,
  };
  if (unexpectedFailures.length) await saveAndExit("FAIL", `Unexpected Agent UI API failures: ${evidence.checks.unexpectedFailures.join(", ")}`);
  if (!evidence.checks.usedDeterministicHostController) await saveAndExit("FAIL", `Amplify embed did not open through window.__sonikAgentHost. Open targets: ${evidence.checks.openTargets.join(", ")}`);
  if (!evidence.checks.sameSessionAfterPrompt) await saveAndExit("FAIL", "Fresh session changed during prompt execution.");
  if (!evidence.checks.markerAfterPrompt) await saveAndExit("FAIL", "Marker was not visible after prompt completion.");
  if (evidence.checks.successfulGenerateCount < 1) await saveAndExit("FAIL", "No successful /api/generate response observed.");
  if (evidence.checks.successfulArtifactCount < 1) await saveAndExit("FAIL", "No successful /api/artifact persistence response observed.");
  if (!evidence.checks.sameSessionAfterReload) await saveAndExit("FAIL", "Fresh session did not restore after Amplify reload/reopen.");
  if (!evidence.checks.markerAfterReload) await saveAndExit("FAIL", "Artifact marker did not restore after Amplify reload/reopen.");
  if (requirePipeB && evidence.pipeB.lineCount < 1) await saveAndExit("FAIL", "Pipe B tail did not capture any live lines.");
  if (evidence.pageErrors.length || evidence.requestFailures.length) await saveAndExit("FAIL", "Browser page errors/request failures observed during authenticated smoke.");
  await saveAndExit("PASS", "Authenticated embedded Agent UI fresh-session prompt created and restored a marker artifact with Pipe B tail evidence.");
} catch (error) {
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  for (const page of browser?.contexts?.().flatMap((context) => context.pages()) ?? []) {
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    break;
  }
  await browser?.close().catch(() => undefined);
  evidence.harnessError = redact(error instanceof Error ? error.stack || error.message : String(error)).slice(0, 4000);
  await saveAndExit("FAIL", error instanceof Error ? error.message : String(error));
}
