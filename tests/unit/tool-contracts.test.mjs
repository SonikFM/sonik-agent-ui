import assert from "node:assert/strict";
import {
  createCommandCatalog,
  createCommandFamilyRegistry,
  createCommandIndexContextFromPageContext,
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
  createCommandIndexContext,
  createComposedCommandCatalog,
  createComposedCommandFamilyRegistry,
  executeHostCatalogCommand,
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
import {
  GENERATED_BOOKING_LIST_CONTEXTS_COMMAND_ID,
  GENERATED_BOOKING_PING_COMMAND_ID,
  GENERATED_BOOKING_TEMPLATE_COMMAND_ID,
  GENERATED_BOOKING_RUNTIME_PROVIDER,
  STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID,
  STANDALONE_DEMO_BOOKING_WRITE_COMMAND_ID,
  STANDALONE_HOST_RUNTIME_PROVIDER,
  createStandaloneHostCommandIndex,
  createStandaloneHostCommandRuntimeBundle,
  resolveStandaloneHostSession,
} from "../../apps/standalone-sveltekit/src/lib/server/host-command-runtime.ts";

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
const standaloneHostSessionOrpc = createStandaloneAvailableToolManifest({
  sourceMode: "orpc-app-state",
  includeApprovalRequired: true,
  hostSessionMode: "amplify-embedded",
  authenticated: true,
  organizationId: "org-manifest",
  scopes: ["booking:read"],
});
assert.deepEqual(standaloneHostSessionOrpc.tools.map((tool) => tool.id), ["booking.contexts.list"], "tool manifest filtering should consume the host-session envelope instead of parallel primitive-only auth state");
const explicitNullHostSessionOrpc = createStandaloneAvailableToolManifest({
  sourceMode: "orpc-app-state",
  includeApprovalRequired: true,
  hostSession: null,
  authenticated: true,
  organizationId: "org-stale",
  scopes: ["booking:read"],
});
assert.deepEqual(explicitNullHostSessionOrpc.tools, [], "explicit null host session must not fall back to stale primitive auth fields");
const explicitNullWithModeHostSessionOrpc = createStandaloneAvailableToolManifest({
  sourceMode: "orpc-app-state",
  includeApprovalRequired: true,
  hostSession: null,
  hostSessionMode: "amplify-embedded",
  authenticated: true,
  organizationId: "org-stale",
  scopes: ["booking:read"],
});
assert.deepEqual(explicitNullWithModeHostSessionOrpc.tools, [], "explicit null host session must stay authoritative even when a host session mode is also present");
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
  metadata: {
    liveExecution: false,
    familyId: "campaign",
    loadPolicy: { mode: "surface-eager", priority: 50, profile: "sonik" },
    contextHints: {
      routes: ["/campaigns/new"],
      surfaces: ["campaign-wizard"],
      skillFamilies: ["campaign-authoring"],
      commandFamilies: ["campaign"],
      requiredScopes: ["campaign:send"],
    },
  },
};
const campaignCatalog = createCommandCatalog("host-campaign-test", [campaignCommand], "2026-06-20T00:00:00.000Z");
assert.throws(() => createStartupCommandIndex(campaignCatalog, { registry: defaultFamilyRegistry }), /Unknown command family ids: campaign/, "host-only family drift should be rejected unless the active host registry defines it");
const hostFamilyRegistry = createCommandFamilyRegistry("host-test", [
  ...defaultFamilyRegistry.families,
  { id: "campaign", title: "Campaigns", aliases: ["marketing"], source: "host" },
], "2026-06-20T00:00:00.000Z");
const implicitVisibleHostCatalog = createCommandCatalog("implicit-host-test", [{
  ...campaignCommand,
  id: "campaign.implicit",
  metadata: { liveExecution: false },
}], "2026-06-20T00:00:00.000Z");
assert.throws(() => createSurfaceCommandIndex(implicitVisibleHostCatalog, { surface: "campaign-wizard" }, { registry: hostFamilyRegistry }), /Visible non-local commands require explicit family\/load\/context metadata: campaign\.implicit/, "visible host commands must not rely on heuristic visibility metadata");

const unmatchedSurfaceIndex = createSurfaceCommandIndex(campaignCatalog, { surface: "event-create", authenticated: true, organizationId: "org1", scopes: ["campaign:send"] }, { registry: hostFamilyRegistry });
assert.deepEqual(unmatchedSurfaceIndex.commands, [], "surface-eager host command should not load on an unrelated surface");
const unauthenticatedSurfaceIndex = createSurfaceCommandIndex(campaignCatalog, { surface: "campaign-wizard", organizationId: "org1", scopes: ["campaign:send"] }, { registry: hostFamilyRegistry });
assert.deepEqual(unauthenticatedSurfaceIndex.commands, [], "auth-required surface-eager host command should not load without authenticated context");
const noOrgSurfaceIndex = createSurfaceCommandIndex(campaignCatalog, { surface: "campaign-wizard", authenticated: true, scopes: ["campaign:send"] }, { registry: hostFamilyRegistry });
assert.deepEqual(noOrgSurfaceIndex.commands, [], "org-scoped surface-eager host command should not load without organization context");
const scopedOutSurfaceIndex = createSurfaceCommandIndex(campaignCatalog, { surface: "campaign-wizard", authenticated: true, organizationId: "org1" }, { registry: hostFamilyRegistry });
assert.deepEqual(scopedOutSurfaceIndex.commands, [], "surface-eager host command should not load until required context scopes are present");
const matchedSurfaceIndex = createSurfaceCommandIndex(campaignCatalog, { surface: "campaign-wizard", authenticated: true, organizationId: "org1", scopes: ["campaign:send"] }, { registry: hostFamilyRegistry });
assert.deepEqual(matchedSurfaceIndex.commands.map((command) => command.id), ["campaign.launch"], "surface-eager host command should load for matching authenticated org page/surface context");
assert.equal(matchedSurfaceIndex.commands.every((command) => !Object.hasOwn(command, "input") && !Object.hasOwn(command, "inputSchemaJson")), true, "surface index should also be schema-free");
const matchedByFamilyIndex = createSurfaceCommandIndex(campaignCatalog, { commandFamilies: ["campaign"], authenticated: true, organizationId: "org1", scopes: ["campaign:send"] }, { registry: hostFamilyRegistry });
assert.deepEqual(matchedByFamilyIndex.commands.map((command) => command.id), ["campaign.launch"], "surface index should support page-provided command family hints");
const trustedStandaloneSurfaceIndex = createStandaloneSurfaceCommandIndex(
  { sessionId: "s-index", authenticated: true, organizationId: "org1", scopes: ["booking:read"], hostSessionSource: "embedded-host" },
  { surface: "artifact", commandFamilies: ["integration"] },
  "2026-06-20T00:00:00.000Z",
);
assert.equal(trustedStandaloneSurfaceIndex.commands.some((command) => command.id === "booking.contexts.list"), true, "trusted standalone auth/org/scope context can surface metadata-only ORPC command summaries");
const pageContextCannotWidenTrustedAccess = createStandaloneSurfaceCommandIndex(
  { sessionId: "s-index", authenticated: false, organizationId: null, scopes: [] },
  { surface: "artifact", authenticated: true, organizationId: "org1", scopes: ["booking:read"], hostSessionSource: "embedded-host", commandFamilies: ["integration"] },
  "2026-06-20T00:00:00.000Z",
);
assert.equal(pageContextCannotWidenTrustedAccess.commands.some((command) => command.id === "booking.contexts.list"), false, "page/surface context must not widen trusted standalone auth/org/scope access for non-local commands");

const billingEagerCommand = {
  ...campaignCommand,
  id: "billing.invoice.list",
  title: "List invoices",
  familyId: "billing",
  effect: "read",
  approval: "none",
  loadPolicy: { mode: "eager-summary", priority: 60, profile: "host-billing" },
  contextHints: {
    routes: [],
    surfaces: ["billing-dashboard"],
    pageTypes: [],
    artifactTypes: [],
    skillFamilies: [],
    commandFamilies: ["billing"],
    requiredScopes: ["billing:read"],
  },
  capabilities: ["billing", "invoice", "read"],
  auth: { required: true, orgScoped: true, scopes: ["billing:read"] },
  metadata: {
    liveExecution: false,
    familyId: "billing",
    loadPolicy: { mode: "eager-summary", priority: 60, profile: "host-billing" },
    contextHints: {
      surfaces: ["billing-dashboard"],
      commandFamilies: ["billing"],
      requiredScopes: ["billing:read"],
    },
  },
};
const billingFamilyRegistry = createCommandFamilyRegistry("host-billing-test", [
  ...defaultFamilyRegistry.families,
  { id: "billing", title: "Billing", aliases: [], source: "host" },
], "2026-06-20T00:00:00.000Z");
const billingCatalog = createCommandCatalog("host-billing-test", [billingEagerCommand], "2026-06-20T00:00:00.000Z");
assert.deepEqual(createStartupCommandIndex(billingCatalog, { registry: billingFamilyRegistry }).commands, [], "startup index should not expose auth/org-scoped eager-summary host commands anonymously");
assert.deepEqual(createSurfaceCommandIndex(billingCatalog, { surface: "billing-dashboard" }, { registry: billingFamilyRegistry }).commands, [], "surface index should not expose auth/org-scoped eager-summary host commands anonymously");
assert.deepEqual(createStartupCommandIndex(billingCatalog, { registry: billingFamilyRegistry, context: { authenticated: true, organizationId: "org1", scopes: ["billing:read"] } }).commands.map((command) => command.id), ["billing.invoice.list"], "startup index may expose auth/org-scoped eager summaries only with matching trusted context");
assert.deepEqual(createSurfaceCommandIndex(billingCatalog, { surface: "billing-dashboard", authenticated: true, organizationId: "org1", scopes: ["billing:read"] }, { registry: billingFamilyRegistry }).commands.map((command) => command.id), ["billing.invoice.list"], "surface index may expose auth/org-scoped eager summaries only with matching trusted context");

const pageContext = createCommandIndexContextFromPageContext({
  route: "/campaigns/new",
  surface: "campaign-wizard",
  pageType: "wizard",
  title: "Launch Campaign Wizard",
  activeEntity: { type: "campaign", id: "cmp_1", label: "Launch Campaign" },
  activeArtifactId: "artifact_1",
  activeDocumentId: "doc_1",
  visibleActions: ["preview", "publish"],
  skillFamilies: ["campaign-authoring"],
  commandFamilies: ["campaign"],
}, { authenticated: true, organizationId: "org1", scopes: ["campaign:send"] });
assert.equal(pageContext.activeEntity?.type, "campaign", "page context bridge should preserve active entity type");
assert.equal(pageContext.activeEntity?.label, "Launch Campaign", "page context bridge should preserve active entity display label");
assert.equal(pageContext.title, "Launch Campaign Wizard", "page context bridge should preserve safe page title for model-readable context");
assert.deepEqual(pageContext.visibleActions, ["preview", "publish"], "page context bridge should preserve safe visible action labels");
assert.equal(pageContext.authenticated, true, "page context bridge should carry trusted auth state");
assert.equal(pageContext.organizationId, "org1", "page context bridge should carry trusted org state");

const eventCommand = {
  ...campaignCommand,
  id: "event.create",
  title: "Create event",
  familyId: "event",
  capabilities: ["event", "create"],
  contextHints: {
    routes: ["/events/new"],
    surfaces: ["event-create"],
    pageTypes: ["wizard"],
    artifactTypes: [],
    skillFamilies: ["event-authoring"],
    commandFamilies: ["event"],
    requiredScopes: ["event:write"],
  },
  auth: { required: true, orgScoped: true, scopes: ["event:write"] },
  metadata: {
    liveExecution: false,
    familyId: "event",
    loadPolicy: { mode: "surface-eager", priority: 40, profile: "host-event" },
    contextHints: {
      routes: ["/events/new"],
      surfaces: ["event-create"],
      pageTypes: ["wizard"],
      skillFamilies: ["event-authoring"],
      commandFamilies: ["event"],
      requiredScopes: ["event:write"],
    },
  },
};
const hiddenEventCommand = {
  ...eventCommand,
  id: "event.hidden",
  title: "Hidden event admin",
  loadPolicy: { mode: "hidden", priority: 99, profile: "host-event" },
  metadata: {
    ...eventCommand.metadata,
    loadPolicy: { mode: "hidden", priority: 99, profile: "host-event" },
  },
};
const eventHostAdapter = {
  provider: "event-host-fixture",
  families: [{ id: "event", title: "Events", aliases: ["eventing"], source: "host" }],
  commands: [eventCommand, hiddenEventCommand],
};
const crmManifestAdapter = {
  provider: "crm-manifest-fixture",
  families: [{ id: "crm", title: "CRM", aliases: ["contacts"], source: "host" }],
  manifest: createToolManifest("crm-manifest-fixture", [{
    id: "crm.customer.search",
    source: "orpc",
    title: "Search customers",
    description: "Host-provided customer lookup projected from a manifest adapter.",
    effect: "read",
    approval: "none",
    uiTargets: ["chat"],
    capabilities: ["crm", "customer", "search"],
    input: { kind: "unknown" },
    output: { kind: "unknown" },
    auth: { required: true, scopes: ["crm:read"], orgScoped: true },
    transport: { procedure: "crm.customer.search", runtimeStatus: "shadow" },
    metadata: {
      familyId: "crm",
      loadPolicy: { mode: "lazy", priority: 10, profile: "host-crm" },
      contextHints: { commandFamilies: ["crm"], requiredScopes: ["crm:read"] },
    },
  }], "2026-06-20T00:00:00.000Z"),
};
const composedRegistry = createComposedCommandFamilyRegistry("composed-host-test", [eventHostAdapter], "2026-06-20T00:00:00.000Z");
const composedCatalog = createComposedCommandCatalog("composed-host-test", commandCatalog, [eventHostAdapter], "2026-06-20T00:00:00.000Z");
assert.equal(composedRegistry.families.some((family) => family.id === "event" && family.source === "host"), true, "host adapter should extend family registry outside core");
assert.equal(composedCatalog.commands.some((command) => command.id === "event.create"), true, "host adapter should compose host descriptors into catalog");
const manifestComposedRegistry = createComposedCommandFamilyRegistry("manifest-composed-host-test", [crmManifestAdapter], "2026-06-20T00:00:00.000Z");
const manifestComposedCatalog = createComposedCommandCatalog("manifest-composed-host-test", commandCatalog, [crmManifestAdapter], "2026-06-20T00:00:00.000Z");
assert.equal(manifestComposedRegistry.families.some((family) => family.id === "crm" && family.source === "host"), true, "host manifest adapter should extend family registry");
assert.equal(manifestComposedCatalog.commands.find((command) => command.id === "crm.customer.search")?.familyId, "crm", "host manifest adapter should project manifest tools into command descriptors");
assert.throws(
  () => createComposedCommandFamilyRegistry("duplicate-family-test", [{ provider: "bad-host", families: [{ id: "artifact", title: "Bad override", aliases: [], source: "host" }] }], "2026-06-20T00:00:00.000Z"),
  /Duplicate command family id/,
  "host adapters should fail fast instead of silently shadowing command families",
);
assert.throws(
  () => createComposedCommandCatalog("duplicate-command-test", commandCatalog, [{ provider: "bad-host", commands: [{ ...eventCommand, id: "createJsonArtifact" }] }], "2026-06-20T00:00:00.000Z"),
  /Duplicate command id/,
  "host adapters should fail fast instead of silently duplicating command descriptors",
);
const eventPageContext = createCommandIndexContext({ route: "/events/new", surface: "event-create", pageType: "wizard", commandFamilies: ["event"] }, { authenticated: true, organizationId: "org1", scopes: ["event:write"] });
const eventSurfaceCommandIds = createSurfaceCommandIndex(composedCatalog, eventPageContext, { registry: composedRegistry }).commands.map((command) => command.id);
assert.equal(eventSurfaceCommandIds.includes("event.create"), true, "host-composed surface index should include matching host command");
assert.equal(eventSurfaceCommandIds.includes("event.hidden"), false, "host-composed surface index should hide hidden host commands");
assert.equal(searchCommandCatalog(composedCatalog, "event").some((command) => command.id === "event.create"), true, "host-composed lazy search should discover visible host commands");
assert.equal(searchCommandCatalog(composedCatalog, "hidden").some((command) => command.id === "event.hidden"), false, "host-composed hidden commands should stay hidden from search");

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
assert.equal(unauthenticatedLiveOrpc.policy.reasons.includes("trusted_host_session_required"), true);
const authenticatedLiveOrpc = executeCatalogCommand(liveOrpcCatalog, "booking.contexts.list", {}, {
  source: "agent-ui",
  requestId: "req_live_orpc_auth",
  authenticated: true,
  organizationId: "org_1",
  scopes: ["booking:read"],
  hostSessionSource: "embedded-host",
});
assert.equal(authenticatedLiveOrpc.ok, true, "mounted live ORPC read can execute only after auth/org/scope context passes");

const bookingHostReadCommand = {
  ...liveOrpcCommand,
  id: "booking.host.contexts.list",
  title: "Host list booking contexts",
  description: "Host-provided read-only booking context command.",
  familyId: "booking",
  loadPolicy: { mode: "surface-eager", priority: 55, profile: "host-booking" },
  contextHints: {
    routes: ["/booking"],
    surfaces: ["booking-console"],
    pageTypes: [],
    artifactTypes: [],
    skillFamilies: ["booking-ops"],
    commandFamilies: ["booking"],
    requiredScopes: ["booking:read"],
  },
  capabilities: ["booking", "context", "read"],
  transport: { procedure: "booking.contexts.list", runtimeStatus: "shadow" },
  metadata: {
    liveExecution: false,
    familyId: "booking",
    loadPolicy: { mode: "surface-eager", priority: 55, profile: "host-booking" },
    contextHints: {
      routes: ["/booking"],
      surfaces: ["booking-console"],
      skillFamilies: ["booking-ops"],
      commandFamilies: ["booking"],
      requiredScopes: ["booking:read"],
    },
  },
};
const bookingHostWriteCommand = {
  ...campaignCommand,
  id: "booking.host.contexts.create",
  title: "Host create booking context",
  description: "Host-provided write booking command.",
  familyId: "booking",
  source: "orpc",
  effect: "write",
  approval: "required",
  loadPolicy: { mode: "surface-eager", priority: 45, profile: "host-booking" },
  contextHints: {
    routes: ["/booking"],
    surfaces: ["booking-console"],
    pageTypes: [],
    artifactTypes: [],
    skillFamilies: ["booking-ops"],
    commandFamilies: ["booking"],
    requiredScopes: ["booking:write"],
  },
  capabilities: ["booking", "context", "write"],
  transport: { procedure: "booking.contexts.create", runtimeStatus: "shadow" },
  auth: { required: true, orgScoped: true, scopes: ["booking:write"] },
  policy: { ...campaignCommand.policy, readOnly: false },
  metadata: {
    liveExecution: false,
    familyId: "booking",
    loadPolicy: { mode: "surface-eager", priority: 45, profile: "host-booking" },
    contextHints: {
      routes: ["/booking"],
      surfaces: ["booking-console"],
      skillFamilies: ["booking-ops"],
      commandFamilies: ["booking"],
      requiredScopes: ["booking:write"],
    },
  },
};
const bookingHostAdapter = {
  provider: "booking-host-fixture",
  families: [{ id: "booking", title: "Bookings", aliases: ["reservations"], source: "host" }],
  commands: [bookingHostReadCommand, bookingHostWriteCommand],
};
const bookingRuntimeCatalog = createComposedCommandCatalog("booking-runtime-test", commandCatalog, [bookingHostAdapter], "2026-06-20T00:00:00.000Z");
const bookingRuntimeRegistry = createComposedCommandFamilyRegistry("booking-runtime-test", [bookingHostAdapter], "2026-06-20T00:00:00.000Z");
const bookingSurfaceIndex = createSurfaceCommandIndex(bookingRuntimeCatalog, { surface: "booking-console", authenticated: true, organizationId: "org1", scopes: ["booking:read", "booking:write"] }, { registry: bookingRuntimeRegistry });
assert.equal(bookingSurfaceIndex.commands.some((command) => command.id === "booking.host.contexts.list"), true, "host runtime commands should still surface through page-aware indexes before execution is mounted");
assert.equal(searchCommandCatalog(bookingRuntimeCatalog, "host booking").some((command) => command.id === "booking.host.contexts.list"), true, "shadow host runtime commands remain searchable");
assert.equal(learnCommandDescriptor(bookingRuntimeCatalog, "booking.host.contexts.list", ["transport"]).transport.runtimeStatus, "shadow", "learn keeps shadow transport metadata until runtime binding executes");
const unavailableHostReceipt = await executeHostCatalogCommand({
  catalog: bookingRuntimeCatalog,
  commandId: "booking.host.contexts.list",
  commandInput: {},
  execution: { source: "agent-ui", requestId: "req_shadow_host", authenticated: true, organizationId: "org1", scopes: ["booking:read"], hostSessionSource: "embedded-host" },
});
assert.equal(unavailableHostReceipt.ok, false, "non-local host commands without a runtime binding should return explicit runtime unavailable receipts");
assert.equal(unavailableHostReceipt.policy.reasons.includes("runtime_unavailable"), true);
const mountedLiveWithoutBindingCatalog = createCommandCatalog("mounted-live-without-runtime-test", [{
  ...bookingHostReadCommand,
  transport: { procedure: "booking.contexts.list", runtimeStatus: "mounted" },
  metadata: { ...bookingHostReadCommand.metadata, liveExecution: true },
}], "2026-06-20T00:00:00.000Z");
const mountedLiveWithoutBindingReceipt = await executeHostCatalogCommand({
  catalog: mountedLiveWithoutBindingCatalog,
  commandId: "booking.host.contexts.list",
  commandInput: {},
  execution: { source: "agent-ui", requestId: "req_mounted_live_no_binding", authenticated: true, organizationId: "org1", scopes: ["booking:read"], hostSessionSource: "embedded-host" },
});
assert.equal(mountedLiveWithoutBindingReceipt.ok, false, "mounted/live non-local descriptors still require an explicit host runtime binding");
assert.equal(mountedLiveWithoutBindingReceipt.policy.reasons.includes("runtime_unavailable"), true);
const localFallbackReceipt = await executeHostCatalogCommand({
  catalog: bookingRuntimeCatalog,
  commandId: "getWeather",
  commandInput: { city: "Bogota" },
  execution: { source: "agent-ui", requestId: "req_local_fallback" },
});
assert.equal(localFallbackReceipt.ok, true, "local UI/demo reads should still use the core catalog executor when no host runtime binding exists");
const shadowHostReceipt = await executeHostCatalogCommand({
  catalog: bookingRuntimeCatalog,
  commandId: "booking.host.contexts.list",
  commandInput: {},
  runtimeAdapters: [{ provider: "shadow-runtime", bindings: [{ commandId: "booking.host.contexts.list", status: "shadow" }] }],
  execution: { source: "agent-ui", requestId: "req_shadow_host", authenticated: true, organizationId: "org1", scopes: ["booking:read"], hostSessionSource: "embedded-host" },
});
assert.equal(shadowHostReceipt.ok, false, "shadow host commands should not execute without a mounted runtime binding");
assert.equal(shadowHostReceipt.policy.reasons.includes("runtime_shadow"), true);
const mountedLiveShadowBindingReceipt = await executeHostCatalogCommand({
  catalog: mountedLiveWithoutBindingCatalog,
  commandId: "booking.host.contexts.list",
  commandInput: {},
  runtimeAdapters: [{ provider: "shadow-runtime", bindings: [{ commandId: "booking.host.contexts.list", status: "shadow" }] }],
  execution: { source: "agent-ui", requestId: "req_mounted_live_shadow", authenticated: true, organizationId: "org1", scopes: ["booking:read"], hostSessionSource: "embedded-host" },
});
assert.equal(mountedLiveShadowBindingReceipt.ok, false, "shadow runtime binding remains authoritative even when descriptor metadata claims mounted/live");
assert.equal(mountedLiveShadowBindingReceipt.policy.reasons.includes("runtime_shadow"), true);

const readRuntimeAdapter = {
  provider: "booking-runtime-fixture",
  bindings: [{
    commandId: "booking.host.contexts.list",
    status: "mounted-read",
    execute: (input, context) => ({
      summary: {
        contexts: [{ id: "ctx_1", name: "Main Room" }],
        input,
        action: context.action,
        procedure: context.command.transport.procedure,
      },
      nextActions: ["learnCommand"],
    }),
  }],
};
const mountedReadRuntimeCatalog = createCommandCatalog("mounted-read-runtime-test", [{
  ...bookingHostReadCommand,
  transport: { procedure: "booking.contexts.list", runtimeStatus: "mounted" },
  metadata: { ...bookingHostReadCommand.metadata, liveExecution: true, runtimeAdapterProvider: "booking-runtime-fixture" },
}], "2026-06-20T00:00:00.000Z");
const mountedDisabledRuntimeCatalog = createCommandCatalog("mounted-disabled-runtime-test", [{
  ...bookingHostReadCommand,
  transport: { procedure: "booking.contexts.list", runtimeStatus: "mounted" },
  metadata: { ...bookingHostReadCommand.metadata, liveExecution: true, runtimeAdapterProvider: "disabled-runtime" },
}], "2026-06-20T00:00:00.000Z");
const mountedUnavailableRuntimeCatalog = createCommandCatalog("mounted-unavailable-runtime-test", [{
  ...bookingHostReadCommand,
  transport: { procedure: "booking.contexts.list", runtimeStatus: "mounted" },
  metadata: { ...bookingHostReadCommand.metadata, liveExecution: true, runtimeAdapterProvider: "unavailable-runtime" },
}], "2026-06-20T00:00:00.000Z");
const unauthenticatedRuntimeReceipt = await executeHostCatalogCommand({
  catalog: mountedReadRuntimeCatalog,
  commandId: "booking.host.contexts.list",
  commandInput: { limit: 1 },
  runtimeAdapters: [readRuntimeAdapter],
  execution: { source: "agent-ui", requestId: "req_host_no_auth" },
});
assert.equal(unauthenticatedRuntimeReceipt.ok, false, "mounted host runtime still obeys auth/org/scope policy");
assert.equal(unauthenticatedRuntimeReceipt.policy.reasons.includes("auth_required"), true);
const readRuntimeReceipt = await executeHostCatalogCommand({
  catalog: mountedReadRuntimeCatalog,
  commandId: "booking.host.contexts.list",
  commandInput: { limit: 1 },
  runtimeAdapters: [readRuntimeAdapter],
  execution: { source: "agent-ui", requestId: "req_host_read", authenticated: true, organizationId: "org1", scopes: ["booking:read"], hostSessionSource: "embedded-host" },
});
assert.equal(readRuntimeReceipt.ok, true, "mounted-read host runtime can execute read ORPC commands after policy passes");
assert.deepEqual(readRuntimeReceipt.summary.contexts.map((context) => context.id), ["ctx_1"]);
assert.equal(readRuntimeReceipt.summary.procedure, "booking.contexts.list");
assert.equal(readRuntimeReceipt.trace.provider, "booking-runtime-fixture");

const disabledRuntimeReceipt = await executeHostCatalogCommand({
  catalog: mountedDisabledRuntimeCatalog,
  commandId: "booking.host.contexts.list",
  runtimeAdapters: [{ provider: "disabled-runtime", bindings: [{ commandId: "booking.host.contexts.list", status: "disabled" }] }],
  execution: { source: "agent-ui", requestId: "req_host_disabled", authenticated: true, organizationId: "org1", scopes: ["booking:read"], hostSessionSource: "embedded-host" },
});
assert.equal(disabledRuntimeReceipt.ok, false, "disabled host runtime returns a typed deny receipt");
assert.equal(disabledRuntimeReceipt.policy.reasons.includes("runtime_disabled"), true);
const explicitUnavailableRuntimeReceipt = await executeHostCatalogCommand({
  catalog: mountedUnavailableRuntimeCatalog,
  commandId: "booking.host.contexts.list",
  runtimeAdapters: [{ provider: "unavailable-runtime", bindings: [{ commandId: "booking.host.contexts.list", status: "unavailable" }] }],
  execution: { source: "agent-ui", requestId: "req_host_unavailable", authenticated: true, organizationId: "org1", scopes: ["booking:read"], hostSessionSource: "embedded-host" },
});
assert.equal(explicitUnavailableRuntimeReceipt.ok, false, "unavailable host runtime returns a typed deny receipt distinct from disabled");
assert.equal(explicitUnavailableRuntimeReceipt.policy.reasons.includes("runtime_unavailable"), true);

const writeRuntimeAdapter = {
  provider: "booking-write-runtime-fixture",
  bindings: [{
    commandId: "booking.host.contexts.create",
    status: "mounted-write",
    commit: (input) => ({ summary: { created: true, input }, nextActions: ["learnCommand"] }),
  }],
};
const mountedWriteRuntimeCatalog = createCommandCatalog("mounted-write-runtime-test", [{
  ...bookingHostWriteCommand,
  transport: { procedure: "booking.contexts.create", runtimeStatus: "mounted" },
  metadata: { ...bookingHostWriteCommand.metadata, liveExecution: true, runtimeAdapterProvider: "booking-write-runtime-fixture" },
}], "2026-06-20T00:00:00.000Z");
const writeExecuteReceipt = await executeHostCatalogCommand({
  catalog: mountedWriteRuntimeCatalog,
  commandId: "booking.host.contexts.create",
  commandInput: { name: "VIP" },
  runtimeAdapters: [writeRuntimeAdapter],
  execution: { source: "agent-ui", requestId: "req_write_execute", authenticated: true, organizationId: "org1", scopes: ["booking:write"], hostSessionSource: "embedded-host" },
});
assert.equal(writeExecuteReceipt.ok, false, "write host commands must not run through execute even when mounted-write");
assert.equal(writeExecuteReceipt.policy.reasons.includes("runtime_not_mounted_for_execute"), true);
const writeCommitWithoutApproval = await executeHostCatalogCommand({
  catalog: mountedWriteRuntimeCatalog,
  commandId: "booking.host.contexts.create",
  commandInput: { name: "VIP" },
  runtimeAdapters: [writeRuntimeAdapter],
  execution: { action: "commit", source: "agent-ui", requestId: "req_write_no_approval", authenticated: true, organizationId: "org1", scopes: ["booking:write"], hostSessionSource: "embedded-host" },
});
assert.equal(writeCommitWithoutApproval.ok, false, "write host commits require trusted approval");
assert.equal(writeCommitWithoutApproval.policy.reasons.includes("approval_required"), true);
const writeCommitReceipt = await executeHostCatalogCommand({
  catalog: mountedWriteRuntimeCatalog,
  commandId: "booking.host.contexts.create",
  commandInput: { name: "VIP" },
  runtimeAdapters: [writeRuntimeAdapter],
  execution: { action: "commit", approved: true, source: "agent-ui", requestId: "req_write_approved", authenticated: true, organizationId: "org1", scopes: ["booking:write"], hostSessionSource: "embedded-host" },
});
assert.equal(writeCommitReceipt.ok, true, "approved mounted-write host command can commit through runtime adapter");
assert.equal(writeCommitReceipt.summary.created, true);
await assert.rejects(
  () => executeHostCatalogCommand({
    catalog: bookingRuntimeCatalog,
    commandId: "booking.host.contexts.list",
    runtimeAdapters: [
      readRuntimeAdapter,
      { provider: "duplicate-runtime", bindings: [{ commandId: "booking.host.contexts.list", status: "mounted-read", execute: () => ({ summary: {} }) }] },
    ],
    execution: { source: "agent-ui", requestId: "req_duplicate_runtime" },
  }),
  /Duplicate runtime binding/,
  "runtime adapters should fail fast on duplicate command bindings",
);


const anonymousHostSession = resolveStandaloneHostSession({ sessionId: "s-anon" });
assert.equal(anonymousHostSession.authenticated, false, "default host session resolution should be anonymous");
const explicitNullRuntimeHostSession = resolveStandaloneHostSession({
  sessionId: "s-null-runtime",
  hostSession: null,
  hostSessionMode: "standalone-demo",
  organizationId: "org-stale",
  scopes: ["booking:read"],
});
assert.equal(explicitNullRuntimeHostSession.authenticated, false, "explicit null runtime host session must not fall through to standalone demo mode");
const anonymousHostRuntimeBundle = createStandaloneHostCommandRuntimeBundle({
  sessionId: "s-anon",
  pageContext: { surface: "booking-console", commandFamilies: ["booking"], skillFamilies: ["booking-ops"] },
}, "2026-06-20T00:00:00.000Z");
assert.equal(anonymousHostRuntimeBundle.catalog.commands.some((command) => command.id === STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID), false, "anonymous host runtime bundle should not compose host-scoped booking commands");
assert.equal(anonymousHostRuntimeBundle.runtimeAdapters.some((adapter) => adapter.bindings.some((binding) => binding.commandId === STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID)), false, "anonymous host runtime bundle should not mount scoped demo booking adapters");
assert.equal(anonymousHostRuntimeBundle.catalog.commands.some((command) => command.id === GENERATED_BOOKING_PING_COMMAND_ID), true, "anonymous host runtime bundle may expose public generated booking health commands");
assert.equal(createStandaloneHostCommandIndex({
  sessionId: "s-anon",
  pageContext: { surface: "booking-console", commandFamilies: ["booking"], skillFamilies: ["booking-ops"] },
}, "2026-06-20T00:00:00.000Z").commands.some((command) => command.id === STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID), false, "page context hints cannot grant anonymous booking visibility");
assert.equal(createStandaloneHostCommandRuntimeBundle({
  sessionId: "s-embedded-no-org",
  hostSessionMode: "amplify-embedded",
  authenticated: true,
  scopes: ["booking:read"],
  pageContext: { surface: "booking-console", commandFamilies: ["booking"] },
}, "2026-06-20T00:00:00.000Z").catalog.commands.some((command) => command.id === STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID), false, "Amplify-shaped embedded sessions need server-resolved organization authority before host commands compose");
assert.equal(createStandaloneHostCommandRuntimeBundle({
  sessionId: "s-embedded",
  hostSessionMode: "amplify-embedded",
  authenticated: true,
  organizationId: "org-embedded",
  scopes: ["booking:read"],
  pageContext: { surface: "booking-console", commandFamilies: ["booking"] },
}, "2026-06-20T00:00:00.000Z").catalog.commands.some((command) => command.id === STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID), true, "server-resolved Amplify-style org/scopes should enable host booking command composition");

const generatedNoBaseBundle = createStandaloneHostCommandRuntimeBundle({
  sessionId: "s-generated-no-base",
  hostSessionMode: "standalone-demo",
  pageContext: { surface: "booking-console", commandFamilies: ["booking"], skillFamilies: ["booking-ops"] },
}, "2026-06-20T00:00:00.000Z");
assert.equal(generatedNoBaseBundle.catalog.commands.some((command) => command.id === GENERATED_BOOKING_PING_COMMAND_ID && command.metadata.mountedFromGeneratedDescriptor === true), true, "generated mounted booking read descriptors should compose through the host adapter seam");
const generatedNoBaseReceipt = await executeHostCatalogCommand({
  catalog: generatedNoBaseBundle.catalog,
  commandId: GENERATED_BOOKING_PING_COMMAND_ID,
  commandInput: {},
  runtimeAdapters: generatedNoBaseBundle.runtimeAdapters,
  execution: { ...generatedNoBaseBundle.executionContext, requestId: "req_generated_no_base" },
});
assert.equal(generatedNoBaseReceipt.ok, false, "generated booking read commands need configured runtime transport before execution");
assert.equal(generatedNoBaseReceipt.policy.reasons.includes("runtime_unavailable"), true);
const generatedLiveBundle = createStandaloneHostCommandRuntimeBundle({
  sessionId: "s-generated-live",
  hostSessionMode: "standalone-demo",
  bookingServiceBaseUrl: "https://booking.test/root/",
  fetcher: async (url, init) => new Response(JSON.stringify({ service: "sonik-booking-service", ok: true, url: String(url), requestId: init?.headers?.["x-sonik-request-id"] }), { status: 200, headers: { "content-type": "application/json" } }),
  pageContext: { surface: "booking-console", commandFamilies: ["booking"], skillFamilies: ["booking-ops"] },
}, "2026-06-20T00:00:00.000Z");
const generatedLiveReceipt = await executeHostCatalogCommand({
  catalog: generatedLiveBundle.catalog,
  commandId: GENERATED_BOOKING_PING_COMMAND_ID,
  commandInput: {},
  runtimeAdapters: generatedLiveBundle.runtimeAdapters,
  execution: { ...generatedLiveBundle.executionContext, requestId: "req_generated_live" },
});
assert.equal(generatedLiveReceipt.ok, true, "configured generated booking read command should execute through the runtime adapter");
assert.equal(generatedLiveReceipt.trace.provider, GENERATED_BOOKING_RUNTIME_PROVIDER);
assert.equal(generatedLiveReceipt.summary.body.service, "sonik-booking-service");
assert.equal(generatedLiveReceipt.summary.path, "/api/v1/booking/ping");
assert.equal(generatedLiveReceipt.summary.url, "/root/api/v1/booking/ping", "live booking receipts should not expose the configured origin");
const generatedUnknownInputReceipt = await executeHostCatalogCommand({
  catalog: generatedLiveBundle.catalog,
  commandId: GENERATED_BOOKING_PING_COMMAND_ID,
  commandInput: { unexpected: "value" },
  runtimeAdapters: generatedLiveBundle.runtimeAdapters,
  execution: { ...generatedLiveBundle.executionContext, requestId: "req_generated_unknown_input" },
});
assert.equal(generatedUnknownInputReceipt.ok, false, "generated booking runtime should reject unknown parameters before outbound fetch");
assert.equal(generatedUnknownInputReceipt.policy.reasons.includes("host_runtime_error"), true);
assert.match(generatedUnknownInputReceipt.summary.error, /Unsupported generated booking parameter/);
const generatedContextsReceipt = await executeHostCatalogCommand({
  catalog: generatedLiveBundle.catalog,
  commandId: GENERATED_BOOKING_LIST_CONTEXTS_COMMAND_ID,
  commandInput: { kind: "event" },
  runtimeAdapters: generatedLiveBundle.runtimeAdapters,
  execution: { ...generatedLiveBundle.executionContext, requestId: "req_generated_contexts" },
});
assert.equal(generatedContextsReceipt.ok, false, "protected generated booking reads need configured runtime auth credentials");
assert.equal(generatedContextsReceipt.policy.reasons.includes("runtime_unavailable"), true);
const generatedCookieOnlyBundle = createStandaloneHostCommandRuntimeBundle({
  sessionId: "s-generated-cookie-only",
  hostSessionMode: "standalone-demo",
  bookingServiceBaseUrl: "https://booking.test/root/",
  bookingRuntimeAuth: { mode: "cookie", includeCredentials: true, source: "test" },
  fetcher: async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
  pageContext: { surface: "booking-console", commandFamilies: ["booking"], skillFamilies: ["booking-ops"] },
}, "2026-06-20T00:00:00.000Z");
const generatedCookieOnlyContextsReceipt = await executeHostCatalogCommand({
  catalog: generatedCookieOnlyBundle.catalog,
  commandId: GENERATED_BOOKING_LIST_CONTEXTS_COMMAND_ID,
  commandInput: { kind: "event" },
  runtimeAdapters: generatedCookieOnlyBundle.runtimeAdapters,
  execution: { ...generatedCookieOnlyBundle.executionContext, requestId: "req_generated_cookie_only" },
});
assert.equal(generatedCookieOnlyContextsReceipt.ok, false, "cookie mode is not treated as credentialed for protected booking reads until cookie forwarding is explicitly implemented");
assert.equal(generatedCookieOnlyContextsReceipt.policy.reasons.includes("runtime_unavailable"), true);
let credentialedFetchHeaders = {};
const generatedCredentialedLiveBundle = createStandaloneHostCommandRuntimeBundle({
  sessionId: "s-generated-live-credentialed",
  hostSessionMode: "standalone-demo",
  bookingServiceBaseUrl: "https://booking.test/root/",
  bookingRuntimeAuth: { mode: "bearer", token: "test-booking-token", source: "test" },
  fetcher: async (url, init) => {
    credentialedFetchHeaders = init?.headers ?? {};
    return new Response(JSON.stringify({
      service: "sonik-booking-service",
      ok: true,
      url: String(url),
      authorization: init?.headers?.authorization,
      nested: { token: "test-booking-token", note: "Bearer test-booking-token" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  },
  pageContext: { surface: "booking-console", commandFamilies: ["booking"], skillFamilies: ["booking-ops"] },
}, "2026-06-20T00:00:00.000Z");
const generatedCredentialedContextsReceipt = await executeHostCatalogCommand({
  catalog: generatedCredentialedLiveBundle.catalog,
  commandId: GENERATED_BOOKING_LIST_CONTEXTS_COMMAND_ID,
  commandInput: { kind: "event" },
  runtimeAdapters: generatedCredentialedLiveBundle.runtimeAdapters,
  execution: { ...generatedCredentialedLiveBundle.executionContext, requestId: "req_generated_contexts_credentialed" },
});
assert.equal(generatedCredentialedContextsReceipt.ok, true, "credentialed generated booking runtime should allow declared query parameters");
assert.equal(generatedCredentialedContextsReceipt.summary.url, "/root/api/v1/booking/contexts?kind=event");
assert.equal(generatedCredentialedContextsReceipt.summary.authMode, "bearer");
assert.equal(generatedCredentialedContextsReceipt.summary.credentialed, true);
assert.equal(JSON.stringify(generatedCredentialedContextsReceipt).includes("test-booking-token"), false, "runtime receipts must redact bearer tokens even if the upstream body echoes them");
assert.equal(JSON.stringify(generatedCredentialedContextsReceipt).includes("Bearer test-booking-token"), false, "runtime receipts must redact authorization header echoes");
assert.equal(generatedCredentialedContextsReceipt.summary.body.authorization, "[redacted]");
assert.equal(generatedCredentialedContextsReceipt.summary.body.nested.token, "[redacted]");
assert.equal(generatedCredentialedContextsReceipt.summary.body.nested.note, "Bearer [redacted]");
assert.equal(credentialedFetchHeaders.authorization, "Bearer test-booking-token", "trusted runtime token should be sent only as an outbound header");
assert.equal(credentialedFetchHeaders["x-sonik-agent-org-id"], "standalone-demo-org", "trusted org id should be forwarded as bounded telemetry");
assert.equal(credentialedFetchHeaders["x-sonik-agent-session-id"], "s-generated-live-credentialed", "trusted session id should be forwarded as bounded telemetry");
const generatedInvalidContextReceipt = await executeHostCatalogCommand({
  catalog: generatedCredentialedLiveBundle.catalog,
  commandId: GENERATED_BOOKING_LIST_CONTEXTS_COMMAND_ID,
  commandInput: { kind: "venue" },
  runtimeAdapters: generatedCredentialedLiveBundle.runtimeAdapters,
  execution: { ...generatedCredentialedLiveBundle.executionContext, requestId: "req_generated_contexts_invalid" },
});
assert.equal(generatedInvalidContextReceipt.ok, false, "generated booking runtime should reject undeclared enum-like query values");
assert.match(generatedInvalidContextReceipt.summary.error, /Unsupported generated booking query value/);
const generatedTemplateReceipt = await executeHostCatalogCommand({
  catalog: generatedLiveBundle.catalog,
  commandId: GENERATED_BOOKING_TEMPLATE_COMMAND_ID,
  commandInput: { slug: "event_starter-1" },
  runtimeAdapters: generatedLiveBundle.runtimeAdapters,
  execution: { ...generatedLiveBundle.executionContext, requestId: "req_generated_template" },
});
assert.equal(generatedTemplateReceipt.ok, true, "generated booking runtime should allow declared path parameters");
assert.equal(generatedTemplateReceipt.summary.url, "/root/api/v1/booking/templates/event_starter-1");

const hostRuntimeBundle = createStandaloneHostCommandRuntimeBundle({
  sessionId: "s-host-runtime",
  hostSessionMode: "standalone-demo",
  pageContext: { surface: "booking-console", commandFamilies: ["booking"], skillFamilies: ["booking-ops"] },
}, "2026-06-20T00:00:00.000Z");
assert.equal(hostRuntimeBundle.executionContext.hostSessionSource, "standalone-demo", "standalone demo runtime should record host session source for telemetry");
assert.equal(hostRuntimeBundle.registry.families.some((family) => family.id === "booking" && family.source === "host"), true, "standalone host runtime bundle should inject booking as a host family, not a core family");
assert.equal(createStandaloneCommandCatalog({ sessionId: "s-host-runtime" }).commands.some((command) => command.id === STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID), false, "base standalone catalog should not include host-only runtime commands");
assert.equal(hostRuntimeBundle.catalog.commands.some((command) => command.id === STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID && command.familyId === "booking"), true, "host runtime catalog should include the read-only booking command through adapter composition");
const hostRuntimeSearch = searchCommandCatalog(hostRuntimeBundle.catalog, "booking contexts");
assert.equal(hostRuntimeSearch.some((command) => command.id === STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID), true, "host runtime commands should be discoverable through catalog search");
assert.equal(hostRuntimeSearch.some((command) => command.id === STANDALONE_DEMO_BOOKING_WRITE_COMMAND_ID), false, "read-scoped host sessions should not discover write-only booking command metadata");
const hostRuntimeLearn = learnCommandDescriptor(hostRuntimeBundle.catalog, STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID, ["transport", "auth", "policy", "schema"]);
assert.equal(hostRuntimeLearn.transport.runtimeStatus, "mounted", "read-only host runtime command should expose mounted transport in the command catalog path");
assert.deepEqual(hostRuntimeLearn.auth.scopes, ["booking:read"], "learned host runtime command should expose required auth scopes");
const hostRuntimeReceipt = await executeHostCatalogCommand({
  catalog: hostRuntimeBundle.catalog,
  commandId: STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID,
  commandInput: { limit: 2 },
  runtimeAdapters: hostRuntimeBundle.runtimeAdapters,
  execution: { ...hostRuntimeBundle.executionContext, requestId: "req_standalone_host_runtime" },
});
assert.equal(hostRuntimeReceipt.ok, true, "standalone host runtime read command should execute through the runtime adapter");
assert.equal(hostRuntimeReceipt.trace.provider, STANDALONE_HOST_RUNTIME_PROVIDER, "host runtime receipt should trace the runtime provider");
assert.equal(hostRuntimeReceipt.summary.contexts.length, 2, "host runtime fixture should honor bounded read input");
assert.equal(hostRuntimeReceipt.summary.fixtureOnly, true, "manual smoke runtime result should clearly mark fixture-only data");
const hostRuntimeWriteExecute = await executeHostCatalogCommand({
  catalog: hostRuntimeBundle.catalog,
  commandId: STANDALONE_DEMO_BOOKING_WRITE_COMMAND_ID,
  commandInput: { name: "VIP" },
  runtimeAdapters: hostRuntimeBundle.runtimeAdapters,
  execution: { ...hostRuntimeBundle.executionContext, requestId: "req_standalone_host_write_execute" },
});
assert.equal(hostRuntimeWriteExecute.ok, false, "read-scoped standalone host session should not include the write command");
assert.equal(hostRuntimeWriteExecute.policy.reasons.includes("unknown_command"), true);
const writeScopedHostRuntimeBundle = createStandaloneHostCommandRuntimeBundle({
  sessionId: "s-host-runtime-write",
  hostSessionMode: "standalone-demo",
  scopes: ["booking:read", "booking:write"],
  pageContext: { surface: "booking-console", commandFamilies: ["booking"], skillFamilies: ["booking-ops"] },
}, "2026-06-20T00:00:00.000Z");
assert.equal(writeScopedHostRuntimeBundle.catalog.commands.some((command) => command.id === STANDALONE_DEMO_BOOKING_WRITE_COMMAND_ID), true, "write-scoped host session can discover write-only booking command metadata");
assert.equal(writeScopedHostRuntimeBundle.runtimeAdapters.flatMap((adapter) => adapter.bindings.map((binding) => binding.commandId)).includes(STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID), true, "runtime mounting should select visible scoped demo read bindings");
assert.equal(writeScopedHostRuntimeBundle.runtimeAdapters.some((adapter) => adapter.provider === GENERATED_BOOKING_RUNTIME_PROVIDER), true, "runtime mounting should also select generated booking read bindings from generated descriptors");
const writeOnlyHostRuntimeIndex = createStandaloneHostCommandIndex({
  sessionId: "s-host-runtime-write-only",
  hostSessionMode: "standalone-demo",
  scopes: ["booking:write"],
  pageContext: { surface: "booking-console", commandFamilies: ["booking"], skillFamilies: ["booking-ops"] },
}, "2026-06-20T00:00:00.000Z");
assert.equal(Array.isArray(writeOnlyHostRuntimeIndex.commands), true, "write-only host sessions should build an index without missing booking-family drift");
const writeOnlyHostRuntimeBundle = createStandaloneHostCommandRuntimeBundle({
  sessionId: "s-host-runtime-write-only",
  hostSessionMode: "standalone-demo",
  scopes: ["booking:write"],
  pageContext: { surface: "booking-console", commandFamilies: ["booking"], skillFamilies: ["booking-ops"] },
}, "2026-06-20T00:00:00.000Z");
assert.equal(writeOnlyHostRuntimeBundle.catalog.commands.some((command) => command.id === STANDALONE_DEMO_BOOKING_WRITE_COMMAND_ID), true, "write-only host sessions should compose write-only booking command metadata");
assert.equal(writeOnlyHostRuntimeBundle.runtimeAdapters.some((adapter) => adapter.bindings.some((binding) => binding.commandId === STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID)), false, "write-only host sessions should not mount unrelated scoped demo read runtime bindings");
const injectedHostReadCommand = {
  ...bookingHostReadCommand,
  id: "injected.demo.read",
  title: "Injected demo read",
  description: "Injected host adapter command used to verify embedder-owned runtime seams.",
  familyId: "injected",
  auth: { required: false, orgScoped: false, scopes: [] },
  policy: { tags: ["orpc", "read", "injected"], hostProfiles: ["test"], readOnly: true, proofTier: "fixture" },
  transport: { procedure: "injected.demo.read", runtimeStatus: "mounted" },
  metadata: {
    ...bookingHostReadCommand.metadata,
    familyId: "injected",
    contextHints: { commandFamilies: ["injected"], surfaces: ["injected-surface"], requiredScopes: [] },
    liveExecution: true,
    runtimeAdapterProvider: "injected-runtime-fixture",
  },
};
const injectedAdapter = {
  provider: "injected-host-fixture",
  families: [{ id: "injected", title: "Injected", aliases: ["custom"], source: "host" }],
  commands: [injectedHostReadCommand],
  isEligible: () => true,
};
const injectedRuntimeBundle = createStandaloneHostCommandRuntimeBundle({
  sessionId: "s-injected-runtime",
  hostSessionMode: "standalone-demo",
  hostCommandAdapters: [injectedAdapter],
  hostRuntimeAdapters: [{
    provider: "injected-runtime-fixture",
    bindings: [
      { commandId: "injected.demo.read", status: "mounted-read", execute: (input) => ({ summary: { injected: true, input } }) },
      { commandId: STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID, status: "mounted-read", execute: () => ({ summary: { unrelated: true } }) },
    ],
  }],
}, "2026-06-20T00:00:00.000Z");
assert.deepEqual(injectedRuntimeBundle.runtimeAdapters.flatMap((adapter) => adapter.bindings.map((binding) => binding.commandId)), ["injected.demo.read"], "injected runtime adapters should be trimmed to visible injected catalog command bindings");
const injectedRuntimeReceipt = await executeHostCatalogCommand({
  catalog: injectedRuntimeBundle.catalog,
  commandId: "injected.demo.read",
  commandInput: { ok: true },
  runtimeAdapters: injectedRuntimeBundle.runtimeAdapters,
  execution: { ...injectedRuntimeBundle.executionContext, requestId: "req_injected_runtime" },
});
assert.equal(injectedRuntimeReceipt.ok, true, "injected mounted-read runtime binding should execute through the public host runtime bundle seam");
assert.equal(injectedRuntimeReceipt.summary.injected, true);
assert.throws(() => createStandaloneHostCommandIndex({
  sessionId: "s-conflicting-family",
  hostSessionMode: "standalone-demo",
  hostCommandAdapters: [
    { provider: "family-a", families: [{ id: "injected", title: "Injected", parentId: "alpha", aliases: [], source: "host" }], commands: [injectedHostReadCommand], isEligible: () => true },
    { provider: "family-b", families: [{ id: "injected", title: "Injected", parentId: "beta", aliases: [], source: "host" }], commands: [], isEligible: () => true },
  ],
}, "2026-06-20T00:00:00.000Z"), /Conflicting command family id/, "injected adapters with different parent family hierarchy should fail conflict detection");
const writeScopedHostRuntimeWriteExecute = await executeHostCatalogCommand({
  catalog: writeScopedHostRuntimeBundle.catalog,
  commandId: STANDALONE_DEMO_BOOKING_WRITE_COMMAND_ID,
  commandInput: { name: "VIP" },
  runtimeAdapters: writeScopedHostRuntimeBundle.runtimeAdapters,
  execution: { ...writeScopedHostRuntimeBundle.executionContext, requestId: "req_standalone_host_write_scoped_execute" },
});
assert.equal(writeScopedHostRuntimeWriteExecute.ok, false, "write-scoped standalone host write command remains non-executable without a mounted write runtime binding");
assert.equal(writeScopedHostRuntimeWriteExecute.policy.reasons.includes("runtime_unavailable"), true);
const hostRuntimeIndexSummary = createStandaloneCommandIndexSummary({
  sessionId: "s-host-runtime",
  includeHostRuntime: true,
  hostSessionMode: "standalone-demo",
  pageContext: { surface: "booking-console", commandFamilies: ["booking"], skillFamilies: ["booking-ops"] },
});
assert.equal(hostRuntimeIndexSummary.includes("Command index standalone-demo-host"), true, "host runtime command index summary should opt into the host-composed provider");
assert.equal(hostRuntimeIndexSummary.includes(STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID), true, "page-context command index summary should include the mounted host read command for matching booking surfaces");
assert.equal(hostRuntimeIndexSummary.includes("booking:host"), true, "page-context command index summary should show host family provenance");

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
