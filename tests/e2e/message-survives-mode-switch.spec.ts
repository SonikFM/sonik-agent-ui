import { expect, test } from "@playwright/test";
import { ARTIFACT_INPUT_SCENARIO, gotoFreshWorkspace, smokeUrl, submitPrompt } from "./support/dev-smoke";

// R (iframe remount hypothesis) / Slice B, pinned from the live-transcript failure:
// "I also sent Help Me Create a Reservation three times... it just disappeared while
// i had the canvas open... Yeah it's probably the iframe remount"
// (docs/handoffs/streaming-canvas-artifact-ux-investigation-2026-07-08.md, finding #5).
//
// What this actually exercises: the standalone dev rig has no live embedding host, so a
// true no-reload iframe src swap (packages/agent-embed/src/index.ts `setFrameMode`)
// can't be driven from here. `embedMode` is read once in `onMount` (+page.svelte
// `applyEmbedUrlOptions`, called only from `onMount`) with no runtime re-sync from the
// URL, so the only way to change chat/canvas layout mode at all in this rig is a full
// navigation with a different `embedMode` param -- which is also the closest available
// analog to a host-driven remount (new page load, session-bootstrap resume path). This
// test drives THAT: submit a prompt, then navigate away and back mid-stream (simulating
// chat -> canvas -> chat) before the response has finished, and assert the user's
// message survives the round trip via session-resume (see +page.svelte
// `initializeSessions`, which always resumes the most-recently-created session in
// standalone mode).

test("message-survives-mode-switch: in-flight user message survives a chat->canvas->chat navigation round trip", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(ARTIFACT_INPUT_SCENARIO));
  const prompt = "make a visual mode switch test";
  await submitPrompt(page, prompt);

  // Still mid-stream: the artifact-input-stream scenario takes ~500ms end to end
  // (7 tool-input-delta chunks at 60ms apiece plus preamble text), so this window
  // reliably lands before it completes.
  await page.waitForTimeout(150);

  await page.goto(smokeUrl(ARTIFACT_INPUT_SCENARIO, { embedMode: "canvas" }), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.goto(smokeUrl(ARTIFACT_INPUT_SCENARIO, { embedMode: "chat" }), { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);

  await expect(page.locator(".agent-message__user-content", { hasText: prompt })).toBeVisible({ timeout: 10_000 });
});
