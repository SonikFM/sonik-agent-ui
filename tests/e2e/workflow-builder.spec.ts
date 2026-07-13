import { expect, test, type Page } from "@playwright/test";
import { gotoFreshWorkspace, smokeUrl } from "./support/dev-smoke";

// Slice D (production-readiness-agent-creation-2026-07-13.md P1 #7): the
// workflow-builder mode's missing browser lane. Drives the real dev server
// against the third workspace mode (+page.svelte `workspaceMode`) --
// WorkflowBuilderRoot, AgentConfigPanel, WorkflowCanvas, DebugPreviewPane.

async function openWorkflowBuilder(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open the workflow builder" }).click();
  await expect(page.locator('[data-agent-mode="workflow-builder"]')).toBeVisible();
}

test("workflow builder mode toggle mounts the builder", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(null));

  await openWorkflowBuilder(page);
  await expect(page.getByRole("heading", { name: "Workflow Builder" })).toBeVisible();

  // Round-trip: WorkspaceRoot (and its toolbar toggle) unmounts in builder
  // mode, so WorkflowBuilderRoot carries its own onExit "Back to chat" control
  // (prod slice 2026-07-13, fixing the one-way-door gap Lane D found). Click it
  // and the chat workspace returns.
  const backToChat = page.getByRole("button", { name: "Return to the chat workspace" });
  await expect(backToChat).toBeVisible();
  await backToChat.click();
  await expect(page.locator('[data-agent-mode="workflow-builder"]')).toHaveCount(0);
});

test("Config, Canvas, and Debug & Preview tabs switch panels", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(null));
  await openWorkflowBuilder(page);

  await expect(page.locator('[data-agent-panel="workflow-builder-config"]')).toBeVisible();

  await page.getByRole("tab", { name: "Canvas" }).click();
  await expect(page.locator('[data-agent-panel="workflow-builder-canvas"]').first()).toBeVisible();

  await page.getByRole("tab", { name: "Debug & Preview" }).click();
  await expect(page.locator('[data-agent-panel="workflow-builder-preview"]')).toBeVisible();

  await page.getByRole("tab", { name: "Config" }).click();
  await expect(page.locator('[data-agent-panel="workflow-builder-config"]')).toBeVisible();
});

test("draft save round-trips through the agent-definitions API", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(null));
  await openWorkflowBuilder(page);

  const [request, response] = await Promise.all([
    page.waitForRequest((req) => req.url().includes("/api/agent-definitions") && req.method() === "POST"),
    page.waitForResponse((res) => res.url().includes("/api/agent-definitions")),
    page.getByRole("button", { name: "Save draft" }).click(),
  ]);

  const requestBody = JSON.parse(request.postData() ?? "{}");
  expect(requestBody.action).toBe("save_draft");
  expect(requestBody.definition?.agentId).toBeTruthy();

  const responseBody = await response.json();
  expect(responseBody.ok).toBe(true);
  await expect(page.getByText("Draft saved.")).toBeVisible();
});

test("Debug & Preview sends draftAgentId with every generate request", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(null));
  await openWorkflowBuilder(page);

  const agentId = await page
    .locator('[data-agent-mode="workflow-builder"] [data-slot="badge"]')
    .filter({ hasText: /^agent_[a-z0-9]+$/ })
    .first()
    .textContent();

  await page.getByRole("tab", { name: "Debug & Preview" }).click();
  const generateRequest = page.waitForRequest((req) => req.url().includes("/api/generate") && req.method() === "POST");
  await page.locator('[data-agent-panel="workflow-builder-preview"] textarea').fill("test draft preview");
  await page.locator('[data-agent-panel="workflow-builder-preview"] textarea').press("Enter");
  const request = await generateRequest;

  const requestBody = JSON.parse(request.postData() ?? "{}");
  expect(typeof requestBody.draftAgentId).toBe("string");
  expect(requestBody.draftAgentId.length).toBeGreaterThan(0);
  if (agentId) expect(requestBody.draftAgentId).toBe(agentId.trim());
});

test("the shipped reservation fixture renders LOCKED alongside an editable DRAFT workflow", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(null));
  await openWorkflowBuilder(page);
  await page.getByRole("tab", { name: "Canvas" }).click();

  await expect(page.getByText("Example: booking reservation workflow")).toBeVisible();
  // Scope LOCKED to the reservation fixture's own card: the canvas now also
  // renders a second locked fixture (the runnable campaign workflow), so a
  // page-wide getByText("LOCKED") matches two badges and trips strict mode.
  const reservationCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Example: booking reservation workflow" });
  await expect(reservationCard.getByText("LOCKED", { exact: true })).toBeVisible();
  await expect(page.getByText("DRAFT", { exact: true })).toBeVisible();
});
