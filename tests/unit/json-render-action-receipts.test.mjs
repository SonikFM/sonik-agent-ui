import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createInteractiveSurfaceJsonRenderSpec } from "../../packages/json-ui-runtime/src/intake.ts";
import { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE } from "../../apps/standalone-sveltekit/src/lib/server/booking-workflows/context-intake.ts";
import { explorerCatalog } from "../../apps/standalone-sveltekit/src/lib/render/catalog.ts";

const spec = createInteractiveSurfaceJsonRenderSpec(BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE);
const actionRail = spec.elements["action-rail"];
assert.equal(actionRail?.type, "ActionRail", "booking intake artifacts should include an action rail");
assert.deepEqual(actionRail.props.lastReceipt, { $bindState: "/lastActionReceipt" }, "ActionRail should bind to the latest action receipt in artifact state");

const validation = explorerCatalog.validate({
  root: "root",
  elements: {
    root: {
      type: "ActionRail",
      props: {
        title: "Trusted workflow actions",
        actions: [],
        emptyMessage: null,
        lastReceipt: {
          actionName: "requestHostAction",
          ok: false,
          status: "host_approval_required",
          message: "Host approval is required before this action can run.",
          commandId: "booking.create.context",
          hostAction: {
            actionKey: "approval.requestPreview",
            status: "approval_required",
            policyMode: "ask",
            targetId: "booking.command.approval-preview",
          },
        },
      },
      children: [],
    },
  },
  state: {},
});
assert.equal(validation.success, true, validation.success ? "" : JSON.stringify(validation.errors, null, 2));

const actionRailSource = readFileSync("apps/standalone-sveltekit/src/lib/render/components/ActionRail.svelte", "utf8");
assert.match(actionRailSource, /data-action-receipt/, "ActionRail must expose a testable action receipt affordance");
assert.match(actionRailSource, /Needs attention/, "failed or approval-required receipts should be user-visible, not silent telemetry only");

const pageSource = readFileSync("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");
assert.match(pageSource, /async function handleJsonRenderHostAction/, "page controller must route JSON-render host-action requests through the host action channel");
assert.match(pageSource, /recordJsonRenderActionReceipt\(createJsonRenderActionReceipt/, "page controller must record receipts for renderer actions");
assert.match(pageSource, /json_render\.host_action\.receipt/, "host-action receipts must emit telemetry");

console.log("json-render action receipt tests passed");
