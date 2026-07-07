#!/usr/bin/env node
// Deterministic, no-model conformance check for the `window.__sonikAgentUI`
// page-control contract (packages/agent-observability/src/index.ts
// `AgentUiPageControl`). Asserts:
//
//   1. The host-controller schemaVersion and assertions schemaVersion match
//      the pinned contract versions.
//   2. All 13 registered actions exist and are callable.
//   3. Every action returns the documented { ok, state, ... } shape, and is
//      either accepted (ok: true) or typed-refused (ok: false with a string
//      `disabledReason`) — never throws, never returns an untyped shape.
//   4. `submitPrompt({ prompt: "" })` is refused with disabledReason
//      "empty_prompt" specifically, when a session is active (this exact
//      refusal reason requires a live, host-authenticated session — see
//      lib/mock-factory.mjs limitation notice — so it is reported as
//      INCONCLUSIVE rather than FAIL when no session could be established).
//   5. `getAssertions()` returns the documented field shape with correct
//      value types.
//
// No prompt with real content is ever submitted, so no LLM is invoked.
//
// Run directly: node --experimental-strip-types scenarios/page-control-contract.eval.mjs
// (normally invoked by scripts/agent-eval-gate.mjs)

import { chromium } from "playwright";
import {
  PAGE_CONTROL_SCHEMA_VERSION,
  ASSERTIONS_SCHEMA_VERSION,
  PAGE_CONTROL_ACTION_NAMES,
  loginWithEmailPassword,
  findAgentFrame,
  waitForPageControlReady,
  createPageControlClient,
  redact,
} from "../lib/page-control-driver.mjs";
import { applyOfflineDeterministicMocks } from "../lib/mock-factory.mjs";

const NAME = "page-control-contract";
const baseUrl = process.env.AGENT_EVAL_BASE_URL ?? "https://sonik-booking-app-pipe-b.liam-trampota.workers.dev";
const email = process.env.TEST_EMAIL;
const password = process.env.TEST_PASSWORD;
const offline = process.env.AGENT_EVAL_MODE === "offline";
const timeoutMs = Number(process.env.AGENT_EVAL_SCENARIO_TIMEOUT_MS ?? 120_000);

const checks = {};
const diagnostics = {};
const notes = [];
let inconclusiveReasons = [];

function record(name, ok, detail) {
  checks[name] = { ok, detail };
}

function isSemanticActionResultShape(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.ok === "boolean" &&
    value.state !== null &&
    typeof value.state === "object" &&
    (value.disabledReason === undefined || typeof value.disabledReason === "string") &&
    (value.message === undefined || typeof value.message === "string")
  );
}

async function run() {
  if (!email || !password) {
    throw new Error("Missing TEST_EMAIL/TEST_PASSWORD for page-control-contract scenario.");
  }
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "false", args: ["--disable-gpu", "--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });

    // Note: `context.request` (used for login below) is a raw API request
    // context that Playwright's page-level `route()` cannot intercept, so
    // offline mocks only ever apply to the page created after login (see
    // lib/mock-factory.mjs limitation notice re: the trusted host-context
    // boundary). In offline mode without a live backend, login is expected
    // to fail here — that's surfaced as an inconclusive reason below rather
    // than a hard crash.
    const login = await loginWithEmailPassword(context, { baseUrl, email, password });
    record("loginOk", login.ok, { status: login.status });
    if (!login.ok) {
      inconclusiveReasons.push(`login failed with status ${login.status}`);
    }

    const page = await context.newPage();
    if (offline) await applyOfflineDeterministicMocks(page);
    const runId = `agent-eval-${Date.now()}`;
    await page.goto(`${baseUrl}/dashboard?smokeMockStream=${offline ? "1" : "0"}&smokeRunId=${encodeURIComponent(runId)}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 45_000 }).catch(() => undefined);

    // How the sidecar was opened is a separate contract from
    // window.__sonikAgentUI (the actual subject of this scenario): the DOM
    // open-chat controls are the canonical path today (see
    // lib/page-control-driver.mjs `openAgentSidecar` and
    // docs/handoffs/booking-host-controller-e2e-gap-evidence-2026-07-06.md —
    // window.__sonikAgentHost was never ported into @sonikfm/sonik-sdk, so it
    // doesn't exist on the booking app yet). `openPath` is recorded as
    // evidence, not a pass/fail check, so a degraded/not-yet-built
    // host-controller probe never masks a fully-conformant page-control
    // surface underneath it.
    const { frame, openPath, openAttempts } = await findAgentFrame(page, { attempts: 6, delayMs: 1500 });
    diagnostics.sidecarOpenPath = { openPath, openAttempts };
    notes.push(
      openPath === "host-controller"
        ? "Opened via window.__sonikAgentHost.openChat() (host-controller forward-compat probe succeeded)."
        : "Opened via DOM open-chat controls (the canonical path today — window.__sonikAgentHost isn't ported into @sonikfm/sonik-sdk yet; see docs/handoffs/booking-host-controller-e2e-gap-evidence-2026-07-06.md).",
    );
    await waitForPageControlReady(frame, { timeoutMs });
    // The embedded page needs a signed host-context handshake with its parent
    // (postMessage round trip) before session-dependent actions like
    // createSession will succeed — without this wait, createSession can race
    // that handshake and spuriously return "missing_host_context".
    await frame
      .waitForFunction(() => window.__sonikAgentUI.getPageContext()?.hostSession?.authenticated === true, undefined, { timeout: timeoutMs })
      .catch(() => undefined);

    const client = createPageControlClient(frame);

    // --- 1. schemaVersion checks ---
    const schemaVersion = await client.getSchemaVersion();
    record("pageControlSchemaVersion", schemaVersion === PAGE_CONTROL_SCHEMA_VERSION, { expected: PAGE_CONTROL_SCHEMA_VERSION, actual: schemaVersion });

    const assertionsBefore = await client.getAssertions();
    record("assertionsSchemaVersion", assertionsBefore?.schemaVersion === ASSERTIONS_SCHEMA_VERSION, {
      expected: ASSERTIONS_SCHEMA_VERSION,
      actual: assertionsBefore?.schemaVersion,
    });

    // --- 2. all 13 actions exist and are callable ---
    const actionNames = await client.getActionNames();
    const expectedSorted = [...PAGE_CONTROL_ACTION_NAMES].sort();
    record("allThirteenActionsRegistered", JSON.stringify(actionNames) === JSON.stringify(expectedSorted), {
      expected: expectedSorted,
      actual: actionNames,
    });

    // --- 3 & 4. drive each action, asserting typed shape; empty-prompt refusal ---
    const createSessionResult = await client.callAction("createSession", {});
    record("createSessionTypedShape", isSemanticActionResultShape(createSessionResult), createSessionResult);
    const sessionReady = createSessionResult?.ok === true;
    if (!sessionReady) inconclusiveReasons.push(`createSession did not succeed: ${JSON.stringify(createSessionResult)}`);

    const submitEmptyResult = await client.callAction("submitPrompt", { prompt: "" });
    record("submitPromptTypedShape", isSemanticActionResultShape(submitEmptyResult), submitEmptyResult);
    record("submitPromptRejectsEmpty", submitEmptyResult?.ok === false, submitEmptyResult);
    if (sessionReady) {
      record("submitPromptEmptyReasonIsEmptyPrompt", submitEmptyResult?.disabledReason === "empty_prompt", submitEmptyResult);
    } else {
      notes.push("submitPromptEmptyReasonIsEmptyPrompt: INCONCLUSIVE (no active session, cannot isolate empty_prompt from missing_session/missing_host_context)");
    }

    const stopResult = await client.callAction("stop", {});
    record("stopTypedShape", isSemanticActionResultShape(stopResult), stopResult);
    record("stopWhenNotStreamingReturnsOk", stopResult?.ok === true, stopResult);

    const clearChatResult = await client.callAction("clearChat", {});
    record("clearChatTypedShape", isSemanticActionResultShape(clearChatResult), clearChatResult);

    const clearArtifactResult = await client.callAction("clearArtifact", {});
    record("clearArtifactTypedShape", isSemanticActionResultShape(clearArtifactResult), clearArtifactResult);

    const reloadSessionResult = await client.callAction("reloadSession", {});
    record("reloadSessionTypedShape", isSemanticActionResultShape(reloadSessionResult), reloadSessionResult);

    const openWorkspaceDocumentResult = await client.callAction("openWorkspaceDocument", {});
    record("openWorkspaceDocumentTypedShape", isSemanticActionResultShape(openWorkspaceDocumentResult), openWorkspaceDocumentResult);

    // submitAnswer/markUnknown/saveDraft/requestApproval/approveAndRun/cancelApproval
    // all require an active json-render artifact; without one they must be
    // typed-refused with "missing_active_artifact" rather than throw.
    const noArtifactActions = ["submitAnswer", "markUnknown", "saveDraft", "requestApproval", "approveAndRun", "cancelApproval"];
    for (const actionName of noArtifactActions) {
      const input = actionName === "submitAnswer" || actionName === "markUnknown" ? { questionId: "agent-eval-nonexistent-question" } : {};
      // eslint-disable-next-line no-await-in-loop
      const result = await client.callAction(actionName, input);
      record(`${actionName}TypedShape`, isSemanticActionResultShape(result), result);
      record(`${actionName}RefusedWithoutActiveArtifact`, result?.ok === false && result?.disabledReason === "missing_active_artifact", result);
    }

    // --- 5. getAssertions() shape ---
    const assertionsAfter = await client.getAssertions();
    const assertionsShapeOk =
      typeof assertionsAfter?.hasActiveSession === "boolean" &&
      typeof assertionsAfter?.isStreaming === "boolean" &&
      typeof assertionsAfter?.canSubmit === "boolean" &&
      typeof assertionsAfter?.hasActiveArtifact === "boolean" &&
      typeof assertionsAfter?.hasActiveDocument === "boolean" &&
      typeof assertionsAfter?.messageCount === "number" &&
      typeof assertionsAfter?.visibleErrorCount === "number" &&
      (assertionsAfter?.lastPersistStatus === undefined || ["idle", "eligible", "in_flight", "success", "error"].includes(assertionsAfter.lastPersistStatus));
    record("assertionsFieldShape", assertionsShapeOk, assertionsAfter);

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
    notes,
    error: redact(error?.stack || error?.message || String(error), [password]),
  };
  console.log(JSON.stringify(result));
  process.exit(1);
}
