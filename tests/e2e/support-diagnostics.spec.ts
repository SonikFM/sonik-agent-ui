import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { gotoFreshWorkspace, smokeUrl, submitPrompt } from "./support/dev-smoke";
import { WORKSPACE_SESSION_ID_MAX_CHARS } from "../../apps/standalone-sveltekit/src/lib/server/workspace-route-limits";

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
  expect(JSON.parse(bodyText)).toEqual({ error: "Invalid request" });
  expect(response.headers()["x-sonik-request-id"]).toBe(correlationHeaders["x-sonik-request-id"]);
  expect(response.headers()["x-sonik-trace-id"]).toBe(correlationHeaders["x-sonik-trace-id"]);
  expect(response.headers().traceparent).toBe(correlationHeaders.traceparent);
  expect(bodyText).not.toContain(tooLongSessionId);
  expect(bodyText).not.toContain("workspace.sessionId");
  expect(bodyText).not.toContain(String(WORKSPACE_SESSION_ID_MAX_CHARS));
  expect(bodyText).not.toMatch(/exceeds|characters|max/i);

  const malformed = await request.post("/api/generate", {
    headers: {
      ...correlationHeaders,
      "x-sonik-request-id": "req_support_malformed",
      "content-type": "application/json",
    },
    data: Buffer.from("{not-json"),
  });

  expect(malformed.status()).toBe(400);
  expect(await malformed.json()).toEqual({ error: "Invalid request" });
});
