import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHostActionRequest } from "../../packages/tool-contracts/src/target-registry.ts";
import { createUnavailableAgentHostActionResult } from "../../packages/agent-embed/src/index.ts";

// E4 (Epic 4 - Real dev-loop actions) red acceptance suite.
// Pinned wished-for API (.omc/plans/2026-07-21-dev-workbench-agent-tdd-plan.md, E4):
//   apps/dev-workbench/src/lib/server/preview-controller.ts exporting createPreviewController({spawn, now?})
//   apps/dev-workbench/src/lib/server/test-runner.ts exporting runWorkspaceTests({filter, exec})
//   apps/standalone-sveltekit/src/lib/host-actions/demo-host-actions.ts exporting createDemoHostActionHandler({documentLike})
// None of these exist yet. Every dynamic import below must fail with a clear
// "not implemented" message (via assert.fail) rather than crash with an
// unhandled import error, so a reviewer can see intent even before green.

const PREVIEW_CONTROLLER_PATH = "../../apps/dev-workbench/src/lib/server/preview-controller.ts";
const TEST_RUNNER_PATH = "../../apps/dev-workbench/src/lib/server/test-runner.ts";
const DEMO_HOST_ACTIONS_PATH = "../../apps/standalone-sveltekit/src/lib/host-actions/demo-host-actions.ts";
const PAGE_SVELTE_PATH = new URL("../../apps/dev-workbench/src/routes/+page.svelte", import.meta.url);

async function importOrFail(specifier, what) {
  try {
    return await import(specifier);
  } catch (error) {
    assert.fail(`not implemented: ${what} (import of ${specifier} failed: ${error.message})`);
  }
}

async function loadPreviewController() {
  const mod = await importOrFail(PREVIEW_CONTROLLER_PATH, "apps/dev-workbench/src/lib/server/preview-controller.ts exporting createPreviewController");
  if (typeof mod.createPreviewController !== "function") {
    assert.fail("not implemented: createPreviewController export from apps/dev-workbench/src/lib/server/preview-controller.ts");
  }
  return mod;
}

async function loadTestRunner() {
  const mod = await importOrFail(TEST_RUNNER_PATH, "apps/dev-workbench/src/lib/server/test-runner.ts exporting runWorkspaceTests");
  if (typeof mod.runWorkspaceTests !== "function") {
    assert.fail("not implemented: runWorkspaceTests export from apps/dev-workbench/src/lib/server/test-runner.ts");
  }
  return mod;
}

async function loadDemoHostActions() {
  const mod = await importOrFail(DEMO_HOST_ACTIONS_PATH, "apps/standalone-sveltekit/src/lib/host-actions/demo-host-actions.ts exporting createDemoHostActionHandler");
  if (typeof mod.createDemoHostActionHandler !== "function") {
    assert.fail("not implemented: createDemoHostActionHandler export from apps/standalone-sveltekit/src/lib/host-actions/demo-host-actions.ts");
  }
  return mod;
}

function createFakeSpawn() {
  let pidCounter = 4200;
  return () => ({ pid: pidCounter++, kill() {} });
}

function createFakeClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return tick;
  };
}

test("E4.1a: preview-controller restart() returns an executed receipt whose pid/startedAt change across sequential restarts", async () => {
  const { createPreviewController } = await loadPreviewController();
  const controller = createPreviewController({ spawn: createFakeSpawn(), now: createFakeClock() });

  const first = await controller.restart();
  assert.equal(first.ok, true, "restart() must report ok:true once the preview process actually restarts");
  assert.equal(first.status, "executed");
  assert.equal(typeof first.pid, "number");
  assert.equal(typeof first.startedAt, "number");

  const second = await controller.restart();
  assert.notEqual(second.pid, first.pid, "a second restart must spawn a distinct process, not reuse the same pid");
  assert.notEqual(second.startedAt, first.startedAt, "two sequential restarts must yield distinct startedAt timestamps");
});

test("E4.1b: +page.svelte's restartPreview handler must no longer be the hardcoded unavailable stub", async () => {
  const source = await readFile(PAGE_SVELTE_PATH, "utf8");
  const match = source.match(/function restartPreview\(\)[^{]*\{([\s\S]*?)\n  \}/);
  assert.ok(match, "expected to find a restartPreview() function in +page.svelte");
  const body = match[1].trim();
  assert.notEqual(
    body,
    'return unavailable("restartPreview");',
    "not implemented: restartPreview() is still the permanent hardcoded stub; it must delegate to the real preview-controller (e.g. a restartPreviewRequest() helper mirroring the existing startWorkspaceRequest/reconnectWorkspaceRequest pattern in this same file)",
  );
});

test("E4.2a: runWorkspaceTests executes a real test run and reports pass/fail/duration from the sandbox exec summary", async () => {
  const { runWorkspaceTests } = await loadTestRunner();
  const fakeExec = async () => ({
    exitCode: 0,
    stdout: "# tests 15\n# pass 12\n# fail 0\n# cancelled 0\n# skipped 3\n# duration_ms 452.7\n",
  });

  const receipt = await runWorkspaceTests({ filter: "dev-loop-actions", exec: fakeExec });
  assert.equal(receipt.ok, true, "an all-passing run must report ok:true");
  assert.equal(receipt.passed, 12);
  assert.equal(receipt.failed, 0);
  assert.equal(receipt.durationMs, 452.7);
});

test("E4.2b: a failing exec yields ok:false with failed>0, never a thrown exception", async () => {
  const { runWorkspaceTests } = await loadTestRunner();
  const failingExec = async () => ({
    exitCode: 1,
    stdout: "# tests 15\n# pass 9\n# fail 6\n# cancelled 0\n# skipped 0\n# duration_ms 610.2\n",
  });

  await assert.doesNotReject(
    () => runWorkspaceTests({ filter: "dev-loop-actions", exec: failingExec }),
    "runWorkspaceTests must never throw for a failing test run; it must return a receipt describing the failure",
  );
  const receipt = await runWorkspaceTests({ filter: "dev-loop-actions", exec: failingExec });
  assert.equal(receipt.ok, false, "a run with failures must report ok:false");
  assert.ok(receipt.failed > 0, "failed count must be greater than zero");

  const throwingExec = async () => {
    throw new Error("sandbox exec crashed");
  };
  await assert.doesNotReject(
    () => runWorkspaceTests({ filter: "dev-loop-actions", exec: throwingExec }),
    "runWorkspaceTests must catch a rejecting exec and still return a receipt, never propagate the exception",
  );
  const crashReceipt = await runWorkspaceTests({ filter: "dev-loop-actions", exec: throwingExec });
  assert.equal(crashReceipt.ok, false, "an exec crash must be reported as ok:false, not thrown");
});

test("E4.3a: reference demo host action handler mutates the resolved DOM element for tour.highlight and returns an executed receipt", async () => {
  const { createDemoHostActionHandler } = await loadDemoHostActions();

  const highlighted = { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const documentLike = {
    querySelector(selector) {
      const match = selector.match(/\[data-sonik-target="([^"]+)"\]/);
      return match && match[1] === "demo.tour.target" ? highlighted : null;
    },
  };

  const handler = createDemoHostActionHandler({ documentLike });
  const request = createHostActionRequest({
    requestId: "req-highlight-1",
    actionKey: "tour.highlight",
    targetId: "demo.tour.target",
  });

  const result = await handler(request);
  assert.equal(result.ok, true, "tour.highlight against a resolvable target must execute");
  assert.equal(result.status, "executed");
  assert.equal(result.requestId, "req-highlight-1");
  assert.equal(result.actionKey, "tour.highlight");
  assert.equal(
    highlighted.attributes["data-sonik-highlighted"],
    "true",
    "the resolved element must be mutated with a highlight marker attribute",
  );
});

test("E4.3b: demo host action handler fails closed on an action key it does not implement, reusing the real unavailable helper", async () => {
  const { createDemoHostActionHandler } = await loadDemoHostActions();

  const documentLike = { querySelector: () => null };
  const handler = createDemoHostActionHandler({ documentLike });
  const request = createHostActionRequest({
    requestId: "req-unknown-1",
    actionKey: "canvas.open",
  });

  const result = await handler(request);
  const expected = createUnavailableAgentHostActionResult({
    requestId: "req-unknown-1",
    actionKey: "canvas.open",
    disabledReason: "host_action_handler_not_registered",
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, expected.status);
  assert.equal(result.disabledReason, expected.disabledReason, "unknown action keys must reuse the existing fail-closed disabledReason, not a bespoke one");
});
