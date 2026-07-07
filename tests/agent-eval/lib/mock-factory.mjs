// Route-level network mocks for running the agent-eval scenarios offline
// against a local `pnpm --filter standalone-sveltekit dev` server.
//
// Adapted from open-design's e2e/lib/playwright/mock-factory.ts
// (`applyStandardMocks` / `page.route` + `route.fulfill`), but scoped to what
// is honestly mockable here:
//
//   - `mockGenerateEndpoint` replaces the model-calling `/api/generate`
//     endpoint with a canned SSE response, so a scripted Playwright run never
//     invokes a live LLM. This is the direct analogue of open-design's
//     `routeAgents`/`fulfillAgentsRoute` (intercept the model-facing route,
//     fulfill deterministically).
//   - `mockAuthSignIn` fulfills `POST /api/auth/sign-in/email` with a
//     deterministic 200, for dev servers where a full Better Auth + Postgres
//     stack isn't running locally.
//
// IMPORTANT LIMITATION: the trusted host-context boundary (see
// `installAgentPageControl` / `createSignedTrustedHostContext` in
// apps/standalone-sveltekit) is signed server-side and re-validated on every
// request; a Playwright route mock cannot forge a header the server will
// accept on follow-up calls. That means session-dependent assertions in
// scenarios/page-control-contract.eval.mjs (e.g. the exact "empty_prompt"
// refusal reason, which requires an active, host-authenticated session) are
// only authoritative when run in **deployed mode** with real
// TEST_EMAIL/TEST_PASSWORD credentials against a live backend. Local/offline
// mock mode is best-effort: it is useful for smoke-checking that the
// page-control surface installs and exposes the right shape without a live
// LLM, but scenarios should treat session-dependent checks as INCONCLUSIVE
// rather than FAIL when running offline. See tests/agent-eval/README.md.

const GENERATE_SSE_BODY = [
  'data: {"type":"start"}',
  '',
  'data: {"type":"text-delta","delta":"Mock response (agent-eval offline mode, no live model)."}',
  '',
  'data: {"type":"finish"}',
  '',
  'data: [DONE]',
  '',
  '',
].join("\n");

/** Intercept POST /api/generate and fulfill a canned SSE stream instead of calling a live model. */
async function mockGenerateEndpoint(page) {
  await page.route("**/api/generate", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream; charset=utf-8",
      body: GENERATE_SSE_BODY,
    });
  });
}

/**
 * Intercept POST /api/auth/sign-in/email and fulfill a deterministic 200.
 * Best-effort only — see file header limitation notice.
 */
async function mockAuthSignIn(page, { email = "agent-eval-mock@example.test" } = {}) {
  await page.route("**/api/auth/sign-in/email", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { email }, redirect: false }),
    });
  });
}

/** Apply both mocks. Call from local/offline scenario runs only — not deployed mode. */
async function applyOfflineDeterministicMocks(page, opts = {}) {
  await mockGenerateEndpoint(page);
  await mockAuthSignIn(page, opts);
}

export { mockGenerateEndpoint, mockAuthSignIn, applyOfflineDeterministicMocks };
