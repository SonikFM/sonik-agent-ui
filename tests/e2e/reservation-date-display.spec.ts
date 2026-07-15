import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { gotoFreshWorkspace, smokeUrl } from "./support/dev-smoke";

const screenshotDir = path.resolve("test-results/g009-product-output");
const rawGuest = {
  name: "Jordan Rivera",
  email: "jordan@example.test",
  contactConfirmed: true,
};
const rawBooking = {
  contextId: "context-g009",
  startsAt: "2026-07-15T19:00:00-04:00",
  endsAt: "2026-07-15T19:30:00-04:00",
  partySize: 4,
  source: "admin",
  clientRequestId: "g009-date-display",
};

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

async function installReservationPreview(page: Page): Promise<string> {
  await page.waitForFunction(() => Boolean((window as Window & {
    __sonikAgentUI?: { getPageContext?: () => { activeSessionId?: string | null } };
  }).__sonikAgentUI?.getPageContext?.().activeSessionId));
  const sessionId = await page.evaluate(() => {
    return (window as Window & {
      __sonikAgentUI?: { getPageContext?: () => { activeSessionId?: string | null } };
    }).__sonikAgentUI?.getPageContext?.().activeSessionId ?? null;
  });
  expect(sessionId).toBeTruthy();
  const previewToolCallId = `g009-reservation-date-preview-${sessionId}`;

  const result = await page.evaluate(async ({ activeSessionId, guest, booking, toolCallId }) => {
    const response = await fetch(`/api/session/${encodeURIComponent(activeSessionId ?? "")}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sonik-agent-ui-smoke-persistence-mode": "memory",
      },
      body: JSON.stringify({
        id: toolCallId,
        role: "assistant",
        content: "",
        parts: [{
          type: "tool-previewBookingReservationCommand",
          toolCallId,
          state: "output-available",
          input: {},
          output: {
            kind: "reservation-command-preview",
            ok: true,
            command: {
              commandId: "booking.create.booking",
              endpoint: "/api/reservation/commit",
              input: { guest, booking },
            },
          },
        }],
      }),
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  }, {
    activeSessionId: sessionId,
    guest: rawGuest,
    booking: rawBooking,
    toolCallId: previewToolCallId,
  });

  expect(result, result.body).toMatchObject({ ok: true, status: 200 });
  await page.reload({ waitUntil: "domcontentloaded" });
  return previewToolCallId;
}

test("reservation approval presents a human date while commit preserves the raw ISO payload", async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await useMemoryWorkspace(page);
  await gotoFreshWorkspace(page, smokeUrl(null));
  const previewToolCallId = await installReservationPreview(page);

  const card = page.locator("[data-chat-approval-card]");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Jordan Rivera, party of 4");
  await expect(card).toContainText(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)/);
  await expect(card).toContainText("2026");
  await expect(card).toContainText(/\d{1,2}:\d{2}/);
  await expect(card).not.toContainText(rawBooking.startsAt);
  await expect(card).not.toContainText(rawBooking.endsAt);

  await mkdir(screenshotDir, { recursive: true });
  await card.screenshot({
    path: path.join(screenshotDir, "reservation-human-date.png"),
    animations: "disabled",
  });

  let committedPayload: Record<string, unknown> | null = null;
  await page.route("**/api/reservation/commit", async (route) => {
    committedPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, kind: "reservation-commit", steps: [] }),
    });
  });

  await card.locator('[data-approval-action="approve"]').click();
  await expect.poll(() => committedPayload).not.toBeNull();
  expect(committedPayload).toMatchObject({
    previewToolCallId,
    guest: rawGuest,
    booking: rawBooking,
  });
  expect((committedPayload as { booking: unknown }).booking).toEqual(rawBooking);
});
