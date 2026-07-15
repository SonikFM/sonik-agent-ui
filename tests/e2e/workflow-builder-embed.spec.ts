import { expect, test } from "@playwright/test";
import { AMPLIFY_CAMPAIGN_COMMAND_ID, installWorkflowBuilderHostFixture } from "./support/workflow-builder-host-fixture";

const embedUrl = "/?embedMode=chat&agentUiHostOrigin=http%3A%2F%2Flocalhost%3A5173";

test("embedded chat exposes Workflow Builder and refuses context-less builder cloud calls", async ({ page }) => {
  let modelCatalogRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/agent-models") modelCatalogRequests += 1;
  });

  await page.goto(embedUrl, { waitUntil: "networkidle" });
  const builderButton = page.getByRole("button", { name: "Open the workflow builder" });
  await expect(builderButton).toBeVisible();
  const requestsBeforeBuilderMount = modelCatalogRequests;
  expect(requestsBeforeBuilderMount).toBe(0);
  await builderButton.click();

  await expect(page.locator('[data-agent-mode="workflow-builder"]')).toBeVisible();
  await expect(page.getByRole("alert")).toHaveText("Reconnect the embedded page with an authenticated workspace session to load cloud models.");
  await expect(page.getByRole("alert")).not.toContainText(/missing-host-context|host_auth_required|workspace_fetch/i);
  expect(modelCatalogRequests).toBe(requestsBeforeBuilderMount);
  await page.getByRole("button", { name: "Return to the chat workspace" }).click();
  await expect(page.locator('[data-agent-mode="workflow-builder"]')).toHaveCount(0);
});

test("signed Amplify grant drives visible preview, approval, and trusted commit through the shared state API", async ({ page }) => {
  await page.goto(embedUrl, { waitUntil: "domcontentloaded" });
  const fixture = await installWorkflowBuilderHostFixture(page);
  await expect.poll(() => page.evaluate(() => {
    const target = window as Window & { __sonikAgentUI?: { getPageContext?: () => { organizationId?: string | null } } };
    return target.__sonikAgentUI?.getPageContext?.().organizationId ?? null;
  })).toBe("11111111-1111-4111-8111-111111111111");
  await expect.poll(() => page.evaluate(() => {
    const target = window as Window & { __sonikAgentUI?: { getPageContext?: () => { activeSessionId?: string | null } } };
    return target.__sonikAgentUI?.getPageContext?.().activeSessionId ?? null;
  })).toBe(fixture.sessionId);
  // Ignore any page-shell catalog request that raced with context donation;
  // observations below belong only to the builder actions this test drives.
  for (const headers of Object.values(fixture.signedHostContextHeaders)) headers.length = 0;

  const beforeRoundTrip = await page.evaluate(() => {
    const target = window as Window & {
      __workflowBuilderEmbedRoundTripSentinel?: string;
      __sonikAgentUI?: { getPageContext?: () => { activeSessionId?: string | null } };
    };
    target.__workflowBuilderEmbedRoundTripSentinel = "embed-state-preserved";
    return {
      href: window.location.href,
      activeSessionId: target.__sonikAgentUI?.getPageContext?.().activeSessionId ?? null,
    };
  });

  await page.getByRole("button", { name: "Open the workflow builder" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  await page.getByRole("tab", { name: "Canvas" }).click();
  const runPanel = page.locator(`[data-workflow-run-panel="${AMPLIFY_CAMPAIGN_COMMAND_ID}"]`);
  await runPanel.getByRole("button", { name: "Run", exact: true }).click();
  await runPanel.getByRole("button", { name: "Preview", exact: true }).click();

  const approvalCard = runPanel.locator("[data-workflow-run-approval-card]");
  await expect(approvalCard).toHaveAttribute("data-status", "approval_required");
  await expect(approvalCard.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
  const approvalState = await page.evaluate(() => {
    const target = window as Window & { __sonikAgentUI?: { getApprovalState?: () => unknown } };
    return target.__sonikAgentUI?.getApprovalState?.();
  });
  expect(approvalState).toMatchObject({
    phase: "preview_ready",
    canRequestApproval: true,
    canApproveAndRun: true,
    disabledReasons: [],
    commandPreview: { commandId: AMPLIFY_CAMPAIGN_COMMAND_ID },
  });

  await approvalCard.getByRole("button", { name: "Approve", exact: true }).click();
  const commitButton = approvalCard.getByRole("button", { name: "Commit", exact: true });
  await expect(commitButton).toBeEnabled();
  await commitButton.click();
  await expect(runPanel.locator("[data-workflow-run-receipt]")).toContainText("campaign-fixture-receipt");

  for (const [kind, headers] of Object.entries(fixture.signedHostContextHeaders)) {
    expect(headers.length, `${kind} should be exercised by the deterministic fixture`).toBeGreaterThan(0);
    expect(headers.every((header) => header.length > 0), `${kind} should reuse workspaceFetch's signed host header`).toBe(true);
  }

  await page.getByRole("button", { name: "Return to the chat workspace" }).click();
  const afterRoundTrip = await page.evaluate(() => {
    const target = window as Window & {
      __workflowBuilderEmbedRoundTripSentinel?: string;
      __sonikAgentUI?: { getPageContext?: () => { activeSessionId?: string | null } };
    };
    return {
      href: window.location.href,
      activeSessionId: target.__sonikAgentUI?.getPageContext?.().activeSessionId ?? null,
      sentinel: target.__workflowBuilderEmbedRoundTripSentinel,
    };
  });
  expect(afterRoundTrip).toEqual({ ...beforeRoundTrip, sentinel: "embed-state-preserved" });
});

test("Run and Reset expose typed visible reasons while a workflow action is busy", async ({ page }) => {
  await page.goto(embedUrl, { waitUntil: "domcontentloaded" });
  await installWorkflowBuilderHostFixture(page, { workflowRunDelayMs: 1_000 });
  await expect.poll(() => page.evaluate(() => {
    const target = window as Window & { __sonikAgentUI?: { getPageContext?: () => { organizationId?: string | null } } };
    return target.__sonikAgentUI?.getPageContext?.().organizationId ?? null;
  })).toBe("11111111-1111-4111-8111-111111111111");

  await page.getByRole("button", { name: "Open the workflow builder" }).click();
  await page.getByRole("tab", { name: "Canvas" }).click();
  const runPanel = page.locator(`[data-workflow-run-panel="${AMPLIFY_CAMPAIGN_COMMAND_ID}"]`);

  const assertBusyReason = async (buttonName: "Run" | "Reset", action: "run" | "reset") => {
    const button = runPanel.getByRole("button", { name: buttonName, exact: true });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("data-disabled-reason", "workflow_action_busy");
    const reasonId = await button.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    const reason = page.locator(`#${reasonId}`);
    await expect(reason).toBeVisible();
    await expect(reason).toHaveAttribute("data-workflow-run-disabled-reason", action);
    await expect(reason).toHaveText("Wait for the current workflow action to finish.");
  };

  const runButton = runPanel.getByRole("button", { name: "Run", exact: true });
  await runButton.click();
  await assertBusyReason("Run", "run");
  await expect(runPanel.getByRole("button", { name: "Reset", exact: true })).toBeVisible();

  await runPanel.getByRole("button", { name: "Preview", exact: true }).click();
  await assertBusyReason("Reset", "reset");
  await expect(runPanel.locator("[data-workflow-run-approval-card]")).toHaveAttribute("data-status", "approval_required");
});

test("missing signed command grant exposes visible described-by reasons on disabled approval and commit controls", async ({ page }) => {
  await page.goto(embedUrl, { waitUntil: "domcontentloaded" });
  await installWorkflowBuilderHostFixture(page, { approvedCommandIds: [], previewPhase: "approved" });
  await expect.poll(() => page.evaluate(() => {
    const target = window as Window & { __sonikAgentUI?: { getPageContext?: () => { organizationId?: string | null } } };
    return target.__sonikAgentUI?.getPageContext?.().organizationId ?? null;
  })).toBe("11111111-1111-4111-8111-111111111111");

  await page.getByRole("button", { name: "Open the workflow builder" }).click();
  await page.getByRole("tab", { name: "Canvas" }).click();
  const runPanel = page.locator(`[data-workflow-run-panel="${AMPLIFY_CAMPAIGN_COMMAND_ID}"]`);
  await runPanel.getByRole("button", { name: "Run", exact: true }).click();
  await runPanel.getByRole("button", { name: "Preview", exact: true }).click();

  const approvalCard = runPanel.locator("[data-workflow-run-approval-card]");
  for (const [buttonName, action] of [["Approved", "approve"], ["Commit", "commit"]] as const) {
    const button = approvalCard.getByRole("button", { name: buttonName, exact: true });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("data-disabled-reason", "trusted_host_approval_required");
    const reasonId = await button.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    const reason = page.locator(`#${reasonId}`);
    await expect(reason).toBeVisible();
    await expect(reason).toHaveAttribute("data-workflow-run-disabled-reason", action);
    await expect(reason).toContainText("trusted host grant");
  }

  const approvalState = await page.evaluate(() => {
    const target = window as Window & { __sonikAgentUI?: { getApprovalState?: () => unknown } };
    return target.__sonikAgentUI?.getApprovalState?.();
  });
  expect(approvalState).toMatchObject({
    phase: "approved",
    canApproveAndRun: false,
    disabledReasons: ["trusted_host_approval_required"],
  });
});
