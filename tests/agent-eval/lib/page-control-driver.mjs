// Deterministic "fake agent" driver for the Sonik page-control contract.
//
// Adapted from open-design's e2e/lib/playwright/{mock-factory,fake-agents}.ts
// pattern: instead of driving the UI through pixel-level clicks, this drives
// the embedded Sonik agent sidecar exclusively through its documented
// runtime-safe automation seam, `window.__sonikAgentUI`
// (see apps/standalone-sveltekit/src/routes/+page.svelte `installAgentPageControl`
// and packages/agent-observability/src/index.ts `AgentUiPageControl`).
//
// No LLM is invoked by anything in this file. Every helper below either reads
// a structural snapshot or calls a semantic action that resolves
// synchronously/locally against client state.

const PAGE_CONTROL_SCHEMA_VERSION = "sonik.agent_ui.page_control.v1";
const ASSERTIONS_SCHEMA_VERSION = "sonik.agent_ui.assertions.v1";

// The 13 actions registered on `AgentUiPageControl["actions"]`. Keep this in
// sync with packages/agent-observability/src/index.ts — the contract
// scenario asserts this exact set exists on the live page.
const PAGE_CONTROL_ACTION_NAMES = [
  "createSession",
  "submitPrompt",
  "stop",
  "clearChat",
  "clearArtifact",
  "reloadSession",
  "openWorkspaceDocument",
  "submitAnswer",
  "markUnknown",
  "saveDraft",
  "requestApproval",
  "approveAndRun",
  "cancelApproval",
  // Added 2026-07-07 (tour/action-channel lane): host-action + tour primitives.
  "requestHostAction",
  "openCanvas",
  "highlightTarget",
  "requestApprovalPreview",
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redact(value, secrets = []) {
  let text = String(value ?? "");
  for (const secret of secrets) {
    if (secret) text = text.replaceAll(secret, "[redacted]");
  }
  return text.replace(/(vck_[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,})/gi, "[secret]");
}

/**
 * Log into the deployed booking app via the same email/password endpoint a
 * real user's browser would hit, so the resulting Playwright browser context
 * carries a real session cookie. This intentionally does not touch the page
 * DOM — it mirrors how `scripts/agent-ui-booking-context-pipeb-smoke.mjs`
 * authenticates before opening the sidecar.
 */
async function loginWithEmailPassword(context, { baseUrl, email, password, callbackURL = "/dashboard" }) {
  if (!email || !password) {
    throw new Error("loginWithEmailPassword requires both email and password (TEST_EMAIL/TEST_PASSWORD).");
  }
  const response = await context.request.post(`${baseUrl}/api/auth/sign-in/email`, {
    data: { email, password, callbackURL },
    headers: { accept: "application/json" },
  });
  return { status: response.status(), ok: response.status() < 400 };
}

/**
 * Open the agent sidecar via its one first-class path: the open-chat DOM
 * controls (the same selector list `scripts/agent-ui-booking-context-pipeb-smoke.mjs`
 * uses). `window.__sonikAgentHost` does not exist on the booking app today —
 * it was added to `packages/agent-embed` during the Jul 5 determinism
 * hardening but never ported into `@sonikfm/sonik-sdk`'s embed code, which is
 * what the booking app actually uses (see
 * docs/handoffs/booking-host-controller-e2e-gap-evidence-2026-07-06.md). This
 * still runs one explicit forward-compat check ahead of the DOM path — if
 * `window.__sonikAgentHost?.openChat` exists (e.g. once that SDK port lands),
 * it's used instead, and either path is recorded as `openPath` evidence
 * rather than a silent fallback.
 */
async function openAgentSidecar(page) {
  return page.evaluate(() => {
    const host = window.__sonikAgentHost;
    if (host?.schemaVersion === "sonik.agent_ui.host_controller.v1" && typeof host.openChat === "function") {
      host.openChat();
      return { openPath: "host-controller", hostSchemaVersion: host.schemaVersion };
    }
    const launcher = document.querySelector(
      '#agent-fab-main, [data-sonik-agent-ui-control="launcher"], [data-testid="sonik-agent-ui-launcher"], [aria-label="Open Sonik agent launcher"], [aria-label="Open Sonik agent"]',
    );
    launcher?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    const chat = document.querySelector(
      '#booking-agent-ui-open-chat, #open-chat, [data-sonik-agent-ui-control="open-chat"], [data-testid="sonik-agent-ui-open-chat"], [aria-label="Open Sonik chat sidecar"], [aria-label="Open Sonik chat"]',
    );
    chat?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return {
      openPath: "dom-control",
      hasHostControllerProbe: Boolean(host),
      hostSchemaVersion: host?.schemaVersion ?? null,
      launcherFound: Boolean(launcher),
      chatFound: Boolean(chat),
    };
  });
}

/**
 * Poll for the embedded agent iframe. Re-invokes `openAgentSidecar` on each
 * attempt since the DOM controls can be mounted after initial page load.
 */
async function findAgentFrame(page, { attempts = 6, delayMs = 1500 } = {}) {
  const openAttempts = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const openResult = await openAgentSidecar(page);
    openAttempts.push({ attempt, ...openResult });
    await sleep(delayMs);
    const frame = page.frames().find((candidate) => {
      const url = candidate.url();
      return url.includes("embedMode=") || url.includes("agentUiHostOrigin=");
    });
    if (frame) {
      return { frame, openAttempts, openPath: openResult.openPath };
    }
  }
  throw new Error(`Agent sidecar iframe did not appear after ${attempts} attempts. Attempts: ${JSON.stringify(openAttempts)}`);
}

/**
 * Wait until `window.__sonikAgentUI` is installed inside the iframe and
 * exposes the expected shape (schemaVersion + getPageContext/getAssertions +
 * all 13 actions as callables).
 */
async function waitForPageControlReady(frame, { timeoutMs = 60_000 } = {}) {
  await frame.waitForFunction(
    (actionNames) => {
      const control = window.__sonikAgentUI;
      if (!control || typeof control.getPageContext !== "function" || typeof control.getAssertions !== "function") return false;
      return actionNames.every((name) => typeof control.actions?.[name] === "function");
    },
    PAGE_CONTROL_ACTION_NAMES,
    { timeout: timeoutMs },
  );
}

/**
 * Thin remote-invocation wrapper around `window.__sonikAgentUI` inside the
 * agent iframe. Every method round-trips through `frame.evaluate`, so callers
 * only ever see plain serializable data — never a live page handle — keeping
 * assertions structural (ok/reason shape) rather than DOM-scraping.
 */
function createPageControlClient(frame) {
  return {
    async getPageContext() {
      return frame.evaluate(() => window.__sonikAgentUI.getPageContext());
    },
    async getAssertions() {
      return frame.evaluate(() => window.__sonikAgentUI.getAssertions());
    },
    async getSchemaVersion() {
      return frame.evaluate(() => window.__sonikAgentUI.schemaVersion);
    },
    async getActionNames() {
      return frame.evaluate(() => Object.keys(window.__sonikAgentUI.actions ?? {}).sort());
    },
    /** Call `window.__sonikAgentUI.actions[name](input)` and return its result verbatim. */
    async callAction(name, input) {
      if (!PAGE_CONTROL_ACTION_NAMES.includes(name)) {
        throw new Error(`Unknown page-control action: ${name}`);
      }
      return frame.evaluate(
        ({ name: actionName, input: actionInput }) => window.__sonikAgentUI.actions[actionName](actionInput ?? {}),
        { name, input },
      );
    },
  };
}

export {
  PAGE_CONTROL_SCHEMA_VERSION,
  ASSERTIONS_SCHEMA_VERSION,
  PAGE_CONTROL_ACTION_NAMES,
  sleep,
  redact,
  loginWithEmailPassword,
  openAgentSidecar,
  findAgentFrame,
  waitForPageControlReady,
  createPageControlClient,
};
