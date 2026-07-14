import { expect, test } from "@playwright/test";
import { ARTIFACT_INPUT_SCENARIO, gotoFreshWorkspace, smokeUrl, submitPrompt } from "./support/dev-smoke";

// Drag divider between the chat and artifact panes (WorkspaceRoot window
// splitter, 2026-07-13). The mock artifact stream opens the two-pane layout;
// the divider must exist, move the split on drag, persist the fraction, and
// snap back on double-click reset.

async function openTwoPaneWorkspace(page: import("@playwright/test").Page): Promise<void> {
  await gotoFreshWorkspace(page, smokeUrl(ARTIFACT_INPUT_SCENARIO));
  await submitPrompt(page, "make a visual for the divider test");
  await expect(page.locator(".workspace-root")).toHaveAttribute("data-artifact-open", "true", { timeout: 10_000 });
  await expect(page.locator(".workspace-pane-divider")).toBeVisible();
}

function gridColumns(page: import("@playwright/test").Page): Promise<string> {
  return page.locator(".workspace-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns);
}

test("pane-split divider drags the chat/artifact split and persists it", async ({ page }) => {
  await openTwoPaneWorkspace(page);

  const before = await gridColumns(page);
  const divider = page.locator(".workspace-pane-divider");
  const dividerBox = await divider.boundingBox();
  const gridBox = await page.locator(".workspace-grid").boundingBox();
  if (!dividerBox || !gridBox) throw new Error("divider or grid not measurable");

  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2);
  await page.mouse.down();
  // Two intermediate moves so the rAF-batched handler sees a real drag.
  await page.mouse.move(gridBox.x + gridBox.width * 0.55, dividerBox.y + dividerBox.height / 2, { steps: 4 });
  await page.mouse.move(gridBox.x + gridBox.width * 0.68, dividerBox.y + dividerBox.height / 2, { steps: 4 });
  await page.mouse.up();

  await expect.poll(() => gridColumns(page)).not.toBe(before);

  const stored = await page.evaluate(() => window.localStorage.getItem("sonik.agent_ui.pane_split.v1"));
  expect(stored).toBeTruthy();
  const parsed = JSON.parse(stored ?? "{}") as { workspace?: number };
  expect(parsed.workspace).toBeGreaterThan(0.5);
  expect(parsed.workspace).toBeLessThanOrEqual(0.75);
});

test("pane-split divider resets on double-click", async ({ page }) => {
  await openTwoPaneWorkspace(page);

  const defaults = await gridColumns(page);
  const divider = page.locator(".workspace-pane-divider");
  const dividerBox = await divider.boundingBox();
  const gridBox = await page.locator(".workspace-grid").boundingBox();
  if (!dividerBox || !gridBox) throw new Error("divider or grid not measurable");

  await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gridBox.x + gridBox.width * 0.65, dividerBox.y + dividerBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => gridColumns(page)).not.toBe(defaults);

  await divider.dblclick();
  await expect.poll(() => gridColumns(page)).toBe(defaults);
  const stored = await page.evaluate(() => window.localStorage.getItem("sonik.agent_ui.pane_split.v1"));
  expect((JSON.parse(stored ?? "{}") as { workspace?: number }).workspace).toBeUndefined();
});
