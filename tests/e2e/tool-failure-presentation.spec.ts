import { expect, test } from "@playwright/test";
import { TOOL_FAILURE_SCENARIO, gotoFreshWorkspace, smokeUrl, submitPrompt } from "./support/dev-smoke";

// R2 / Slice C, pinned from the live-transcript failure: "the tool call failure...
// it should only display as a failure if it doesn't work and your streaming stops"
// (docs/handoffs/streaming-canvas-artifact-ux-investigation-2026-07-08.md). The
// transcript's literal example was a `createJsonArtifact` failure rendering as
// "Canvas creation failed" x4 -- the dev-smoke tool-failure-stream scenario
// (added in this slice, apps/standalone-sveltekit/src/lib/server/dev-smoke-stream.ts)
// reproduces exactly that: a `createJsonArtifact` call that resolves as
// `tool-output-error`.
//
// packages/chat-surface/src/components/ToolCallBlock.svelte renders `data-tool-state`
// straight off the raw AI SDK part state and turns the summary red the instant
// `output-error` arrives -- there is no "recoverable during an active stream" grace
// period today.

test("tool-failure-presentation: a failed tool call renders as an immediate failure today", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(TOOL_FAILURE_SCENARIO));
  await submitPrompt(page, "make a visual");

  const toolBlock = page.locator("[data-tool-phase]").first();
  await expect(toolBlock).toHaveAttribute("data-tool-state", "output-error", { timeout: 10_000 });
  await expect(toolBlock.locator("summary")).toContainText("Canvas creation failed");

  // Technical receipt stays available (expandable), which Slice C keeps as-is --
  // only the default/collapsed-during-stream presentation changes.
  await toolBlock.click();
  await expect(toolBlock.locator("dd").last()).toContainText("dev smoke injected tool failure");
});

test.fixme(
  "tool-failure-presentation (target state): recoverable tool failure stays neutral/collapsed while the turn is still streaming",
  async ({ page }) => {
    // Slice C: while a turn is streaming, collapse tool `output-error`/`output-denied`
    // into a neutral "checking / retrying" activity label; only promote to a
    // user-facing failure if the turn ends without recovery (plan section "Slice C —
    // Recoverable-failure presentation policy (R2)"). Today ToolCallBlock has no
    // streaming-aware grace period, so this assertion fails until that policy layer
    // (and its `tool.failure.recovered` / `tool.failure.terminal` telemetry) exists.
    await gotoFreshWorkspace(page, smokeUrl(TOOL_FAILURE_SCENARIO));
    await submitPrompt(page, "make a visual");

    const toolBlock = page.locator("[data-tool-phase]").first();
    await expect(toolBlock).toHaveAttribute("data-tool-state", "output-error", { timeout: 10_000 });
    await expect(toolBlock.locator("summary")).not.toContainText("failed");
    await expect(toolBlock.locator("summary")).toContainText(/checking|retrying/i);
  },
);
