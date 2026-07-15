import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { installChannelsHostFixture } from "./support/channels-host-fixture";

const embedUrl = "/?embedMode=chat&agentUiHostOrigin=http%3A%2F%2Flocalhost%3A5173";

test("contextless embed refuses Channels before any fixture request", async ({ page }) => {
  let channelRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/channels")) channelRequests += 1;
  });
  await page.goto(embedUrl, { waitUntil: "networkidle" });
  const before = channelRequests;
  await page.getByRole("button", { name: "Open channels" }).click();
  await expect(page.locator('[data-agent-mode="channels"]')).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Signed host context is required");
  expect(channelRequests).toBe(before);
  const pageControlResult = await page.evaluate(async () => {
    const target = window as Window & {
      __sonikAgentUI?: { actions?: { saveFixtureTriggerBinding?: (input: Record<string, string>) => Promise<{ ok: boolean; disabledReason?: string }> } };
    };
    return target.__sonikAgentUI?.actions?.saveFixtureTriggerBinding?.({
      channelId: "fixture.slack.connected",
      event: "message.received",
      workflowId: "amplify.campaign.create",
      sourcePath: "/event/message",
      targetPath: "/input/request",
    });
  });
  expect(pageControlResult).toMatchObject({ ok: false, disabledReason: "missing_signed_host_context" });
  expect(channelRequests).toBe(before);
});

for (const viewport of [
  { name: "wide", width: 1280, height: 900 },
  { name: "sidecar-480", width: 480, height: 900 },
]) {
  test(`signed Channels fixture is responsive and saves a dormant binding at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(embedUrl, { waitUntil: "domcontentloaded" });
    const fixture = await installChannelsHostFixture(page);
    await expect.poll(() => page.evaluate(() => {
      const target = window as Window & { __sonikAgentUI?: { getPageContext?: () => { activeSessionId?: string | null } } };
      return target.__sonikAgentUI?.getPageContext?.().activeSessionId ?? null;
    })).toBe(fixture.sessionId);

    await page.getByRole("button", { name: "Open channels" }).click();
    const root = page.locator('[data-agent-mode="channels"]');
    await expect(root).toBeVisible();
    await expect(root.locator("[data-channel-id]")).toHaveCount(8);
    await expect(root.locator('[data-channel-kind="whatsapp"][data-channel-id]')).toHaveCount(4);
    await expect(root.locator('[data-channel-kind="slack"][data-channel-id]')).toHaveCount(4);
    for (const state of ["unconfigured", "pending", "connected", "error"]) {
      await expect(root.locator(`[data-channel-status="${state}"]`)).toHaveCount(2);
    }
    await expect(root.locator('[data-channel-id] button[data-disabled-reason="integration_not_yet_available"]')).toHaveCount(8);
    await expect(root.locator('[data-trigger-binding-id] button[data-disabled-reason="integration_not_yet_available"]')).toHaveCount(2);

    const controlState = await page.evaluate(async () => {
      const target = window as Window & {
        __sonikAgentUI?: {
          getChannelsState?: () => { status: string; channels: unknown[]; triggerBindings: unknown[] };
          getAssertions?: () => { channels?: unknown };
          getActions?: () => { actions: Array<{ name: string; enabled: boolean; disabledReason?: string }> };
          getPageContext?: () => { workflow?: { triggers?: unknown[] } };
          actions?: {
            connectChannel?: (input: { channelId: string }) => Promise<unknown> | unknown;
            enableTriggerBinding?: (input: { bindingId: string }) => Promise<unknown> | unknown;
          };
        };
      };
      const api = target.__sonikAgentUI;
      return {
        channels: api?.getChannelsState?.(),
        assertions: api?.getAssertions?.(),
        descriptors: api?.getActions?.().actions.filter((action) => action.name === "connectChannel" || action.name === "enableTriggerBinding"),
        triggers: api?.getPageContext?.().workflow?.triggers,
        connect: await api?.actions?.connectChannel?.({ channelId: "fixture.slack.connected" }),
        enable: await api?.actions?.enableTriggerBinding?.({ bindingId: "fixture.binding.slack.amplify" }),
      };
    });
    expect(controlState.channels).toMatchObject({ status: "ready" });
    expect(controlState.channels?.channels).toHaveLength(8);
    expect(controlState.channels?.triggerBindings).toHaveLength(2);
    expect(controlState.assertions?.channels).toMatchObject({
      fixtureOnly: true,
      channelCount: 8,
      triggerBindingCount: 2,
      allIntegrationActionsDisabled: true,
      disabledReason: "integration_not_yet_available",
    });
    expect(controlState.descriptors).toEqual([
      expect.objectContaining({ name: "connectChannel", enabled: false, disabledReason: "integration_not_yet_available" }),
      expect.objectContaining({ name: "enableTriggerBinding", enabled: false, disabledReason: "integration_not_yet_available" }),
    ]);
    expect(controlState.triggers).toHaveLength(2);
    expect(controlState.connect).toMatchObject({ ok: false, disabledReason: "integration_not_yet_available" });
    expect(controlState.enable).toMatchObject({ ok: false, disabledReason: "integration_not_yet_available" });

    await root.getByLabel("Neutral event").fill("reaction.added");
    await root.getByLabel("Source mapping").fill("/event/reaction");
    await root.getByRole("button", { name: "Save fixture binding" }).click();
    await expect(root.getByText("Fixture trigger binding saved. Integration activation remains unavailable.")).toBeVisible();
    await expect(root.locator('[data-trigger-binding-id="fixture.binding.saved.e2e"]')).toContainText("reaction.added");
    await expect.poll(() => page.evaluate(() => {
      const target = window as Window & { __sonikAgentUI?: { getPageContext?: () => { workflow?: { triggers?: unknown[] } } } };
      return target.__sonikAgentUI?.getPageContext?.().workflow?.triggers?.length ?? 0;
    })).toBe(3);

    expect(fixture.channelRequests.some((request) => request.method === "POST")).toBe(true);
    expect(fixture.channelRequests.every((request) => request.hostContext.length > 0)).toBe(true);
    expect(fixture.channelRequests.every((request) => request.workspaceContext === "signed-workspace-session-fixture-token")).toBe(true);
    const postBody = fixture.channelRequests.find((request) => request.method === "POST")?.body as Record<string, unknown>;
    expect(postBody).toEqual({
      channelId: "fixture.whatsapp.connected",
      event: "reaction.added",
      workflowId: "booking.reservation.create",
      sourcePath: "/event/reaction",
      targetPath: "/input/request",
    });
    expect(postBody).not.toHaveProperty("organizationId");
    expect(postBody).not.toHaveProperty("userId");
    expect(postBody).not.toHaveProperty("workspaceId");

    await assertResponsiveLayout(page, viewport.width);
    await page.screenshot({ path: screenshotPath(testInfo, viewport.name), fullPage: true });
  });
}

async function assertResponsiveLayout(page: Page, viewportWidth: number): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  const whatsapp = await page.locator('[data-channel-kind="whatsapp"]:not([data-channel-id])').boundingBox();
  const slack = await page.locator('[data-channel-kind="slack"]:not([data-channel-id])').boundingBox();
  expect(whatsapp).not.toBeNull();
  expect(slack).not.toBeNull();
  if (!whatsapp || !slack) return;
  if (viewportWidth >= 1024) {
    expect(Math.abs(whatsapp.y - slack.y)).toBeLessThan(8);
  } else {
    expect(slack.y).toBeGreaterThan(whatsapp.y + whatsapp.height - 8);
  }
}

function screenshotPath(testInfo: TestInfo, viewportName: string): string {
  return testInfo.outputPath(`channels-${viewportName}.png`);
}
