import assert from "node:assert/strict";
import {
  createCommandCatalog,
  createCommandFamilyRegistry,
  createDefaultCommandFamilyRegistry,
  createStartupCommandIndex,
  createSurfaceCommandIndex,
  createCommandCatalogFromToolManifest,
  executeCatalogCommand,
  learnCommandDescriptor,
  searchCommandCatalog,
  searchCommandCatalogWithMetadata,
  createToolManifest,
  evaluateToolPolicy,
  filterAvailableTools,
  inferEffectFromHttpMethod,
  inferEffectFromProcedureId,
  isValidOrpcProcedureId,
} from "../../packages/tool-contracts/src/index.ts";
import {
  createManifestFromOpenApiDocument,
  createSonikBookingManifestFromOpenApiDocument,
  createStandaloneCommandFamilyRegistry,
  createStandaloneCommandCatalog,
  createStandaloneStartupCommandIndex,
  createStandaloneSurfaceCommandIndex,
  createStandaloneToolManifest,
} from "../../packages/platform-adapters/src/index.ts";
import {
  createStandaloneAvailableToolManifest,
  createStandaloneCommandIndexSummary,
} from "../../apps/standalone-sveltekit/src/lib/server/tool-manifest.ts";

assert.equal(inferEffectFromHttpMethod("GET"), "read");
assert.equal(inferEffectFromHttpMethod("POST"), "write");
assert.equal(inferEffectFromHttpMethod("DELETE"), "destructive");
assert.equal(inferEffectFromProcedureId("booking.contexts.list"), "read");
assert.equal(inferEffectFromProcedureId("booking.contexts.create"), "write");
assert.equal(inferEffectFromProcedureId("booking.contexts.delete"), "destructive");
assert.equal(isValidOrpcProcedureId("booking.contexts.list"), true);
assert.equal(isValidOrpcProcedureId("GET /api/v1/booking/contexts"), false, "ORPC procedure ids must not be arbitrary endpoint strings");
assert.equal(isValidOrpcProcedureId("https://api.sonik.fm/rpc"), false, "ORPC procedure ids must not be URLs");

const mixedManifest = createToolManifest("policy-test", [
  {
    id: "booking.contexts.list",
    source: "orpc",
    title: "List contexts",
    description: "Read contexts",
    effect: "read",
    approval: "none",
    uiTargets: ["chat"],
    capabilities: ["booking"],
    input: { kind: "unknown" },
    output: { kind: "unknown" },
    auth: { required: true, scopes: ["booking:read"], orgScoped: true },
    transport: { procedure: "booking.contexts.list", runtimeStatus: "mounted" },
    metadata: {},
  },
  {
    id: "booking.contexts.create",
    source: "orpc",
    title: "Create context",
    description: "Write context",
    effect: "write",
    approval: "required",
    uiTargets: ["none"],
    capabilities: ["booking"],
    input: { kind: "unknown" },
    output: { kind: "unknown" },
    auth: { required: true, scopes: ["booking:write"], orgScoped: true },
    transport: { procedure: "booking.contexts.create", runtimeStatus: "mounted" },
    metadata: {},
  },
  {
    id: "GET /api/v1/booking/contexts",
    source: "orpc",
    title: "Bad ORPC endpoint string",
    description: "Should be denied",
    effect: "read",
    approval: "none",
    uiTargets: ["chat"],
    capabilities: [],
    input: { kind: "unknown" },
    output: { kind: "unknown" },
    auth: { required: false, scopes: [], orgScoped: false },
    transport: { procedure: "GET /api/v1/booking/contexts", runtimeStatus: "mounted" },
    metadata: {},
  },
  {
    id: "sandbox.shell.run",
    source: "sandbox",
    title: "Run shell",
    description: "Environment-state command",
    effect: "environment",
    approval: "required",
    uiTargets: ["terminal"],
    capabilities: ["shell"],
    input: { kind: "unknown" },
    output: { kind: "unknown" },
    auth: { required: false, scopes: [], orgScoped: false },
    transport: { runtimeStatus: "mounted" },
    metadata: {},
  },
]);

assert.equal(evaluateToolPolicy(mixedManifest.tools[2]).decision, "deny", "endpoint-shaped ORPC ids are denied");
assert.equal(evaluateToolPolicy(mixedManifest.tools[1], {
  authenticated: true,
  organizationId: "org_1",
  scopes: ["booking:write"],
  includeApprovalRequired: true,
}).decision, "approval_required", "write-like ORPC procedures are approval-gated when mutations are not enabled");

const anonymousOrpc = filterAvailableTools(mixedManifest, { sourceMode: "orpc-app-state", includeApprovalRequired: true });
assert.deepEqual(anonymousOrpc.tools.map((tool) => tool.id), [], "unauthenticated org-scoped ORPC tools are filtered out");

const authenticatedOrpc = filterAvailableTools(mixedManifest, {
  sourceMode: "orpc-app-state",
  authenticated: true,
  organizationId: "org_1",
  scopes: ["booking:read", "booking:write"],
  includeApprovalRequired: true,
});
assert.deepEqual(authenticatedOrpc.tools.map((tool) => tool.id), ["booking.contexts.list", "booking.contexts.create"], "ORPC app-state manifest excludes bad endpoint ids and sandbox tools");
assert.equal(authenticatedOrpc.tools.find((tool) => tool.id === "booking.contexts.create")?.approval, "required");

const openApiManifest = createManifestFromOpenApiDocument({
  provider: "booking-openapi-test",
  source: "orpc",
  document: {
    openapi: "3.1.1",
    security: [{ bearerAuth: ["booking:read"] }],
    paths: {
      "/api/v1/booking/contexts": {
        get: { operationId: "booking.contexts.list", summary: "List contexts", "x-sonik-status": "mounted", "x-sonik-adapter": "mounted" },
        post: { operationId: "booking.contexts.create", summary: "Create context", security: [{ bearerAuth: ["booking:write"] }], "x-sonik-status": "mounted", "x-sonik-adapter": "mounted" },
      },
      "/api/v1/booking/ping": {
        get: { operationId: "booking.ping.get", summary: "Public ping", security: [], "x-sonik-status": "mounted", "x-sonik-adapter": "mounted" },
      },
      "/api/v1/booking/customers": {
        get: { operationId: "booking.customers.search", summary: "Search customers", security: [{}], "x-sonik-status": "shadow", "x-sonik-adapter": "not-mounted" },
      },
    },
  },
});
assert.deepEqual(openApiManifest.tools.map((tool) => `${tool.id}:${tool.effect}:${tool.approval}:${tool.auth.required}:${tool.auth.scopes.join("+")}`), [
  "booking.contexts.list:read:none:true:booking:read",
  "booking.contexts.create:write:required:true:booking:write",
  "booking.ping.get:read:none:false:",
]);
const anonymousInheritedSecurity = filterAvailableTools(openApiManifest, { sourceMode: "orpc-app-state", includeApprovalRequired: true });
assert.deepEqual(anonymousInheritedSecurity.tools.map((tool) => tool.id), ["booking.ping.get"], "document-level OpenAPI security must be inherited unless operation security is explicitly public");
assert.equal(createSonikBookingManifestFromOpenApiDocument({ paths: {} }).provider, "sonik-booking-openapi");

const standalone = createStandaloneToolManifest({ sessionId: "s1" });
assert.equal(standalone.tools.some((tool) => tool.id === "createJsonArtifact" && tool.source === "local-ui"), true);
assert.equal(standalone.tools.some((tool) => tool.id === "booking.contexts.list" && tool.source === "orpc"), true);

const standaloneOrpc = createStandaloneAvailableToolManifest({ sourceMode: "orpc-app-state", includeApprovalRequired: true });
assert.deepEqual(standaloneOrpc.tools, [], "standalone ORPC mock does not expose org-scoped tools before host auth/org context is injected");
const standaloneLocal = createStandaloneAvailableToolManifest({ sourceMode: "local-ui", includeApprovalRequired: true });
assert.equal(standaloneLocal.tools.some((tool) => tool.id === "createDocumentArtifact" && tool.approval === "required"), true);

const commandCatalog = createCommandCatalogFromToolManifest(standalone);
assert.equal(commandCatalog.version, "sonik-agent-ui.command-catalog.v1");
assert.equal(commandCatalog.commands.some((command) => command.id === "createJsonArtifact" && command.source === "local-ui"), true, "local UI artifact command should project into command catalog");
assert.equal(commandCatalog.commands.find((command) => command.id === "booking.contexts.list")?.transport.runtimeStatus, "shadow", "ORPC mock remains metadata/shadow in command catalog");
assert.equal(commandCatalog.commands.find((command) => command.id === "createJsonArtifact")?.familyId, "artifact", "artifact tools infer a product-neutral core family");
assert.equal(commandCatalog.commands.find((command) => command.id === "createDocumentArtifact")?.familyId, "document", "document tools infer a product-neutral core family");
assert.equal(commandCatalog.commands.find((command) => command.id === "booking.contexts.list")?.familyId, "integration", "mock ORPC booking remains generic integration in the standalone core");

const defaultFamilyRegistry = createDefaultCommandFamilyRegistry("2026-06-20T00:00:00.000Z");
assert.equal(defaultFamilyRegistry.families.some((family) => family.id === "campaign"), false, "core family registry must not hardcode Sonik or client families");
assert.equal(createStandaloneCommandFamilyRegistry("2026-06-20T00:00:00.000Z").families.some((family) => family.id === "artifact"), true, "standalone adapter exposes the core family registry");

const startupIndex = createStartupCommandIndex(commandCatalog, { registry: defaultFamilyRegistry, limit: 3 });
assert.equal(startupIndex.version, "sonik-agent-ui.command-index.v1", "startup command index should carry a version discriminator");
assert.equal(startupIndex.commands.length, 3, "startup index should honor a bounded limit");
assert.equal(startupIndex.truncated, true, "startup index should report truncation");
assert.equal(startupIndex.commands.every((command) => command.loadPolicy.mode === "eager-summary"), true, "startup index should only include eager summaries");
assert.equal(startupIndex.commands.every((command) => !Object.hasOwn(command, "input") && !Object.hasOwn(command, "inputSchemaJson")), true, "startup index should be schema-free");
assert.equal(startupIndex.families.every((family) => ["artifact", "document", "ui", "integration", "data", "sandbox"].includes(family.id)), true, "startup index should only reference registered core families");

const standaloneStartupIndex = createStandaloneStartupCommandIndex({ sessionId: "s-index" }, "2026-06-20T00:00:00.000Z");
assert.equal(standaloneStartupIndex.commands.some((command) => command.id === "createJsonArtifact"), true, "standalone startup index includes core artifact creation summary");
assert.equal(createStandaloneStartupCommandIndex({ sessionId: "s-index" }, "2026-06-20T00:00:00.000Z", { limit: 1 }).commands.length, 1, "standalone adapter owns bounded startup index assembly");
const standaloneCommandIndexSummary = createStandaloneCommandIndexSummary({ sessionId: "s-index", indexLimit: 4 });
assert.equal(standaloneCommandIndexSummary.includes("Command index standalone-local"), true, "standalone command index summary should be available for server prompt context");
assert.equal(standaloneCommandIndexSummary.includes("Use searchCommandCatalog"), true, "standalone command index summary should direct lazy discovery");
assert.equal(standaloneCommandIndexSummary.includes("inputSchema"), false, "standalone command index summary should stay schema-free");

const campaignCommand = {
  ...commandCatalog.commands.find((command) => command.id === "createJsonArtifact"),
  id: "campaign.launch",
  title: "Launch campaign",
  description: "Host-provided campaign launch command.",
  familyId: "campaign",
  source: "orpc",
  effect: "write",
  approval: "required",
  loadPolicy: { mode: "surface-eager", priority: 50, profile: "sonik" },
  contextHints: {
    routes: ["/campaigns/new"],
    surfaces: ["campaign-wizard"],
    pageTypes: [],
    artifactTypes: [],
    skillFamilies: ["campaign-authoring"],
    commandFamilies: ["campaign"],
    requiredScopes: ["campaign:send"],
  },
  capabilities: ["campaign", "launch", "send"],
  transport: { procedure: "campaign.launch", runtimeStatus: "shadow" },
  auth: { required: true, orgScoped: true, scopes: ["campaign:send"] },
  metadata: { liveExecution: false },
};
const campaignCatalog = createCommandCatalog("host-campaign-test", [campaignCommand], "2026-06-20T00:00:00.000Z");
assert.throws(() => createStartupCommandIndex(campaignCatalog, { registry: defaultFamilyRegistry }), /Unknown command family ids: campaign/, "host-only family drift should be rejected unless the active host registry defines it");
const hostFamilyRegistry = createCommandFamilyRegistry("host-test", [
  ...defaultFamilyRegistry.families,
  { id: "campaign", title: "Campaigns", aliases: ["marketing"], source: "host" },
], "2026-06-20T00:00:00.000Z");
const unmatchedSurfaceIndex = createSurfaceCommandIndex(campaignCatalog, { surface: "event-create" }, { registry: hostFamilyRegistry });
assert.deepEqual(unmatchedSurfaceIndex.commands, [], "surface-eager host command should not load on an unrelated surface");
const scopedOutSurfaceIndex = createSurfaceCommandIndex(campaignCatalog, { surface: "campaign-wizard" }, { registry: hostFamilyRegistry });
assert.deepEqual(scopedOutSurfaceIndex.commands, [], "surface-eager host command should not load until required context scopes are present");
const matchedSurfaceIndex = createSurfaceCommandIndex(campaignCatalog, { surface: "campaign-wizard", scopes: ["campaign:send"] }, { registry: hostFamilyRegistry });
assert.deepEqual(matchedSurfaceIndex.commands.map((command) => command.id), ["campaign.launch"], "surface-eager host command should load for matching page/surface context");
assert.equal(matchedSurfaceIndex.commands.every((command) => !Object.hasOwn(command, "input") && !Object.hasOwn(command, "inputSchemaJson")), true, "surface index should also be schema-free");
const matchedByFamilyIndex = createSurfaceCommandIndex(campaignCatalog, { commandFamilies: ["campaign"], scopes: ["campaign:send"] }, { registry: hostFamilyRegistry });
assert.deepEqual(matchedByFamilyIndex.commands.map((command) => command.id), ["campaign.launch"], "surface index should support page-provided command family hints");

const lazySearch = searchCommandCatalog(commandCatalog, "weather");
assert.equal(lazySearch.some((command) => command.id === "getWeather"), true, "lazy commands should remain discoverable through catalog search");
const hiddenCatalog = createCommandCatalog("hidden-test", [{
  ...commandCatalog.commands.find((command) => command.id === "getWeather"),
  id: "hidden.secret",
  title: "Hidden secret",
  loadPolicy: { mode: "hidden", priority: 100 },
}]);
assert.equal(searchCommandCatalog(hiddenCatalog, "secret").length, 0, "hidden commands should not appear in standard catalog search");

const standaloneSurfaceIndex = createStandaloneSurfaceCommandIndex({ sessionId: "s-index" }, { surface: "canvas" }, "2026-06-20T00:00:00.000Z");
assert.equal(standaloneSurfaceIndex.commands.some((command) => command.familyId === "artifact"), true, "standalone surface index composes catalog and core family registry");

const catalogSearch = searchCommandCatalog(commandCatalog, "document");
assert.equal(catalogSearch.some((command) => command.id === "createDocumentArtifact"), true, "catalog search should find commands by user-language/capability terms");
assert.equal(catalogSearch.every((command) => command.id && command.title && !Object.hasOwn(command, "inputSchemaJson")), true, "catalog search should stay compact and not return full schema detail");
const cappedCatalogSearch = searchCommandCatalogWithMetadata(commandCatalog, "", 3);
assert.equal(cappedCatalogSearch.commands.length, 3, "catalog search should cap broad searches by defaultable limit");
assert.equal(cappedCatalogSearch.truncated, true, "catalog search should report truncation for broad catalogs");
assert.equal(cappedCatalogSearch.totalMatches, commandCatalog.commands.length, "catalog search should report total matches separately from returned commands");

const learnedDocument = learnCommandDescriptor(commandCatalog, "createDocumentArtifact", ["schema", "examples", "policy", "output", "surfaces", "transport", "auth"]);
assert.equal(learnedDocument.ok, true);
assert.equal(learnedDocument.commandId, "createDocumentArtifact");
assert.equal(learnedDocument.policy.readOnly, false, "write-like document command should not be read-only");
assert.deepEqual(learnedDocument.surfaces, ["document", "canvas"]);
assert.equal(learnedDocument.transport.runtimeStatus, "mounted");

const executeReadReceipt = executeCatalogCommand(commandCatalog, "getWeather", { city: "Bogota" }, { source: "agent-ui", requestId: "req_read" });
assert.equal(executeReadReceipt.ok, true, "mounted local read commands can execute through catalog bridge");
assert.equal(executeReadReceipt.commandId, "getWeather");
assert.equal(executeReadReceipt.policy.decision, "allow");
assert.equal(executeReadReceipt.trace.requestId, "req_read");

const executeWriteReceipt = executeCatalogCommand(commandCatalog, "createJsonArtifact", { title: "Demo" }, { source: "agent-ui", requestId: "req_write" });
assert.equal(executeWriteReceipt.ok, false, "write commands must not execute through read execute path");
assert.equal(executeWriteReceipt.policy.decision, "needs_approval");
assert.equal(executeWriteReceipt.policy.reasons.includes("use_commit_for_mutation_command"), true);

const commitWithoutApproval = executeCatalogCommand(commandCatalog, "createJsonArtifact", { title: "Demo" }, { action: "commit", source: "agent-ui", requestId: "req_commit_no" });
assert.equal(commitWithoutApproval.ok, false, "approval-gated command cannot commit without approval");
assert.equal(commitWithoutApproval.policy.decision, "needs_approval");

const commitWithApproval = executeCatalogCommand(commandCatalog, "createJsonArtifact", { title: "Demo" }, { action: "commit", source: "agent-ui", approved: true, requestId: "req_commit_yes" });
assert.equal(commitWithApproval.ok, true, "approved mounted local UI command can commit through catalog bridge dry-run receipt");
assert.equal(commitWithApproval.summary.dryRun, true, "catalog commit is a dry-run receipt until a live local executor is bound");

const orpcExecutionReceipt = executeCatalogCommand(commandCatalog, "booking.contexts.list", {}, { source: "agent-ui", requestId: "req_orpc" });
assert.equal(orpcExecutionReceipt.ok, false, "ORPC command remains non-executable until live adapter is mounted");
assert.equal(orpcExecutionReceipt.policy.reasons.includes("orpc_execution_adapter_not_mounted"), true);

const liveOrpcCommand = commandCatalog.commands.find((command) => command.id === "booking.contexts.list");
assert.ok(liveOrpcCommand);
const liveOrpcCatalog = createCommandCatalog("live-orpc-test", [{
  ...liveOrpcCommand,
  transport: { procedure: "booking.contexts.list", runtimeStatus: "mounted" },
  metadata: { liveExecution: true },
}]);
const unauthenticatedLiveOrpc = executeCatalogCommand(liveOrpcCatalog, "booking.contexts.list", {}, { source: "agent-ui", requestId: "req_live_orpc_no_auth" });
assert.equal(unauthenticatedLiveOrpc.ok, false, "live ORPC execution still requires auth/org/scope context");
assert.equal(unauthenticatedLiveOrpc.policy.reasons.includes("auth_required"), true);
assert.equal(unauthenticatedLiveOrpc.policy.reasons.includes("organization_required"), true);
assert.equal(unauthenticatedLiveOrpc.policy.reasons.includes("missing_scopes:booking:read"), true);
const authenticatedLiveOrpc = executeCatalogCommand(liveOrpcCatalog, "booking.contexts.list", {}, {
  source: "agent-ui",
  requestId: "req_live_orpc_auth",
  authenticated: true,
  organizationId: "org_1",
  scopes: ["booking:read"],
});
assert.equal(authenticatedLiveOrpc.ok, true, "mounted live ORPC read can execute only after auth/org/scope context passes");

const sandboxTool = mixedManifest.tools.find((tool) => tool.id === "sandbox.shell.run");
assert.ok(sandboxTool);
const sandboxCatalog = createCommandCatalogFromToolManifest(createToolManifest("sandbox-test", [sandboxTool]));
const sandboxExecutionReceipt = executeCatalogCommand(sandboxCatalog, "sandbox.shell.run", { command: "pwd" }, { source: "agent-ui", requestId: "req_sandbox" });
assert.equal(sandboxExecutionReceipt.ok, false, "sandbox commands are denied unless sandbox execution is explicitly enabled by trusted host context");
assert.equal(sandboxExecutionReceipt.policy.reasons.includes("sandbox_execution_not_enabled"), true);
const sandboxCommitReceipt = executeCatalogCommand(sandboxCatalog, "sandbox.shell.run", { command: "pwd" }, { action: "commit", source: "agent-ui", requestId: "req_sandbox_commit" });
assert.equal(sandboxCommitReceipt.ok, false, "sandbox commit remains denied without sandbox enablement and approval");
assert.equal(sandboxCommitReceipt.policy.reasons.includes("sandbox_execution_not_enabled"), true);
assert.equal(sandboxCommitReceipt.policy.reasons.includes("approval_required"), true);

const standaloneCommandCatalog = createStandaloneCommandCatalog({ sessionId: "s-command" });
assert.equal(standaloneCommandCatalog.commands.some((command) => command.metadata.sessionId === "s-command"), true, "standalone command catalog preserves adapter context metadata");
console.log("tool-contracts tests passed");
