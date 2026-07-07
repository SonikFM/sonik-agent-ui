import assert from "node:assert/strict";
import {
  GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  GENERATED_BOOKING_GET_HOLD_COMMAND_ID,
  GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID,
  GENERATED_BOOKING_RUNTIME_PROVIDER,
} from "../../apps/standalone-sveltekit/src/lib/server/host-command-runtime.ts";
import { createCommandCatalogTools } from "../../apps/standalone-sveltekit/src/lib/tools/command-catalog.ts";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_demo_command_tool";
const SESSION_ID = "session_command_tool_demo";
const CONTEXT_ID = "22222222-2222-4222-8222-222222222222";
const HOLD_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_UNIT_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = "command-tool-secret-token";

const hostSession = {
  source: "amplify-embedded",
  sessionId: SESSION_ID,
  userId: USER_ID,
  principalId: USER_ID,
  organizationId: ORG_ID,
  authenticated: true,
  scopes: ["booking:read", "booking:write"],
  metadata: { approvedCommandIds: [GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID, GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID] },
};

const pageContext = {
  route: "/booking/bookings/booking_123",
  surface: "booking-admin",
  pageType: "event-booking-detail",
  activeEntity: { type: "booking-context", id: CONTEXT_ID, label: "Summer Jazz Night" },
  commandFamilies: ["booking", "booking-holds"],
  visibleActions: ["view-availability", "create-hold", "release-hold"],
};

const calls = [];
const fetcher = async (url, init = {}) => {
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method: init.method, headers: init.headers ?? {}, body });
  if (String(url).includes("/availability")) {
    return Response.json([{ startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z", capacityRemaining: 4 }]);
  }
  if (String(url).endsWith(`/api/v1/booking/contexts/${CONTEXT_ID}`) && init.method === "GET") {
    return Response.json({ id: CONTEXT_ID, organizationId: ORG_ID, label: "Summer Jazz Night", status: "active" });
  }
  if (String(url).endsWith("/api/v1/booking/holds") && init.method === "POST") {
    if (body.clientRequestId === "force-runtime-500") {
      return Response.json({ error: "forced-runtime-failure" }, { status: 500 });
    }
    return Response.json({
      id: HOLD_ID,
      organizationId: ORG_ID,
      contextId: body.contextId,
      userId: body.userId,
      window: body.window,
      partySize: body.partySize,
      status: "active",
      source: body.source,
      expiresAt: "2026-07-01T18:10:00.000Z",
      clientRequestId: body.clientRequestId,
      resourceUnitId: body.resourceUnitId,
      metadata: body.metadata,
      tokenEcho: TOKEN,
    }, { status: 201 });
  }
  if (String(url).endsWith(`/api/v1/booking/holds/${HOLD_ID}`) && init.method === "GET") {
    return Response.json({ id: HOLD_ID, organizationId: ORG_ID, contextId: CONTEXT_ID, status: "active", resourceUnitId: RESOURCE_UNIT_ID });
  }
  if (String(url).endsWith(`/api/v1/booking/holds/${HOLD_ID}/release`) && init.method === "POST") {
    return Response.json({ id: HOLD_ID, organizationId: ORG_ID, contextId: CONTEXT_ID, status: "released", resourceUnitId: RESOURCE_UNIT_ID });
  }
  return Response.json({ error: "unexpected", url: String(url) }, { status: 500 });
};

const tools = createCommandCatalogTools({
  sessionId: SESSION_ID,
  hostSession,
  pageContext,
  approvedCommandIds: [GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID, GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID],
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "bearer", token: TOKEN, source: "test" },
  bookingRuntimeFetcher: fetcher,
});

const search = await tools.searchCommandCatalog.execute({ query: "booking", limit: 20 });
assert.ok(search.contextLoadedCommandIds.length >= 20, "trusted host search exposes a bounded page-context command summary set");
assert.ok(search.totalMatches >= 53, "trusted host search can discover the generated source-mounted booking command catalog");
assert.equal(search.truncated, true, "generated booking catalog remains bounded instead of flooding context");

const learnedCreate = await tools.learnCommand.execute({ commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID, aspects: ["policy", "transport", "auth", "schema", "examples"] });
assert.equal(learnedCreate.ok, true, "agent-facing learnCommand resolves the create-hold descriptor");
assert.equal(learnedCreate.contextLoaded, true, "learnCommand marks create hold as page-context loaded");
assert.equal(learnedCreate.transport.runtimeStatus, "mounted", "learnCommand sees trusted runtime-mounted descriptor, not the global shadow descriptor");
assert.equal(learnedCreate.effect, "write");
assert.equal(learnedCreate.approval, "required");
assert.equal(learnedCreate.inputSchema.type, "object", "agent-facing learnCommand returns concrete JSON Schema");
assert.equal(learnedCreate.inputSchema.properties.contextId.format, "uuid");
assert.equal(learnedCreate.examples.length > 0, true, "agent-facing learnCommand returns generated examples");
assert.equal(learnedCreate.inputConvention.includes("directly"), true, "agent-facing learnCommand returns input-shape guidance");
assert.equal(learnedCreate.forbiddenFields.includes("organizationId"), true, "agent-facing learnCommand teaches host-derived org scope");

const deniedExecuteMutation = await tools.executeCommand.execute({
  commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  input: { contextId: CONTEXT_ID, window: { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" }, resourceUnitId: RESOURCE_UNIT_ID },
});
assert.equal(deniedExecuteMutation.receipt.ok, false, "agent-facing executeCommand cannot run mutation commands");
assert.equal(deniedExecuteMutation.receipt.policy.reasons.includes("runtime_not_mounted_for_execute"), true);
assert.equal(calls.length, 0, "denied executeCommand mutation does not call booking runtime");

const emptyAvailability = await tools.executeCommand.execute({
  commandId: GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  input: {},
});
assert.equal(emptyAvailability.receipt.ok, false, "preflight repairs contextId but still rejects missing availability time fields before host runtime fetch");
assert.equal(emptyAvailability.receipt.summary.kind, "command_input_preflight_failed");
assert.deepEqual(emptyAvailability.receipt.summary.missingRequiredFields, ["from", "to"]);
assert.deepEqual(emptyAvailability.receipt.nextActions, ["learnCommand"]);
assert.equal(calls.length, 0, "preflight failure does not call booking runtime");

const dateAvailability = await tools.executeCommand.execute({
  commandId: GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  input: { date: "2026-07-01", partySize: 2 },
});
assert.equal(dateAvailability.receipt.ok, true, "preflight repair maps availability date to from/to and binds page contextId");
assert.equal(calls.at(-1).method, "GET");
assert.equal(new URL(calls.at(-1).url).pathname, `/api/v1/booking/contexts/${CONTEXT_ID}/availability`);
assert.equal(new URL(calls.at(-1).url).searchParams.get("from"), "2026-07-01T18:00:00.000Z");
assert.equal(new URL(calls.at(-1).url).searchParams.get("to"), "2026-07-01T19:00:00.000Z");

const contextRead = await tools.executeCommand.execute({
  commandId: "booking.get.context",
  input: {},
});
assert.equal(contextRead.receipt.ok, true, "preflight repair binds page contextId for booking.get.context");
assert.equal(calls.at(-1).method, "GET");
assert.equal(calls.at(-1).url, `https://booking.example.test/api/v1/booking/contexts/${CONTEXT_ID}`);

const learnedCreateBooking = await tools.learnCommand.execute({ commandId: "booking.create.booking", aspects: ["schema", "examples", "policy"] });
assert.equal(learnedCreateBooking.ok, true, "learnCommand resolves the durable booking creation descriptor");
assert.equal(learnedCreateBooking.examples[0].input.userId, "GUEST_USER_ID_FROM_booking.create.guest", "agent-facing booking creation example uses the guest/user id returned by booking.create.guest");
assert.notEqual(learnedCreateBooking.examples[0].input.userId, USER_ID, "agent-facing booking creation example does not reuse the trusted host principal");
assert.notEqual(learnedCreateBooking.examples[0].input.userId, "CURRENT_HOST_PRINCIPAL_ID", "agent-facing booking creation example does not teach the host principal sentinel for guest identity");

const learnedAvailability = await tools.learnCommand.execute({ commandId: GENERATED_BOOKING_AVAILABILITY_COMMAND_ID, aspects: ["schema", "examples"] });
assert.equal(learnedAvailability.ok, true, "learnCommand recovers the exact availability schema after preflight failure");
assert.deepEqual(learnedAvailability.inputSchema.required, ["contextId", "from", "to"]);
assert.deepEqual(learnedAvailability.examples[0].input, {
  contextId: "11111111-1111-4111-8111-111111111111",
  from: "2026-07-01T18:00:00.000Z",
  to: "2026-07-01T19:00:00.000Z",
  partySize: 2,
  source: "admin",
  resourceUnitId: "44444444-4444-4444-8444-444444444444",
});

const availability = await tools.executeCommand.execute({
  commandId: GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  input: { contextId: CONTEXT_ID, from: "2026-07-01T18:00:00.000Z", to: "2026-07-01T19:00:00.000Z", partySize: 2, source: "admin", resourceUnitId: RESOURCE_UNIT_ID },
});
assert.equal(availability.receipt.ok, true, "agent-facing executeCommand can read availability through the trusted runtime");
assert.equal(availability.receipt.trace.provider, GENERATED_BOOKING_RUNTIME_PROVIDER);
assert.equal(calls.at(-1).method, "GET");

const create = await tools.commitCommand.execute({
  commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  input: {
    contextId: CONTEXT_ID,
    userId: USER_ID,
    window: { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" },
    partySize: 2,
    source: "admin",
    clientRequestId: "agent-ui-v02-demo-hold-command-tool-001",
    resourceUnitId: RESOURCE_UNIT_ID,
    metadata: { purpose: "agent-facing-command-tool-test", apiToken: TOKEN },
  },
});
assert.equal(create.receipt.ok, true, "agent-facing commitCommand can create an approved hold through the trusted runtime");

const failedRuntimeCreate = await tools.commitCommand.execute({
  commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  inputJson: JSON.stringify({
    contextId: CONTEXT_ID,
    userId: USER_ID,
    window: { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" },
    partySize: 2,
    source: "admin",
    clientRequestId: "force-runtime-500",
    resourceUnitId: RESOURCE_UNIT_ID,
  }),
});
assert.equal(failedRuntimeCreate.receipt.ok, false, "commitCommand reports runtime HTTP failures as failed receipts");
assert.equal(failedRuntimeCreate.receipt.summary.ok, false, "failed runtime summary preserves HTTP ok=false");
assert.equal(failedRuntimeCreate.receipt.errors[0].code, "HOST_RUNTIME_RESPONSE_NOT_OK", "failed runtime receipt has an explicit runtime-response error code");

assert.equal(create.receipt.summary.receipt.confirmation.id, HOLD_ID);
assert.equal(create.receipt.summary.receipt.confirmation.status, "active");
assert.equal(JSON.stringify(create).includes(TOKEN), false, "agent-facing command receipt redacts booking runtime secrets");
const createCall = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/v1/booking/holds"));
assert.ok(createCall, "commitCommand calls POST /holds");
assert.equal(createCall.headers.authorization, `Bearer ${TOKEN}`);
assert.equal(createCall.headers["x-sonik-agent-org-id"], ORG_ID);
assert.equal(createCall.headers["x-sonik-agent-session-id"], SESSION_ID);
assert.equal(createCall.headers["x-sonik-agent-principal-id"], USER_ID);
assert.equal(createCall.body.userId, USER_ID, "commitCommand binds create hold userId to the trusted host principal");
assert.equal(createCall.body.metadata.apiToken, "[redacted]", "secret-like metadata is redacted before outbound booking API call");

const getHold = await tools.executeCommand.execute({ commandId: GENERATED_BOOKING_GET_HOLD_COMMAND_ID, input: { holdId: HOLD_ID } });
assert.equal(getHold.receipt.ok, true, "agent-facing executeCommand can confirm created hold");
assert.equal(getHold.receipt.summary.body.id, HOLD_ID);

const release = await tools.commitCommand.execute({ commandId: GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID, input: { holdId: HOLD_ID, reason: "agent-ui-demo-cleanup" } });
assert.equal(release.receipt.ok, true, "agent-facing commitCommand can release the approved hold");
assert.equal(release.receipt.summary.receipt.confirmation.status, "released");
const releaseCall = calls.find((call) => call.method === "POST" && call.url.endsWith(`/api/v1/booking/holds/${HOLD_ID}/release`));
assert.ok(releaseCall, "commitCommand calls POST /holds/{holdId}/release");

const unapprovedTools = createCommandCatalogTools({
  sessionId: SESSION_ID,
  hostSession: { ...hostSession, metadata: { approvedCommandIds: [] } },
  pageContext,
  approvedCommandIds: [],
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "bearer", token: TOKEN, source: "test" },
  bookingRuntimeFetcher: fetcher,
});
const beforeUnapproved = calls.length;
const unapprovedCreate = await unapprovedTools.commitCommand.execute({
  commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  input: { contextId: CONTEXT_ID, window: { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" }, resourceUnitId: RESOURCE_UNIT_ID },
});
assert.equal(unapprovedCreate.receipt.ok, false, "commitCommand denies unapproved writes even with trusted runtime credentials");
assert.equal(unapprovedCreate.receipt.policy.decision, "needs_approval");
assert.equal(calls.length, beforeUnapproved, "unapproved commitCommand does not call booking runtime");

console.log(JSON.stringify({
  ok: true,
  selectedRead: GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  selectedMutation: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  confirmationRead: GENERATED_BOOKING_GET_HOLD_COMMAND_ID,
  cleanupMutation: GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID,
  runtimeProvider: GENERATED_BOOKING_RUNTIME_PROVIDER,
  fetchCalls: calls.length,
}));
