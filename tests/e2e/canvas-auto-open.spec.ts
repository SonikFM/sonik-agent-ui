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

test(
  "canvas-auto-open: embedded host chat mode suppresses the local canvas pane",
  async ({ page }) => {
    // This baseline intentionally does not submit the mock stream: the page is
    // not running inside a real parent host that can receive canvas.open and
    // donate the follow-up page-context mode change.
    await gotoFreshWorkspace(page, smokeUrl(null, { embedMode: "chat", agentUiHostOrigin: "http://localhost" }));

    await expect(page.locator(".workspace-root")).toHaveAttribute("data-artifact-open", "false");
    await expect(page.locator(".workspace-pane--artifact")).toHaveCount(0);
  },
);

test("canvas-auto-open: embedded chat mode baseline -- canvas pane stays hidden before any artifact exists", async ({ page }) => {
  // Guards the other regression direction: chat mode should not eagerly show
  // the canvas pane just because it's embedded -- only once there is actually
  // an artifact/document/pending intent to show.
  await gotoFreshWorkspace(page, smokeUrl(null, { embedMode: "chat" }));

  await expect(page.locator(".workspace-root")).toHaveAttribute("data-artifact-open", "false");
  await expect(page.locator(".workspace-pane--artifact")).toHaveCount(0);
});
