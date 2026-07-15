import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { gotoFreshWorkspace, smokeUrl, submitPrompt } from "./support/dev-smoke";

const skillIds = [
  "booking.event.create",
  "amplify.campaign.template.create",
  "booking.context.intake",
  "booking.context.create",
] as const;
const cases = [
  { width: 320 },
  { width: 480 },
  { width: 960 },
] as const;
const screenshotDir = path.resolve("test-results/g008-narrow-chat-shell");

async function stageSkills(page: Page): Promise<void> {
  for (const skillId of skillIds) {
    await expect.poll(async () => page.evaluate(async (id) => {
      return window.__sonikAgentUI?.actions.stageComposerSkill?.({ skillId: id });
    }, skillId)).toMatchObject({ ok: true });
  }
}

async function settleFreshSession(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    return typeof window.__sonikAgentUI?.actions.createSession === "function";
  })).toBe(true);
  const result = await page.evaluate(async () => window.__sonikAgentUI?.actions.createSession());
  expect(result).toMatchObject({ ok: true });
}

for (const { width } of cases) {
  test(`composer context disclosure preserves all staged items at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await gotoFreshWorkspace(page, smokeUrl(null, { embedMode: "chat" }));
    await settleFreshSession(page);
    await stageSkills(page);

    const row = page.locator("[data-staged-context-row]");
    const stagedItems = row.locator(".staged-context-items");
    const disclosure = row.locator("[data-staged-context-toggle]");
    await expect(row).toBeVisible();
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    const stagedItemsWidth = await stagedItems.evaluate((element) => element.getBoundingClientRect().width);
    const visible = stagedItemsWidth < 420 ? 1 : stagedItemsWidth < 640 ? 2 : 3;
    await expect(stagedItems.locator("[data-staged-item]")).toHaveCount(visible);
    const collapsedLabel = (await disclosure.textContent()) ?? "";
    const hiddenCount = Number.parseInt(collapsedLabel.match(/^\+(\d+) more$/)?.[1] ?? "0", 10);
    expect(hiddenCount).toBeGreaterThan(0);
    const totalStagedItems = visible + hiddenCount;

    const collapsedGeometry = await stagedItems.evaluate((element) => {
      const container = element.getBoundingClientRect();
      const children = [...element.children].map((child) => child.getBoundingClientRect());
      const centers = children.map((rect) => rect.top + rect.height / 2);
      return {
        centerSpread: Math.max(...centers) - Math.min(...centers),
        childrenWithinWidth: children.every((rect) => rect.left >= container.left - 1 && rect.right <= container.right + 1),
        noHorizontalOverflow: element.scrollWidth <= element.clientWidth + 1,
      };
    });
    expect(collapsedGeometry.childrenWithinWidth).toBe(true);
    expect(collapsedGeometry.noHorizontalOverflow).toBe(true);
    expect(collapsedGeometry.centerSpread).toBeLessThanOrEqual(2);

    const textarea = page.locator("textarea").first();
    const rowBox = await row.boundingBox();
    const textareaBox = await textarea.boundingBox();
    if (!rowBox || !textareaBox) throw new Error("composer context row or textarea not measurable");
    expect(textareaBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height - 1);
    expect(textareaBox.x).toBeGreaterThanOrEqual(0);
    expect(textareaBox.x + textareaBox.width).toBeLessThanOrEqual(width);

    await disclosure.focus();
    await disclosure.press("Enter");
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(disclosure).toHaveText("Show less");
    await expect(stagedItems.locator("[data-staged-item]")).toHaveCount(totalStagedItems);
    await expect(stagedItems.locator("[data-context-chip-remove]")).toHaveCount(totalStagedItems);
    for (const skillId of skillIds) {
      await expect(stagedItems.locator(`[data-context-chip-remove="runtime-skill:${skillId}"]`)).toBeVisible();
    }

    await disclosure.press("Enter");
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(stagedItems.locator("[data-staged-item]")).toHaveCount(visible);

    if (width === 960) {
      await stagedItems.locator("[data-staged-item-index='2'] [data-context-chip-remove]").focus();
      await page.setViewportSize({ width: 320, height: 800 });
      await expect(disclosure).toBeFocused();
      await expect(stagedItems.locator("[data-staged-item]")).toHaveCount(1);
      await page.setViewportSize({ width, height: 800 });
      await expect(stagedItems.locator("[data-staged-item]")).toHaveCount(visible);
    }

    await mkdir(screenshotDir, { recursive: true });
    await page.getByRole("region", { name: "Message composer" }).screenshot({
      path: path.join(screenshotDir, `composer-context-${width}.png`),
      animations: "disabled",
    });

    await page.route("**/api/generate", async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body: [
          `data: ${JSON.stringify({ type: "start", messageId: `g008-${width}` })}`,
          `data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}`,
          "data: [DONE]",
          "",
        ].join("\n\n"),
      });
    });
    const generateRequest = page.waitForRequest((request) => request.url().endsWith("/api/generate") && request.method() === "POST");
    await submitPrompt(page, `prove hidden staged context survives at ${width}px`);
    const body = (await generateRequest).postDataJSON() as {
      contextSelection?: { items?: Array<{ id?: string }> };
    };
    const submittedIds = body.contextSelection?.items?.map((item) => item.id) ?? [];
    for (const skillId of skillIds) expect(submittedIds).toContain(`runtime-skill:${skillId}`);
  });
}
