import { expect, test } from "@playwright/test";
import { gotoFreshWorkspace, smokeUrl } from "./support/dev-smoke";

// Chat-as-dynamic-modal (docs/plans/experience-seams-resolution-plan-2026-07-08.md
// "Chat-as-dynamic-modal" + docs/plans/agent-ui-long-run-plan-2026-07-08.md): the
// standalone chat pane is wrapped in ChatWindow (packages/workspace-core/src/components/ChatWindow.svelte),
// reusing the same createCanvasWindowController (packages/workspace-core/src/lib/window-drag.svelte.ts)
// as CanvasViewport -- drag via the header grip undocks it into a floating, resizable
// window whose rect persists to localStorage under "sonik-agent-ui:chat-window:v1".

test("chat-modal: chat pane starts docked (in-grid), not floating", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(null));

  const chatWindow = page.locator(".chat-window");
  await expect(chatWindow).toBeVisible();
  await expect(chatWindow).not.toHaveClass(/chat-window--floating/);
});

test("chat-modal: dragging the header grip undocks the window and persists position across reload", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(null));

  const grip = page.locator(".chat-window__drag-region");
  await expect(grip).toBeVisible();
  const gripBox = await grip.boundingBox();
  if (!gripBox) throw new Error("chat window grip has no bounding box");

  const startX = gripBox.x + gripBox.width / 2;
  const startY = gripBox.y + gripBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 160, startY + 90, { steps: 8 });
  await page.mouse.up();

  const chatWindow = page.locator(".chat-window");
  await expect(chatWindow).toHaveClass(/chat-window--floating/);
  await expect(chatWindow.locator(".chat-window__grip--floating")).toBeVisible();

  const windowBox = await chatWindow.boundingBox();
  const conversationHeaderBox = await chatWindow.locator("[data-agent-conversation-header]").boundingBox();
  if (!windowBox || !conversationHeaderBox) throw new Error("floating chat chrome was not measurable");
  expect(conversationHeaderBox.y - windowBox.y).toBeLessThan(3);

  const styleAfterDrag = await chatWindow.getAttribute("style");
  expect(styleAfterDrag).toBeTruthy();

  // Position/size persisted to localStorage (window-drag.svelte.ts `persist()`) --
  // survives a fresh navigation instead of resetting to the docked default.
  await page.reload({ waitUntil: "domcontentloaded" });
  const chatWindowAfterReload = page.locator(".chat-window");
  await expect(chatWindowAfterReload).toHaveClass(/chat-window--floating/);
  const styleAfterReload = await chatWindowAfterReload.getAttribute("style");
  expect(styleAfterReload).toBe(styleAfterDrag);
});

test("chat-modal: Reset layout re-docks the window and clears the persisted rect", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(null));

  const grip = page.locator(".chat-window__drag-region");
  const gripBox = await grip.boundingBox();
  if (!gripBox) throw new Error("chat window grip has no bounding box");

  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + 140, gripBox.y + 80, { steps: 8 });
  await page.mouse.up();

  const chatWindow = page.locator(".chat-window");
  await expect(chatWindow).toHaveClass(/chat-window--floating/);

  await page.getByRole("button", { name: "Reset the chat window to its default position and size" }).click();
  await expect(chatWindow).not.toHaveClass(/chat-window--floating/);

  const persisted = await page.evaluate(() => window.localStorage.getItem("sonik-agent-ui:chat-window:v1"));
  expect(persisted).toBeNull();
});
