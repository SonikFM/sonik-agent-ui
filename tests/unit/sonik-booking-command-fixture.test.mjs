import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateCommandArtifactsFromOpenApi } from "../../packages/command-generator/src/index.ts";
import {
  createStartupCommandIndex,
  createSurfaceCommandIndex,
  executeCatalogCommand,
  learnCommandDescriptor,
} from "../../packages/tool-contracts/src/index.ts";

const [document, config, checkedFixture] = await Promise.all([
  readJson("tests/fixtures/sonik-booking/booking-openapi.fixture.json"),
  readJson("tests/fixtures/sonik-booking/generator.config.json"),
  readJson("tests/fixtures/generated/sonik-booking-command-artifacts.generated.json"),
]);

const generated = generateCommandArtifactsFromOpenApi({ document, config });
const operationCount = Object.values(document.paths ?? {}).reduce((count, pathItem) => count + Object.keys(pathItem ?? {}).filter((method) => ["get", "post", "put", "patch", "delete", "head", "options"].includes(method.toLowerCase())).length, 0);
const regeneratedFixture = {
  version: checkedFixture.version,
  generatedAt: config.generatedAt,
  source: document["x-fixture-provenance"],
  summary: {
    operationCount,
    commandCount: generated.catalog.commands.length,
    familyCount: generated.registry.families.length,
    cliProjectionCount: generated.projections.cli?.commands.length ?? 0,
    mcpProjectionCount: generated.projections.mcp?.commands.length ?? 0,
  },
  manifest: generated.manifest,
  registry: generated.registry,
  catalog: generated.catalog,
  projections: generated.projections,
};

assert.deepEqual(JSON.parse(JSON.stringify(regeneratedFixture)), checkedFixture, "checked Sonik booking command artifact fixture must be generator-derived and deterministic");
assert.equal(operationCount, 71, "fixture represents the real branch OpenAPI operation count");
assert.equal(checkedFixture.summary.commandCount, 71);
assert.equal(checkedFixture.summary.familyCount, 12);
assert.equal(checkedFixture.source.sourceRef, "emdash/major-schools-raise-3zsc2");
assert.equal(checkedFixture.source.sourceSha256, "5baf5b0a9588fea0c0349ca3fe1f25342b29c342d0cb749607acfd913ae8060f");

const catalog = checkedFixture.catalog;
const registry = checkedFixture.registry;
const commands = catalog.commands;
const ids = new Set(commands.map((command) => command.id));
assert.equal(ids.size, commands.length, "generated command ids are unique");
for (const id of [
  "booking.ping",
  "booking.list.contexts",
  "booking.create.booking",
  "booking.delete.media.asset",
  "booking.list.organizer.templates",
  "booking.project.event.context",
]) {
  assert.equal(ids.has(id), true, `expected generated command ${id}`);
}

assert.equal(commands.every((command) => command.source === "openapi"), true, "booking fixture commands remain OpenAPI metadata, not local UI tools");
assert.equal(commands.every((command) => command.transport.runtimeStatus === "shadow"), true, "booking fixture commands are non-executable until host runtime mounting");
assert.equal(commands.every((command) => command.metadata.generated === true && command.metadata.sourceAdapter === "openapi" && typeof command.metadata.sourceOperationId === "string"), true, "every command records generated provenance");
const sourcePostureCounts = commands.reduce((counts, command) => {
  counts[command.metadata.sourceRuntimeStatus] = (counts[command.metadata.sourceRuntimeStatus] ?? 0) + 1;
  return counts;
}, {});
assert.deepEqual(sourcePostureCounts, { mounted: 50, shadow: 21 }, "generated commands preserve source service mounted/shadow posture separately from executable runtime status");
assert.equal(commands.some((command) => command.familyId === "booking-media"), true, "host config can inject product families outside core");
assert.equal(registry.families.every((family) => family.source === "host"), true, "Sonik booking families are host-provided");

const ping = command("booking.ping");
const createBooking = command("booking.create.booking");
const deleteMedia = command("booking.delete.media.asset");
const listTemplates = command("booking.list.organizer.templates");
assert.equal(ping.auth.required, false, "public OpenAPI security remains public");
assert.equal(ping.metadata.sourceRuntimeStatus, "mounted");
assert.equal(ping.metadata.sourceRuntimeAdapter, "mounted");
assert.equal(ping.metadata.sourceMounted, true);
assert.equal(command("booking.search.customers").metadata.sourceRuntimeStatus, "shadow", "future customer contracts remain marked as source shadow");
assert.equal(listTemplates.auth.required, false, "public template endpoints remain public");
assert.equal(createBooking.auth.required, true, "Better Auth session operations require auth");
assert.equal(createBooking.auth.orgScoped, true, "authenticated booking operations remain org-scoped");
assert.equal(createBooking.effect, "write");
assert.equal(createBooking.approval, "required");
assert.equal(createBooking.policy.readOnly, false);
assert.equal(deleteMedia.effect, "destructive");
assert.equal(deleteMedia.approval, "required");
assert.equal(deleteMedia.policy.readOnly, false);

const startupIndex = createStartupCommandIndex(catalog, { registry, limit: 10 });
assert.deepEqual(startupIndex.commands.map((entry) => entry.id).sort(), ["booking.get.organizer.template", "booking.list.organizer.templates", "booking.ping"], "startup index only includes public eager summaries");
assert.equal(startupIndex.commands.every((entry) => !Object.hasOwn(entry, "input") && !Object.hasOwn(entry, "inputSchemaJson")), true, "startup command index remains schema-free");

const surfaceIndex = createSurfaceCommandIndex(catalog, {
  surface: "booking-admin",
  authenticated: true,
  organizationId: "org_booking",
  scopes: [],
}, { registry, limit: 100 });
assert.equal(surfaceIndex.totalMatches, 71, "authenticated booking-admin surface can see the generated booking catalog");
assert.equal(surfaceIndex.commands.every((entry) => !Object.hasOwn(entry, "input") && !Object.hasOwn(entry, "inputSchemaJson")), true, "surface command index remains schema-free");

const learned = learnCommandDescriptor(catalog, "booking.create.booking", ["schema", "policy", "transport", "auth", "surfaces"]);
assert.equal(learned.ok, true);
assert.equal(learned.inputSchema.ref, "POST /api/v1/booking/bookings request");
assert.equal(learned.transport.path, "/api/v1/booking/bookings");
assert.equal(learned.transport.runtimeStatus, "shadow");
assert.equal(learned.auth.required, true);
assert.equal(learned.policy.readOnly, false);
assert.deepEqual(learned.surfaces, ["chat", "artifact"]);

const readReceipt = executeCatalogCommand(catalog, "booking.list.contexts", {}, {
  source: "agent-ui",
  requestId: "booking-read-shadow",
  authenticated: true,
  organizationId: "org_booking",
  scopes: [],
});
assert.equal(readReceipt.ok, false, "read commands from generated booking OpenAPI do not execute without a runtime adapter");
assert.ok(readReceipt.policy.reasons.includes("runtime_not_mounted:shadow"));
assert.ok(readReceipt.policy.reasons.includes("orpc_execution_adapter_not_mounted"));

const writeReceipt = executeCatalogCommand(catalog, "booking.create.booking", { customerId: "cus_1" }, {
  action: "commit",
  approved: true,
  source: "agent-ui",
  requestId: "booking-write-shadow",
  authenticated: true,
  organizationId: "org_booking",
  scopes: [],
});
assert.equal(writeReceipt.ok, false, "approved writes still do not execute until a host runtime adapter is mounted");
assert.ok(writeReceipt.policy.reasons.includes("runtime_not_mounted:shadow"));

const createBookingCli = checkedFixture.projections.cli.commands.find((entry) => entry.commandId === "booking.create.booking");
assert.equal(createBookingCli.invocation.kind, "catalog-command");
assert.equal(createBookingCli.invocation.executeTool, "executeCommand");
assert.equal(createBookingCli.invocation.commitTool, "commitCommand");
assert.deepEqual(createBookingCli.invocation.cli, { command: "sonik booking command execute", args: ["--command-id", "booking.create.booking"] });
const createBookingMcp = checkedFixture.projections.mcp.commands.find((entry) => entry.commandId === "booking.create.booking");
assert.equal(createBookingMcp.invocation.mcp.toolName, "sonik_booking_command_execute");
assert.equal(createBookingMcp.provenance.sourceAdapter, "openapi");

function command(id) {
  const found = commands.find((entry) => entry.id === id);
  assert.ok(found, `Missing command ${id}`);
  return found;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
