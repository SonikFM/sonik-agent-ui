import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { executeHostCatalogCommand } from "../../packages/platform-adapters/src/index.ts";
import {
  GENERATED_BOOKING_RUNTIME_PROVIDER,
  createStandaloneHostCommandRuntimeBundle,
} from "../../apps/standalone-sveltekit/src/lib/server/host-command-runtime.ts";

const runtimeBindings = JSON.parse(await readFile("tests/fixtures/generated/sonik-booking-runtime-bindings.generated.json", "utf8"));

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_runtime_coverage";
const SESSION_ID = "session_runtime_coverage";
const TOKEN = "runtime-coverage-token";
const GUEST_FROM_CREATE_GUEST_SENTINEL = "GUEST_USER_ID_FROM_booking.create.guest";
const ids = {
  contextId: "22222222-2222-4222-8222-222222222222",
  bookingId: "33333333-3333-4333-8333-333333333333",
  holdId: "44444444-4444-4444-8444-444444444444",
  resourceTypeId: "55555555-5555-4555-8555-555555555555",
  typeId: "55555555-5555-4555-8555-555555555555",
  resourceUnitId: "66666666-6666-4666-8666-666666666666",
  unitId: "66666666-6666-4666-8666-666666666666",
  resourceBlockId: "77777777-7777-4777-8777-777777777777",
  blockId: "77777777-7777-4777-8777-777777777777",
  resourceCombinationId: "88888888-8888-4888-8888-888888888888",
  combinationId: "88888888-8888-4888-8888-888888888888",
  policyId: "99999999-9999-4999-8999-999999999999",
  ratePlanId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ruleId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  memberId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  assignmentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  assetId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  customerId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
};

const hostSession = {
  source: "amplify-embedded",
  sessionId: SESSION_ID,
  userId: USER_ID,
  principalId: USER_ID,
  organizationId: ORG_ID,
  authenticated: true,
  scopes: ["booking:read", "booking:write"],
  metadata: { approvedCommandIds: runtimeBindings.bindings.filter((binding) => binding.commit).map((binding) => binding.commandId) },
};

const calls = [];
const fetcher = async (url, init = {}) => {
  calls.push({ commandUrl: String(url), method: init.method, bodyKind: bodyKind(init.body) });
  return Response.json({
    ok: true,
    id: responseIdForPath(String(url)),
    organizationId: ORG_ID,
    contextId: ids.contextId,
    bookingId: ids.bookingId,
    holdId: ids.holdId,
    status: "runtime-coverage-ok",
  }, { status: init.method === "POST" ? 201 : 200 });
};

const bundle = createStandaloneHostCommandRuntimeBundle({
  hostSession,
  pageContext: { surface: "booking-admin", pageType: "booking", commandFamilies: ["booking"], skillFamilies: ["sonik-booking"] },
  bookingServiceBaseUrl: "https://booking.example.test",
  bookingRuntimeAuth: { mode: "bearer", token: TOKEN, source: "test" },
  fetcher,
});

const mountedCommandIds = bundle.catalog.commands
  .filter((command) => command.metadata?.runtimeAdapterProvider === GENERATED_BOOKING_RUNTIME_PROVIDER)
  .map((command) => command.id)
  .sort();
assert.deepEqual(mountedCommandIds, runtimeBindings.bindings.map((binding) => binding.commandId).sort(), "trusted host catalog and generated runtime binding set match exactly");
assert.equal(mountedCommandIds.length, 53, "trusted host catalog mounts exactly the 53 source-mounted booking commands");
for (const shadowCommandId of runtimeBindings.summary.shadowCommandIds) {
  assert.equal(bundle.catalog.commands.some((command) => command.id === shadowCommandId), false, `${shadowCommandId} remains absent from executable trusted host catalog`);
}

const createBookingCommand = bundle.catalog.commands.find((entry) => entry.id === "booking.create.booking");
assert.equal(
  createBookingCommand?.examples?.[0]?.input?.userId,
  GUEST_FROM_CREATE_GUEST_SENTINEL,
  "booking.create.booking learned example intentionally teaches agents to use the guest id returned by booking.create.guest",
);

const results = [];
for (const binding of runtimeBindings.bindings) {
  const command = bundle.catalog.commands.find((entry) => entry.id === binding.commandId);
  const commandInput = sampleInputForBinding(binding, command);
  const action = binding.commit ? "commit" : "execute";
  const before = calls.length;
  const receipt = await executeHostCatalogCommand({
    catalog: bundle.catalog,
    runtimeAdapters: bundle.runtimeAdapters,
    commandId: binding.commandId,
    commandInput,
    execution: { ...bundle.executionContext, action, approved: binding.commit, requestId: `runtime_coverage_${binding.commandId.replaceAll(".", "_")}` },
  });
  results.push({ commandId: binding.commandId, ok: receipt.ok, method: binding.method, path: binding.path, action, callMade: calls.length === before + 1, error: receipt.errors?.[0]?.message ?? null });
  assert.equal(receipt.ok, true, `${binding.commandId} executes through generated host runtime`);
  assert.equal(calls.length, before + 1, `${binding.commandId} makes exactly one outbound booking runtime call`);
}

assert.equal(results.filter((result) => result.ok).length, 53, "all 53 source-mounted commands are runtime-executable in deterministic host proof");
console.log(JSON.stringify({
  ok: true,
  runtimeProvider: GENERATED_BOOKING_RUNTIME_PROVIDER,
  sourceCommandCount: runtimeBindings.summary.sourceCommandCount,
  mountedCommandCount: runtimeBindings.summary.commandCount,
  shadowCommandCount: runtimeBindings.summary.shadowCommandCount,
  executedCommandCount: results.length,
  callCount: calls.length,
  closedMountedCommandIds: [
    "booking.create.booking",
    "booking.get.booking",
    "booking.confirm.booking",
    "booking.reschedule.booking",
    "booking.list.party.members",
    "booking.add.party.member",
    "booking.list.resource.assignments",
    "booking.assign.resource",
    "booking.cancel.booking",
    "booking.remove.party.member",
    "booking.unassign.resource",
    "booking.commit.hold",
    "booking.upload.media.asset",
    "booking.get.media.asset",
    "booking.get.media.asset.variant",
    "booking.delete.media.asset",
  ],
}));

function sampleInputForBinding(binding, command) {
  const generatedExample = command?.examples?.[0]?.input;
  if (generatedExample && typeof generatedExample === "object" && !Array.isArray(generatedExample) && Object.keys(generatedExample).length > 0) return materializeExampleInput(generatedExample);
  if (binding.commandId === "booking.create.hold") {
    return { contextId: ids.contextId, window: windowInput(), partySize: 2, source: "admin", clientRequestId: "runtime-coverage-create-hold", ttlSeconds: 600, resourceUnitId: ids.resourceUnitId };
  }
  if (binding.requestBody.bodyEncoding === "multipart") {
    return { ...routeInput(binding), contextId: ids.contextId, role: "floor_plan", fileName: "runtime-coverage.txt", file: new Blob(["runtime coverage"], { type: "text/plain" }) };
  }
  const input = { ...routeInput(binding) };
  if (binding.requestBody.bodyEncoding === "json" || binding.requestBody.required) return { ...input, ...bodyInput(binding.commandId) };
  return input;
}

function materializeExampleInput(value) {
  if (value === GUEST_FROM_CREATE_GUEST_SENTINEL) return USER_ID;
  if (Array.isArray(value)) return value.map((entry) => materializeExampleInput(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, materializeExampleInput(entry)]));
  }
  return value;
}

function routeInput(binding) {
  const input = {};
  for (const parameter of [...binding.pathParams, ...binding.queryParams]) input[parameter.name] = sampleParameter(parameter.name, parameter);
  return input;
}

function sampleParameter(name, parameter) {
  if (parameter.enum?.length) return parameter.enum[0];
  if (Object.hasOwn(ids, name)) return ids[name];
  if (name === "templateId") return "restaurant-basic";
  if (name === "variant") return "public";
  if (name === "from" || name === "startsFrom") return "2026-07-01T18:00:00.000Z";
  if (name === "to" || name === "startsTo") return "2026-07-01T20:00:00.000Z";
  if (name === "startsAt" || name === "endsAt") return name === "startsAt" ? "2026-07-01T18:00:00.000Z" : "2026-07-01T18:30:00.000Z";
  if (name === "userId" || name === "principalId") return USER_ID;
  if (name === "limit" || name === "partySize" || parameter.schema?.type === "integer" || parameter.schema?.type === "number") return 2;
  if (parameter.schema?.type === "boolean") return true;
  if (parameter.schema?.format === "uuid") return ids.contextId;
  return `runtime-${name}`;
}

function bodyInput(commandId) {
  const common = { contextId: ids.contextId, metadata: { purpose: "runtime-coverage" } };
  switch (commandId) {
    case "booking.create.booking": return { ...common, userId: USER_ID, startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z", partySize: 2, source: "admin", clientRequestId: "runtime-coverage-create-booking" };
    case "booking.confirm.booking": return { source: "admin" };
    case "booking.reschedule.booking": return { startsAt: "2026-07-01T19:00:00.000Z", endsAt: "2026-07-01T19:30:00.000Z", source: "admin" };
    case "booking.add.party.member": return { displayName: "Runtime Coverage Guest", userId: USER_ID, clientRequestId: "runtime-coverage-party" };
    case "booking.assign.resource": return { resourceUnitId: ids.resourceUnitId, source: "admin" };
    case "booking.cancel.booking": return { reason: "runtime coverage", source: "admin" };
    case "booking.remove.party.member": return { reason: "runtime coverage" };
    case "booking.unassign.resource": return { reason: "runtime coverage" };
    case "booking.commit.hold": return { userId: USER_ID, source: "admin", clientRequestId: "runtime-coverage-commit-hold" };
    case "booking.create.context": return { kind: "venue_schedule", name: "Runtime Coverage Context", timezone: "America/New_York", config: { slotMinutes: 30 } };
    case "booking.update.context": return { name: "Runtime Coverage Context Updated", config: { slotMinutes: 30 } };
    case "booking.project.event.context": return { externalEventRef: ids.contextId, name: "Runtime Coverage Event", timezone: "America/New_York", config: {} };
    case "booking.create.schedule.rule": return { contextId: ids.contextId, kind: "weekly", timezone: "America/New_York", windows: [] };
    case "booking.update.schedule.rule": return { timezone: "America/New_York", windows: [] };
    case "booking.create.guest": return { name: "Runtime Coverage Guest", email: "runtime-coverage@example.test" };
    case "booking.create.resource.type": return { ...common, name: "Runtime Coverage Type", code: "RCT", kind: "room", capacity: 4, capacityModel: "unit" };
    case "booking.create.resource.unit": return { ...common, typeId: ids.resourceTypeId, name: "Runtime Coverage Unit", code: "RCU", capacity: 4, status: "active" };
    case "booking.create.resource.block": return { ...common, resourceUnitId: ids.resourceUnitId, startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z", reason: "runtime coverage" };
    case "booking.create.resource.combination": return { ...common, name: "Runtime Coverage Combo", code: "RCC", resourceUnitIds: [ids.resourceUnitId], capacity: 4, status: "active" };
    case "booking.create.policy": return { kind: "booking_window", name: "Runtime Coverage Policy", rule: { kind: "booking_window", minLeadMinutes: 0, maxAdvanceDays: 30 }, active: true, binding: { contextId: ids.contextId } };
    case "booking.update.policy": return { name: "Runtime Coverage Policy Updated", rule: { kind: "booking_window", minLeadMinutes: 5, maxAdvanceDays: 30 } };
    case "booking.create.rate.plan": return { name: "Runtime Coverage Rate", currency: "USD", components: [{ code: "base", label: "Base", amount: { amountCents: 1000, currency: "USD" } }], active: true, binding: { contextId: ids.contextId } };
    case "booking.update.rate.plan": return { name: "Runtime Coverage Rate Updated", currency: "USD", components: [{ code: "base", label: "Base", amount: { amountCents: 1200, currency: "USD" } }] };
    case "booking.extend.hold": return { ttlSeconds: 900, reason: "runtime coverage" };
    case "booking.release.hold": return { reason: "runtime coverage" };
    case "booking.delete.media.asset": return { reason: "runtime coverage" };
    default: return { ...common, name: `Runtime Coverage ${commandId}`, source: "admin" };
  }
}

function windowInput() {
  return { startsAt: "2026-07-01T18:00:00.000Z", endsAt: "2026-07-01T18:30:00.000Z" };
}

function responseIdForPath(url) {
  const match = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return match?.[0] ?? ids.contextId;
}

function bodyKind(body) {
  if (!body) return "none";
  if (typeof FormData !== "undefined" && body instanceof FormData) return "form-data";
  if (typeof body === "string") return "string";
  return typeof body;
}
