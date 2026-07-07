import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { executeCatalogCommand } from "../../packages/tool-contracts/src/index.ts";
import { executeHostCatalogCommand } from "../../packages/platform-adapters/src/index.ts";
import {
  GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  GENERATED_BOOKING_CREATE_BOOKING_COMMAND_ID,
  GENERATED_BOOKING_RUNTIME_PROVIDER,
  GENERATED_BOOKING_LIST_CONTEXTS_COMMAND_ID,
  GENERATED_BOOKING_PING_COMMAND_ID,
  GENERATED_BOOKING_TEMPLATES_COMMAND_ID,
  GENERATED_BOOKING_GET_HOLD_COMMAND_ID,
  GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID,
  createStandaloneHostCommandIndex,
  createStandaloneHostCommandRuntimeBundle,
} from "../../apps/standalone-sveltekit/src/lib/server/host-command-runtime.ts";
import {
  getGlobalCommandCatalog,
  learnGlobalCommand,
  searchGlobalCommandRegistry,
} from "../../apps/standalone-sveltekit/src/lib/server/global-command-registry.ts";

const binding = JSON.parse(await readFile("tests/fixtures/sonik-booking/demo-command-binding.json", "utf8"));
const runtimeBindings = JSON.parse(await readFile("tests/fixtures/generated/sonik-booking-runtime-bindings.generated.json", "utf8"));
const globalCatalog = getGlobalCommandCatalog();
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_demo_123";
const GUEST_USER_ID = "guest_user_456";
const SESSION_ID = "session_phase3_demo";
const CONTEXT_ID = "22222222-2222-4222-8222-222222222222";
const HOLD_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_UNIT_ID = "44444444-4444-4444-8444-444444444444";
const WAITLIST_ENTRY_ID = "55555555-5555-4555-8555-555555555555";
const TOKEN = "phase3-secret-token";
const SIGNED_HOST_CONTEXT_HEADER = "eyJzaWduZWQiOiJwcm9vZiJ9";

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

const bookingPageContext = {
  route: "/booking/bookings/booking_123",
  surface: "booking-admin",
  pageType: "event-booking-detail",
  activeEntity: { type: "booking-context", id: CONTEXT_ID, label: "Summer Jazz Night" },
  commandFamilies: ["booking", "booking-holds"],
  skillFamilies: ["sonik-booking"],
  visibleActions: ["view-availability", "create-hold", "release-hold"],
};

const learnedMutation = learnGlobalCommand({ commandId: binding.selectedMutation.commandId, aspects: ["policy", "transport", "auth", "schema"] });
assert.equal(learnedMutation.ok, true, "global learn finds selected mutation");
assert.equal(learnedMutation.transport.runtimeStatus, "shadow", "global discovery remains shadow for selected mutation");
assert.equal(learnedMutation.approval, "required", "global discovery keeps approval required");
assert.ok(learnedMutation.inputSchema, "global learn remains the schema-loading boundary");

const globalSearch = searchGlobalCommandRegistry({ query: "create hold", context: { ...bookingPageContext, authenticated: true, organizationId: ORG_ID, scopes: ["booking:read", "booking:write"] } });
const searchMutation = globalSearch.commands.find((command) => command.id === GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID);
assert.ok(searchMutation, "global search discovers selected mutation");
assert.equal(searchMutation.execution.runtimeStatus, "shadow", "global search stays shadow");
assert.equal(searchMutation.execution.executable, false, "global search explicitly remains non-executable");

const globalDenied = executeCatalogCommand(globalCatalog, GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID, {}, {
  action: "commit",
  approved: true,
  authenticated: true,
  organizationId: ORG_ID,
  scopes: ["booking:read", "booking:write"],
  requestId: "req_global_shadow_denied",
});
assert.equal(globalDenied.ok, false, "global catalog helper cannot execute selected generated mutation");
assert.equal(globalDenied.policy.reasons.includes("runtime_not_mounted:shadow"), true);
assert.equal(globalDenied.policy.reasons.includes("orpc_execution_adapter_not_mounted"), true);

const calls = [];
const fetcher = async (url, init = {}) => {
  const rawBody = init.body;
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method: init.method, headers: init.headers, body, rawBody });
  if (String(url).includes("/availability")) {
    return Response.json([{ startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z", capacityRemaining: 4 }]);
  }
  if (String(url).endsWith("/api/v1/booking/bookings") && init.method === "POST") {
    return Response.json({
      id: "booking_123",
      organizationId: ORG_ID,
      contextId: body.contextId,
      userId: body.userId,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      partySize: body.partySize,
      source: body.source,
      clientRequestId: body.clientRequestId,
      status: "confirmed",
      createdBy: USER_ID,
    }, { status: 201 });
  }

  if (String(url).endsWith("/api/v1/booking/holds") && init.method === "POST") {
    return Response.json({
      id: HOLD_ID,
      organizationId: ORG_ID,
      contextId: body.contextId,
      userId: body.userId ?? null,
      customerId: body.customerId ?? null,
      createdBy: USER_ID,
      window: body.window,
      partySize: body.partySize,
      status: "active",
      source: body.source,
      expiresAt: "2026-07-01T18:10:00.000Z",
      clientRequestId: body.clientRequestId,
      convertedBookingId: null,
      convertedAt: null,
      resourceUnitId: body.resourceUnitId ?? null,
      resourceCombinationId: body.resourceCombinationId ?? null,
      metadata: body.metadata,
      createdAt: "2026-07-01T18:00:00.000Z",
      updatedAt: "2026-07-01T18:00:00.000Z",
      tokenEcho: TOKEN,
    }, { status: 201 });
  }
  if (String(url).endsWith(`/api/v1/booking/holds/${HOLD_ID}`) && init.method === "GET") {
    return Response.json({ id: HOLD_ID, organizationId: ORG_ID, contextId: CONTEXT_ID, window: { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" }, partySize: 2, status: "active", expiresAt: "2026-07-01T18:10:00.000Z", resourceUnitId: RESOURCE_UNIT_ID });
  }
  if (String(url).endsWith(`/api/v1/booking/holds/${HOLD_ID}/release`) && init.method === "POST") {
    return Response.json({ id: HOLD_ID, organizationId: ORG_ID, contextId: CONTEXT_ID, window: { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" }, partySize: 2, status: "released", expiresAt: "2026-07-01T18:10:00.000Z", resourceUnitId: RESOURCE_UNIT_ID });
  }
  if (String(url).endsWith(`/api/v1/booking/waitlist/${WAITLIST_ENTRY_ID}`) && init.method === "DELETE") {
    return Response.json({ id: WAITLIST_ENTRY_ID, deleted: true, organizationId: ORG_ID });
  }
  if (String(url).includes("/api/v1/booking/media/assets") && init.method === "POST" && typeof FormData !== "undefined" && init.body instanceof FormData) {
    return Response.json({ id: "asset_123", contextId: init.body.get("contextId"), role: init.body.get("role"), fileName: init.body.get("fileName"), status: "uploaded" }, { status: 201 });
  }
  return Response.json({ error: "unexpected", url: String(url) }, { status: 500 });
};

const bundle = createStandaloneHostCommandRuntimeBundle({
  hostSession,
  pageContext: bookingPageContext,
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "bearer", token: TOKEN, source: "test" },
  fetcher,
});

const generatedRuntimeCommands = bundle.catalog.commands.filter((command) => command.metadata?.runtimeAdapterProvider === GENERATED_BOOKING_RUNTIME_PROVIDER);
assert.equal(runtimeBindings.summary.sourceCommandCount, 72, "trusted host runtime keeps the full generated booking contract count");
assert.equal(runtimeBindings.summary.shadowCommandCount, 19, "trusted host runtime keeps generated shadow commands non-executable");
assert.equal(generatedRuntimeCommands.length, runtimeBindings.summary.commandCount, "trusted host catalog mounts every source-mounted generated booking command");
assert.equal(generatedRuntimeCommands.filter((command) => command.effect === "read").length, runtimeBindings.summary.readCount, "all source-mounted generated reads are mounted");
assert.equal(generatedRuntimeCommands.filter((command) => command.effect === "write").length, runtimeBindings.summary.writeCount, "all source-mounted generated writes are mounted");
assert.equal(generatedRuntimeCommands.filter((command) => command.effect === "destructive").length, runtimeBindings.summary.destructiveCount, "all source-mounted generated destructive commands are mounted behind approval");
const generatedRuntimeAdapter = bundle.runtimeAdapters.find((adapter) => adapter.provider === GENERATED_BOOKING_RUNTIME_PROVIDER);
assert.ok(generatedRuntimeAdapter, "trusted host runtime includes generated booking runtime adapter");
assert.equal(generatedRuntimeAdapter.bindings.length, runtimeBindings.summary.commandCount, "runtime adapter binds every source-mounted generated booking command");
assert.equal(generatedRuntimeAdapter.bindings.filter((entry) => entry.status === "mounted-read").length, runtimeBindings.summary.readCount, "runtime adapter maps every read as mounted-read");
assert.equal(generatedRuntimeAdapter.bindings.filter((entry) => entry.status === "mounted-write").length, runtimeBindings.summary.mountedWriteCount, "runtime adapter maps every write/destructive command as mounted-write");

const readOnlyBundle = createStandaloneHostCommandRuntimeBundle({
  hostSession: { ...hostSession, scopes: ["booking:read"], metadata: { approvedCommandIds: [] } },
  pageContext: bookingPageContext,
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "bearer", token: TOKEN, source: "test" },
  fetcher,
});
const readOnlyGeneratedCommands = readOnlyBundle.catalog.commands.filter((command) => command.metadata?.runtimeAdapterProvider === GENERATED_BOOKING_RUNTIME_PROVIDER);
assert.equal(readOnlyGeneratedCommands.length, runtimeBindings.summary.readCount, "read-only host sessions only discover generated read commands");
assert.equal(readOnlyGeneratedCommands.every((command) => command.effect === "read"), true, "read-only host sessions do not mount write/destructive generated commands");
assert.equal(readOnlyBundle.catalog.commands.some((command) => command.id === "booking.create.context"), false, "read-only host sessions cannot discover generated booking writes");

for (const commandId of [GENERATED_BOOKING_AVAILABILITY_COMMAND_ID, GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID, GENERATED_BOOKING_GET_HOLD_COMMAND_ID, GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID]) {
  const command = bundle.catalog.commands.find((entry) => entry.id === commandId);
  assert.ok(command, `trusted host catalog includes ${commandId}`);
  assert.equal(command.transport.runtimeStatus, "mounted", `${commandId} is mounted only in trusted host catalog`);
  assert.equal(command.metadata.liveExecution, true, `${commandId} declares live execution only in trusted host catalog`);
  assert.equal(command.metadata.runtimeAdapterProvider, GENERATED_BOOKING_RUNTIME_PROVIDER, `${commandId} uses the generated trusted runtime provider`);
}

const surfaceIndex = createStandaloneHostCommandIndex({
  hostSession,
  pageContext: bookingPageContext,
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "bearer", token: TOKEN, source: "test" },
  fetcher,
});
assert.equal(surfaceIndex.commands.some((command) => command.id === GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID), true, "surface index can context-load selected mutation summary");
assert.equal(surfaceIndex.commands.every((command) => command.execution.executable === false), true, "index summaries still remain non-executable summaries");

const missingApproval = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  commandInput: { contextId: CONTEXT_ID, window: { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" }, resourceUnitId: RESOURCE_UNIT_ID },
  execution: { ...bundle.executionContext, action: "commit", requestId: "req_missing_approval" },
});
assert.equal(missingApproval.ok, false, "trusted mutation still requires explicit approval");
assert.equal(missingApproval.policy.decision, "needs_approval");
assert.equal(calls.length, 0, "missing approval does not call booking API");

const missingResource = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  commandInput: { contextId: CONTEXT_ID, window: { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" } },
  execution: { ...bundle.executionContext, action: "commit", approved: true, requestId: "req_missing_resource" },
});
assert.equal(missingResource.ok, false, "missing resource target fails closed before mutation");
assert.equal(missingResource.policy.reasons.includes("host_runtime_error"), true);
assert.match(missingResource.errors?.[0]?.message ?? "", /missing-resource-target/);
assert.equal(calls.length, 0, "missing resource target does not call booking API");

const mismatchedPrincipal = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  commandInput: {
    contextId: CONTEXT_ID,
    userId: "malicious-user-id",
    window: { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" },
    resourceUnitId: RESOURCE_UNIT_ID,
  },
  execution: { ...bundle.executionContext, action: "commit", approved: true, requestId: "req_mismatched_principal" },
});
assert.equal(mismatchedPrincipal.ok, false, "model-supplied userId cannot override trusted host principal");
assert.equal(mismatchedPrincipal.policy.reasons.includes("host_runtime_error"), true);
assert.match(mismatchedPrincipal.errors?.[0]?.message ?? "", /trusted-principal-mismatch/);
assert.equal(calls.length, 0, "mismatched userId fails before calling booking API");

const beforeCreateBooking = calls.length;
const createBookingWithGuest = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: GENERATED_BOOKING_CREATE_BOOKING_COMMAND_ID,
  commandInput: {
    contextId: CONTEXT_ID,
    userId: GUEST_USER_ID,
    startsAt: "2026-07-01T18:00:00.000Z",
    endsAt: "2026-07-01T18:30:00.000Z",
    partySize: 2,
    source: "admin",
    clientRequestId: "agent-ui-v02-demo-booking-guest-001",
  },
  execution: { ...bundle.executionContext, action: "commit", approved: true, requestId: "req_create_booking_guest" },
});
assert.equal(createBookingWithGuest.ok, true, "create booking accepts guest userId that differs from trusted host principal");
const createBookingCall = calls.slice(beforeCreateBooking).find((call) => call.method === "POST" && call.url.endsWith("/api/v1/booking/bookings"));
assert.ok(createBookingCall, "create booking calls POST /bookings");
assert.equal(createBookingCall.body.userId, GUEST_USER_ID, "booking.create.booking preserves the resolved guest identity as booking subject");
assert.equal(createBookingCall.headers["x-sonik-agent-principal-id"], USER_ID, "trusted host principal remains an audit header, not the booking subject");

const spoofedCreateBookingPrincipal = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: GENERATED_BOOKING_CREATE_BOOKING_COMMAND_ID,
  commandInput: {
    contextId: CONTEXT_ID,
    userId: GUEST_USER_ID,
    principalId: "malicious-principal",
    startsAt: "2026-07-01T18:00:00.000Z",
    endsAt: "2026-07-01T18:30:00.000Z",
    partySize: 2,
    source: "admin",
    clientRequestId: "agent-ui-v02-demo-booking-spoof-001",
  },
  execution: { ...bundle.executionContext, action: "commit", approved: true, requestId: "req_create_booking_spoofed_principal" },
});
assert.equal(spoofedCreateBookingPrincipal.ok, false, "create booking still rejects model-supplied principalId spoofing");
assert.match(
  spoofedCreateBookingPrincipal.errors?.[0]?.message ?? "",
  /Unsupported command input fields: principalId|trusted-principal-mismatch: principalId/,
  "principalId spoofing is rejected before any booking API mutation",
);

const beforeNoUserHold = calls.length;
const noUserHoldReceipt = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  commandInput: {
    contextId: CONTEXT_ID,
    window: { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" },
    partySize: 2,
    source: "admin",
    clientRequestId: "agent-ui-v02-demo-hold-no-user-001",
    resourceUnitId: RESOURCE_UNIT_ID,
  },
  execution: { ...bundle.executionContext, action: "commit", approved: true, requestId: "req_create_hold_no_user" },
});
assert.equal(noUserHoldReceipt.ok, true, "create hold can omit booking userId when host principal is not a bookable guest identity");
const noUserHoldCall = calls.slice(beforeNoUserHold).find((call) => call.method === "POST" && call.url.endsWith("/api/v1/booking/holds"));
assert.ok(noUserHoldCall, "create hold without userId still calls POST /holds");
assert.equal(Object.hasOwn(noUserHoldCall.body, "userId"), false, "create hold does not force trusted principal into booking userId when omitted");
assert.equal(noUserHoldCall.headers["x-sonik-agent-principal-id"], USER_ID, "trusted principal remains available as an audit header");

const availabilityReceipt = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  commandInput: { contextId: CONTEXT_ID, from: "2026-07-01T18:00:00.000Z", to: "2026-07-01T19:00:00.000Z", partySize: 2, source: "admin", resourceUnitId: RESOURCE_UNIT_ID },
  execution: { ...bundle.executionContext, action: "execute", requestId: "req_availability" },
});
assert.equal(availabilityReceipt.ok, true, "selected read executes through trusted adapter");
assert.equal(availabilityReceipt.trace.provider, GENERATED_BOOKING_RUNTIME_PROVIDER);
assert.equal(calls.at(-1).method, "GET");
assert.match(calls.at(-1).url, /\/availability\?/);

const createReceipt = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  commandInput: {
    contextId: CONTEXT_ID,
    userId: USER_ID,
    window: { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" },
    partySize: 2,
    source: "admin",
    clientRequestId: "agent-ui-v02-demo-hold-001",
    ttlSeconds: 600,
    resourceUnitId: RESOURCE_UNIT_ID,
    metadata: { purpose: "phase3-test", apiToken: TOKEN },
  },
  execution: { ...bundle.executionContext, action: "commit", approved: true, requestId: "req_create_hold" },
});
assert.equal(createReceipt.ok, true, "selected mutation commits through trusted adapter");
assert.equal(createReceipt.trace.provider, GENERATED_BOOKING_RUNTIME_PROVIDER);
assert.equal(createReceipt.summary.receipt.organizationId, ORG_ID);
assert.equal(createReceipt.summary.receipt.principalId, USER_ID);
assert.equal(createReceipt.summary.receipt.idempotencyKey, "agent-ui-v02-demo-hold-001");
assert.equal(createReceipt.summary.receipt.confirmation.id, HOLD_ID);
assert.equal(createReceipt.summary.receipt.confirmation.status, "active");
assert.equal(JSON.stringify(createReceipt).includes(TOKEN), false, "receipts redact bearer tokens and secret-like response fields");
const createCall = calls.find(
  (call) =>
    call.method === "POST" &&
    call.url.endsWith("/api/v1/booking/holds") &&
    call.body?.clientRequestId === "agent-ui-v02-demo-hold-001",
);
assert.ok(createCall, "create hold calls POST /holds");
assert.equal(createCall.headers.authorization, `Bearer ${TOKEN}`);
assert.equal(createCall.headers["x-sonik-agent-ui-host-context"], undefined, "bearer runtime does not synthesize a signed host context");
assert.equal(createCall.headers["x-sonik-agent-org-id"], ORG_ID);
assert.equal(createCall.headers["x-sonik-agent-session-id"], SESSION_ID);
assert.equal(createCall.headers["x-sonik-agent-principal-id"], USER_ID);
assert.equal(createCall.body.userId, USER_ID, "create hold body is bound to trusted principal, not arbitrary model input");
assert.equal(createCall.headers["x-sonik-idempotency-key"], "agent-ui-v02-demo-hold-001");
assert.equal(createCall.body.resourceUnitId, RESOURCE_UNIT_ID);
assert.equal(createCall.body.metadata.apiToken, "[redacted]");

const signedHeaderCalls = [];
const signedHeaderBundle = createStandaloneHostCommandRuntimeBundle({
  hostSession,
  pageContext: bookingPageContext,
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "signed-host-context", signedHostContextHeader: SIGNED_HOST_CONTEXT_HEADER, source: "test" },
  fetcher: async (url, init = {}) => {
    signedHeaderCalls.push({ url: String(url), method: init.method, headers: init.headers });
    return Response.json([{ startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z", capacityRemaining: 4 }]);
  },
});
const signedCommandIds = signedHeaderBundle.catalog.commands
  .filter((command) => command.metadata?.runtimeAdapterProvider === GENERATED_BOOKING_RUNTIME_PROVIDER)
  .map((command) => command.id)
  .sort();
const expectedGeneratedCommandIds = runtimeBindings.bindings.map((binding) => binding.commandId).sort();
assert.deepEqual(signedCommandIds, expectedGeneratedCommandIds, "signed host-context catalog mounts every source-mounted generated booking command");
assert.equal(signedCommandIds.length, 53, "signed host-context exposes the full source-mounted generated command set, not a four-command handwritten subset");
assert.equal(signedHeaderBundle.catalog.commands.some((command) => runtimeBindings.summary.shadowCommandIds.includes(command.id)), false, "signed host-context does not mount generated shadow commands as executable");
assert.equal(
  signedHeaderBundle.runtimeAdapters.every((adapter) => adapter.provider === GENERATED_BOOKING_RUNTIME_PROVIDER),
  true,
  "signed host-context runtime uses the generated booking adapter",
);
for (const broadReadCommandId of [
  GENERATED_BOOKING_PING_COMMAND_ID,
  GENERATED_BOOKING_LIST_CONTEXTS_COMMAND_ID,
  GENERATED_BOOKING_TEMPLATES_COMMAND_ID,
]) {
  assert.equal(
    signedHeaderBundle.catalog.commands.some((command) => command.id === broadReadCommandId),
    true,
    `${broadReadCommandId} is mounted for signed host-context execution`,
  );
}

const signedHeaderReceipt = await executeHostCatalogCommand({
  catalog: signedHeaderBundle.catalog,
  runtimeAdapters: signedHeaderBundle.runtimeAdapters,
  commandId: GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  commandInput: { contextId: CONTEXT_ID, from: "2026-07-01T18:00:00.000Z", to: "2026-07-01T19:00:00.000Z", partySize: 2, source: "admin", resourceUnitId: RESOURCE_UNIT_ID },
  execution: { ...signedHeaderBundle.executionContext, action: "execute", requestId: "req_signed_context_header" },
});
assert.equal(signedHeaderReceipt.ok, true, "signed host-context runtime is treated as credentialed");
assert.equal(signedHeaderCalls.at(-1).headers["x-sonik-agent-ui-host-context"], SIGNED_HOST_CONTEXT_HEADER, "signed host context is forwarded to booking service");
assert.equal(signedHeaderCalls.at(-1).headers.authorization, undefined, "signed host-context runtime avoids bearer fallback");

const getHoldReceipt = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: GENERATED_BOOKING_GET_HOLD_COMMAND_ID,
  commandInput: { holdId: HOLD_ID },
  execution: { ...bundle.executionContext, action: "execute", requestId: "req_get_hold" },
});
assert.equal(getHoldReceipt.ok, true, "confirmation read executes through trusted adapter");
assert.equal(getHoldReceipt.summary.body.id, HOLD_ID);

const releaseReceipt = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID,
  commandInput: { holdId: HOLD_ID, reason: binding.cleanupMutation.cleanupReason },
  execution: { ...bundle.executionContext, action: "commit", approved: true, requestId: "req_release_hold" },
});
assert.equal(releaseReceipt.ok, true, "cleanup mutation commits through trusted adapter");
assert.equal(releaseReceipt.summary.receipt.confirmation.status, "released");
const releaseCall = calls.find((call) => call.method === "POST" && call.url.endsWith(`/api/v1/booking/holds/${HOLD_ID}/release`));
assert.ok(releaseCall, "release hold calls POST /holds/{holdId}/release");
assert.equal(releaseCall.body.reason, binding.cleanupMutation.cleanupReason);

const beforeShadowWaitlist = calls.length;
const learnedShadowWaitlist = learnGlobalCommand({ commandId: "booking.delete.waitlist.entry", aspects: ["policy", "transport", "auth", "schema"] });
assert.equal(learnedShadowWaitlist.ok, true, "global registry still discovers generated shadow waitlist commands");
assert.equal(learnedShadowWaitlist.transport.runtimeStatus, "shadow", "shadow waitlist commands remain non-mounted in global discovery");
assert.equal(bundle.catalog.commands.some((command) => command.id === "booking.delete.waitlist.entry"), false, "trusted host catalog does not mount source-shadow waitlist commands");
const shadowWaitlistReceipt = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: "booking.delete.waitlist.entry",
  commandInput: { entryId: WAITLIST_ENTRY_ID },
  execution: { ...bundle.executionContext, action: "commit", approved: true, requestId: "req_delete_waitlist_shadow" },
});
assert.equal(shadowWaitlistReceipt.ok, false, "source-shadow waitlist command is not executable through trusted host runtime");
assert.equal(shadowWaitlistReceipt.policy.reasons.includes("unknown_command"), true, "source-shadow command is absent from mounted runtime catalog");
assert.equal(calls.length, beforeShadowWaitlist, "source-shadow command does not call the booking API");

const uploadReceipt = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: "booking.upload.media.asset",
  commandInput: { contextId: CONTEXT_ID, role: "floor_plan", fileName: "plan.txt", file: new Blob(["hello"], { type: "text/plain" }) },
  execution: { ...bundle.executionContext, action: "commit", approved: true, requestId: "req_upload_media_asset" },
});
assert.equal(uploadReceipt.ok, true, "approved multipart generated upload command commits through generated runtime");
const uploadCall = calls.find((call) => call.method === "POST" && call.url.includes("/api/v1/booking/media/assets"));
assert.ok(uploadCall, "multipart upload calls POST /media/assets");
assert.equal(uploadCall.url.includes("contextId="), false, "multipart upload keeps contextId in FormData instead of duplicating it into the URL");
assert.equal(uploadCall.url.includes("role="), false, "multipart upload keeps role in FormData instead of duplicating it into the URL");
assert.equal(uploadCall.url.includes("fileName="), false, "multipart upload keeps fileName in FormData instead of duplicating it into the URL");
assert.equal(uploadCall.headers["content-type"], undefined, "multipart upload lets fetch set the boundary content-type");
assert.equal(typeof FormData !== "undefined" && uploadCall.rawBody instanceof FormData, true, "multipart upload sends FormData, not JSON");
assert.equal(uploadCall.rawBody.get("contextId"), CONTEXT_ID, "multipart upload includes contextId in the form body");
assert.equal(uploadCall.rawBody.get("role"), "floor_plan", "multipart upload includes role in the form body");
assert.equal(uploadCall.rawBody.get("fileName"), "plan.txt", "multipart upload includes fileName in the form body");
assert.ok(uploadCall.rawBody.get("file"), "multipart upload includes the file part");

console.log(JSON.stringify({
  ok: true,
  selectedRead: GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  selectedMutation: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  confirmationRead: GENERATED_BOOKING_GET_HOLD_COMMAND_ID,
  cleanupMutation: GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID,
  runtimeProvider: GENERATED_BOOKING_RUNTIME_PROVIDER,
  fetchCalls: calls.length,
}));
