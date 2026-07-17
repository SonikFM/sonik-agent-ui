import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { gotoFreshWorkspace, smokeUrl } from "./support/dev-smoke";

const screenshotDir = path.resolve("test-results/g005-responsive-layout");

async function capture(locator: Locator, name: string): Promise<void> {
  await mkdir(screenshotDir, { recursive: true });
  await locator.screenshot({ path: path.join(screenshotDir, name), animations: "disabled" });
}

async function suggestionWidths(page: Page): Promise<number[]> {
  return page.locator("[data-workflow-suggestion]").evaluateAll((cards) =>
    cards.map((card) => card.getBoundingClientRect().width),
  );
}

async function useMemoryWorkspace(page: Page): Promise<void> {
  await page.route("**/api/**", async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        "x-sonik-agent-ui-smoke-persistence-mode": "memory",
      },
    });
  });
}

async function installReservationPreview(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Window & {
    __sonikAgentUI?: { getPageContext?: () => { activeSessionId?: string | null } };
  }).__sonikAgentUI?.getPageContext?.().activeSessionId));
  const sessionId = await page.evaluate(() => {
    const control = (window as Window & {
      __sonikAgentUI?: { getPageContext?: () => { activeSessionId?: string | null } };
    }).__sonikAgentUI;
    return control?.getPageContext?.().activeSessionId ?? null;
  });
  expect(sessionId).toBeTruthy();

  const result = await page.evaluate(async (activeSessionId) => {
    const fixtureId = `g005-responsive-approval-${activeSessionId}`;
    const response = await fetch(`/api/session/${encodeURIComponent(activeSessionId ?? "")}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sonik-agent-ui-smoke-persistence-mode": "memory",
      },
      body: JSON.stringify({
        id: fixtureId,
        role: "assistant",
        content: "",
        parts: [{
          type: "tool-previewBookingReservationCommand",
          toolCallId: fixtureId,
          state: "output-available",
          input: {},
          output: {
            kind: "reservation-command-preview",
            ok: true,
            command: {
              commandId: "booking.create.booking",
              endpoint: "/api/reservation/commit",
              input: {
                guest: { name: "Jordan Rivera", email: "jordan@example.test", contactConfirmed: true },
                booking: {
                  contextId: "context-g005",
                  startsAt: "2026-07-15T19:00:00-04:00",
                  endsAt: "2026-07-15T19:30:00-04:00",
                  partySize: 4,
                  source: "admin",
                  clientRequestId: "g005-responsive-layout",
                },
              },
            },
          },
        }],
      }),
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  }, sessionId);

  expect(result, result.body).toMatchObject({ ok: true, status: 200 });
  await page.reload({ waitUntil: "domcontentloaded" });
}

async function assertApprovalLayout(card: Locator): Promise<void> {
  await expect(card).toBeVisible();
  await expect(card.locator("[data-chat-approval-layout]")).toHaveAttribute("data-chat-approval-layout", "intrinsic-wrap");
  const actionOrder = await card.locator("[data-approval-action]").evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute("data-approval-action")),
  );
  expect(actionOrder).toEqual(["preview", "approve", "cancel"]);

  const copyBox = await card.locator("[data-chat-approval-copy]").boundingBox();
  const actionsBox = await card.locator("[data-chat-approval-actions]").boundingBox();
  if (!copyBox || !actionsBox) throw new Error("approval layout was not measurable");
  expect(actionsBox.y).toBeGreaterThanOrEqual(copyBox.y + copyBox.height);

  const cardBox = await card.boundingBox();
  if (!cardBox) throw new Error("approval card was not measurable");
  const buttonsWithinCard = await card.locator("[data-approval-action]").evaluateAll((buttons, cardRect) => {
    return buttons.every((button) => {
      const rect = button.getBoundingClientRect();
      return rect.left >= cardRect.x && rect.right <= cardRect.x + cardRect.width
        && rect.top >= cardRect.y && rect.bottom <= cardRect.y + cardRect.height;
    });
  }, cardBox);
  expect(buttonsWithinCard).toBe(true);
}

test("workflow suggestions use two readable intrinsic columns at wide width", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoFreshWorkspace(page, smokeUrl(null));

  const grid = page.getByLabel("Suggested agent workflows");
  await expect(grid).toHaveAttribute("data-workflow-suggestions-layout", "intrinsic-grid");
  await expect(page.locator("[data-workflow-suggestion]")).toHaveCount(4);
  const widths = await suggestionWidths(page);
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(280);
  const columns = await page.locator("[data-workflow-suggestion]").evaluateAll((cards) =>
    new Set(cards.map((card) => Math.round(card.getBoundingClientRect().x))).size,
  );
  expect(columns).toBe(2);
  await capture(grid, "wide-suggestions.png");
});

test("workflow suggestions stack without squeezed words in the 480px sidecar", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await gotoFreshWorkspace(page, smokeUrl(null, { embedMode: "chat" }));

  const grid = page.getByLabel("Suggested agent workflows");
  await expect(grid).toHaveAttribute("data-workflow-suggestions-layout", "intrinsic-grid");
  const widths = await suggestionWidths(page);
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(280);
  const columns = await page.locator("[data-workflow-suggestion]").evaluateAll((cards) =>
    new Set(cards.map((card) => Math.round(card.getBoundingClientRect().x))).size,
  );
  expect(columns).toBe(1);
  await capture(grid, "sidecar-480-suggestions.png");
});

test("approval actions stack below copy without overlap in the 480px sidecar", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await useMemoryWorkspace(page);
  await gotoFreshWorkspace(page, smokeUrl(null, { embedMode: "chat" }));
  await installReservationPreview(page);

  const card = page.locator("[data-chat-approval-card]");
  await assertApprovalLayout(card);
  await capture(card, "sidecar-480-approval.png");
});

test("approval actions stay bounded in a 480px floated sidecar on a wide viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await useMemoryWorkspace(page);
  await gotoFreshWorkspace(page, smokeUrl(null));
  await installReservationPreview(page);

  const grip = page.locator(".chat-window__drag-region");
  const gripBox = await grip.boundingBox();
  if (!gripBox) throw new Error("chat window grip was not measurable");
  await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(gripBox.x + gripBox.width / 2 + 120, gripBox.y + gripBox.height / 2 + 60, { steps: 6 });
  await page.mouse.up();

  const chatWindow = page.locator(".chat-window");
  await expect(chatWindow).toHaveClass(/chat-window--floating/);
  const windowBox = await chatWindow.boundingBox();
  if (!windowBox) throw new Error("floating chat window was not measurable");
  expect(windowBox.width).toBeGreaterThanOrEqual(479);
  expect(windowBox.width).toBeLessThanOrEqual(481);

  await assertApprovalLayout(chatWindow.locator("[data-chat-approval-card]"));
  await capture(chatWindow, "wide-1100-floating-sidecar-approval.png");
});
