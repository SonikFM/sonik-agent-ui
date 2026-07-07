import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { executeCatalogCommand } from "../../packages/tool-contracts/src/index.ts";
import {
  getGlobalCommandCatalog,
  getGlobalCommandRegistryArtifact,
  getGlobalCommandRegistrySummary,
  learnGlobalCommand,
  parseGlobalCommandRegistryContextFromSearchParams,
  searchGlobalCommandRegistry,
} from "../../apps/standalone-sveltekit/src/lib/server/global-command-registry.ts";

const [binding, bookingArtifact] = await Promise.all([
  readJson("tests/fixtures/sonik-booking/demo-command-binding.json"),
  readJson("tests/fixtures/generated/sonik-booking-command-artifacts.generated.json"),
]);
const expectedBookingCommandCount = bookingArtifact.summary.commandCount;
const catalog = getGlobalCommandCatalog();
const commandById = new Map(catalog.commands.map((command) => [command.id, command]));

const bookingContext = parseGlobalCommandRegistryContextFromSearchParams(new URLSearchParams({
  route: "/booking/bookings/booking_123",
  surface: "booking-admin",
  pageType: "event-booking-detail",
  commandFamilies: "booking,booking-holds,event",
  skillFamilies: "sonik-booking",
  authenticated: "true",
  organizationId: "org_booking_demo",
  scopes: "booking:read,booking:write",
}));

const registry = getGlobalCommandRegistryArtifact({ startupLimit: 10, context: bookingContext });
const registryJson = JSON.stringify(registry);
assert.equal(registry.version, "sonik-agent-ui.global-command-registry.v1");
assert.equal(registry.summary.commandCount, expectedBookingCommandCount, "registry reports all generated booking commands");
assert.equal(registry.providers.some((provider) => provider.provider === "sonik-booking-openapi-fixture"), true, "registry summary includes booking provider");
assert.equal(Object.hasOwn(registry, "catalog"), false, "default registry endpoint does not load the full catalog into context");
assert.equal(Object.hasOwn(registry, "manifest"), false, "default registry endpoint does not load the full manifest into context");
assert.equal(registryJson.includes("inputSchema"), false, "default registry endpoint remains schema-free");
assert.equal(registry.startupIndex.commands.every((command) => command.execution.runtimeStatus === "shadow" && command.execution.executable === false), true, "startup index exposes runtime status without mounting generated commands");

const summary = getGlobalCommandRegistrySummary();
assert.equal(summary.summary.commandCount, expectedBookingCommandCount);
assert.equal(summary.summary.toolCount, expectedBookingCommandCount);
assert.equal(summary.summary.cliProjectionCount, bookingArtifact.summary.cliProjectionCount);
assert.equal(summary.summary.mcpProjectionCount, bookingArtifact.summary.mcpProjectionCount);

const holdSearch = searchGlobalCommandRegistry({ query: "hold", limit: 12, context: bookingContext });
assert.equal(holdSearch.kind, "global-command-registry-search");
assert.equal(holdSearch.provider, "sonik-global-command-registry");
assert.equal(holdSearch.commands.length <= 12, true);
assert.equal(holdSearch.contextIndex.totalMatches, expectedBookingCommandCount, "booking page context can surface all booking command summaries without schemas");
assert.equal(JSON.stringify(holdSearch).includes("inputSchema"), false, "search endpoint remains schema-free");
assert.equal(holdSearch.commands.every((command) => command.execution.executable === false), true, "search summaries explicitly remain non-executable discovery records");
assert.equal(holdSearch.commands.every((command) => !Object.hasOwn(command, "input") && !Object.hasOwn(command, "inputSchemaJson")), true, "search returns bounded summaries, not full descriptors");

for (const sectionName of ["selectedMutation", "cleanupMutation"]) {
  const selected = binding[sectionName];
  const discovered = holdSearch.commands.find((command) => command.id === selected.commandId);
  assert.ok(discovered, `search discovers ${selected.commandId}`);
  if (sectionName === "selectedMutation") {
    assert.equal(discovered.contextLoaded, true, `${selected.commandId} is context-loaded by booking page context`);
  }
  assert.equal(discovered.effect, selected.effect, `${selected.commandId} search effect`);
  assert.equal(discovered.approval, "required", `${selected.commandId} search approval remains required`);
  assert.equal(discovered.execution.runtimeStatus, "shadow", `${selected.commandId} search runtime status remains shadow`);
}

const availabilitySearch = searchGlobalCommandRegistry({ query: binding.selectedRead.commandId, limit: 5, context: bookingContext });
const selectedRead = availabilitySearch.commands.find((command) => command.id === binding.selectedRead.commandId);
assert.ok(selectedRead, "search discovers selected read command by exact id");
assert.equal(selectedRead.effect, "read");
assert.equal(selectedRead.approval, "none");
assert.equal(selectedRead.execution.runtimeStatus, "shadow", "selected read remains discovery-only shadow before adapter mount");

for (const sectionName of ["selectedMutation", "cleanupMutation"]) {
  const selected = binding[sectionName];
  const learned = learnGlobalCommand({ commandId: selected.commandId, aspects: ["schema", "policy", "transport", "auth"] });
  assert.equal(learned.ok, true, `learn resolves ${selected.commandId}`);
  assert.equal(learned.effect, "write", `${selected.commandId} learned effect`);
  assert.equal(learned.approval, "required", `${selected.commandId} learned approval`);
  assert.equal(learned.transport.runtimeStatus, "shadow", `${selected.commandId} learned runtime status remains shadow`);
  assert.equal(learned.policy.readOnly, false, `${selected.commandId} learned policy is not read-only`);
  assert.equal(learned.auth.required, true, `${selected.commandId} requires auth`);
  assert.equal(learned.auth.orgScoped, true, `${selected.commandId} remains org scoped`);
  assert.ok(learned.inputSchema, `${selected.commandId} learn returns schema only after explicit selection`);
  assert.equal(Object.hasOwn(learned, "trace"), false, "learn endpoint is not an execution receipt");
  assert.equal(Object.hasOwn(learned, "handle"), false, "learn endpoint does not mint resource handles");
}

const destructive = learnGlobalCommand({ commandId: "booking.delete.schedule.rule", aspects: ["policy", "transport", "auth"] });
assert.equal(destructive.ok, true);
assert.equal(destructive.effect, "destructive", "learn reports destructive generated command effect");
assert.equal(destructive.approval, "required", "destructive generated command remains approval-gated");
assert.equal(destructive.transport.runtimeStatus, "shadow", "destructive generated command remains shadow/non-executable");
assert.equal(destructive.policy.readOnly, false);

const generatedWriteOrDestructive = catalog.commands.filter((command) => command.source === "openapi" && ["write", "destructive"].includes(command.effect));
assert.ok(generatedWriteOrDestructive.length > 0, "generated provider fixture includes mutation commands");
for (const command of generatedWriteOrDestructive) {
  assert.equal(command.transport.runtimeStatus, "shadow", `${command.id} generated mutation stays shadow`);
  assert.equal(command.approval, "required", `${command.id} generated mutation requires approval`);
  assert.equal(command.policy.readOnly, false, `${command.id} generated mutation is not read-only`);
}

for (const sectionName of ["selectedMutation", "cleanupMutation"]) {
  const selected = binding[sectionName];
  const descriptor = commandById.get(selected.commandId);
  assert.ok(descriptor, `${selected.commandId} exists in full catalog`);
  const receipt = executeCatalogCommand(catalog, selected.commandId, {}, {
    action: "commit",
    approved: true,
    authenticated: true,
    organizationId: "org_booking_demo",
    scopes: ["booking:read", "booking:write"],
    requestId: `req_phase2_discovery_gate_${sectionName}`,
  });
  assert.equal(receipt.ok, false, `${selected.commandId} is not executable through read-only discovery/catalog helpers`);
  assert.equal(receipt.policy.reasons.includes("runtime_not_mounted:shadow"), true, `${selected.commandId} denies execution because generated registry runtime is shadow`);
  assert.equal(receipt.policy.reasons.includes("orpc_execution_adapter_not_mounted"), true, `${selected.commandId} denies execution because no trusted runtime adapter is mounted`);
}

console.log(JSON.stringify({
  ok: true,
  registryCommands: summary.summary.commandCount,
  contextMatches: holdSearch.contextIndex.totalMatches,
  selectedMutation: binding.selectedMutation.commandId,
  cleanupMutation: binding.cleanupMutation.commandId,
  destructiveProbe: destructive.commandId,
}));

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
