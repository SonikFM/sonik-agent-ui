import { chromium } from "playwright";

const baseUrl = process.env.AGENT_UI_COMPOSER_SMOKE_URL ?? "http://127.0.0.1:5187/?smokeMockStream=1&smokeRunId=composer-context-tools";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let generateBody;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/generate")) generateBody = request.postDataJSON();
  });
  const rejectOnce = new Set([
    "/api/commands/search?limit=40",
    "/api/tool-manifest",
    "/api/documents/library?sort=updated&limit=8",
  ]);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (rejectOnce.delete(`${url.pathname}${url.search}`)) await route.abort("failed");
    else await route.continue();
  });
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
  const editor = page.locator('textarea[name="message"]');
  await editor.waitFor({ timeout: 30_000 });

  await editor.fill("/book");
  await page.locator('[data-composer-suggestion^="skill:"]').first().waitFor({ timeout: 15_000 });
  await page.getByRole("status").filter({ hasText: "Some command and skill catalogs are unavailable." }).waitFor();
  if (await page.locator('[data-composer-suggestion^="command:"]').count()) throw new Error("Unavailable command catalog masqueraded as ready.");
  await page.getByRole("button", { name: "Retry catalogs" }).click();
  await page.locator('[data-composer-suggestion^="command:"]').first().waitFor({ timeout: 15_000 });
  const skillCount = await page.locator('[data-composer-suggestion^="skill:"]').count();
  if (!skillCount) throw new Error("No live skill suggestions were rendered.");
  await page.locator('[data-composer-suggestion^="skill:"]').first().click();
  await page.locator('[data-context-kind="runtime-skill"]').waitFor();

  await editor.fill("/book");
  await page.locator('[data-composer-suggestions="/"]').waitFor();
  const suggestions = await page.locator("[data-composer-suggestion]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-composer-suggestion") ?? ""));
  if (!suggestions.some((value) => value.startsWith("skill:")) || !suggestions.some((value) => value.startsWith("command:"))) {
    throw new Error("Slash suggestions did not merge skills and commands.");
  }
  await editor.press("Escape");
  if (await page.locator('[data-composer-suggestions="/"]').count()) throw new Error("Escape did not dismiss composer suggestions.");
  if (await editor.inputValue() !== "/book") throw new Error("Escape deleted typed composer text.");

  const attachmentTrigger = page.getByTestId("composer-attachment-trigger");
  await attachmentTrigger.click();
  await page.getByRole("button", { name: "Retry recent documents" }).click();
  await page.getByRole("button", { name: "Retry recent documents" }).waitFor({ state: "detached" });
  await attachmentTrigger.click();
  await attachmentTrigger.click();
  await page.route("**/api/document", async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await page.locator('input[type="file"]').setInputFiles(["package.json", "package.json"]);
  const uploadAttempts = page.locator("[data-upload-chip]");
  await page.waitForFunction(() => document.querySelectorAll("[data-upload-chip]").length === 2);
  const uploadAttemptIds = await uploadAttempts.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-upload-chip")));
  if (new Set(uploadAttemptIds).size !== 2) throw new Error("Uploading the same file twice reused an upload attempt ID.");
  await page.locator('[data-context-kind="document"]').nth(1).waitFor({ timeout: 15_000 });

  const removeContextEvidence = await page.evaluate(async () => {
    const control = window.__sonikAgentUI;
    const descriptor = control?.getActions().actions.find((action) => action.name === "removeComposerContext");
    const contextId = document.querySelector('[data-context-kind="document"]')?.getAttribute("data-context-chip") ?? "";
    const invalid = await control?.actions.removeComposerContext?.({});
    const removed = await control?.actions.removeComposerContext?.({ contextId });
    return { descriptor, contextId, invalid, removed };
  });
  if (!removeContextEvidence.descriptor) throw new Error("removeComposerContext descriptor is missing.");
  if (removeContextEvidence.invalid?.ok !== false || removeContextEvidence.invalid?.disabledReason !== "missing_context_id") throw new Error("removeComposerContext did not validate a missing context id.");
  if (!removeContextEvidence.contextId || removeContextEvidence.removed?.ok !== true) throw new Error("removeComposerContext did not remove a staged document.");
  if (await page.locator(`[data-context-chip="${removeContextEvidence.contextId}"]`).count()) throw new Error("removeComposerContext left the removed chip staged.");

  const toolSelector = page.getByTestId("composer-tool-selector-trigger");
  await toolSelector.click();
  const selector = page.getByTestId("composer-tool-selector");
  await selector.waitFor();
  await selector.locator("button").first().click();
  const toolRows = selector.locator("[data-tool-row]");
  if (await toolRows.count() < 2) throw new Error("Composer smoke requires at least two tools to verify multi-pin provenance.");
  await toolRows.nth(0).getByRole("button").click();
  await toolRows.nth(1).getByRole("button").click();
  await editor.fill("Verify staged composer context");
  const generateRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().includes("/api/generate"));
  await editor.press("Enter");
  await generateRequest;
  const sentItems = generateBody?.contextSelection?.items ?? [];
  if (!sentItems.some((item) => item.kind === "runtime-skill")) throw new Error("Sent request lost the staged runtime skill.");
  const pinnedHints = sentItems.filter((item) => item.metadata?.pinnedToolId);
  if (pinnedHints.length !== 2 || pinnedHints.some((item) => item.kind !== "command-family" || item.metadata?.contextOnly !== true || item.metadata?.permission)) {
    throw new Error("Pinned tools were not sent as two non-grant command-family context hints.");
  }
  if (await page.locator('[data-context-kind="runtime-skill"]').count()) throw new Error("Sent runtime skill remained staged for the next turn.");
  console.log(JSON.stringify({ status: "PASS", skillCount, slashKinds: ["skill", "command"], partialCatalogWarning: true, catalogRetries: { composer: true, recentDocuments: true }, sameFileUploadAttempts: 2, documentAttached: true, removeComposerContext: true, toolSelector: true, sentRuntimeSkill: true, pinnedHints: 2 }));
} finally {
  await browser.close();
}
