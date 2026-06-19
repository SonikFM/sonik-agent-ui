import assert from "node:assert/strict";
import {
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
  createStandaloneToolManifest,
} from "../../packages/platform-adapters/src/index.ts";
import { createStandaloneAvailableToolManifest } from "../../apps/standalone-sveltekit/src/lib/server/tool-manifest.ts";

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

console.log("tool-contracts tests passed");
