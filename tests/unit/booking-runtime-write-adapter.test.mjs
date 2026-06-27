import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { executeCatalogCommand } from "../../packages/tool-contracts/src/index.ts";
import { executeHostCatalogCommand } from "../../packages/platform-adapters/src/index.ts";
import {
  GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER,
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
const globalCatalog = getGlobalCommandCatalog();
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_demo_123";
const SESSION_ID = "session_phase3_demo";
const CONTEXT_ID = "22222222-2222-4222-8222-222222222222";
const HOLD_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_UNIT_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = "phase3-secret-token";

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
  const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method: init.method, headers: init.headers, body });
  if (String(url).includes("/availability")) {
    return Response.json([{ startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z", capacityRemaining: 4 }]);
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
  return Response.json({ error: "unexpected", url: String(url) }, { status: 500 });
};

const bundle = createStandaloneHostCommandRuntimeBundle({
  hostSession,
  pageContext: bookingPageContext,
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "bearer", token: TOKEN, source: "test" },
  fetcher,
});

for (const commandId of [GENERATED_BOOKING_AVAILABILITY_COMMAND_ID, GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID, GENERATED_BOOKING_GET_HOLD_COMMAND_ID, GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID]) {
  const command = bundle.catalog.commands.find((entry) => entry.id === commandId);
  assert.ok(command, `trusted host catalog includes ${commandId}`);
  assert.equal(command.transport.runtimeStatus, "mounted", `${commandId} is mounted only in trusted host catalog`);
  assert.equal(command.metadata.liveExecution, true, `${commandId} declares live execution only in trusted host catalog`);
  assert.equal(command.metadata.runtimeAdapterProvider, GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER, `${commandId} uses the demo trusted runtime provider`);
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

const availabilityReceipt = await executeHostCatalogCommand({
  catalog: bundle.catalog,
  runtimeAdapters: bundle.runtimeAdapters,
  commandId: GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  commandInput: { contextId: CONTEXT_ID, from: "2026-07-01T18:00:00.000Z", to: "2026-07-01T19:00:00.000Z", partySize: 2, source: "admin", resourceUnitId: RESOURCE_UNIT_ID },
  execution: { ...bundle.executionContext, action: "execute", requestId: "req_availability" },
});
assert.equal(availabilityReceipt.ok, true, "selected read executes through trusted adapter");
assert.equal(availabilityReceipt.trace.provider, GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER);
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
assert.equal(createReceipt.trace.provider, GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER);
assert.equal(createReceipt.summary.receipt.organizationId, ORG_ID);
assert.equal(createReceipt.summary.receipt.principalId, USER_ID);
assert.equal(createReceipt.summary.receipt.idempotencyKey, "agent-ui-v02-demo-hold-001");
assert.equal(createReceipt.summary.receipt.confirmation.id, HOLD_ID);
assert.equal(createReceipt.summary.receipt.confirmation.status, "active");
assert.equal(JSON.stringify(createReceipt).includes(TOKEN), false, "receipts redact bearer tokens and secret-like response fields");
const createCall = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/v1/booking/holds"));
assert.ok(createCall, "create hold calls POST /holds");
assert.equal(createCall.headers.authorization, `Bearer ${TOKEN}`);
assert.equal(createCall.headers["x-sonik-agent-org-id"], ORG_ID);
assert.equal(createCall.headers["x-sonik-agent-session-id"], SESSION_ID);
assert.equal(createCall.headers["x-sonik-agent-principal-id"], USER_ID);
assert.equal(createCall.body.userId, USER_ID, "create hold body is bound to trusted principal, not arbitrary model input");
assert.equal(createCall.headers["x-sonik-idempotency-key"], "agent-ui-v02-demo-hold-001");
assert.equal(createCall.body.resourceUnitId, RESOURCE_UNIT_ID);
assert.equal(createCall.body.metadata.apiToken, "[redacted]");

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

console.log(JSON.stringify({
  ok: true,
  selectedRead: GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  selectedMutation: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  confirmationRead: GENERATED_BOOKING_GET_HOLD_COMMAND_ID,
  cleanupMutation: GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID,
  runtimeProvider: GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER,
  fetchCalls: calls.length,
}));
