import { expect, test, type Page } from "@playwright/test";
import { amplifyCampaignWorkflowManifest } from "../../packages/tool-contracts/dist/marketplace-fixtures.js";
import { gotoFreshWorkspace, smokeUrl, submitPrompt, WORKFLOW_DRAFT_SCENARIO } from "./support/dev-smoke";

// Slice D (production-readiness-agent-creation-2026-07-13.md P1 #7): the
// workflow-builder mode's missing browser lane. Drives the real dev server
// against the third workspace mode (+page.svelte `workspaceMode`) --
// WorkflowBuilderRoot, AgentConfigPanel, WorkflowCanvas, DebugPreviewPane.

async function openWorkflowBuilder(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open the workflow builder" }).click();
  await expect(page.locator('[data-agent-mode="workflow-builder"]')).toBeVisible();
}

async function installWorkflowBuilderDraftPersistenceFixture(page: Page): Promise<void> {
  await page.route("**/api/agent-definitions", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }));
  await page.route("**/api/workflow-definitions", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { action?: string; definition?: Record<string, unknown> };
    const response = body.action === "versions"
      ? { ok: true, versions: [] }
      : body.action === "list"
        ? { ok: true, drafts: [] }
        : {
            ok: true,
            draft: {
              organizationId: "workflow-builder-e2e",
              workflowId: body.definition?.workflowId,
              draftRevision: 0,
              definitionDigest: `sha256:${"a".repeat(64)}`,
              definition: body.definition,
            },
          };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
}

async function installWorkflowDraftStreamFixture(page: Page): Promise<void> {
  const toolCallId = "workflow-builder-e2e-draft";
  const chunks = [
    { type: "tool-input-start", toolCallId, toolName: "draftWorkflow" },
    {
      type: "tool-input-available",
      toolCallId,
      toolName: "draftWorkflow",
      input: { description: "Create an Amplify campaign" },
    },
    {
      type: "tool-output-available",
      toolCallId,
      output: {
        kind: "workflow-draft",
        ok: true,
        workflow: amplifyCampaignWorkflowManifest.payload.workflow,
      },
    },
  ];

  await page.route("**/api/generate", (route) => route.fulfill({
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    },
    body: `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join("\n\n")}\n\ndata: [DONE]\n\n`,
  }));
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

test("builder and chat round-trip preserves the active conversation without reloading", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(null));
  await submitPrompt(page, "Keep this conversation while I edit a workflow");
  await expect(page.getByText("I can expose tool and session state for regression testing.")).toBeVisible();

  const before = await page.evaluate(() => {
    (window as Window & { __workflowBuilderRoundTripSentinel?: string }).__workflowBuilderRoundTripSentinel = "still-mounted";
    const control = (window as Window & { __sonikAgentUI?: { getPageContext?: () => { activeSessionId?: string | null } } }).__sonikAgentUI;
    return { href: window.location.href, activeSessionId: control?.getPageContext?.().activeSessionId ?? null };
  });

  await openWorkflowBuilder(page);
  await page.getByRole("button", { name: "Return to the chat workspace" }).click();

  await expect(page.getByText("Keep this conversation while I edit a workflow")).toBeVisible();
  const after = await page.evaluate(() => {
    const target = window as Window & {
      __workflowBuilderRoundTripSentinel?: string;
      __sonikAgentUI?: { getPageContext?: () => { activeSessionId?: string | null } };
    };
    return {
      href: window.location.href,
      activeSessionId: target.__sonikAgentUI?.getPageContext?.().activeSessionId ?? null,
      sentinel: target.__workflowBuilderRoundTripSentinel,
    };
  });
  expect(after).toEqual({ ...before, sentinel: "still-mounted" });
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
  await installWorkflowBuilderDraftPersistenceFixture(page);
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
  await installWorkflowBuilderDraftPersistenceFixture(page);
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

test("describe, draft, and canvas uses the current saved draft through the deterministic smoke stream", async ({ page }) => {
  await installWorkflowBuilderDraftPersistenceFixture(page);
  await installWorkflowDraftStreamFixture(page);
  await gotoFreshWorkspace(page, smokeUrl(WORKFLOW_DRAFT_SCENARIO));
  await openWorkflowBuilder(page);
  await page.getByRole("tab", { name: "Debug & Preview" }).click();

  const previewPanel = page.locator('[data-agent-panel="workflow-builder-preview"]');
  await previewPanel.locator("textarea").fill("Draft a campaign workflow");
  const generateRequest = page.waitForRequest((request) => request.url().includes("/api/generate") && request.method() === "POST");
  await previewPanel.getByRole("button", { name: "Send" }).click();

  const requestBody = (await generateRequest).postDataJSON() as { draftAgentId?: string };
  expect(requestBody.draftAgentId).toBeTruthy();

  await expect(page.getByRole("tab", { name: "Canvas", selected: true })).toBeVisible();
  const draftCard = page.locator('[data-slot="card"]').filter({ hasText: "Your workflow (draft)" }).first();
  await expect(draftCard.getByText("Create an Amplify campaign", { exact: true })).toBeVisible();
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

test("builder exposes honest lifecycle, isolated preview context, and keyboard canvas semantics", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(null));
  await openWorkflowBuilder(page);

  await expect(page.locator('[data-workflow-lifecycle="dirty"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toBeDisabled();

  await page.getByRole("tab", { name: "Canvas" }).click();
  await page.getByRole("button", { name: "Add node" }).first().click();
  const firstNode = page.locator('[data-workflow-node-index="0"]').first();
  await firstNode.focus();
  await firstNode.press("c");
  await expect(page.getByText(/Connected .* to .*/)).toBeAttached();
  await firstNode.press("Control+z");
  await expect(page.getByText("Undid the last canvas change.")).toBeAttached();

  await page.getByRole("tab", { name: "Debug & Preview" }).click();
  await expect(page.locator("[data-debug-preview-context]")).toContainText("Isolated preview context");
  await expect(page.locator("[data-debug-preview-context]")).toContainText("read/preview only");

  await page.getByRole("button", { name: "Organizer", exact: true }).click();
  await expect(page.locator("[data-organizer-panel]")).toBeVisible();
  await expect(page.locator('[data-agent-panel="workflow-builder-canvas"]')).toHaveCount(0);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator("[data-run-history-panel]")).toBeVisible();
});
