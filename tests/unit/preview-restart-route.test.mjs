import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";

// E4.4 (preview-restart wiring) red acceptance suite.
// Two gaps close this lane:
//   1. POST /api/workspaces/preview does not exist (404 today).
//   2. +page.svelte:206 hardcodes restartPreview to permanently disabled.
// The route is tested by stubbing $lib/server/workspace-service the same
// way tests/unit/telemetry-route.test.mjs stubs $lib/server/workspace-request-store:
// the route's collaborator is swapped for a controllable fake, so this suite
// proves route wiring/response-shape without reimplementing Vercel Sandbox mocking
// (already covered for createDevWindowRefreshPlan by tests/unit/dev-workbench-server.test.mjs).

const stub = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });

let restartImpl = async () => {
  throw new Error("restartImpl not configured for this test");
};
globalThis.__previewRestartImpl = (...args) => restartImpl(...args);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "$lib/server/workspace-service") {
      return stub(`export const restartWorkspacePreview = (...args) => globalThis.__previewRestartImpl(...args);`);
    }
    if (specifier === "$env/dynamic/private") {
      return stub(`export const env = {
        DEV_WORKBENCH_ENABLED: "true",
        DEV_WORKBENCH_REPOSITORY_URL: "https://github.com/sonikfm/sonik-agent-ui.git",
        DEV_WORKBENCH_REPOSITORY_REVISION: "main",
        DEV_WORKBENCH_ORGANIZATION_ID: "sonikfm",
      };`);
    }
    if (specifier.startsWith("$lib/")) {
      return { url: new URL(`../../apps/dev-workbench/src/lib/${specifier.slice(5)}.ts`, import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { POST } = await import("../../apps/dev-workbench/src/routes/api/workspaces/preview/+server.ts");

function requestEvent({ cookie } = {}) {
  return {
    cookies: { get: (name) => (name === "sonik-dev-workbench-session" ? cookie : undefined) },
    request: new Request("https://workbench.local/api/workspaces/preview", { method: "POST" }),
  };
}

test("no attached workspace session returns a non-500 structured unavailable receipt", async () => {
  const response = await POST(requestEvent());
  assert.notEqual(response.status, 500);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, "unavailable");
  assert.ok(typeof body.reason === "string" && body.reason.length > 0);
});

test("the route invokes the workspace dev-window refresh seam and returns an executed receipt", async () => {
  let calledWith = null;
  restartImpl = async (sessionId) => {
    calledWith = sessionId;
    return { ok: true, value: { restartedAt: "2026-07-21T00:00:00.000Z" } };
  };
  const response = await POST(requestEvent({ cookie: "workspace-1" }));
  assert.equal(calledWith, "workspace-1", "the route must invoke the injected dev-window refresh seam with the session id");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, status: "executed", restartedAt: "2026-07-21T00:00:00.000Z" });
});

test("a failed refresh returns a non-500 structured unavailable receipt, not a thrown/crashed response", async () => {
  restartImpl = async () => ({
    ok: false,
    error: { code: "sandbox_bootstrap_failed", operation: "restart-preview", retryable: false, message: "The repository could not be prepared in the development sandbox." },
  });
  const response = await POST(requestEvent({ cookie: "workspace-1" }));
  assert.notEqual(response.status, 500);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.status, "unavailable");
  assert.ok(typeof body.reason === "string" && body.reason.length > 0);
});

test("+page.svelte's restartPreview action descriptor is no longer the permanent hardcoded-disabled stub", async () => {
  const source = await readFile(new URL("../../apps/dev-workbench/src/routes/+page.svelte", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /restartPreview: \{ enabled: false, disabledReason: "Preview restart wiring is not connected yet\." \}/,
    "restartPreview must no longer be permanently hardcoded disabled",
  );
  assert.match(
    source,
    /restartPreview:[\s\S]{0,200}workspace\.preview/,
    "restartPreview's enabled state must be derived from real workspace/preview state, like its sibling actions (e.g. openPreview)",
  );
});

console.log("preview-restart-route tests: ok");
