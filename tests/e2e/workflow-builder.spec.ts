import { expect, test, type Page } from "@playwright/test";
import { amplifyCampaignWorkflowManifest } from "../../packages/tool-contracts/dist/marketplace-fixtures.js";
import { gotoFreshWorkspace, smokeUrl, submitPrompt, WORKFLOW_DRAFT_SCENARIO } from "./support/dev-smoke";
import { AMPLIFY_CAMPAIGN_COMMAND_ID, installWorkflowBuilderHostFixture, type WorkflowBuilderHostFixtureObservation } from "./support/workflow-builder-host-fixture";

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
  let revision = 0;
  let definition: Record<string, unknown> | undefined;
  await page.route("**/api/workflow-definitions", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      action?: string;
      definition?: Record<string, unknown>;
      patch?: { edits?: Array<{ path: string; value: unknown }> };
    };
    if (body.definition) definition = body.definition;
    if (body.action === "organizer_patch") revision += 1;
    const response = body.action === "versions"
      ? { ok: true, versions: [] }
      : body.action === "list"
        ? { ok: true, drafts: [] }
        : {
            ok: true,
            draft: {
              organizationId: "workflow-builder-e2e",
              workflowId: definition?.workflowId,
              draftRevision: revision,
              definitionDigest: `sha256:${"a".repeat(64)}`,
              definition,
            },
          };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
}

async function installModelCatalogFixture(page: Page): Promise<void> {
  const models = Array.from({ length: 35 }, (_, index) => ({
    id: `fixture/model-${String(index + 1).padStart(2, "0")}`,
    label: `Fixture Model ${String(index + 1).padStart(2, "0")}`,
    provider: "Fixture",
    contextWindow: 128_000,
    supportsTools: true,
    supportsImages: index === 34,
    supportsVideo: index === 34,
    task: index === 34 ? "Agent" : "Text",
    inputModalities: index === 34 ? ["audio"] : ["text"],
    outputModalities: ["text"],
  }));
  await page.route("**/api/agent-models", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ source: "gateway", models }),
  }));
}

async function installCapabilityReadinessFixture(page: Page): Promise<void> {
  await page.route("**/api/capability-readiness", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      readiness: [{
        capabilityId: "amplify.campaign.create",
        effectMode: "write",
        registered: true,
        implemented: false,
        authorable: true,
        definitionCompatible: false,
        mounted: true,
        contextReady: false,
        grantReady: false,
        previewable: false,
        committable: false,
        killSwitched: true,
        versionPinned: false,
        callable: false,
        reasonCodes: ["not_implemented", "definition_incompatible", "missing_context", "missing_host_grant", "kill_switched", "version_not_pinned", "preview_required", "approval_required"],
        nextAction: "Restore the listed runtime prerequisites before enabling this capability.",
      }, {
        capabilityId: "amplify.campaign.preview",
        effectMode: "preview",
        registered: true,
        implemented: true,
        authorable: true,
        definitionCompatible: true,
        mounted: true,
        contextReady: true,
        grantReady: true,
        previewable: true,
        committable: false,
        killSwitched: false,
        versionPinned: true,
        callable: true,
        reasonCodes: [],
        nextAction: null,
      }],
    }),
  }));
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

const signedEmbedUrl = "/?embedMode=chat&agentUiHostOrigin=http%3A%2F%2Flocalhost%3A5173";

async function openSignedWorkflowBuilder(page: Page, options: { waitOnStart?: boolean } = {}): Promise<WorkflowBuilderHostFixtureObservation> {
  await page.goto(signedEmbedUrl, { waitUntil: "domcontentloaded" });
  const fixture = await installWorkflowBuilderHostFixture(page, options);
  await expect.poll(() => page.evaluate(() => {
    const target = window as Window & { __sonikAgentUI?: { getPageContext?: () => { organizationId?: string | null } } };
    return target.__sonikAgentUI?.getPageContext?.().organizationId ?? null;
  })).toBe("11111111-1111-4111-8111-111111111111");
  await installWorkflowDraftStreamFixture(page);
  await openWorkflowBuilder(page);
  return fixture;
}

async function draftCampaignThroughUi(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Debug & Preview" }).click();
  const preview = page.locator('[data-agent-panel="workflow-builder-preview"]');
  await preview.locator("textarea").fill("Create trigger, ask, preview, approval, commit, and evidence steps");
  await preview.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("tab", { name: "Canvas", selected: true })).toBeVisible();
  await expect(page.locator(`[data-workflow-run-panel="${AMPLIFY_CAMPAIGN_COMMAND_ID}"]`).first()).toBeVisible();
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

test("draft lifecycle announces state and warns only for unsaved work", async ({ page }) => {
  await installWorkflowBuilderDraftPersistenceFixture(page);
  await gotoFreshWorkspace(page, smokeUrl(null));
  await openWorkflowBuilder(page);

  await expect(page.locator('[data-workflow-lifecycle="new"]')).toBeVisible();
  await page.getByRole("tab", { name: "Canvas" }).click();
  await page.getByLabel("Workflow title").first().fill("Governed author workflow");
  await expect(page.locator('[data-workflow-lifecycle="dirty"]')).toBeVisible();

  let dialogCount = 0;
  page.on("dialog", async (dialog) => {
    dialogCount += 1;
    expect(dialog.message()).toBe("Discard unsaved workflow changes?");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Return to the chat workspace" }).click();
  await expect(page.locator('[data-agent-mode="workflow-builder"]')).toBeVisible();
  expect(dialogCount).toBe(1);

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator('[data-workflow-lifecycle="saved"]')).toBeVisible();
  await page.getByRole("button", { name: "Return to the chat workspace" }).click();
  await expect(page.locator('[data-agent-mode="workflow-builder"]')).toHaveCount(0);
  expect(dialogCount).toBe(1);
});

test("model catalog proves 35-row search, ten-row viewport, pointer and keyboard selection", async ({ page }) => {
  await installModelCatalogFixture(page);
  await gotoFreshWorkspace(page, smokeUrl(null));
  await openWorkflowBuilder(page);

  const listbox = page.getByRole("listbox", { name: "Model" });
  await expect(page.getByRole("status").filter({ hasText: "35 model results available." })).toBeAttached();
  const dimensions = await listbox.evaluate((element) => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
  expect(dimensions.clientHeight).toBe(800);
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  await page.getByLabel("Search models").fill("Fixture Model 35");
  const finalModel = page.getByRole("option", { name: /Fixture Model 35/ });
  await expect(finalModel).toContainText("Video");
  await expect(finalModel).toContainText("Agent");
  await expect(finalModel).toContainText("Audio");
  await finalModel.click();
  await expect(finalModel).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("status").filter({ hasText: "Selected model: Fixture Model 35." })).toBeAttached();

  await page.getByLabel("Search models").fill("");
  await listbox.focus();
  await listbox.press("End");
  await expect(page.getByRole("option", { name: /Fixture Model 35/ })).toBeFocused();
  await page.keyboard.press("Home");
  const firstModel = page.getByRole("option", { name: /Fixture Model 01/ });
  await expect(firstModel).toBeFocused();
  await firstModel.press("Enter");
  await expect(firstModel).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Expand catalog" }).click();
  await expect(page.getByRole("button", { name: "Collapse catalog" })).toHaveAttribute("aria-expanded", "true");
});

test("capability readiness renders callable and actionable non-callable states", async ({ page }) => {
  await installCapabilityReadinessFixture(page);
  await gotoFreshWorkspace(page, smokeUrl(null));
  await openWorkflowBuilder(page);

  await page.getByText("amplify.campaign", { exact: true }).click();
  await expect(page.getByText("amplify.campaign.preview", { exact: true })).toBeVisible();
  await expect(page.getByText("callable", { exact: true })).toBeVisible();
  await expect(page.getByText("amplify.campaign.create", { exact: true })).toBeVisible();
  await expect(page.getByText("Restore the listed runtime prerequisites before enabling this capability.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Blocked: not_implemented, definition_incompatible, missing_context, missing_host_grant, kill_switched, version_not_pinned, preview_required, approval_required/)).toBeAttached();
  await expect(page.getByLabel("amplify.campaign tool policy")).toHaveText("off");
  await expect(page.getByText(/Not runnable: not_implemented/)).toBeVisible();
});

test("builder exposes isolated preview, full keyboard canvas semantics, and graph-free organizer", async ({ page }) => {
  await installWorkflowBuilderDraftPersistenceFixture(page);
  await gotoFreshWorkspace(page, smokeUrl(null));
  await openWorkflowBuilder(page);

  await page.getByRole("tab", { name: "Canvas" }).click();
  await page.getByRole("button", { name: "Add node" }).first().click();
  const firstNode = page.locator('[data-workflow-node-index="0"]').first();
  await firstNode.focus();
  await firstNode.press("ArrowRight");
  await expect(firstNode.getByRole("button", { name: /output port/ })).toBeFocused();
  await firstNode.getByRole("button", { name: /output port/ }).press("ArrowLeft");
  await expect(firstNode.getByRole("button", { name: /input port/ })).toBeFocused();
  await firstNode.focus();
  await firstNode.press("Enter");
  await expect(firstNode.getByLabel(/title$/)).toBeFocused();
  await firstNode.focus();
  await firstNode.press("c");
  await expect(page.getByText(/Connected .* to .*/)).toBeAttached();
  await firstNode.press("Control+z");
  await expect(page.getByText("Undid the last canvas change.")).toBeAttached();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByText("Redid the last canvas change.")).toBeAttached();
  await firstNode.focus();
  await firstNode.press("d");
  await expect(page.getByText(/Disconnected .* from .*/)).toBeAttached();

  await page.getByRole("tab", { name: "Debug & Preview" }).click();
  await expect(page.locator("[data-debug-preview-context]")).toContainText("Isolated preview context");
  await expect(page.locator("[data-debug-preview-context]")).toContainText("read/preview only");

  await page.getByRole("button", { name: "Organizer", exact: true }).click();
  await expect(page.locator("[data-organizer-panel]")).toBeVisible();
  await expect(page.locator('[data-agent-panel="workflow-builder-canvas"]')).toHaveCount(0);
  for (const heading of ["Identity", "Instructions", "Knowledge", "Curated capabilities"]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.getByText("Pending approval", { exact: true })).toBeVisible();
  await expect(page.getByText("Recent run", { exact: true })).toBeVisible();
  const organizer = page.locator("[data-organizer-panel]");
  await expect(organizer.getByRole("button", { name: "Test" })).toBeVisible();
  await expect(organizer.getByRole("button", { name: "Publish" })).toBeVisible();
  await expect(organizer.getByRole("button", { name: "Review approvals" })).toBeVisible();
  await expect(page.getByText(/raw graph|MCP|model administration/i)).toHaveCount(0);
  const accessibilityTree = await page.locator('[data-agent-mode="workflow-builder"]').ariaSnapshot();
  expect(accessibilityTree).toContain('button "Save configuration"');
  expect(accessibilityTree).toContain('button "Review approvals"');
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator("[data-run-history-panel]")).toBeVisible();
});

test("operator history visibly correlates the governed causal path", async ({ page }) => {
  const query = {
    sessionId: "session-e2e",
    conversationRunId: "conversation-e2e",
    workflowRunId: "workflow-run-e2e",
    nodeId: "commit",
    toolCallId: "tool-e2e",
    approvalId: "approval-e2e",
    artifactId: "artifact-e2e",
    receiptId: "receipt-e2e",
    requestId: "request-e2e",
    traceId: "trace-e2e",
  };
  await page.route("**/api/workflow-history?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      history: {
        query,
        conversations: [{ conversationRunId: query.conversationRunId, sessionId: query.sessionId, requestId: query.requestId, traceId: query.traceId, startedAt: "2026-07-15T21:00:00.000Z", status: "completed" }],
        workflows: [{ workflowRunId: query.workflowRunId, workflowId: "governed-author", workflowVersionId: "governed-author@1", sessionId: query.sessionId, createdAt: "2026-07-15T21:00:00.000Z", updatedAt: "2026-07-15T21:01:00.000Z", status: "completed" }],
        nodes: [{ workflowRunId: query.workflowRunId, nodeId: query.nodeId, status: "succeeded" }],
        toolCalls: [{ toolCallId: query.toolCallId, sessionId: query.sessionId, requestId: query.requestId, artifactId: query.artifactId, createdAt: "2026-07-15T21:00:10.000Z", status: "succeeded" }],
        approvals: [{ approvalId: query.approvalId, workflowRunId: query.workflowRunId, nodeId: "approval", status: "approved" }],
        artifacts: [{ artifactId: query.artifactId, workflowRunId: query.workflowRunId, nodeId: "evidence", status: "ready" }],
        receipts: [{ receiptId: query.receiptId, workflowRunId: query.workflowRunId, nodeId: query.nodeId, status: "committed" }],
        events: [{ eventId: "event-e2e", source: "workflow", timestamp: "2026-07-15T21:01:00.000Z", status: "completed", workflowRunId: query.workflowRunId, nodeId: query.nodeId, approvalId: query.approvalId, artifactId: query.artifactId }],
      },
    }),
  }));
  await gotoFreshWorkspace(page, smokeUrl(null));
  await openWorkflowBuilder(page);
  await page.getByRole("button", { name: "History", exact: true }).click();

  for (const [key, value] of Object.entries(query)) {
    await expect(page.getByText(`${key}: ${value}`, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("Events (1)", { exact: true })).toBeVisible();
  await expect(page.getByText("Approvals (1)", { exact: true })).toBeVisible();
  await expect(page.getByText("Artifacts (1)", { exact: true })).toBeVisible();
  await expect(page.getByText("Receipts (1)", { exact: true })).toBeVisible();
});

test("UI-04 keyboard path deletes, validates, publishes, starts, traces, and resumes", async ({ page }) => {
  await openSignedWorkflowBuilder(page, { waitOnStart: true });
  await draftCampaignThroughUi(page);

  await page.getByRole("button", { name: "Add node" }).first().click();
  const disposableNode = page.locator('[data-workflow-node-id="node_6"]');
  await disposableNode.focus();
  await disposableNode.press("Delete");
  await expect(disposableNode).toHaveCount(0);
  await expect(page.getByText("Deleted node_6. Workflow is valid.")).toBeAttached();

  const title = page.getByLabel("Workflow title").first();
  await title.fill("");
  await expect(page.locator('[data-workflow-lifecycle="invalid"]')).toBeVisible();
  await expect(page.getByText(/Workflow is invalid:/)).toBeAttached();
  await title.fill("Governed campaign author workflow");
  await expect(page.getByText("Workflow is valid.")).toBeAttached();

  await page.getByRole("button", { name: "Save draft" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-workflow-lifecycle="saved"]')).toBeVisible();
  await page.keyboard.press("Alt+Shift+P");
  const publish = page.locator('[data-builder-action="publish"]');
  await expect(publish).toBeFocused();
  await expect(page.getByText("Publish control focused.")).toBeAttached();
  await publish.press("Enter");
  await expect(page.locator('[data-workflow-lifecycle="published"]')).toBeVisible();

  await page.keyboard.press("Alt+Shift+R");
  const runPanel = page.locator(`[data-workflow-run-panel="${AMPLIFY_CAMPAIGN_COMMAND_ID}"]`).first();
  await expect(runPanel.getByRole("button", { name: "Run", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(runPanel.locator("[data-workflow-run-waitpoint]")).toBeVisible();
  await page.keyboard.press("Alt+Shift+T");
  await expect(runPanel.locator("[data-workflow-run-trace] summary")).toBeFocused();
  await runPanel.getByPlaceholder("Answer").fill("Returning members");
  await page.keyboard.press("Alt+Shift+M");
  await expect(runPanel.getByRole("button", { name: "Answer & resume" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(runPanel.locator("[data-workflow-run-status]")).toHaveText("Run resumed.");
});

test("E2E-01 author journey reloads and governs trigger through correlated evidence", async ({ page }) => {
  const fixture = await openSignedWorkflowBuilder(page, { waitOnStart: true });
  await draftCampaignThroughUi(page);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.locator('[data-workflow-lifecycle="saved"]')).toBeVisible();

  await page.getByRole("button", { name: "Return to the chat workspace" }).click();
  await openWorkflowBuilder(page);
  await page.getByLabel("Saved workflows").selectOption(AMPLIFY_CAMPAIGN_COMMAND_ID);
  await expect(page.getByLabel("Workflow title").first()).toHaveValue("Create an Amplify campaign");
  await expect(page.locator('[data-workflow-lifecycle="saved"]')).toBeVisible();
  await page.locator('[data-builder-action="publish"]').click();
  await expect(page.locator('[data-workflow-lifecycle="published"]')).toBeVisible();

  await page.getByRole("tab", { name: "Canvas" }).click();
  const runPanel = page.locator(`[data-workflow-run-panel="${AMPLIFY_CAMPAIGN_COMMAND_ID}"]`).first();
  await runPanel.getByRole("button", { name: "Run", exact: true }).click();
  await runPanel.getByPlaceholder("Answer").fill("Returning members");
  await runPanel.getByRole("button", { name: "Answer & resume" }).click();
  await runPanel.getByRole("button", { name: "Preview", exact: true }).click();
  await runPanel.getByRole("button", { name: "Approve", exact: true }).click();
  await runPanel.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(runPanel.locator("[data-workflow-run-receipt]")).toContainText("campaign-fixture-receipt");
  await expect(runPanel.locator("[data-workflow-run-trace]")).toContainText("trigger");
  await expect(runPanel.locator("[data-workflow-run-trace]")).toContainText("brief");
  await expect(runPanel.locator("[data-workflow-run-trace]")).toContainText("preview");
  await expect(runPanel.locator("[data-workflow-run-trace]")).toContainText("confirm");
  await expect(runPanel.locator("[data-workflow-run-trace]")).toContainText("commit");

  await page.getByRole("button", { name: "Organizer", exact: true }).click();
  await page.getByRole("button", { name: "campaign-fixture-receipt" }).click();
  await expect(page.getByText("Artifacts (1)", { exact: true })).toBeVisible();
  await expect(page.getByText("Receipts (1)", { exact: true })).toBeVisible();
  expect(fixture.workflowDefinitionActions).toEqual(expect.arrayContaining(["create", "get", "publish"]));
  expect(fixture.workflowRunActions).toEqual(["start", "resume_run", "preview", "approve", "commit"]);
  expect(fixture.historyQueries.at(-1)).toContain("receiptId=campaign-fixture-receipt");
});

test("E2E-03 Organizer edits allowlisted fields and preserves the P3 published schema", async ({ page }) => {
  const fixture = await openSignedWorkflowBuilder(page);
  await draftCampaignThroughUi(page);
  await page.getByRole("button", { name: "Save draft" }).click();
  const p3Definition = fixture.workflowDefinitionBodies.find(({ action }) => action === "create")?.definition as Record<string, unknown>;

  await page.getByRole("button", { name: "Organizer", exact: true }).click();
  await expect(page.locator('[data-agent-panel="workflow-builder-canvas"]')).toHaveCount(0);
  await page.getByLabel("Start from a campaign request title").fill("Start from the governed campaign brief");
  await page.getByRole("button", { name: "Save configuration" }).click();
  await expect(page.getByText(/Organizer configuration saved at revision/)).toBeVisible();
  await page.getByRole("button", { name: "Test", exact: true }).click();
  const runPanel = page.locator(`[data-workflow-run-panel="${AMPLIFY_CAMPAIGN_COMMAND_ID}"]`);
  await expect(runPanel.getByRole("button", { name: "Run", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.locator('[data-workflow-lifecycle="published"]')).toBeVisible();

  await runPanel.getByRole("button", { name: "Run", exact: true }).click();
  await runPanel.getByRole("button", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Review approvals", exact: true }).click();
  await expect(runPanel.getByRole("button", { name: "Approve", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await runPanel.getByRole("button", { name: "Commit", exact: true }).click();
  await page.getByRole("button", { name: "Organizer", exact: true }).click();
  await page.getByRole("button", { name: "campaign-fixture-receipt" }).click();
  await expect(page.getByText("Receipts (1)", { exact: true })).toBeVisible();

  const organizerPatch = fixture.workflowDefinitionBodies.find(({ action }) => action === "organizer_patch") as { patch?: { expectedDraftRevision?: number; edits?: Array<{ path: string }> } };
  const publish = fixture.workflowDefinitionBodies.find(({ action }) => action === "publish") as { dependencyPins?: Record<string, unknown> };
  expect(organizerPatch.patch?.expectedDraftRevision).toBeGreaterThan(0);
  expect(organizerPatch.patch?.edits?.map(({ path }) => path)).toEqual(["nodes.trigger.config.title"]);
  expect(Object.keys(p3Definition).sort()).toEqual(["definitionVersion", "edges", "entryNodeId", "facadeToolIds", "nodes", "schemaVersion", "title", "workflowId"].sort());
  expect(publish.dependencyPins).toMatchObject({
    organizationId: "11111111-1111-4111-8111-111111111111",
    workflowVersionId: "amplify.campaign.create@0.1.0",
    definitionDigest: `sha256:${"a".repeat(64)}`,
  });
  expect(fixture.workflowRunActions).toEqual(["start", "preview", "approve", "commit"]);
});
