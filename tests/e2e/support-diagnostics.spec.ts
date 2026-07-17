import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { gotoFreshWorkspace, openChatActions, smokeUrl, submitPrompt } from "./support/dev-smoke";
import { WORKSPACE_SESSION_ID_MAX_CHARS } from "../../apps/standalone-sveltekit/src/lib/server/workspace-route-limits";

async function expectPanelInsideVisualViewport(page: import("@playwright/test").Page): Promise<void> {
  const panel = page.locator("[data-support-menu-panel]");
  await expect.poll(async () => panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const right = left + (viewport?.width ?? window.innerWidth);
    const bottom = top + (viewport?.height ?? window.innerHeight);
    return [rect.left - left, rect.top - top, right - rect.right, bottom - rect.bottom]
      .every((gutter) => gutter >= 15);
  })).toBe(true);
}

for (const width of [480, 320]) {
  test(`support diagnostics stays usable inside a ${width}px visual viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 260 });
    await gotoFreshWorkspace(page, smokeUrl(null, { embedMode: "chat" }));
    await openChatActions(page);

    const details = page.locator("details.support-menu");
    const summary = details.locator("summary");
    const panel = details.locator("[data-support-menu-panel]");
    await summary.focus();
    await summary.press("Enter");

    await expect(details).toHaveAttribute("open", "");
    await expect(panel).toBeVisible();
    await expectPanelInsideVisualViewport(page);

    await page.setViewportSize({ width, height: 210 });
    await expectPanelInsideVisualViewport(page);
    const scrollState = await panel.evaluate((element) => ({
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }));
    expect(scrollState.overflowY).toBe("auto");
    expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);
    await panel.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

    await page.keyboard.press("Escape");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(panel).toBeHidden();
    await expect(summary).toBeFocused();
  });
}

test("support diagnostics seam captures correlation and exports safe downloads", async ({ page }) => {
  await gotoFreshWorkspace(page, smokeUrl(null, { smokeRunId: "support-smoke-run" }));
  await submitPrompt(page, "support diagnostics smoke");

  await expect.poll(async () => page.evaluate(() => window.__sonikAgentUI?.getPageContext().correlation?.requestId)).toBeTruthy();

  const context = await page.evaluate(() => window.__sonikAgentUI?.getPageContext());
  expect(context?.correlation?.requestId).toMatch(/^req_/);
  expect(context?.correlation?.traceId).toMatch(/^[a-f0-9]{32}$/);
  expect(JSON.stringify(context)).not.toMatch(/authorization|cookie|secret|token|headers/i);

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", {
      origin: window.location.origin,
      data: {
        source: "sonik-agent-ui-host",
        type: "sonik:agent-ui:page-context",
        payload: {
          route: "/hostile",
          activeSessionId: "hostile-session",
          correlation: {
            sessionId: "hostile-session",
            requestId: "hostile-request",
            traceId: "ffffffffffffffffffffffffffffffff",
            traceparent: "00-ffffffffffffffffffffffffffffffff-ffffffffffffffff-01",
            agentUiRunId: "hostile-run",
            status: "success",
            capturedAt: "2026-07-10T12:00:00.000Z",
          },
          deployment: { id: "hostile-deployment", tag: "hostile-tag" },
        },
      },
    }));
  });
  const contextAfterHostSpoof = await page.evaluate(() => window.__sonikAgentUI?.getPageContext());
  expect(contextAfterHostSpoof?.activeSessionId).toBe(context?.activeSessionId);
  expect(contextAfterHostSpoof?.correlation?.requestId).toBe(context?.correlation?.requestId);
  expect(contextAfterHostSpoof?.correlation?.traceId).toBe(context?.correlation?.traceId);
  expect(contextAfterHostSpoof?.correlation?.agentUiRunId).toBe(context?.correlation?.agentUiRunId);
  expect(JSON.stringify(contextAfterHostSpoof)).not.toContain("hostile-request");
  expect(JSON.stringify(contextAfterHostSpoof)).not.toContain("hostile-deployment");

  const chatDownload = page.waitForEvent("download");
  const chatResult = await page.evaluate(() => window.__sonikAgentUI?.actions.exportChat?.());
  expect(chatResult?.ok).toBe(true);
  const chat = await chatDownload;
  const chatPath = await chat.path();
  expect(chatPath).toBeTruthy();
  const chatText = await readFile(chatPath!, "utf8");
  expect(chat.suggestedFilename()).toMatch(/sonik-chat-.*\.md$/);

  const diagnosticsDownload = page.waitForEvent("download");
  const diagnosticsResult = await page.evaluate(() => window.__sonikAgentUI?.actions.exportDiagnostics?.());
  expect(diagnosticsResult?.ok).toBe(true);
  const diagnostics = await diagnosticsDownload;
  expect(diagnostics.suggestedFilename()).toMatch(/sonik-diagnostics-.*\.json$/);
  const diagnosticsPath = await diagnostics.path();
  expect(diagnosticsPath).toBeTruthy();
  const diagnosticsBody = await readFile(diagnosticsPath!, "utf8");
  expect(diagnosticsBody).toContain("sonik.agent_ui.support_diagnostics.v1");
  expect(diagnosticsBody).toContain(context?.correlation?.requestId ?? "missing-request");
  expect(diagnosticsBody).not.toMatch(/authorization|cookie|secret|token|tool-createJsonArtifact|tool_call|payload/i);
  expect(chatText).not.toMatch(/authorization|cookie|secret|token|tool-createJsonArtifact|tool_call|payload/i);
});

test("generate API preserves sanitized request-validation status and support correlation", async ({ request }) => {
  const correlationHeaders = {
    "x-sonik-request-id": "req_support_validation",
    "x-sonik-trace-id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
  };
  const tooLongSessionId = "s".repeat(WORKSPACE_SESSION_ID_MAX_CHARS + 1);

  const response = await request.post("/api/generate", {
    headers: correlationHeaders,
    data: {
      messages: [],
      workspace: { sessionId: tooLongSessionId },
    },
  });
  const bodyText = await response.text();

  expect(response.status()).toBe(413);
  expect(JSON.parse(bodyText)).toEqual({
    ok: false,
    code: "invalid_request",
    error: "Invalid request",
    phase: "pre_stream",
    safeToRetry: false,
    requestId: correlationHeaders["x-sonik-request-id"],
    traceId: correlationHeaders["x-sonik-trace-id"],
  });
  expect(response.headers()["x-sonik-request-id"]).toBe(correlationHeaders["x-sonik-request-id"]);
  expect(response.headers()["x-sonik-trace-id"]).toBe(correlationHeaders["x-sonik-trace-id"]);
  expect(response.headers().traceparent).toBe(correlationHeaders.traceparent);
  expect(bodyText).not.toContain(tooLongSessionId);
  expect(bodyText).not.toContain("workspace.sessionId");
  expect(bodyText).not.toContain(String(WORKSPACE_SESSION_ID_MAX_CHARS));
  expect(bodyText).not.toMatch(/exceeds|characters|max/i);
  expect(bodyText).not.toMatch(/stack|cause|issues|details/i);

  const malformed = await request.post("/api/generate", {
    headers: {
      ...correlationHeaders,
      "x-sonik-request-id": "req_support_malformed",
      "content-type": "application/json",
    },
    data: Buffer.from("{not-json"),
  });

  const malformedBodyText = await malformed.text();
  expect(malformed.status()).toBe(400);
  expect(JSON.parse(malformedBodyText)).toEqual({
    ok: false,
    code: "invalid_request",
    error: "Invalid request",
    phase: "pre_stream",
    safeToRetry: false,
    requestId: "req_support_malformed",
    traceId: correlationHeaders["x-sonik-trace-id"],
  });
  expect(malformed.headers()["x-sonik-request-id"]).toBe("req_support_malformed");
  expect(malformed.headers()["x-sonik-trace-id"]).toBe(correlationHeaders["x-sonik-trace-id"]);
  expect(malformed.headers().traceparent).toBe(correlationHeaders.traceparent);
  expect(malformedBodyText).not.toContain("{not-json");
  expect(malformedBodyText).not.toMatch(/stack|cause|syntax|unexpected token|position/i);
});
