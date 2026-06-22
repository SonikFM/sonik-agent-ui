import assert from "node:assert/strict";
import {
  createCliDescriptorSourceManifest,
  generateCommandArtifactsFromOpenApi,
} from "../../packages/command-generator/src/index.ts";
import {
  createCommandCatalog,
  createStartupCommandIndex,
  createSurfaceCommandIndex,
  executeCatalogCommand,
  learnCommandDescriptor,
} from "../../packages/tool-contracts/src/index.ts";
import {
  createComposedCommandCatalog,
  createComposedCommandFamilyRegistry,
  executeHostCatalogCommand,
} from "../../packages/platform-adapters/src/index.ts";

const generatedAt = "2026-06-21T00:00:00.000Z";
const families = [
  { id: "venue", title: "Venues", description: "Venue commands for the host app.", aliases: ["location"], source: "host" },
  { id: "public", title: "Public", description: "Public health and discovery commands.", aliases: [], source: "host" },
  { id: "integration", title: "Integrations", description: "Generic integration commands.", aliases: [], source: "host" },
];

const document = {
  openapi: "3.1.1",
  security: [{ bearerAuth: ["venue:read"] }],
  paths: {
    "/api/v1/venues": {
      get: {
        operationId: "venue.locations.list",
        summary: "List venues",
        description: "List venue records for the active organization.",
        tags: ["venue"],
        responses: { 200: { description: "Venues" } },
        "x-sonik-status": "mounted",
        "x-sonik-adapter": "mounted",
      },
      post: {
        operationId: "venue.locations.create",
        summary: "Create venue",
        description: "Create a venue record.",
        tags: ["venue"],
        security: [{ bearerAuth: ["venue:write"] }],
        requestBody: { required: true },
        responses: { 201: { description: "Venue" } },
      },
    },
    "/api/v1/public/ping": {
      get: {
        operationId: "public.ping.get",
        summary: "Public ping",
        tags: ["public"],
        security: [],
        responses: { 200: { description: "Pong" } },
      },
    },
    "/api/v1/venues/{venueId}": {
      delete: {
        operationId: "venue.locations.delete",
        summary: "Delete venue",
        description: "Delete a venue record.",
        tags: ["venue"],
        security: [{ bearerAuth: ["venue:delete"] }],
        parameters: [{ name: "venueId", in: "path", required: true }],
        responses: { 204: { description: "Deleted" } },
      },
    },
  },
};

const config = {
  provider: "neutral-openapi-fixture",
  sourceAdapter: "openapi",
  generatedAt,
  families,
  defaultFamilyId: "integration",
  defaultRuntimeStatus: "shadow",
  defaultLoadPolicy: { mode: "surface-eager", priority: 30, profile: "fixture" },
  defaultContextHints: { surfaces: ["fixture-surface"], commandFamilies: ["venue"] },
  defaultUiTargets: ["chat", "artifact"],
  tagFamilyMap: { venue: "venue", public: "public" },
  tagCapabilityMap: { venue: ["venue"], public: ["public"] },
  operationOverrides: {
    "venue.locations.list": {
      accessibility: { label: "List venues", description: "List venue records", actionLabel: "List venues" },
      examples: [{ title: "List two venues", input: { limit: 2 } }],
      projection: { cli: { command: "fixture venue list", args: ["--json"] }, mcp: { toolName: "fixture_command_execute" } },
    },
    "public.ping.get": {
      familyId: "public",
      loadPolicy: { mode: "eager-summary", priority: 5, profile: "fixture-public" },
      contextHints: { commandFamilies: ["public"], surfaces: [] },
    },
  },
  projectionTargets: ["cli", "mcp"],
  projectionDefaults: {
    cli: { command: "host-agent command execute", args: ["--id", "{commandId}"] },
    mcp: { toolName: "host_command_execute" },
  },
};

const output = generateCommandArtifactsFromOpenApi({ document, config });
const ids = output.catalog.commands.map((command) => command.id).sort();

assert.equal(output.manifest.version, "sonik-agent-ui.tool-manifest.v1");
assert.equal(output.catalog.version, "sonik-agent-ui.command-catalog.v1");
assert.equal(output.registry.version, "sonik-agent-ui.command-family-registry.v1");
assert.deepEqual(ids, ["public.ping.get", "venue.locations.create", "venue.locations.delete", "venue.locations.list"], "OpenAPI operations project into a complete command catalog");
assert.equal(output.registry.families.some((family) => family.id === "booking"), false, "generator is product-neutral and does not inject booking families");
assert.equal(output.catalog.commands.some((command) => command.capabilities.includes("booking")), false, "generator does not inject booking capabilities");

const list = output.catalog.commands.find((command) => command.id === "venue.locations.list");
const create = output.catalog.commands.find((command) => command.id === "venue.locations.create");
const remove = output.catalog.commands.find((command) => command.id === "venue.locations.delete");
const ping = output.catalog.commands.find((command) => command.id === "public.ping.get");

assert.equal(list.familyId, "venue");
assert.equal(list.effect, "read");
assert.equal(list.approval, "none");
assert.deepEqual(list.auth.scopes, ["venue:read"], "document-level security is inherited");
assert.equal(list.auth.orgScoped, true);
assert.deepEqual(list.metadata.accessibility, { label: "List venues", description: "List venue records", actionLabel: "List venues" });
assert.equal(list.metadata.generated, true);
assert.equal(list.metadata.sourceAdapter, "openapi");
assert.equal(list.metadata.sourceRuntimeStatus, "mounted");
assert.equal(list.metadata.sourceRuntimeAdapter, "mounted");
assert.equal(list.metadata.sourceMounted, true);
assert.equal(list.transport.runtimeStatus, "shadow", "source mounted metadata does not make generated descriptors executable");
assert.equal(list.metadata.familyId, "venue");
assert.equal(list.metadata.loadPolicy.mode, "surface-eager");
assert.deepEqual(list.contextHints.requiredScopes, ["venue:read"]);
assert.deepEqual(list.examples, [{ title: "List two venues", input: { limit: 2 } }]);
assert.equal(list.input.ref, "GET /api/v1/venues request");
assert.equal(list.output.schema.ref, "GET /api/v1/venues responses");

assert.equal(create.effect, "write");
assert.equal(create.approval, "required");
assert.equal(create.policy.readOnly, false);
assert.deepEqual(create.auth.scopes, ["venue:write"]);
assert.equal(remove.effect, "destructive");
assert.equal(remove.approval, "required");
assert.deepEqual(remove.auth.scopes, ["venue:delete"]);
assert.equal(ping.familyId, "public");
assert.equal(ping.auth.required, false, "operation-level empty security array makes the command public");
assert.equal(ping.loadPolicy.mode, "eager-summary");


const safetyDocument = {
  openapi: "3.1.1",
  paths: {
    "/api/v1/risky-list": {
      post: { operationId: "venue.locations.list", summary: "POST list-shaped operation", tags: ["venue"], responses: { 200: { description: "ok" } } },
    },
    "/api/v1/risky-mounted": {
      get: { operationId: "venue.locations.mounted", summary: "Mounted-looking generated operation", tags: ["venue"], "x-command-runtime-status": "mounted", responses: { 200: { description: "ok" } } },
    },
  },
};
const safetyOutput = generateCommandArtifactsFromOpenApi({
  document: safetyDocument,
  config: { ...config, toolSource: "local-ui", defaultRuntimeStatus: "mounted", operationOverrides: { "venue.locations.mounted": { runtimeStatus: "mounted" } } },
});
const postList = safetyOutput.catalog.commands.find((command) => command.id === "venue.locations.list");
const mountedLooking = safetyOutput.catalog.commands.find((command) => command.id === "venue.locations.mounted");
assert.equal(postList.effect, "write", "HTTP POST remains the safe effect floor even when operationId says list");
assert.equal(postList.approval, "required", "HTTP POST remains approval-gated even when operationId says list");
assert.equal(postList.policy.readOnly, false, "HTTP POST generated commands are not read-only");
assert.equal(postList.source, "openapi", "OpenAPI generator ignores local-ui source shortcuts");
assert.equal(mountedLooking.transport.runtimeStatus, "shadow", "OpenAPI generator refuses mounted runtime status shortcuts");
assert.equal(mountedLooking.metadata.sourceRuntimeStatus, "unknown", "x-command-runtime-status does not masquerade as source runtime posture");
assert.equal(executeCatalogCommand(safetyOutput.catalog, "venue.locations.mounted", {}, { source: "agent-ui", requestId: "safety-mounted" }).ok, false, "generated OpenAPI command cannot execute without a runtime adapter even when source/status inputs request shortcuts");

const startupIndex = createStartupCommandIndex(output.catalog, { registry: output.registry, limit: 10 });
assert.deepEqual(startupIndex.commands.map((command) => command.id), ["public.ping.get"], "startup index only exposes eager-summary commands");
assert.equal(Object.hasOwn(startupIndex.commands[0], "input"), false, "indexes stay schema-free");
assert.equal(Object.hasOwn(startupIndex.commands[0], "inputSchemaJson"), false, "indexes never leak schema JSON");

const surfaceIndex = createSurfaceCommandIndex(output.catalog, {
  surface: "fixture-surface",
  authenticated: true,
  organizationId: "org_1",
  scopes: ["venue:read", "venue:write", "venue:delete"],
}, { registry: output.registry, limit: 10 });
assert.deepEqual(surfaceIndex.commands.map((command) => command.id).sort(), ids, "surface eager loading respects context and auth gates");

const learned = learnCommandDescriptor(output.catalog, "venue.locations.list", ["schema", "policy", "transport", "auth"]);
assert.equal(learned.ok, true);
assert.equal(learned.inputSchema.ref, "GET /api/v1/venues request");
assert.equal(learned.transport.runtimeStatus, "shadow", "generated commands are metadata until runtime-mounted");
assert.deepEqual(learned.auth.scopes, ["venue:read"]);

const dryReceipt = executeCatalogCommand(output.catalog, "venue.locations.list", { limit: 1 }, {
  source: "agent-ui",
  requestId: "dry-read",
  authenticated: true,
  organizationId: "org_1",
  scopes: ["venue:read"],
});
assert.equal(dryReceipt.ok, false, "generated OpenAPI commands do not execute without a mounted runtime adapter");
assert.ok(dryReceipt.policy.reasons.includes("runtime_not_mounted:shadow"));
assert.ok(dryReceipt.policy.reasons.includes("orpc_execution_adapter_not_mounted"));

const baseCatalog = createCommandCatalog("empty-base", [], generatedAt);
const hostAdapter = { provider: "generated-host", families: output.registry.families.filter((family) => family.id !== "integration"), commands: output.catalog.commands };
const composedCatalog = createComposedCommandCatalog("composed-generator-test", baseCatalog, [hostAdapter], generatedAt);
const composedRegistry = createComposedCommandFamilyRegistry("composed-generator-test", [hostAdapter], generatedAt);
assert.equal(composedCatalog.commands.length, output.catalog.commands.length, "generated catalog composes through host adapter seam");
assert.equal(composedRegistry.families.some((family) => family.id === "venue"), true, "generated families compose through host adapter seam");

const readRuntimeReceipt = await executeHostCatalogCommand({
  catalog: output.catalog,
  commandId: "venue.locations.list",
  commandInput: { limit: 2 },
  execution: { source: "agent-ui", requestId: "runtime-read", authenticated: true, organizationId: "org_1", scopes: ["venue:read"] },
  runtimeAdapters: [{
    provider: "generated-read-runtime",
    bindings: [{
      commandId: "venue.locations.list",
      status: "mounted-read",
      execute: (input, context) => ({ summary: { ok: true, input, runtimeStatus: context.command.metadata.runtimeStatus }, nextActions: ["learnCommand"] }),
    }],
  }],
});
assert.equal(readRuntimeReceipt.ok, true, "runtime adapter can mount generated read command without changing the descriptor");
assert.equal(readRuntimeReceipt.summary.runtimeStatus, "mounted-read");

const writeExecuteReceipt = await executeHostCatalogCommand({
  catalog: output.catalog,
  commandId: "venue.locations.create",
  commandInput: { name: "New Venue" },
  execution: { source: "agent-ui", requestId: "runtime-write-execute", authenticated: true, organizationId: "org_1", scopes: ["venue:write"] },
  runtimeAdapters: [{ provider: "generated-write-runtime", bindings: [{ commandId: "venue.locations.create", status: "mounted-write", commit: () => ({ summary: { ok: true } }) }] }],
});
assert.equal(writeExecuteReceipt.ok, false, "mutation commands cannot run through execute action");
assert.ok(writeExecuteReceipt.policy.reasons.includes("runtime_not_mounted_for_execute"));

const writeNeedsApproval = await executeHostCatalogCommand({
  catalog: output.catalog,
  commandId: "venue.locations.create",
  commandInput: { name: "New Venue" },
  execution: { action: "commit", source: "agent-ui", requestId: "runtime-write-needs-approval", authenticated: true, organizationId: "org_1", scopes: ["venue:write"] },
  runtimeAdapters: [{ provider: "generated-write-runtime", bindings: [{ commandId: "venue.locations.create", status: "mounted-write", commit: () => ({ summary: { ok: true } }) }] }],
});
assert.equal(writeNeedsApproval.ok, false, "mutation commit requires explicit approval");
assert.equal(writeNeedsApproval.policy.decision, "needs_approval");
assert.ok(writeNeedsApproval.nextActions.includes("commitCommand"));

const writeCommitReceipt = await executeHostCatalogCommand({
  catalog: output.catalog,
  commandId: "venue.locations.create",
  commandInput: { name: "New Venue" },
  execution: { action: "commit", approved: true, source: "agent-ui", requestId: "runtime-write-commit", authenticated: true, organizationId: "org_1", scopes: ["venue:write"] },
  runtimeAdapters: [{
    provider: "generated-write-runtime",
    bindings: [{
      commandId: "venue.locations.create",
      status: "mounted-write",
      commit: (input) => ({ summary: { ok: true, input }, resources: [{ uri: "venue://new", title: "New Venue" }], handle: "venue:new" }),
    }],
  }],
});
assert.equal(writeCommitReceipt.ok, true, "approved commit can pass through a mounted host runtime adapter");
assert.equal(writeCommitReceipt.handle, "venue:new");

assert.equal(output.projections.cli.version, "sonik-agent-ui.command-projection.v1");
const listCliProjection = output.projections.cli.commands.find((command) => command.commandId === "venue.locations.list");
assert.equal(listCliProjection.invocation.kind, "catalog-command");
assert.equal(listCliProjection.invocation.executeTool, "executeCommand");
assert.deepEqual(listCliProjection.invocation.cli, { command: "fixture venue list", args: ["--json"] }, "CLI projections are explicit descriptor metadata, not inferred shell commands");
const createCliProjection = output.projections.cli.commands.find((command) => command.commandId === "venue.locations.create");
assert.deepEqual(createCliProjection.invocation.cli, { command: "host-agent command execute", args: ["--id", "venue.locations.create"] });
const listMcpProjection = output.projections.mcp.commands.find((command) => command.commandId === "venue.locations.list");
assert.equal(listMcpProjection.invocation.mcp.toolName, "fixture_command_execute");
assert.equal(listMcpProjection.provenance.sourceAdapter, "openapi");
assert.equal(output.projections.cli.commands.find((entry) => entry.commandId === "venue.locations.list").provenance.sourceRuntimeStatus, "mounted");

const cliDescriptor = createCliDescriptorSourceManifest({
  provider: "cli-source-fixture",
  generatedAt,
  families: [families[0]],
  commands: [{
    ...list,
    source: "local-ui",
    metadata: { ...list.metadata, sourceAdapter: "cli-descriptor", familyId: "venue", loadPolicy: list.loadPolicy, contextHints: list.contextHints, projection: undefined },
  }],
});
assert.equal(cliDescriptor.catalog.commands[0].id, "venue.locations.list");
assert.equal(cliDescriptor.projection.commands[0].invocation.kind, "catalog-command");
assert.deepEqual(cliDescriptor.projection.commands[0].invocation.cli, { command: "agent-command execute", args: ["--command-id", "venue.locations.list"] });

assert.throws(() => generateCommandArtifactsFromOpenApi({ document, config: { ...config, families: [families[0], families[0]] } }), /Duplicate command family ids/);
assert.throws(() => generateCommandArtifactsFromOpenApi({ document, config: { ...config, families: [families[1]], tagFamilyMap: { venue: "venue" } } }), /Unknown generated command family id: venue/);
assert.throws(() => generateCommandArtifactsFromOpenApi({ document, config: { ...config, sourceAdapter: "orpc" } }), /Unsupported source adapter/);
