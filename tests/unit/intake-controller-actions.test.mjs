import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createInteractiveSurfaceJsonRenderSpec } from "../../packages/json-ui-runtime/src/intake.ts";
import { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE } from "../../apps/standalone-sveltekit/src/lib/server/booking-workflows/context-intake.ts";
import { explorerCatalog } from "../../apps/standalone-sveltekit/src/lib/render/catalog.ts";

const spec = createInteractiveSurfaceJsonRenderSpec(BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE);
const validation = explorerCatalog.validate(spec);
assert.equal(validation.success, true, validation.success ? "" : JSON.stringify(validation.errors, null, 2));

const actionRail = spec.elements["action-rail"];
assert.equal(actionRail?.type, "ActionRail", "booking intake specs must expose a visible trusted action rail");
assert.deepEqual(
  actionRail.props.actions.map((action) => action.id),
  ["saveDraft", "editDraft", "submitToAgent", "reviseWithAgent", "requestApproval", "cancelApproval", "approveAndRun"],
  "trusted intake action rail should expose the v0 controller lifecycle with edit/revise/cancel/approve controls",
);
assert.equal(actionRail.props.actions.find((action) => action.id === "requestApproval")?.commandId, "booking.create.context");
assert.deepEqual(actionRail.props.lastReceipt, { $bindState: "/lastActionReceipt" }, "trusted action rail must render the latest controller receipt from artifact state");
assert.equal(actionRail.props.actions.find((action) => action.id === "approveAndRun")?.approval, "host_required");

const buttonActions = Object.entries(spec.elements)
  .filter(([, element]) => element.type === "Button" && element.on?.press)
  .map(([id, element]) => [id, element.on.press.action]);
assert.deepEqual(buttonActions, [
  ["action-save-draft", "saveDraft"],
  ["action-edit-draft", "editDraft"],
  ["action-submit-to-agent", "submitToAgent"],
  ["action-revise-agent", "reviseWithAgent"],
  ["action-request-approval", "requestApproval"],
  ["action-cancel-approval", "cancelApproval"],
  ["action-approve-run", "approveAndRun"],
]);

const serializedSpec = JSON.stringify(spec);
for (const forbidden of ["tool_call", "agent_action", "commitCommand", "executeCommand", "/api/v1/booking"]) {
  assert.equal(serializedSpec.includes(forbidden), false, `renderer spec must not embed ${forbidden}`);
}

const pageSource = readFileSync("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");
for (const action of ["saveDraft", "editDraft", "submitToAgent", "reviseWithAgent", "requestApproval", "cancelApproval", "approveAndRun"]) {
  assert.ok(pageSource.includes(action), `page trusted controller must handle ${action}`);
}
assert.ok(pageSource.includes("persistActiveArtifactStatePatch"), "controller actions must flush artifact state before sending turns");
// Draft-only invariant (Slice A, 2026-07-08): approveAndRun no longer sends a model
// turn at all. It calls the deterministic /api/intake/commit endpoint directly —
// publishing is a human click, not a model tool call.
assert.ok(pageSource.includes("runIntakeCommitEndpoint"), "approve action must call the deterministic commit endpoint helper");
assert.ok(pageSource.includes("workspaceFetch(\"/api/intake/commit\""), "approve action must POST to the deterministic commit endpoint");
assert.equal(pageSource.includes("commitActiveIntakeCommand with confirmation=APPROVE_AND_RUN"), false, "approve action must no longer instruct the model to call a commit tool");
assert.ok(pageSource.includes("does not send a model turn") || pageSource.includes("no model turn"), "approve action must document that it does not send a model turn");
assert.ok(pageSource.includes("recordJsonRenderActionReceipt"), "renderer actions must write user-facing action receipts into artifact state");
assert.ok(pageSource.includes("requestHostAction"), "JSON-render artifacts must be able to request allowlisted host actions through the action channel");

console.log("intake controller actions tests passed");
