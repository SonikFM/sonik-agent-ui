import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PAGE_CONTROL_ACTION_NAMES,
  createPageControlClient,
  waitForPageControlReady,
} from "../agent-eval/lib/page-control-driver.mjs";

const pageSource = readFileSync("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");
const observabilitySource = readFileSync("packages/agent-observability/src/index.ts", "utf8");
const driverSource = readFileSync("tests/agent-eval/lib/page-control-driver.mjs", "utf8");

for (const method of [
  "getActions",
  "getTargetRegistry",
  "getActiveWorkflowState",
  "getApprovalState",
]) {
  assert.equal(observabilitySource.includes(`${method}: () =>`), true, `page-control type must expose ${method}`);
  assert.equal(pageSource.includes(`${method}: snapshot`), true, `standalone page-control install must wire ${method} to a snapshot function`);
  assert.equal(driverSource.includes(`.${method}`), true, `agent eval driver must wait for and expose ${method}`);
}

assert.equal(pageSource.includes("function createLocalWorkflowSnapshot"), true, "agent-readable workflow snapshots should have a local-only helper");
assert.equal(pageSource.includes("return snapshotPageContext().workflow"), false, "approval/action state must not derive from host-overridable merged page context workflow");
assert.equal(observabilitySource.includes("interface AgentUiTargetRegistrySnapshot"), true, "target registry getter should expose a versioned typed snapshot shape");
assert.equal(observabilitySource.includes('schemaVersion: "sonik.agent_ui.actions.v1"'), true, "actions snapshot should be versioned");
assert.equal(observabilitySource.includes('schemaVersion: "sonik.agent_ui.approval_state.v1"'), true, "approval state snapshot should be versioned");
assert.equal(observabilitySource.includes("getCanvasControls?: () => AgentUiCanvasControlStateMap"), true, "page-control type must expose the optional typed canvas-control snapshot");
assert.equal(pageSource.includes("getCanvasControls: snapshotCanvasControls"), true, "standalone page control must expose the canvas-control snapshot getter");
assert.equal(driverSource.includes(".getCanvasControls"), true, "agent eval driver must expose the optional canvas-control snapshot getter");
assert.equal(pageSource.includes("const canvasControlStates = $derived(deriveCanvasControlStates({"), true, "canvas controls must derive from one presentation-only state source");
assert.equal(pageSource.includes("enabled: canvasControlStates.clear.enabled"), true, "clear action descriptor must reuse the shared control map");
assert.equal(pageSource.includes("const clearControl = canvasControlStates.clear"), true, "clear callable guard must reuse the shared control map");
assert.equal(pageSource.includes("if (!clearControl.enabled)"), true, "clear page-control action must fail closed when the shared state disables it");
assert.equal(pageSource.includes('policyMode: "ask"'), true, "approval descriptors must preserve ask/approval semantics");
assert.equal(pageSource.includes('target_registry_unavailable'), true, "host target actions must report registry availability instead of forcing DOM scraping");
assert.equal(pageSource.includes('hostTargetDisabledReason'), true, "tour target actions must distinguish missing host channel from missing target registry");
assert.equal(pageSource.includes('function snapshotHostTargetRegistry'), true, "tour action readiness must use host-provided target registry, not local fallback registry");
assert.equal(pageSource.includes('function isAgentHostActionChannelAvailable'), true, "host action descriptors must check the parent host-action channel precondition");
assert.equal(pageSource.includes('enabled: hostActionsAvailable && Boolean(targetRegistry)'), true, "tour target actions must not advertise enabled outside an embedded host action channel");
assert.equal(pageSource.includes('enabled: hostActionsAvailable && workflow.canRequestApproval'), true, "approval preview host action must not advertise enabled outside an embedded host action channel");
assert.equal(pageSource.includes('workflow.canRequestApproval'), true, "approval readiness must derive from workflow state");
assert.equal(pageSource.includes('workflow.canSubmitAnswer'), true, "question answer readiness must derive from workflow state");

for (const actionName of PAGE_CONTROL_ACTION_NAMES) {
  assert.equal(
    pageSource.includes(`createActionDescriptor("${actionName}"`) || actionName === "requestHostAction" && pageSource.includes('createActionDescriptor("requestHostAction"'),
    true,
    `agent-readable action registry must describe page-control action ${actionName}`,
  );
}

const actionCallLog = [];
const mockActions = Object.fromEntries(PAGE_CONTROL_ACTION_NAMES.map((name) => [name, async (input = {}) => {
  actionCallLog.push({ name, input });
  return { ok: true, action: name, input };
}]));
const mockControl = {
  schemaVersion: "sonik.agent_ui.page_control.v1",
  getPageContext: () => ({ workflow: { canApproveAndRun: true } }),
  getAssertions: () => ({ schemaVersion: "sonik.agent_ui.assertions.v1" }),
  getActions: () => ({
    schemaVersion: "sonik.agent_ui.actions.v1",
    actions: [
      { name: "requestApproval", label: "Request approval", effect: "write", policyMode: "ask", enabled: true },
      { name: "approveAndRun", label: "Approve and run", effect: "write", policyMode: "require", enabled: false, disabledReason: "trusted_host_approval_required" },
      { name: "highlightTarget", label: "Highlight host target", kind: "host_action", actionKey: "tour.highlight", requiresTarget: true, enabled: false, disabledReason: "target_registry_unavailable" },
      { name: "focusTarget", label: "Focus host target", kind: "host_action", actionKey: "tour.focusTarget", requiresTarget: true, enabled: false, disabledReason: "target_registry_unavailable" },
    ],
  }),
  getTargetRegistry: () => null,
  getActiveWorkflowState: () => ({
    schemaVersion: "sonik.agent_ui.workflow.v1",
    phase: "idle",
    canRequestApproval: false,
    canApproveAndRun: false,
    disabledReasons: ["missing_active_artifact"],
  }),
  getApprovalState: () => ({
    schemaVersion: "sonik.agent_ui.approval_state.v1",
    phase: "idle",
    activeArtifactId: null,
    canRequestApproval: false,
    canApproveAndRun: false,
    disabledReasons: ["missing_active_artifact"],
    commandPreview: null,
  }),
  getCanvasControls: () => ({
    preview: { id: "preview", label: "Preview", enabled: false, active: true, disabledReason: "missing_active_artifact" },
    document: { id: "document", label: "Document", enabled: false, active: false, disabledReason: "missing_active_document" },
    fullscreen: { id: "fullscreen", label: "Fullscreen", enabled: false, active: false, disabledReason: "missing_workspace_content" },
    clear: { id: "clear", label: "Clear", enabled: false, active: false, disabledReason: "missing_active_artifact" },
  }),
  actions: mockActions,
};

function withMockWindow(fn) {
  const previous = globalThis.window;
  globalThis.window = { __sonikAgentUI: mockControl };
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previous;
    }
  }
}

const fakeFrame = {
  waitForFunction: async (predicate, actionNames) => withMockWindow(() => {
    assert.equal(predicate(actionNames), true, "driver readiness should accept the full page-control shape");
  }),
  evaluate: async (fn, arg) => withMockWindow(() => fn(arg)),
};

await waitForPageControlReady(fakeFrame, { timeoutMs: 1 });
const client = createPageControlClient(fakeFrame);
const actionsSnapshot = await client.getActions();
assert.equal(actionsSnapshot.schemaVersion, "sonik.agent_ui.actions.v1");
assert.equal(actionsSnapshot.actions.find((action) => action.name === "requestApproval")?.policyMode, "ask");
assert.equal(actionsSnapshot.actions.find((action) => action.name === "approveAndRun")?.policyMode, "require");
assert.equal(actionsSnapshot.actions.find((action) => action.name === "highlightTarget")?.actionKey, "tour.highlight");
assert.equal(actionsSnapshot.actions.find((action) => action.name === "highlightTarget")?.requiresTarget, true);
assert.equal(actionsSnapshot.actions.find((action) => action.name === "highlightTarget")?.disabledReason, "target_registry_unavailable");
assert.equal(actionsSnapshot.actions.find((action) => action.name === "focusTarget")?.actionKey, "tour.focusTarget");
assert.equal(actionsSnapshot.actions.find((action) => action.name === "focusTarget")?.requiresTarget, true);
assert.equal(await client.getTargetRegistry(), null);
const approvalStateSnapshot = await client.getApprovalState();
assert.equal(approvalStateSnapshot.canApproveAndRun, false, "approval state should not inherit host page-context workflow approval");
assert.equal(approvalStateSnapshot.disabledReasons.every((reason) => typeof reason === "string" && reason.trim().length > 0), true, "disabled approval snapshots must expose semantic non-empty machine-readable reasons");
const disabledApprovalDescriptor = actionsSnapshot.actions.find((action) => action.name === "approveAndRun");
assert.equal(typeof disabledApprovalDescriptor?.disabledReason === "string" && disabledApprovalDescriptor.disabledReason.trim().length > 0, true, "disabled approval action descriptors must preserve a non-empty reason for page-control parity");
assert.equal((await client.getActiveWorkflowState()).canRequestApproval, false);
const canvasControls = await client.getCanvasControls();
assert.equal(canvasControls.fullscreen.disabledReason, "missing_workspace_content");
assert.equal(canvasControls.clear.active, false, "Clear must never expose a pressed state");
const actionResult = await client.callAction("requestApproval", { dryRun: true });
assert.deepEqual(actionResult, { ok: true, action: "requestApproval", input: { dryRun: true } });
assert.deepEqual(actionCallLog.at(-1), { name: "requestApproval", input: { dryRun: true } });

console.log("agent page-control readability tests passed");
