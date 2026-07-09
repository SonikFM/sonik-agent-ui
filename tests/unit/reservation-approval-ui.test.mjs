import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCommandCatalogTools } from "../../apps/standalone-sveltekit/src/lib/tools/command-catalog.ts";

const tools = createCommandCatalogTools({ sessionId: "reservation-approval-ui-test" });
assert.equal(typeof tools.previewBookingReservationCommand?.execute, "function", "reservation preview tool must be mounted");

const preview = await tools.previewBookingReservationCommand.execute({
  guest: { name: "Dan", email: "dan@example.test" },
  booking: {
    contextId: "ctx_123",
    startsAt: "2026-07-01T20:00:00.000Z",
    endsAt: "2026-07-01T20:10:00.000Z",
    partySize: 3,
    source: "admin",
    clientRequestId: "reservation-approval-ui-test",
    userId: "model_should_not_control_this",
  },
});
assert.equal(preview.ok, true);
assert.equal(preview.kind, "reservation-command-preview");
assert.equal(preview.command.endpoint, "/api/reservation/commit");
assert.equal(preview.command.input.guest.email, "dan@example.test");
assert.equal(preview.command.input.booking.contextId, "ctx_123");
assert.equal("userId" in preview.command.input.booking, false, "preview payload must not let the model supply booking.userId");
assert.match(preview.nextAction, /human Approve click/);

const blockedPreview = await tools.previewBookingReservationCommand.execute({ guest: { name: "" }, booking: { contextId: "ctx_123" } });
assert.equal(blockedPreview.ok, false);
assert.ok(blockedPreview.missingFields.includes("guest.name"));
assert.ok(blockedPreview.missingFields.includes("guest.email or guest.phone"));
assert.ok(blockedPreview.missingFields.includes("booking.startsAt"));

const pageSource = await readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");
assert.match(pageSource, /findLatestReservationApprovalPreview/);
assert.match(pageSource, /workspaceFetch\("\/api\/reservation\/commit"/);
assert.match(pageSource, /appendReservationCommitReceiptMessage/);
assert.match(pageSource, /approvalAffordance=\{createReservationApprovalAffordance\(\) \?\? createActiveIntakeApprovalAffordance\(\)\}/);
assert.match(pageSource, /Approve and book/);
assert.doesNotMatch(pageSource, /booking\.create\.guest[\s\S]{0,120}onApprove/, "approve click must use the endpoint, not a model-callable write command");

const conversationSource = await readFile("packages/chat-surface/src/components/AgentConversation.svelte", "utf8");
assert.match(conversationSource, /previewLabel\?: string/);
assert.match(conversationSource, /approvalAffordance\.approveLabel \?\? "Approve and create"/);

const toolBlockSource = await readFile("packages/chat-surface/src/components/ToolCallBlock.svelte", "utf8");
assert.match(toolBlockSource, /output\.kind === "reservation-commit"/);
assert.match(toolBlockSource, /Reservation created\./);

console.log(JSON.stringify({ ok: true, checked: "reservation-approval-ui" }));
