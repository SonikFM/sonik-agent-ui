import assert from "node:assert/strict";
import {
  GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  GENERATED_BOOKING_GET_HOLD_COMMAND_ID,
  GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID,
  GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER,
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
  if (String(url).endsWith("/api/v1/booking/holds") && init.method === "POST") {
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

const search = await tools.searchCommandCatalog.execute({ query: "hold availability", limit: 10 });
for (const commandId of [GENERATED_BOOKING_AVAILABILITY_COMMAND_ID, GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID, GENERATED_BOOKING_GET_HOLD_COMMAND_ID, GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID]) {
  assert.equal(search.contextLoadedCommandIds.includes(commandId), true, `${commandId} is context-loaded in the trusted host command search`);
}

const learnedCreate = await tools.learnCommand.execute({ commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID, aspects: ["policy", "transport", "auth", "schema"] });
assert.equal(learnedCreate.ok, true, "agent-facing learnCommand resolves the create-hold descriptor");
assert.equal(learnedCreate.contextLoaded, true, "learnCommand marks create hold as page-context loaded");
assert.equal(learnedCreate.transport.runtimeStatus, "mounted", "learnCommand sees trusted runtime-mounted descriptor, not the global shadow descriptor");
assert.equal(learnedCreate.effect, "write");
assert.equal(learnedCreate.approval, "required");

const deniedExecuteMutation = await tools.executeCommand.execute({
  commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  input: { contextId: CONTEXT_ID, window: { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" }, resourceUnitId: RESOURCE_UNIT_ID },
});
assert.equal(deniedExecuteMutation.receipt.ok, false, "agent-facing executeCommand cannot run mutation commands");
assert.equal(deniedExecuteMutation.receipt.policy.reasons.includes("runtime_not_mounted_for_execute"), true);
assert.equal(calls.length, 0, "denied executeCommand mutation does not call booking runtime");

const availability = await tools.executeCommand.execute({
  commandId: GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  input: { contextId: CONTEXT_ID, from: "2026-07-01T18:00:00.000Z", to: "2026-07-01T19:00:00.000Z", partySize: 2, source: "admin", resourceUnitId: RESOURCE_UNIT_ID },
});
assert.equal(availability.receipt.ok, true, "agent-facing executeCommand can read availability through the trusted runtime");
assert.equal(availability.receipt.trace.provider, GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER);
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
  runtimeProvider: GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER,
  fetchCalls: calls.length,
}));
