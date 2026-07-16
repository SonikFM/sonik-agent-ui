import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Rendered E2E lane (Slice G, docs/plans/experience-seams-resolution-plan-2026-07-08.md).
// Drives the real standalone-sveltekit dev server against the dev-only smoke mock stream
// (apps/standalone-sveltekit/src/lib/server/dev-smoke-stream.ts) -- no live model, no
// deployed worker, no signed host-context envelope required (standalone workspace mode
// short-circuits `isWorkspaceHostContextReady()` when `agentUiHostOrigin` is absent from
// the URL -- see apps/standalone-sveltekit/src/routes/+page.svelte `isEmbeddedHostContextExpected`).
//
// Prerequisite: the workspace packages the app imports (chat-surface, json-ui-runtime,
// workspace-core, agent-embed, etc.) must already be built -- run `pnpm build` (or the
// individual `pnpm --filter <pkg> build` steps in the root "build"/"dev" script) once
// before this lane; `pnpm dev` here only runs `vite dev`, it does not rebuild them.
const appDir = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../apps/standalone-sveltekit");
const PORT = Number(process.env.SONIK_AGENT_UI_E2E_PORT ?? 5173);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) {
  throw new Error("SONIK_AGENT_UI_E2E_PORT must be a valid TCP port");
}
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  // The dev server's workspace-session store is in-memory and keyed by a
  // constant "standalone" bootstrap key (see +page.svelte `maybeBootstrapSessions`),
  // so every fresh page load resumes the single most-recently-created session
  // process-wide. Parallel workers/tests would race on that shared session --
  // keep this lane single-worker/serial so each test's "New chat" click gives
  // it a deterministic, isolated session.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    // Wrangler's checked-in deployment config is intentionally cloud-first.
    // Every browser request in this local-only lane must opt into the server's
    // localhost-scoped memory override so unmocked bootstrap reads cannot
    // accidentally resolve the production persistence policy.
    extraHTTPHeaders: {
      "x-sonik-agent-ui-smoke-persistence-mode": "memory",
    },
  },
  webServer: {
    command: "pnpm dev --port " + PORT + " --strictPort",
    cwd: appDir,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Memory persistence: no Postgres/cloud credentials needed for this lane.
      SONIK_AGENT_UI_PERSISTENCE_MODE: "memory",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
