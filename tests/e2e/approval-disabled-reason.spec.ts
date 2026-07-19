import { expect, test, type Page } from "@playwright/test";
import { ARTIFACT_INPUT_SCENARIO, gotoFreshWorkspace, smokeUrl, submitPrompt } from "./support/dev-smoke";

const disabledReasonId = "agent-approval-disabled-reason";
const streamingMessage = "Wait for the current response to finish before using approval actions.";

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
    return (window as Window & {
      __sonikAgentUI?: { getPageContext?: () => { activeSessionId?: string | null } };
    }).__sonikAgentUI?.getPageContext?.().activeSessionId ?? null;
  });
  expect(sessionId).toBeTruthy();

  const result = await page.evaluate(async (activeSessionId) => {
    const fixtureId = `g011-approval-disabled-${activeSessionId}`;
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
                  contextId: "context-g011",
                  startsAt: "2026-07-15T19:00:00-04:00",
                  endsAt: "2026-07-15T19:30:00-04:00",
                  partySize: 4,
                  source: "admin",
                  clientRequestId: `g011-approval-disabled-${activeSessionId}`,
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

test("streaming approval controls share one visible typed reason and clear it after settling", async ({ page }) => {
  await useMemoryWorkspace(page);
  await gotoFreshWorkspace(page, smokeUrl(ARTIFACT_INPUT_SCENARIO));
  await installReservationPreview(page);

  const card = page.locator("[data-chat-approval-card]");
  const buttons = card.locator("[data-approval-action]");
  const reason = card.locator("[data-approval-disabled-reason]");
  await expect(card).toBeVisible();
  await expect(buttons).toHaveCount(3);

  await submitPrompt(page, "stream while approval actions stay visible");
  await expect(reason).toBeVisible({ timeout: 2_000 });
  await expect(reason).toHaveAttribute("id", disabledReasonId);
  await expect(reason).toHaveAttribute("role", "status");
  await expect(reason).toHaveAttribute("aria-live", "polite");
  await expect(reason).toHaveAttribute("data-disabled-reason", "streaming");
  await expect(reason).toHaveText(streamingMessage);
  expect(await buttons.evaluateAll((controls) => controls.map((control) => ({
    action: control.getAttribute("data-approval-action"),
    disabled: (control as HTMLButtonElement).disabled,
    code: control.getAttribute("data-disabled-reason"),
    describedBy: control.getAttribute("aria-describedby"),
  })))).toEqual([
    { action: "preview", disabled: true, code: "streaming", describedBy: disabledReasonId },
    { action: "approve", disabled: true, code: "streaming", describedBy: disabledReasonId },
    { action: "cancel", disabled: true, code: "streaming", describedBy: disabledReasonId },
  ]);

  await expect(reason).toHaveCount(0, { timeout: 10_000 });
  expect(await buttons.evaluateAll((controls) => controls.map((control) => ({
    action: control.getAttribute("data-approval-action"),
    disabled: (control as HTMLButtonElement).disabled,
    code: control.getAttribute("data-disabled-reason"),
    describedBy: control.getAttribute("aria-describedby"),
  })))).toEqual([
    { action: "preview", disabled: false, code: null, describedBy: null },
    { action: "approve", disabled: false, code: null, describedBy: null },
    { action: "cancel", disabled: false, code: null, describedBy: null },
  ]);
});
