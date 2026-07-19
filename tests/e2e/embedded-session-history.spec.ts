import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { embeddedHostUrl } from "./support/dev-smoke";

const embedUrl = embeddedHostUrl();

const historicalSession = sessionSummary({
  id: "g010-historical-session",
  name: "Stored historical title",
  lastAccessed: "2026-07-14T12:00:00.000Z",
  lastMessageAt: "2026-07-13T15:02:00.000Z",
  updatedAt: "2026-07-13T14:00:00.000Z",
});
const invalidDateSession = sessionSummary({
  id: "g010-invalid-date-session",
  name: "Stored invalid-date title",
  lastAccessed: "2026-07-14T11:00:00.000Z",
  lastMessageAt: "not-a-date",
  updatedAt: "2026-07-12T14:00:00.000Z",
});
const missingDateSession = sessionSummary({
  id: "g010-missing-date-session",
  name: "Stored missing-date title",
  lastAccessed: "2026-07-14T10:00:00.000Z",
  lastMessageAt: null,
  updatedAt: "",
});
const sessionSummaries = [historicalSession, invalidDateSession, missingDateSession];

function sessionSummary(input: {
  id: string;
  name: string;
  lastAccessed: string;
  lastMessageAt: string | null;
  updatedAt: string;
}) {
  return {
    id: input.id,
    name: input.name,
    mode: "chat",
    archived: false,
    is_important: false,
    folder: null,
    message_count: 0,
    active_document_id: null,
    active_artifact_id: null,
    created_at: "2026-07-10T12:00:00.000Z",
    updated_at: input.updatedAt,
    last_accessed: input.lastAccessed,
    last_message_at: input.lastMessageAt,
  };
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function donateEmbeddedHostContext(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Window & { __sonikAgentUI?: unknown }).__sonikAgentUI));
  await page.evaluate(() => {
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    window.postMessage({
      source: "sonik-agent-ui-host",
      type: "sonik:agent-ui:page-context",
      authority: { header: "g010_embedded_session_history_header", revision: Date.now(), expiresAt },
      payload: {
        route: "/history",
        surface: "embedded-session-history-test",
        authenticated: true,
        organizationId: "11111111-1111-4111-8111-111111111111",
        scopes: ["agent-ui:read"],
        hostSession: {
          source: "embedded-host",
          sessionId: "g010-embedded-host-session",
          userId: "g010-user",
          principalId: "g010-user",
          organizationId: "11111111-1111-4111-8111-111111111111",
          authenticated: true,
          scopes: ["agent-ui:read"],
          expiresAt,
        },
      },
    }, window.location.origin);
  });
}

test("embedded history adds viewer-local dates without changing stored titles or selection ids", async ({ page }) => {
  const detailRequestIds: string[] = [];
  const sessionMutationRequests: string[] = [];

  await page.route("**/api/session**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      sessionMutationRequests.push(`${request.method()} ${url.pathname}`);
      await route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ ok: false, error: "mutation_not_allowed" }) });
      return;
    }
    if (url.pathname === "/api/sessions") {
      await fulfillJson(route, url.searchParams.get("archived") === "true" ? [] : sessionSummaries);
      return;
    }
    const detailMatch = url.pathname.match(/^\/api\/session\/([^/]+)$/);
    if (detailMatch) {
      const sessionId = decodeURIComponent(detailMatch[1]);
      detailRequestIds.push(sessionId);
      const session = sessionSummaries.find((candidate) => candidate.id === sessionId);
      if (!session) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
        return;
      }
      await fulfillJson(route, {
        session,
        activeDocument: null,
        messages: [],
        runs: [],
        telemetry: [],
        reattach: null,
        activeArtifact: null,
        activeArtifactState: null,
        activeArtifactVersions: [],
      });
      return;
    }
    await fulfillJson(route, { ok: true });
  });

  await page.goto(embedUrl, { waitUntil: "domcontentloaded" });
  await donateEmbeddedHostContext(page);

  const switcher = page.getByTestId("agent-session-switcher");
  await expect(switcher.locator("option")).toHaveCount(3);
  const expectedHistoricalTitle = await page.evaluate(({ title, timestamp }) => {
    const formatted = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
    return `${title} · ${formatted}`;
  }, { title: historicalSession.name, timestamp: historicalSession.last_message_at });

  await expect(switcher.locator(`option[value="${historicalSession.id}"]`)).toHaveText(expectedHistoricalTitle);
  await expect(switcher.locator(`option[value="${invalidDateSession.id}"]`)).toHaveText(invalidDateSession.name);
  await expect(switcher.locator(`option[value="${missingDateSession.id}"]`)).toHaveText(missingDateSession.name);

  const apiTitlesBeforeSelection = await page.evaluate(async () => {
    const response = await fetch("/api/sessions");
    return (await response.json() as Array<{ id: string; name: string }>).map(({ id, name }) => ({ id, name }));
  });
  expect(apiTitlesBeforeSelection).toEqual(sessionSummaries.map(({ id, name }) => ({ id, name })));

  detailRequestIds.length = 0;
  await switcher.selectOption(invalidDateSession.id);
  await expect(switcher).toHaveValue(invalidDateSession.id);
  await expect.poll(() => detailRequestIds.at(-1)).toBe(invalidDateSession.id);
  expect(sessionMutationRequests).toEqual([]);

  const apiTitlesAfterSelection = await page.evaluate(async () => {
    const response = await fetch("/api/sessions");
    return (await response.json() as Array<{ id: string; name: string }>).map(({ id, name }) => ({ id, name }));
  });
  expect(apiTitlesAfterSelection).toEqual(apiTitlesBeforeSelection);
  expect(sessionMutationRequests).toEqual([]);
});

const persistedMessage = {
  id: "g019-persisted-message",
  session_id: historicalSession.id,
  role: "assistant",
  content: "Persisted history remains visible.",
  parts: [{ type: "text", text: "Persisted history remains visible." }],
  created_at: "2026-07-13T15:03:00.000Z",
};

const historyModes = [
  { name: "workspace wide", width: 1100, mode: "workspace", rail: "expanded" },
  { name: "workspace mobile", width: 390, mode: "workspace", rail: "expanded" },
  { name: "canvas wide hidden rail", width: 1100, mode: "canvas", rail: "hidden" },
  { name: "canvas mobile hidden rail", width: 390, mode: "canvas", rail: "hidden" },
] as const;

for (const scenario of historyModes) {
  test(`${scenario.name} preserves hydrated history through authority failure and keyboard Retry`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: 820 });
    const sessionMutations: string[] = [];
    const listAuthorities: string[] = [];
    const listWorkspaceTokens: string[] = [];
    const detailWorkspaceTokens: string[] = [];
    const detailRequestIds: string[] = [];
    let failRefresh = false;

    await page.route("**/api/session**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const headers = request.headers();
      if (request.method() !== "GET") {
        sessionMutations.push(`${request.method()} ${url.pathname}`);
        await route.fulfill({ status: 405, contentType: "application/json", body: JSON.stringify({ ok: false, error: "mutation_not_allowed" }) });
        return;
      }
      if (url.pathname === "/api/sessions") {
        if (url.searchParams.get("archived") === "true") return fulfillJson(route, []);
        listAuthorities.push(headers["x-sonik-agent-ui-host-context"] ?? "");
        listWorkspaceTokens.push(headers["x-sonik-agent-ui-workspace-session-context"] ?? "");
        if (failRefresh) {
          await route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ ok: false, error: "Authenticated host session required", code: "host_auth_required", phase: "read", safeToRetry: true }),
          });
          return;
        }
        return fulfillJson(route, sessionSummaries);
      }
      if (url.pathname === `/api/session/${historicalSession.id}`) {
        detailRequestIds.push(decodeURIComponent(url.pathname.slice("/api/session/".length)));
        detailWorkspaceTokens.push(headers["x-sonik-agent-ui-workspace-session-context"] ?? "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "x-sonik-agent-ui-workspace-session-context": "g019-workspace-token" },
          body: JSON.stringify({
            session: historicalSession,
            activeDocument: null,
            messages: [persistedMessage],
            runs: [],
            telemetry: [],
            reattach: null,
            activeArtifact: null,
            activeArtifactState: null,
            activeArtifactVersions: [],
          }),
        });
        return;
      }
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: "not_found" }) });
    });

    const url = embeddedHostUrl({ mode: scenario.mode, rail: scenario.rail });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await donateHistoryAuthority(page, { header: "g019-authority-a", revision: 100, hostSessionId: "g019-host-a" });

    const switcher = page.getByTestId("agent-session-switcher");
    await expect(switcher).toHaveValue(historicalSession.id);
    await expect(page.getByText(persistedMessage.content)).toBeVisible();
    await expect(switcher.locator("option")).toHaveCount(sessionSummaries.length);
    const initialOptions = await switcher.locator("option").evaluateAll((options) => options.map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent })));

    await donateHistoryAuthority(page, { header: "g019-authority-b", revision: 200, hostSessionId: "g019-host-b" });
    await page.evaluate(() => {
      window.addEventListener("message", (event) => {
        const data = event.data as { source?: string; type?: string } | null;
        if (event.source !== window.parent || data?.source !== "sonik-agent-ui" || data.type !== "sonik:agent-ui:request-page-context") return;
        const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
        window.postMessage({
          source: "sonik-agent-ui-host",
          type: "sonik:agent-ui:page-context",
          authority: { header: "g019-authority-c", revision: 300, expiresAt },
          payload: { route: "/history", surface: "embedded-session-history-test", authenticated: true },
        }, window.location.origin);
      }, { once: true });
    });

    failRefresh = true;
    const actionsTrigger = page.getByTestId("agent-chat-actions-trigger");
    await actionsTrigger.focus();
    await expect(actionsTrigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("agent-chat-actions-popover")).toBeVisible();
    await page.getByTestId("session-history-refresh").click();
    await expect(page.getByTestId("agent-chat-actions-popover")).toBeHidden();
    const alert = page.getByTestId("session-history-error");
    await expect(alert).toBeVisible();
    await expect(switcher).toHaveValue(historicalSession.id);
    await expect(switcher.locator("option")).toHaveCount(sessionSummaries.length);
    expect(await switcher.locator("option").evaluateAll((options) => options.map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent })))).toEqual(initialOptions);
    await expect(page.getByText(persistedMessage.content)).toBeVisible();
    expect(listAuthorities.slice(-2)).toEqual(["g019-authority-b", "g019-authority-c"]);
    expect(listWorkspaceTokens.slice(-2)).toEqual(["g019-workspace-token", "g019-workspace-token"]);

    const screenshotDir = path.join("test-results", "g019-session-history");
    await mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, `${scenario.mode}-${scenario.rail}-${scenario.width}-failure.png`), fullPage: true });

    failRefresh = false;
    const retry = page.getByTestId("session-history-retry");
    await retry.focus();
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(alert).toBeHidden();
    await expect(switcher).toHaveValue(historicalSession.id);
    expect(await switcher.locator("option").evaluateAll((options) => options.map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent })))).toEqual(initialOptions);
    await expect(page.getByText(persistedMessage.content)).toBeVisible();
    expect(detailWorkspaceTokens.at(-1)).toBe("g019-workspace-token");
    expect(detailRequestIds).toEqual([historicalSession.id, historicalSession.id]);
    expect(sessionMutations).toEqual([]);
  });
}

async function donateHistoryAuthority(page: Page, input: { header: string; revision: number; hostSessionId: string }): Promise<void> {
  await page.waitForFunction(() => Boolean((window as Window & { __sonikAgentUI?: unknown }).__sonikAgentUI));
  await page.evaluate(({ header, revision, hostSessionId }) => {
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    window.postMessage({
      source: "sonik-agent-ui-host",
      type: "sonik:agent-ui:page-context",
      authority: { header, revision, expiresAt },
      payload: {
        route: "/history",
        surface: "embedded-session-history-test",
        authenticated: true,
        organizationId: "11111111-1111-4111-8111-111111111111",
        scopes: ["agent-ui:read"],
        hostSession: {
          source: "embedded-host",
          sessionId: hostSessionId,
          userId: "g019-user",
          principalId: "g019-user",
          organizationId: "11111111-1111-4111-8111-111111111111",
          authenticated: true,
          scopes: ["agent-ui:read"],
          expiresAt,
        },
      },
    }, window.location.origin);
  }, input);
}
