import { expect, test } from "@playwright/test";

const root = "/vercel/sandbox/workspace";
const repositoryRoot = `${root}/repo`;
const stateRoot = `${root}/.sonik`;
const now = "2026-07-20T12:00:00.000Z";

const workspace = {
  schemaVersion: "sonik.dev-workbench.v1",
  sessionId: "workbench-session-1",
  organizationId: "sonikfm",
  sandboxName: "sonik-dev-workbench-session-1",
  sandboxSessionId: "sandbox-session-1",
  status: "ready",
  repository: {
    schemaVersion: "sonik.dev-workbench.v1",
    repositoryId: "sonikfm.sonik-agent-ui",
    cloneUrl: "https://github.com/sonikfm/sonik-agent-ui.git",
    revision: "abc123def456",
    branch: "main",
    deployment: null,
    commands: {
      install: ["pnpm", "install"],
      dev: ["pnpm", "dev"],
      test: ["pnpm", "test"],
      build: ["pnpm", "build"],
      codex: ["codex"],
    },
  },
  repositoryRoot,
  tmuxSession: "sonik-dev",
  tmuxWindows: ["codex", "dev", "shell", "logs"].map((name, index) => ({
    name,
    index,
    command: ["bash"],
    workingDirectory: repositoryRoot,
  })),
  mirrorPaths: {
    pageContext: `${stateRoot}/page-context.json`,
    hostContext: `${stateRoot}/host-context.json`,
    openApi: `${stateRoot}/openapi.json`,
    guide: `${stateRoot}/README.md`,
    consoleEvents: `${stateRoot}/console.jsonl`,
    networkEvents: `${stateRoot}/network.jsonl`,
    latestScreenshot: `${stateRoot}/screenshots/latest.png`,
    sitemap: `${stateRoot}/sitemap.json`,
    workspace: `${stateRoot}/workspace.json`,
  },
  preview: {
    kind: "preview",
    url: "https://preview.example.test",
    port: 3_000,
    expiresAt: "2026-07-21T12:00:00.000Z",
    sandboxSessionId: "sandbox-session-1",
  },
  terminal: null,
  createdAt: now,
  updatedAt: now,
  error: null,
};

const visualSnapshot = {
  schemaVersion: "sonik.visual-context.v1",
  status: "current",
  generation: "generation-1",
  requestId: "request-1",
  requestSequence: 1,
  sourceContextRevision: 4,
  routeRevision: 7,
  source: { id: "preview", label: "Preview", surface: "workbench-preview", route: "/" },
  selection: null,
  ariaSnapshot: null,
  selectionResolution: "not-requested",
  screenshot: null,
  invalidatedAt: null,
  staleReason: null,
};

test("terminal embed keeps controls and reconnects restored state after remount", async ({ page }) => {
  let workspaceGets = 0;
  let workspacePosts = 0;
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.route("**/api/workspaces", async (route) => {
    if (route.request().method() === "GET") workspaceGets += 1;
    else workspacePosts += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workspace }) });
  });
  await page.route("**/api/workspaces/visual-context", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ snapshot: visualSnapshot }),
  }));
  await page.route("**/api/workspaces/visual-browser", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ browser: { capability: "installed", setup: "idle", disabledReason: null } }),
  }));
  await page.route("https://preview.example.test/**", (route) => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: `<script>
      setTimeout(() => parent.postMessage({
        source: "sonik-agent-ui",
        type: "sonik:agent-ui:request-page-context",
        reason: "mount",
      }, new URLSearchParams(location.search).get("agentUiHostOrigin")), 10_000);
    </script>`,
  }));

  await page.goto("/?surface=terminal");
  const shell = page.locator("main.dev-workbench");
  await expect(shell).toHaveAttribute("data-terminal-only", "true");
  await expect(page.locator(".dev-workbench__toolbar")).toBeVisible();
  await expect(page.getByLabel("Visual context source")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pick" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Capture" })).toBeVisible();
  await expect(page.locator(".dev-workbench__visual-status")).toHaveText("Preview visual context restored.");

  const positions = page.getByRole("group", { name: "Terminal position" });
  await expect(positions).toBeVisible();
  await positions.getByRole("button", { name: "Bottom" }).click();
  await expect(shell).toHaveAttribute("data-terminal-dock", "bottom");
  await expect(page.getByText("Starting the preview interface")).toBeVisible();
  await expect(page.locator('section[aria-labelledby="preview-heading"] .dev-workbench__status')).toHaveText("ready", { timeout: 15_000 });
  await expect(page.getByText("Starting the preview interface")).toBeHidden();

  await expect(shell).toHaveAttribute("data-terminal-dock", "bottom");
  await expect(page.getByTitle("Live development preview")).toBeVisible();

  await page.reload();
  await expect(shell).toHaveAttribute("data-terminal-dock", "bottom");
  await expect(page.locator(".dev-workbench__visual-status")).toHaveText("Preview visual context restored.");
  expect(workspaceGets).toBe(2);
  expect(workspacePosts).toBe(0);
  expect(pageErrors).toEqual([]);
});
