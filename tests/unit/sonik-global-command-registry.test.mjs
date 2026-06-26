import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createGlobalCommandRegistryArtifact,
} from "../../packages/command-generator/src/index.ts";
import {
  createStartupCommandIndex,
  createSurfaceCommandIndex,
  executeCatalogCommand,
  learnCommandDescriptor,
} from "../../packages/tool-contracts/src/index.ts";

const [bookingArtifact, checkedGlobal] = await Promise.all([
  readJson("tests/fixtures/generated/sonik-booking-command-artifacts.generated.json"),
  readJson("tests/fixtures/generated/sonik-global-command-registry.generated.json"),
]);

const normalizedBookingSource = { ...bookingArtifact.source, sourceRepo: "sonik-booking-service" };
const regenerated = createGlobalCommandRegistryArtifact({
  provider: "sonik-global-command-registry",
  generatedAt: bookingArtifact.generatedAt,
  providers: [{
    provider: bookingArtifact.manifest.provider,
    generatedAt: bookingArtifact.generatedAt,
    source: normalizedBookingSource,
    summary: bookingArtifact.summary,
    manifest: bookingArtifact.manifest,
    registry: bookingArtifact.registry,
    catalog: bookingArtifact.catalog,
    projections: bookingArtifact.projections,
  }],
});

assert.deepEqual(JSON.parse(JSON.stringify(regenerated)), checkedGlobal, "global command registry fixture must be deterministic and provider-derived");
assert.equal(checkedGlobal.version, "sonik-agent-ui.global-command-registry.v1");
assert.equal(checkedGlobal.provider, "sonik-global-command-registry");
assert.deepEqual(checkedGlobal.summary, {
  providerCount: 1,
  commandCount: bookingArtifact.summary.commandCount,
  familyCount: bookingArtifact.summary.familyCount,
  toolCount: bookingArtifact.summary.commandCount,
  cliProjectionCount: bookingArtifact.summary.cliProjectionCount,
  mcpProjectionCount: bookingArtifact.summary.mcpProjectionCount,
});
assert.equal(checkedGlobal.providers[0].provider, "sonik-booking-openapi-fixture");
assert.deepEqual(checkedGlobal.providers[0].summary, bookingArtifact.summary, "global registry preserves provider summary provenance");
assert.equal(checkedGlobal.providers[0].source.sourceRepo, "sonik-booking-service", "global registry normalizes local source repo paths before SDK promotion");
assert.equal(checkedGlobal.providers[0].source.sourceRef, bookingArtifact.source.sourceRef, "global registry preserves provider source ref provenance");
assert.equal(checkedGlobal.providers[0].source.sourceSha256, bookingArtifact.source.sourceSha256, "global registry preserves provider source hash provenance");
assert.equal(JSON.stringify(checkedGlobal).includes("/Users/"), false, "global registry must not ship local absolute filesystem paths");

const catalog = checkedGlobal.catalog;
const registry = checkedGlobal.registry;
const commands = catalog.commands;
const commandIds = commands.map((command) => command.id);
assert.equal(new Set(commandIds).size, commands.length, "global registry command ids are unique");
assert.equal(new Set(checkedGlobal.manifest.tools.map((tool) => tool.id)).size, checkedGlobal.manifest.tools.length, "global registry tool ids are unique");
assert.equal(commands.every((command) => command.source === "openapi"), true, "booking provider commands remain generated OpenAPI descriptors");
assert.equal(commands.every((command) => command.transport.runtimeStatus === "shadow"), true, "global registry does not accidentally mount generated ORPC/OpenAPI commands");
assert.equal(commands.every((command) => command.metadata.generated === true), true, "generated provenance remains attached to every command");

const familyIds = new Set(registry.families.map((family) => family.id));
for (const command of commands) assert.equal(familyIds.has(command.familyId), true, `family ${command.familyId} is registered`);
assert.equal(registry.families.every((family) => family.source === "host"), true, "Sonik booking families remain host-owned vocabulary, not core defaults");

const cliProjectionIds = checkedGlobal.projections.cli.commands.map((entry) => entry.commandId);
const mcpProjectionIds = checkedGlobal.projections.mcp.commands.map((entry) => entry.commandId);
assert.equal(new Set(cliProjectionIds).size, cliProjectionIds.length, "CLI projection command ids are unique");
assert.equal(new Set(mcpProjectionIds).size, mcpProjectionIds.length, "MCP projection command ids are unique");
for (const projectionId of [...cliProjectionIds, ...mcpProjectionIds]) assert.equal(commandIds.includes(projectionId), true, `projection ${projectionId} targets a known command`);
assert.equal(checkedGlobal.projections.cli.provider, checkedGlobal.provider, "global CLI projection uses the global provider name");
assert.equal(checkedGlobal.projections.mcp.provider, checkedGlobal.provider, "global MCP projection uses the global provider name");

const startupIndex = createStartupCommandIndex(catalog, { registry, limit: 20 });
assert.deepEqual(startupIndex.commands.map((entry) => entry.id).sort(), ["booking.get.organizer.template", "booking.list.organizer.templates", "booking.ping"], "global startup index remains bounded to eager summaries");
assert.equal(startupIndex.commands.every((entry) => !Object.hasOwn(entry, "input") && !Object.hasOwn(entry, "inputSchemaJson")), true, "global startup index remains schema-free");

const surfaceIndex = createSurfaceCommandIndex(catalog, {
  surface: "booking-admin",
  authenticated: true,
  organizationId: "org_booking",
  scopes: [],
}, { registry, limit: 100 });
assert.equal(surfaceIndex.totalMatches, 71, "global surface index can expose booking commands when booking page context asks for them");
assert.equal(surfaceIndex.commands.every((entry) => !Object.hasOwn(entry, "input") && !Object.hasOwn(entry, "inputSchemaJson")), true, "global surface index remains schema-free");

const learned = learnCommandDescriptor(catalog, "booking.create.booking", ["schema", "policy", "transport", "auth"]);
assert.equal(learned.ok, true);
assert.equal(learned.transport.runtimeStatus, "shadow");
assert.equal(learned.auth.orgScoped, true);
assert.equal(learned.policy.readOnly, false);

const readReceipt = executeCatalogCommand(catalog, "booking.list.contexts", {}, {
  source: "agent-ui",
  requestId: "global-read-shadow",
  authenticated: true,
  organizationId: "org_booking",
  scopes: [],
});
assert.equal(readReceipt.ok, false, "global generated read command remains non-executable until mounted by a runtime adapter");
assert.ok(readReceipt.policy.reasons.includes("runtime_not_mounted:shadow"));
assert.ok(readReceipt.policy.reasons.includes("orpc_execution_adapter_not_mounted"));

const writeReceipt = executeCatalogCommand(catalog, "booking.create.booking", { customerId: "cus_1" }, {
  action: "commit",
  approved: true,
  source: "agent-ui",
  requestId: "global-write-shadow",
  authenticated: true,
  organizationId: "org_booking",
  scopes: [],
});
assert.equal(writeReceipt.ok, false, "global generated write command remains non-executable until mounted by a runtime adapter");
assert.ok(writeReceipt.policy.reasons.includes("runtime_not_mounted:shadow"));

assert.throws(() => createGlobalCommandRegistryArtifact({
  provider: "duplicate-test",
  generatedAt: bookingArtifact.generatedAt,
  providers: [providerArtifact("one", bookingArtifact), providerArtifact("two", bookingArtifact)],
}), /Duplicate global command ids/, "global registry rejects duplicate command ids across providers");

assert.throws(() => createGlobalCommandRegistryArtifact({
  provider: "duplicate-tool-test",
  generatedAt: bookingArtifact.generatedAt,
  providers: [providerArtifact("one", bookingArtifact), renamedProviderArtifact("two", bookingArtifact, { renameTools: false })],
}), /Duplicate global tool ids/, "global registry rejects duplicate tool ids independently from command id collisions");

assert.throws(() => createGlobalCommandRegistryArtifact({
  provider: "family-conflict-test",
  generatedAt: bookingArtifact.generatedAt,
  providers: [providerArtifact("one", bookingArtifact), renamedProviderArtifact("two", bookingArtifact, { familyTitleSuffix: " conflict" })],
}), /Conflicting command family definition/, "global registry rejects conflicting family definitions for the same family id");

assert.throws(() => createGlobalCommandRegistryArtifact({
  provider: "projection-unknown-test",
  generatedAt: bookingArtifact.generatedAt,
  providers: [providerArtifact("projection-bad", bookingArtifact, { breakProjection: true })],
}), /Projection entries reference unknown command ids/, "global registry rejects projection entries that target unknown command ids");

function providerArtifact(provider, artifact, options = {}) {
  const clone = structuredClone({
    provider,
    generatedAt: artifact.generatedAt,
    source: normalizedBookingSource,
    summary: artifact.summary,
    manifest: { ...artifact.manifest, provider },
    registry: { ...artifact.registry, provider },
    catalog: { ...artifact.catalog, provider },
    projections: artifact.projections,
  });
  if (options.breakProjection) clone.projections.cli.commands[0].commandId = "missing.command";
  return clone;
}

function renamedProviderArtifact(provider, artifact, options = {}) {
  const clone = providerArtifact(provider, artifact);
  clone.catalog.commands = clone.catalog.commands.map((command) => ({ ...command, id: `${provider}.${command.id}` }));
  if (options.renameTools !== false) clone.manifest.tools = clone.manifest.tools.map((tool) => ({ ...tool, id: `${provider}.${tool.id}` }));
  clone.projections = Object.fromEntries(Object.entries(clone.projections).map(([target, projection]) => [target, {
    ...projection,
    commands: projection.commands.map((entry) => ({
      ...entry,
      commandId: `${provider}.${entry.commandId}`,
      invocation: { ...entry.invocation, commandId: `${provider}.${entry.invocation.commandId}` },
    })),
  }]));
  if (options.familyTitleSuffix) clone.registry.families[0] = { ...clone.registry.families[0], title: `${clone.registry.families[0].title}${options.familyTitleSuffix}` };
  return clone;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
