import { expect, test } from "@playwright/test";
import { DOCUMENT_FAILURE_SCENARIO, DOCUMENT_INTENT_SCENARIO, gotoFreshWorkspace, smokeUrl, submitPrompt } from "./support/dev-smoke";

const DOCUMENT_PROMPT = "create an HTML document in the document workspace/editor";

test("document-artifact-intent: explicit document transcript phrase creates and opens a workspace document", async ({ page }) => {
  const consoleLines: string[] = [];
  page.on("console", (message) => consoleLines.push(message.text()));

  await gotoFreshWorkspace(page, smokeUrl(DOCUMENT_INTENT_SCENARIO));
  await submitPrompt(page, DOCUMENT_PROMPT);

  await expect(page.locator(".workspace-root")).toHaveAttribute("data-artifact-open", "true", { timeout: 10_000 });
  await expect(page.locator('[data-canvas-panel="document"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Open or create a workspace document" })).toBeVisible();
  await expect(page.locator('[data-tool-phase="document"]')).toHaveAttribute("data-tool-state", "output-available", { timeout: 10_000 });
  await expect(page.locator('[data-tool-phase="canvas"]')).toHaveCount(0);
  await expect(page.locator('[data-tool-phase="document"] summary')).toContainText("Created document");
  await expect.poll(async () => page.evaluate(() => window.__sonikAgentUI?.getAssertions().hasActiveDocument)).toBe(true);
  await expect.poll(() => consoleLines.some((line) => line.includes('"event":"document_artifact.promoted"'))).toBe(true);
  expect(consoleLines.some((line) => line.includes("createJsonArtifact"))).toBe(false);
});

test("document-artifact-intent: terminal document tool failure exposes retryable user state", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(DOCUMENT_FAILURE_SCENARIO));
  await submitPrompt(page, DOCUMENT_PROMPT);

  const toolBlock = page.locator('[data-tool-phase="document"]').first();
  await expect(toolBlock).toHaveAttribute("data-tool-state", "output-error", { timeout: 10_000 });
  await expect(toolBlock.locator("summary")).toContainText("Document creation failed", { timeout: 10_000 });
  await toolBlock.click();
  await expect(toolBlock.locator("dd").last()).toContainText("dev smoke injected document failure");
  await expect(toolBlock.locator("dd").last()).toContainText(/Retry the document request/i);
});
