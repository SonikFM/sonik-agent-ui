import { expect, test } from "@playwright/test";
import { ARTIFACT_INPUT_SCENARIO, gotoFreshWorkspace, smokeUrl, submitPrompt } from "./support/dev-smoke";

// R1 / Slice B (docs/plans/experience-seams-resolution-plan-2026-07-08.md), pinned from
// the live-transcript failure in docs/handoffs/streaming-canvas-artifact-ux-investigation-2026-07-08.md:
// "It doesn't automatically open when you say 'creating an artifact'. It should after
// it's created." WorkspaceRoot stamps `data-artifact-open` on `.workspace-root` and only
// renders `.workspace-pane--artifact` when it's true (packages/workspace-core/src/components/WorkspaceRoot.svelte).

test("canvas-auto-open: standalone workspace mode auto-shows the canvas once an artifact streams in", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(ARTIFACT_INPUT_SCENARIO));
  await submitPrompt(page, "make a visual");

  // +page.svelte's artifactOpen derivation: for the default "workspace" embedMode,
  // artifactOpen falls out of `Boolean(activeArtifact || pendingArtifactIntent || ...)`,
  // so once the mock createJsonArtifact tool call streams in, the canvas pane should
  // mount without any explicit "open canvas" action from the agent.
  await expect(page.locator(".workspace-root")).toHaveAttribute("data-artifact-open", "true", { timeout: 10_000 });
  await expect(page.locator(".workspace-pane--artifact")).toBeVisible();
});

test.fixme(
  "canvas-auto-open: embedded chat mode (embedMode=chat) also auto-opens the canvas on artifact creation",
  async ({ page }) => {
    // Today, `artifactOpen` is hard-forced to `false` whenever `embedMode === "chat"`
    // (+page.svelte:337-343), regardless of whether an artifact exists -- the embedded
    // chat surface never shows a canvas the agent created unless the host separately
    // calls `canvas.open`. Slice B wires `artifact.stream.preview_mounted` to request
    // `canvas.open` from the host (agent-embed already exposes the action at
    // packages/agent-embed/src/index.ts:793) and/or relaxes this force-false so the
    // rendered surface reflects "an artifact now exists" the same way workspace mode
    // does. Flip this test (remove test.fixme) once that lands.
    await gotoFreshWorkspace(page, smokeUrl(ARTIFACT_INPUT_SCENARIO, { embedMode: "chat" }));
    await submitPrompt(page, "make a visual");

    await expect(page.locator(".workspace-root")).toHaveAttribute("data-artifact-open", "true", { timeout: 10_000 });
    await expect(page.locator(".workspace-pane--artifact")).toBeVisible();
  },
);

test("canvas-auto-open: embedded chat mode baseline -- canvas pane stays hidden today even with an active artifact", async ({ page }) => {
  // Pins today's actual (buggy) behavior so a regression the other direction
  // (canvas suddenly showing in chat mode without a deliberate fix) is still caught.
  await gotoFreshWorkspace(page, smokeUrl(ARTIFACT_INPUT_SCENARIO, { embedMode: "chat" }));
  await submitPrompt(page, "make a visual");
  await page.waitForTimeout(1500);

  await expect(page.locator(".workspace-root")).toHaveAttribute("data-artifact-open", "false");
  await expect(page.locator(".workspace-pane--artifact")).toHaveCount(0);
});
