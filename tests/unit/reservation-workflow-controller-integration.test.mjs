import assert from "node:assert/strict";
import { bookingReservationWorkflowManifest } from "../../packages/tool-contracts/dist/marketplace-fixtures.js";
import { applyWorkflowRunEvent } from "../../packages/tool-contracts/dist/workflow-run-state.js";
import { runWorkflowNode, startControllerRun } from "../../packages/tool-contracts/dist/workflow-controller.js";
import { createCommandCatalogTools } from "../../apps/standalone-sveltekit/src/lib/tools/command-catalog.ts";
import { commitBookingReservationCommand } from "../../apps/standalone-sveltekit/src/lib/server/booking-workflows/reservation-commit.ts";

// Phase 3a integration proof (consensus plan .omc/plans/workflow-state-machine-consensus-2026-07-10.md):
// drives the REVISED bookingReservationWorkflowManifest through
// trigger -> availability -> reservation_preview -> reservation_commit via the generic controller,
// using the SAME previewBookingReservationCommand tool and commitBookingReservationCommand function
// the live reservation flow already ships (reused unchanged, not reimplemented). Proves the compound
// commit node fires the two-write commit exactly once, and the same telemetry event names still fire.

const definition = bookingReservationWorkflowManifest.payload.workflow;
assert.ok(definition, "fixture must carry a workflow payload");

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_controller_integration_test";
const SESSION_ID = "session_controller_integration_test";
const CONTEXT_ID = "22222222-2222-4222-8222-222222222222";
const GUEST_ID = "guest_controller_integration_123";
const BOOKING_ID = "55555555-5555-4555-8555-555555555555";

const hostSession = {
  source: "amplify-embedded",
  sessionId: SESSION_ID,
  userId: USER_ID,
  principalId: USER_ID,
  organizationId: ORG_ID,
  authenticated: true,
  scopes: ["booking:read", "booking:write"],
  metadata: { approvedCommandIds: ["booking.create.guest", "booking.create.booking"] },
};

function makeBookingRuntimeFetcher() {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method, body });
    if (String(url).endsWith("/api/v1/booking/guests") && init.method === "POST") {
      return Response.json({ id: GUEST_ID, name: body?.name, email: body?.email }, { status: 201 });
    }
    if (String(url).endsWith("/api/v1/booking/bookings") && init.method === "POST") {
      return Response.json({ id: BOOKING_ID, contextId: body?.contextId, userId: body?.userId, status: "booked" }, { status: 201 });
    }
    return Response.json({ error: "unexpected", url: String(url) }, { status: 500 });
  };
  return { calls, fetcher };
}

const guestInput = { name: "Dan", email: "dan@sonik.com", contactConfirmed: true };
const bookingInput = {
  contextId: CONTEXT_ID,
  startsAt: "2026-07-01T20:00:00.000Z",
  endsAt: "2026-07-01T20:10:00.000Z",
  partySize: 3,
  source: "admin",
  clientRequestId: "controller-integration-test",
};

// Capture telemetry event names without a real DB/log sink: writeAgentTelemetry always
// console.info's a "sonik_agent_ui_telemetry" line first, so intercepting console.info is a safe,
// local way to observe which event names the REUSED commit function emits.
const emittedEvents = [];
const originalConsoleInfo = console.info;
console.info = (...args) => {
  if (args[0] === "sonik_agent_ui_telemetry") {
    try {
      const parsed = JSON.parse(args[1]);
      emittedEvents.push(parsed.payload.event);
    } catch {
      // ignore parse failures, not relevant to this assertion
    }
  }
  return originalConsoleInfo.apply(console, args);
};

try {
  const { fetcher: commitFetcher, calls: commitCalls } = makeBookingRuntimeFetcher();

  const tools = createCommandCatalogTools({ sessionId: "controller-integration-test" });

  let commitInvocations = 0;

  const run0 = startControllerRun(definition, { runId: "run-reservation-controller-1", workflowVersionId: bookingReservationWorkflowManifest.packageVersionId });

  // 1. trigger: entry node, already active from run start -- no callback needed.
  assert.equal(run0.nodeStates.trigger.status, "active");

  // 2. availability: mocked (generic read command, not part of the reuse proof this test targets).
  const afterAvailability = await runWorkflowNode(run0, definition, "availability", {
    availability: () => ({ kind: "preview", ok: true, preview: { commandId: "booking.get.availability", stableInputHash: "avail-hash", effect: "read", approvalRequired: false } }),
  });
  assert.equal(afterAvailability.ok, true, "availability preview must succeed");

  // 3. reservation_preview: the SAME previewBookingReservationCommand tool the live flow uses.
  const afterPreview = await runWorkflowNode(afterAvailability.state, definition, "reservation_preview", {
    reservation_preview: async () => {
      const preview = await tools.previewBookingReservationCommand.execute({ guest: guestInput, booking: bookingInput });
      assert.equal(preview.ok, true, "reservation preview must be valid for this fixture input");
      return {
        kind: "preview",
        ok: true,
        preview: { commandId: preview.command.commandId, stableInputHash: "reservation-hash", effect: "write", approvalRequired: true },
      };
    },
  });
  assert.equal(afterPreview.ok, true, "reservation preview node must succeed");
  assert.equal(afterPreview.state.phase, "preview_ready");

  // 4. Approval is a host-signed action, never model output -- mirrors the real flow's human
  // Approve click (there is no model-callable approve tool; command-catalog.ts's draft-only
  // invariant and the controller's own structural refusal both depend on this).
  const requested = applyWorkflowRunEvent(afterPreview.state, { type: "request_approval", nodeId: "reservation_commit" });
  assert.equal(requested.ok, true);
  const approved = applyWorkflowRunEvent(requested.state, { type: "approve", hostSigned: true });
  assert.equal(approved.ok, true);

  // 5. reservation_commit: the compound node wrapping the SAME commitBookingReservationCommand
  // function used by /api/reservation/commit today -- must fire exactly once for both writes.
  const committed = await runWorkflowNode(approved.state, definition, "reservation_commit", {
    reservation_commit: async () => {
      commitInvocations += 1;
      const result = await commitBookingReservationCommand(
        {
          sessionId: SESSION_ID,
          hostSession,
          approvedCommandIds: ["booking.create.guest", "booking.create.booking"],
          bookingServiceBaseUrl: "https://booking.example.test",
          bookingRuntimeAuth: { mode: "bearer", token: "controller-integration-secret", source: "test" },
          bookingRuntimeFetcher: commitFetcher,
        },
        { guest: guestInput, booking: bookingInput },
      );
      assert.equal(result.ok, true, "the reused commit function must succeed for this fixture input");
      assert.deepEqual(result.steps.map((s) => s.commandId), ["booking.create.guest", "booking.create.booking"], "both writes run under one commit call");
      return { kind: "commit", ok: true, receiptRef: result.guestId ?? undefined };
    },
  });

  assert.equal(committed.ok, true, "compound commit node transition must succeed");
  assert.equal(committed.state.phase, "committed");
  assert.equal(committed.state.nodeStates.reservation_commit.status, "committed");
  assert.equal(commitInvocations, 1, "commitBookingReservationCommand must fire exactly ONCE for the compound node, not twice");

  const guestFetchCalls = commitCalls.filter((c) => c.url.endsWith("/guests"));
  const bookingFetchCalls = commitCalls.filter((c) => c.url.endsWith("/bookings"));
  assert.equal(guestFetchCalls.length, 1, "exactly one guest write for the one approval interaction");
  assert.equal(bookingFetchCalls.length, 1, "exactly one booking write for the one approval interaction");

  // Same telemetry event names the shipped endpoint relies on -- commit.human_approved per write.
  const commitApprovedEvents = emittedEvents.filter((event) => event === "commit.human_approved");
  assert.equal(commitApprovedEvents.length, 2, "commit.human_approved fires once per underlying write, same event name as the shipped path");
} finally {
  console.info = originalConsoleInfo;
}

console.log(JSON.stringify({ ok: true, checked: "reservation-workflow-controller-integration" }));
