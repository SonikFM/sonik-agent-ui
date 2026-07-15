#!/usr/bin/env node
// Deterministic, no-model regression gate for three embedded-experience bugs
// that shipped unseen the week of 2026-07-07 and were fixed on 2026-07-08.
// Each check below pins exactly one of them so a recurrence fails the gate
// instead of shipping unseen again:
//
//   1. sessionSurvivesReopen — pins "embedded widget created a fresh session
//      on every mount". Opens the sidecar, records the active session id
//      (`window.__sonikAgentUI.getPageContext().activeSessionId`), closes it
//      via the host's `#booking-agent-ui-close-chat` control, then reloads
//      the host page (the actual "mount" trigger — `open()`/`close()` alone
//      reuse the same iframe without a fresh boot, see
//      packages/agent-embed/src/index.ts `setFrameMode`/`close`, so a bare
//      close+reopen without a reload can't exercise the regression) and
//      reopens via the launcher. Asserts the SAME session id comes back
//      (embedded bootstrap now resumes the most recent session instead of
//      always creating a new one — see `initializeSessions` in
//      apps/standalone-sveltekit/src/routes/+page.svelte).
//   2. sessionSwitcherPresent — pins "no session switcher in embedded mode".
//      Asserts `[data-testid="agent-session-switcher"]` exists in the
//      embedded frame with >=1 `<option>` (see
//      packages/chat-surface/src/components/AgentConversation.svelte, wired
//      from `sessions` in +page.svelte).
//   3. reservationRuntimeMounted — pins "booking runtime silently anonymous
//      -> executeCommand denied runtime_unavailable on the reservation
//      path". Does NOT invoke the LLM (no /api/generate call). Instead it
//      reads the live signed host-context envelope off
//      `getPageContext()` (already established by the real postMessage
//      handshake with the deployed booking host) and POSTs it as the
//      `x-sonik-agent-ui-host-context` header (capped at
//      SIGNED_HOST_CONTEXT_HEADER_MAX_CHARS = 16384, see
//      apps/standalone-sveltekit/src/lib/server/host-command-runtime.ts) to
//      `/api/session`. A 200 with `x-sonik-agent-ui-host-authenticated:
//      true` proves the signed envelope is accepted end-to-end and the
//      runtime resolves a real host session rather than falling back to
//      anonymous (which is what produced the runtime_unavailable denial).
//
// No prompt with real content is ever submitted, so no LLM is invoked.
//
// Run directly: node --experimental-strip-types scenarios/embedded-experience.eval.mjs
// (normally invoked by scripts/agent-eval-gate.mjs)

import { chromium } from "playwright";
import {
  loginWithEmailPassword,
  findAgentFrame,
  waitForPageControlReady,
  createPageControlClient,
  redact,
  sleep,
} from "../lib/page-control-driver.mjs";
import { applyOfflineDeterministicMocks } from "../lib/mock-factory.mjs";

const NAME = "embedded-experience";
const baseUrl = process.env.AGENT_EVAL_BASE_URL ?? "https://sonik-booking-app-pipe-b.liam-trampota.workers.dev";
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
const offline = process.env.AGENT_EVAL_MODE === "offline";
const timeoutMs = Number(process.env.AGENT_EVAL_SCENARIO_TIMEOUT_MS ?? 180_000);

const checks = {};
const diagnostics = {};
const notes = [];
const inconclusiveReasons = [];

function record(name, ok, detail) {
  checks[name] = { ok, detail };
}

async function closeAgentSidecar(page) {
  return page.evaluate(() => {
    const close = document.querySelector(
      '#booking-agent-ui-close-chat, #close-chat, [data-sonik-agent-ui-control="close-chat"], [data-testid="sonik-agent-ui-close-chat"], [aria-label="Close Sonik chat sidecar"], [aria-label="Close Sonik chat"]',
    );
    close?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return { closeFound: Boolean(close) };
  });
}

async function waitForBootstrappedSession(frame) {
  await frame
    .waitForFunction(
      () =>
        window.__sonikAgentUI?.getPageContext?.()?.hostSession?.authenticated === true &&
        window.__sonikAgentUI?.getAssertions?.()?.hasActiveSession === true &&
        Boolean(window.__sonikAgentUI.getPageContext()?.activeSessionId),
      undefined,
      { timeout: timeoutMs },
    )
    .catch(() => undefined);
}

async function run() {
  if (!email || !password) {
    throw new Error("Missing TEST_EMAIL/TEST_PASSWORD for embedded-experience scenario.");
  }
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "false", args: ["--disable-gpu", "--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });

    const login = await loginWithEmailPassword(context, { baseUrl, email, password });
    record("loginOk", login.ok, { status: login.status });
    if (!login.ok) inconclusiveReasons.push(`login failed with status ${login.status}`);

    const page = await context.newPage();
    if (offline) await applyOfflineDeterministicMocks(page);
    const runId = `agent-eval-${Date.now()}`;
    const dashboardUrl = `${baseUrl}/dashboard?smokeMockStream=${offline ? "1" : "0"}&smokeRunId=${encodeURIComponent(runId)}`;
    await page.goto(dashboardUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined);

    // --- open #1, establish baseline session + switcher + runtime probe ---
    const { frame: firstFrame, openPath: firstOpenPath } = await findAgentFrame(page, { attempts: 6, delayMs: 1500 });
    diagnostics.firstOpenPath = firstOpenPath;
    await waitForPageControlReady(firstFrame, { timeoutMs });
    await waitForBootstrappedSession(firstFrame);

    const firstClient = createPageControlClient(firstFrame);
    const firstPageContext = await firstClient.getPageContext();
    const firstAssertions = await firstClient.getAssertions();
    const sessionIdBeforeReload = firstPageContext?.activeSessionId ?? null;
    diagnostics.sessionIdBeforeReload = sessionIdBeforeReload;
    if (!sessionIdBeforeReload || firstAssertions?.hasActiveSession !== true) {
      inconclusiveReasons.push(
        `no active session established on first open (activeSessionId=${sessionIdBeforeReload}, hasActiveSession=${firstAssertions?.hasActiveSession}) — cannot verify session-survives-reopen`,
      );
    }

    // --- check 2: session switcher present with >=1 option ---
    const switcherInfo = await firstFrame.evaluate(() => {
      const el = document.querySelector('[data-testid="agent-session-switcher"]');
      return { present: Boolean(el), optionCount: el ? el.querySelectorAll("option").length : 0 };
    });
    diagnostics.switcherInfo = switcherInfo;
    record("sessionSwitcherPresent", switcherInfo.present && switcherInfo.optionCount >= 1, switcherInfo);

    // --- check 1: close, force a real remount (host page reload), reopen ---
    // Must run before check 3 below: check 3's probe itself creates a new
    // workspace session via POST /api/session, which would become the "most
    // recently created" session and corrupt this before/after comparison if
    // it ran first.
    const closeResult = await closeAgentSidecar(page);
    diagnostics.closeResult = closeResult;
    if (!closeResult.closeFound) {
      inconclusiveReasons.push("close control (#booking-agent-ui-close-chat) not found — could not exercise the close+remount path");
    }
    await sleep(1000);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined);

    const { frame: secondFrame, openPath: secondOpenPath } = await findAgentFrame(page, { attempts: 6, delayMs: 1500 });
    diagnostics.secondOpenPath = secondOpenPath;
    await waitForPageControlReady(secondFrame, { timeoutMs });
    await waitForBootstrappedSession(secondFrame);
    const secondClient = createPageControlClient(secondFrame);
    const secondPageContext = await secondClient.getPageContext();
    const sessionIdAfterReopen = secondPageContext?.activeSessionId ?? null;
    diagnostics.sessionIdAfterReopen = sessionIdAfterReopen;

    if (sessionIdBeforeReload && sessionIdAfterReopen) {
      record("sessionSurvivesReopen", sessionIdBeforeReload === sessionIdAfterReopen, {
        sessionIdBeforeReload,
        sessionIdAfterReopen,
      });
    } else {
      inconclusiveReasons.push(
        `sessionSurvivesReopen: could not compare (before=${sessionIdBeforeReload}, after=${sessionIdAfterReopen})`,
      );
    }

    // --- check 3: the page's exact opaque host authority is accepted (no LLM call) ---
    const sessionResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === agentOrigin && url.pathname === "/api/session" && response.request().method() === "POST";
    });
    const actionResultPromise = secondFrame.evaluate(async () => window.__sonikAgentUI.actions.createSession());
    const [sessionResponse, actionResult] = await Promise.all([sessionResponsePromise, actionResultPromise]);
    const observedOpaqueHeader = sessionResponse.request().headers()["x-sonik-agent-ui-host-context"] ?? "";
    const responseHeaders = sessionResponse.headers();
    const sessionCreateProbe = {
      ok: sessionResponse.ok() && actionResult?.ok === true,
      status: sessionResponse.status(),
      headerBytes: new TextEncoder().encode(observedOpaqueHeader).length,
      headers: {
        hostAuthenticated: responseHeaders["x-sonik-agent-ui-host-authenticated"] ?? null,
        hostOrg: responseHeaders["x-sonik-agent-ui-host-org"] ?? null,
        hostUser: responseHeaders["x-sonik-agent-ui-host-user"] ?? null,
        cloudError: responseHeaders["x-sonik-agent-ui-cloud-error"] ?? null,
      },
      actionResult,
    };
    diagnostics.sessionCreateProbe = sessionCreateProbe;
    if (sessionCreateProbe.error) {
      inconclusiveReasons.push(`reservationRuntimeMounted: ${sessionCreateProbe.error}`);
    }
    record(
      "reservationRuntimeMounted",
      sessionCreateProbe.ok === true &&
        sessionCreateProbe.headerBytes <= 16384 &&
        sessionCreateProbe.headers.hostAuthenticated === "true" &&
        sessionCreateProbe.headers.hostOrg === "present" &&
        sessionCreateProbe.headers.hostUser === "present" &&
        sessionCreateProbe.headers.cloudError == null,
      sessionCreateProbe,
    );

    await page.screenshot({ path: `.omx/logs/${NAME}-${runId}.png`, fullPage: true }).catch(() => undefined);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

const startedAt = Date.now();
try {
  await Promise.race([
    run(),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Scenario timed out after ${timeoutMs}ms`)), timeoutMs + 20_000)),
  ]);
  const failing = Object.entries(checks).filter(([, v]) => v.ok !== true);
  const status = failing.length === 0 ? (inconclusiveReasons.length > 0 ? "INCONCLUSIVE" : "PASS") : "FAIL";
  const result = {
    name: NAME,
    status,
    durationMs: Date.now() - startedAt,
    checks,
    diagnostics,
    notes,
    inconclusiveReasons,
    failingChecks: failing.map(([k]) => k),
  };
  console.log(JSON.stringify(result));
  process.exit(status === "FAIL" ? 1 : 0);
} catch (error) {
  const result = {
    name: NAME,
    status: "FAIL",
    durationMs: Date.now() - startedAt,
    checks,
    diagnostics,
    notes,
    error: redact(error?.stack || error?.message || String(error), [password]),
  };
  console.log(JSON.stringify(result));
  process.exit(1);
}
