import type { Page } from "@playwright/test";

// Trigger for the dev-only mock stream, reverse-engineered from
// apps/standalone-sveltekit/src/routes/+page.svelte `createDevSmokeHeaders()` and
// apps/standalone-sveltekit/src/lib/server/dev-smoke-stream.ts. Three prior probe
// attempts failed to trigger this -- the two load-bearing details that were missing:
//
//   1. Standalone workspace mode only. Do NOT add `agentUiHostOrigin` (that flips
//      `isEmbeddedHostContextExpected()` true, which then requires a signed
//      host-context envelope from a real embedding host before `workspaceFetch`
//      will even send a request -- see `isWorkspaceHostContextReady()`).
//   2. The query params alone don't start a run -- a message still has to be
//      submitted through the composer. `createDevSmokeHeaders()` reads
//      `smokeMockStream`/`smokeScenario` off `window.location.search` on every
//      `workspaceFetch` call, so any non-empty prompt text works; the mock
//      stream response completely ignores the submitted prompt's content.
//
// Scenario names mirror DEV_SMOKE_ARTIFACT_INPUT_SCENARIO / DEV_SMOKE_TOOL_FAILURE_SCENARIO
// exported from dev-smoke-stream.ts (not imported directly -- that module pulls in
// `$app/environment`, a SvelteKit alias that only resolves inside Vite, not Playwright's
// test transform).
export const ARTIFACT_INPUT_SCENARIO = "artifact-input-stream";
export const TOOL_FAILURE_SCENARIO = "tool-failure-stream";
export const DOCUMENT_INTENT_SCENARIO = "document-intent-stream";
export const DOCUMENT_FAILURE_SCENARIO = "document-failure-stream";

/** `scenario` omitted (or null) selects the default text-only dev-smoke stream
 *  (dev-smoke-stream.ts's fallback branch -- three text-delta chunks, no tool call). */
export function smokeUrl(scenario: string | null, extraParams: Record<string, string> = {}): string {
  const params = new URLSearchParams({ smokeMockStream: "1", ...extraParams });
  if (scenario) params.set("smokeScenario", scenario);
  return `/?${params.toString()}`;
}

/**
 * Navigate to a dev-smoke URL and force a brand-new server-side workspace session.
 *
 * The dev server's workspace-session store is in-memory and standalone mode always
 * resumes the most-recently-created session (constant "standalone" bootstrap key --
 * see +page.svelte `maybeBootstrapSessions`), so a bare page load can inherit messages
 * left behind by a previous test/run against the same dev server. Clicking the rail's
 * "+ New chat" button (visible pre-first-message in workspace layout mode) creates a
 * fresh session and gives each test a clean transcript.
 */
export async function gotoFreshWorkspace(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const textarea = page.locator("textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 15_000 });
  const newChatButton = page.getByRole("button", { name: "New chat" });
  if ((await newChatButton.count()) > 0) {
    await newChatButton.first().click();
    await page.waitForTimeout(300);
  }
}

export async function submitPrompt(page: Page, text: string): Promise<void> {
  const textarea = page.locator("textarea").first();
  await textarea.fill(text);
  await textarea.press("Enter");
}
