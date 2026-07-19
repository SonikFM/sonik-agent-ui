import { expect, test, type Page } from "@playwright/test";
import { ARTIFACT_INPUT_SCENARIO, gotoFreshWorkspace, smokeUrl, submitPrompt } from "./support/dev-smoke";

async function openWorkspaceDocument(page: Page): Promise<void> {
  const result = await page.evaluate(async () => {
    const control = window.__sonikAgentUI;
    if (!control) return { ok: false, message: "page control unavailable" };
    return control.actions.openWorkspaceDocument();
  });
  expect(result.ok).toBe(true);
}

async function documentGeometry(page: Page): Promise<{
  innerWidth: number;
  toolbarGap: number;
  toolbarOverflowX: string;
  bodyOverflows: boolean;
}> {
  const frame = page.frameLocator('iframe[title="Workspace document editor"]');
  await expect(frame.locator("#doc-md-toolbar")).toBeVisible({ timeout: 15_000 });
  return frame.locator("body").evaluate(() => {
    const tabBar = document.querySelector<HTMLElement>("#doc-tab-bar");
    const toolbar = document.querySelector<HTMLElement>("#doc-md-toolbar");
    if (!tabBar || !toolbar) throw new Error("document tab bar or Markdown toolbar unavailable");
    const tabRect = tabBar.getBoundingClientRect();
    const toolbarRect = toolbar.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      toolbarGap: Math.round((toolbarRect.top - tabRect.bottom) * 100) / 100,
      toolbarOverflowX: getComputedStyle(toolbar).overflowX,
      bodyOverflows: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

test("canvas controls: narrow streaming reasons settle and document toolbar gets its iframe-width separator", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await gotoFreshWorkspace(page, smokeUrl(ARTIFACT_INPUT_SCENARIO));

  await expect.poll(() => page.evaluate(() => window.__sonikAgentUI?.getCanvasControls?.().clear.disabledReason)).toBe("missing_active_artifact");
  const missingClear = await page.evaluate(() => window.__sonikAgentUI?.actions.clearArtifact());
  expect(missingClear).toMatchObject({ ok: false, disabledReason: "missing_active_artifact" });
  await submitPrompt(page, "make a visual");
  await expect.poll(() => page.evaluate(() => window.__sonikAgentUI?.getCanvasControls?.().clear.disabledReason), { timeout: 5_000 }).toBe("streaming");
  const streamingClear = await page.evaluate(() => window.__sonikAgentUI?.actions.clearArtifact());
  expect(streamingClear).toMatchObject({ ok: false, disabledReason: "streaming" });
  await expect.poll(() => page.evaluate(() => window.__sonikAgentUI?.getCanvasControls?.().clear.enabled), { timeout: 10_000 }).toBe(true);
  const clearParity = await page.evaluate(() => {
    const control = window.__sonikAgentUI;
    return {
      state: control?.getCanvasControls?.().clear,
      descriptor: control?.getActions().actions.find((action) => action.name === "clearArtifact"),
    };
  });
  expect(clearParity.descriptor).toMatchObject({ enabled: clearParity.state?.enabled, disabledReason: clearParity.state?.disabledReason });

  const preview = page.locator('[data-canvas-control="preview"]');
  await expect(preview).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-canvas-control="clear"]')).not.toHaveAttribute("aria-pressed", /.+/);
  await expect(page.locator(".canvas-toolbar__panel-tabs button")).toHaveCount(5);

  await openWorkspaceDocument(page);
  const documentControl = page.locator('[data-canvas-control="document"]');
  await expect(documentControl).toBeEnabled();
  await documentControl.click();
  await expect(documentControl).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  await documentControl.focus();
  const focusOutline = await documentControl.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(focusOutline).not.toBe("none");

  const geometry = await documentGeometry(page);
  expect(geometry.innerWidth).toBeLessThanOrEqual(640);
  expect(geometry.toolbarGap).toBeGreaterThanOrEqual(4);
  expect(["auto", "scroll"]).toContain(geometry.toolbarOverflowX);
  expect(geometry.bodyOverflows).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("canvas-controls-480.png"), fullPage: true });
});

test("canvas controls: wide fullscreen document keeps the desktop toolbar baseline", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1100, height: 820 });
  await gotoFreshWorkspace(page, smokeUrl(null));
  await openWorkspaceDocument(page);

  const documentControl = page.locator('[data-canvas-control="document"]');
  await expect(documentControl).toBeEnabled();
  await documentControl.click();
  await expect(documentControl).toHaveAttribute("aria-pressed", "true");

  const fullscreen = page.locator('[data-canvas-control="fullscreen"]');
  await expect(fullscreen).toHaveAttribute("aria-pressed", "false");
  await fullscreen.click();
  await expect(fullscreen).toHaveAttribute("aria-pressed", "true");
  await expect(fullscreen).toHaveText("Exit");

  const geometry = await documentGeometry(page);
  expect(geometry.innerWidth).toBeGreaterThan(768);
  expect(geometry.toolbarGap).toBe(0);
  expect(geometry.bodyOverflows).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("canvas-controls-1100-fullscreen.png"), fullPage: true });
});
