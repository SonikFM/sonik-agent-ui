import { expect, test } from "@playwright/test";
import { gotoFreshWorkspace, smokeUrl } from "./support/dev-smoke";

test("workflow launcher suppresses duplicate same-tick launch and disables while streaming", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(null));

  const generateRequests: Array<{ url: string; postData: string | null }> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/generate")) generateRequests.push({ url: request.url(), postData: request.postData() });
  });

  const telemetry: unknown[] = [];
  page.on("console", (message) => {
    const text = message.text();
    const prefix = "[sonik-agent-ui] ";
    if (!text.startsWith(prefix)) return;
    try { telemetry.push(JSON.parse(text.slice(prefix.length))); } catch { /* ignore malformed telemetry */ }
  });

  const suggestion = page.locator("[data-workflow-suggestion]").first();
  await expect(suggestion).toBeVisible();
  await suggestion.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });

  await expect(page.locator('[data-role="user"]')).toHaveCount(1);
  await expect(page.locator("[data-workflow-suggestion]")).toHaveCount(0);
  await expect.poll(() => generateRequests.length).toBe(1);
  const requestBody = JSON.parse(generateRequests[0]?.postData ?? "{}");
  expect(requestBody.analyticsHints?.entryFrom).toBe("workflow_launcher");
  expect(requestBody.messages?.filter((message: { role?: string }) => message.role === "user")).toHaveLength(1);
  await expect(page.locator('[data-role="assistant"]')).toBeVisible({ timeout: 15_000 });

  const launcherEvents = telemetry as Array<{ event?: string; reason?: string; ok?: boolean; toolCallId?: string; runtimeStatus?: string; title?: string; mode?: string }>;
  expect(launcherEvents.some((entry) => entry.event === "workflow_launcher.accepted" && entry.ok === true && entry.toolCallId && entry.runtimeStatus && entry.title && entry.mode)).toBe(true);
  expect(launcherEvents.some((entry) => entry.event === "workflow_launcher.suppressed" && entry.reason === "duplicate" && entry.ok === false && entry.toolCallId && entry.runtimeStatus && entry.title && entry.mode)).toBe(true);
});
