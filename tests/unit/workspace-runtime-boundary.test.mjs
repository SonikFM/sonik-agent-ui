import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createAsyncWorkspacePersistenceAdapter,
  createInMemoryWorkspacePersistence,
  createMemoryWorkspaceRuntime,
} from "../../packages/workspace-session/src/index.ts";
import {
  AGENT_UI_HOST_CONTEXT_HEADER,
  WorkspaceRuntimeResolutionError,
  createRequestWorkspaceServices,
  createSignedTrustedHostContextHeader,
  createWorkspaceRuntimeDiagnosticHeaders,
  encodeTrustedHostContextHeader,
  resolveWorkspacePersistencePolicy,
  resolveWorkspaceRuntime,
  resolveWorkspaceRuntimeDiagnostics,
} from "../../apps/standalone-sveltekit/src/lib/server/workspace-services.ts";

const syncPersistence = createInMemoryWorkspacePersistence();
const asyncPersistence = createAsyncWorkspacePersistenceAdapter(syncPersistence);
const session = await asyncPersistence.createSession({ id: "async-boundary-session", name: "Async Boundary" });
await asyncPersistence.appendMessage({ session_id: session.id, role: "user", content: "persist through async facade" });
assert.equal((await asyncPersistence.getSession(session.id))?.message_count, 1, "async wrapper should preserve sync adapter behavior");
assert.equal((await asyncPersistence.listMessages(session.id))[0]?.content, "persist through async facade");

const memoryRuntime = createMemoryWorkspaceRuntime({ persistence: syncPersistence, reason: "local" });
assert.equal(memoryRuntime.kind, "memory");
assert.equal(memoryRuntime.reason, "local");
assert.equal((await memoryRuntime.persistence.getSession(session.id))?.id, session.id);

assert.equal(resolveWorkspacePersistencePolicy(), "memory", "default request policy should preserve local memory behavior");
assert.equal(resolveWorkspacePersistencePolicy({ env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "auto" } }), "auto");
assert.throws(
  () => resolveWorkspacePersistencePolicy({ env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "sqlite" } }),
  WorkspaceRuntimeResolutionError,
  "invalid persistence mode should fail closed",
);
assert.throws(
  () => resolveWorkspacePersistencePolicy({ env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "cloud" }, override: "memory" }),
  /cloud is authoritative/,
  "explicit cloud env should not be downgradable by caller policy",
);

const localServices = createRequestWorkspaceServices(null);
assert.equal(localServices.persistencePolicy, "memory");
assert.equal(localServices.persistenceMode, "memory");
assert.equal(localServices.runtime.kind, "memory");
assert.equal((await localServices.persistence.createSession({ id: "request-local-session" })).id, "request-local-session");

const autoRuntime = resolveWorkspaceRuntime({ event: { platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "auto" } } } });
assert.equal(autoRuntime.kind, "memory", "auto policy should fall back to memory when DB/host context are unavailable");
assert.equal(autoRuntime.kind === "memory" ? autoRuntime.reason : null, "cloud-unavailable");

const autoDiagnostics = resolveWorkspaceRuntimeDiagnostics({ platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "auto" } } });
assert.equal(autoDiagnostics.policy, "auto", "runtime diagnostics should report the effective persistence policy");
assert.equal(autoDiagnostics.mode, "memory", "runtime diagnostics should report the mounted runtime mode");
assert.equal(autoDiagnostics.memoryReason, "cloud-unavailable", "runtime diagnostics should surface auto fallback reason without secrets");
const autoDiagnosticHeaders = createWorkspaceRuntimeDiagnosticHeaders({ platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "auto" } } });
assert.equal(autoDiagnosticHeaders["x-sonik-agent-ui-persistence-policy"], "auto", "diagnostic headers should expose persistence policy for smoke gates");
assert.equal(autoDiagnosticHeaders["x-sonik-agent-ui-persistence-mode"], "memory", "diagnostic headers should expose runtime mode for smoke gates");
assert.equal(autoDiagnosticHeaders["x-sonik-agent-ui-host-user"], "missing", "diagnostic headers should report missing trusted host user without exposing identities");
const invalidDiagnosticHeaders = createWorkspaceRuntimeDiagnosticHeaders({ platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "sqlite" } } });
assert.equal(invalidDiagnosticHeaders["x-sonik-agent-ui-persistence-policy"], "invalid", "diagnostic headers should fail safe when persistence policy parsing fails");
assert.equal(invalidDiagnosticHeaders["x-sonik-agent-ui-cloud-error"], "invalid-persistence-policy", "diagnostic headers should preserve invalid policy error code for failure responses");

assert.throws(
  () => resolveWorkspaceRuntime({ event: { platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "cloud" } } } }),
  /requires SONIK_AGENT_UI_DATABASE_URL/,
  "explicit cloud mode should fail closed when DB env is missing",
);

assert.throws(
  () => resolveWorkspaceRuntime({ event: { platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "cloud", SONIK_AGENT_UI_DATABASE_URL: "postgres://user:pass@example.neon.tech/db" } } } }),
  /requires authenticated host session context/,
  "explicit cloud mode should fail closed when authenticated host context is missing",
);

const hostContextHeader = encodeTrustedHostContextHeader({
  authenticated: true,
  organizationId: "org-a",
  scopes: ["workspace:read", "workspace:write"],
  hostSession: {
    source: "amplify-embedded",
    sessionId: "host-session-a",
    userId: "user-a",
    principalId: "principal-a",
    organizationId: "org-a",
    authenticated: true,
    scopes: ["workspace:read", "workspace:write"],
  },
});
assert.throws(
  () => resolveWorkspaceRuntime({ event: { platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "cloud", SONIK_AGENT_UI_DATABASE_URL: "postgres://user:pass@example.neon.tech/db" } }, request: new Request("https://agent.example/api/session", { headers: { [AGENT_UI_HOST_CONTEXT_HEADER]: hostContextHeader, "x-sonik-request-id": "request-a" } }) } }),
  /requires authenticated host session context/,
  "unsigned browser host-context headers must not mount the cloud runtime by default",
);

assert.throws(
  () => resolveWorkspaceRuntime({ event: { platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "cloud", SONIK_AGENT_UI_DATABASE_URL: "postgres://user:pass@example.neon.tech/db", SONIK_AGENT_UI_ALLOW_UNSIGNED_HOST_CONTEXT: "true" } }, request: new Request("https://agent.example/api/session", { headers: { [AGENT_UI_HOST_CONTEXT_HEADER]: hostContextHeader, "x-sonik-request-id": "request-forged" } }) } }),
  /requires authenticated host session context/,
  "cloud mode must ignore unsigned browser host-context headers even when a deployed env accidentally enables the dev fixture flag",
);

const signedHostContextHeader = createSignedTrustedHostContextHeader({
  secret: "test-host-context-secret",
  context: {
    authenticated: true,
    organizationId: "org-signed",
    scopes: ["workspace:read", "workspace:write"],
    hostSession: {
      source: "amplify-embedded",
      sessionId: "signed-host-session",
      userId: "user-signed",
      principalId: "principal-signed",
      organizationId: "org-signed",
      authenticated: true,
      scopes: ["workspace:read", "workspace:write"],
    },
  },
});
const signedCloudRuntime = resolveWorkspaceRuntime({
  event: {
    platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "cloud", SONIK_AGENT_UI_DATABASE_URL: "postgres://user:pass@example.neon.tech/db", SONIK_AGENT_UI_HOST_CONTEXT_SECRET: "test-host-context-secret" } },
    request: new Request("https://agent.example/api/session", { headers: { [AGENT_UI_HOST_CONTEXT_HEADER]: signedHostContextHeader, "x-sonik-request-id": "request-signed" } }),
  },
});
assert.equal(signedCloudRuntime.kind, "cloud", "signed embedded host context should mount the cloud runtime");
assert.equal(signedCloudRuntime.kind === "cloud" ? signedCloudRuntime.authorized.organizationId : null, "org-signed");
assert.equal(signedCloudRuntime.kind === "cloud" ? signedCloudRuntime.authorized.userId : null, "user-signed");

const cloudEvent = {
  platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "cloud", SONIK_AGENT_UI_DATABASE_URL: "postgres://user:pass@example.neon.tech/db" } },
  request: new Request("https://agent.example/api/session", { headers: { "x-sonik-request-id": "request-a" } }),
  locals: {
    agentUiHostSession: {
      source: "amplify-embedded",
      sessionId: "host-session-a",
      userId: "user-a",
      principalId: "principal-a",
      organizationId: "org-a",
      authenticated: true,
      scopes: ["workspace:read", "workspace:write"],
    },
  },
};
const cloudRuntime = resolveWorkspaceRuntime({ event: cloudEvent });
assert.equal(cloudRuntime.kind, "cloud", "explicit cloud mode should mount the cloud runtime when DB and server-local trusted host context are present");
assert.equal(cloudRuntime.kind === "cloud" ? cloudRuntime.authorized.organizationId : null, "org-a");
assert.equal(cloudRuntime.kind === "cloud" ? cloudRuntime.authorized.userId : null, "user-a");
const cloudDiagnosticHeaders = createWorkspaceRuntimeDiagnosticHeaders(cloudEvent);
assert.equal(cloudDiagnosticHeaders["x-sonik-agent-ui-persistence-mode"], "cloud", "diagnostic headers should prove cloud runtime mounting when trusted host context is complete");
assert.equal(cloudDiagnosticHeaders["x-sonik-agent-ui-host-org"], "present", "diagnostic headers should prove host org context is present without leaking org id");
assert.equal(cloudDiagnosticHeaders["x-sonik-agent-ui-host-user"], "present", "diagnostic headers should prove host user context is present without leaking user id");

const sessionOnlyHeader = encodeTrustedHostContextHeader({
  authenticated: true,
  organizationId: "org-session-only",
  hostSession: {
    source: "amplify-embedded",
    sessionId: "browser-session-is-not-user-authority",
    organizationId: "org-session-only",
    authenticated: true,
    scopes: ["workspace:read"],
  },
});
assert.throws(
  () => resolveWorkspaceRuntime({ event: { platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "cloud", SONIK_AGENT_UI_DATABASE_URL: "postgres://user:pass@example.neon.tech/db" } }, request: new Request("https://agent.example/api/session", { headers: { [AGENT_UI_HOST_CONTEXT_HEADER]: sessionOnlyHeader } }) } }),
  /requires authenticated host session context/,
  "host session ids must not be promoted into user authority for cloud RLS context",
);

assert.throws(
  () => resolveWorkspaceRuntime({ event: { platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "cloud" } } }, policy: "memory" }),
  /cloud is authoritative/,
  "direct runtime resolution should not downgrade cloud env with caller policy",
);

assert.throws(
  () => createRequestWorkspaceServices(null, { policy: "cloud", persistence: createInMemoryWorkspacePersistence() }),
  /requires SONIK_AGENT_UI_DATABASE_URL/,
  "explicit cloud mode should fail closed even if a test/local persistence adapter is supplied",
);
assert.throws(
  () => createRequestWorkspaceServices({ platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "cloud" } } }, { policy: "memory" }),
  /cloud is authoritative/,
  "request env cloud mode should be authoritative over caller policy",
);

const routeFiles = await collectFiles("apps/standalone-sveltekit/src/routes/api");
const cloudMarkers = [
  "createRequestWorkspaceServices",
  "resolveWorkspaceRuntime",
  "SONIK_AGENT_UI_PERSISTENCE_MODE",
  "cloud-v0",
];
const singletonImportMarkers = [
  "from \"$lib/server/workspace-store",
  "from '$lib/server/workspace-store",
  "from \"../../../lib/server/workspace-store",
  "from '../../../lib/server/workspace-store",
  "from \"$lib/server/workspace-document-store",
  "from '$lib/server/workspace-document-store",
  "from \"../../../lib/server/workspace-document-store",
  "from '../../../lib/server/workspace-document-store",
];
const singletonIdentifierMarkers = [
  "getWorkspacePersistenceAdapter",
  "workspaceServices.persistence",
  "workspacePersistence",
];
const localOnlySingletonRouteAllowlist = new Set([]);

let singletonBackedRouteCount = 0;
for (const file of routeFiles) {
  const source = await readFile(file, "utf8");
  const importsSingleton = singletonImportMarkers.some((marker) => source.includes(marker));
  const usesSingletonIdentifier = singletonIdentifierMarkers.some((marker) => source.includes(marker));
  const isSingletonBacked = importsSingleton || usesSingletonIdentifier;
  const isCloudEnabled = cloudMarkers.some((marker) => source.includes(marker));
  if (isSingletonBacked) {
    singletonBackedRouteCount += 1;
    assert.equal(
      localOnlySingletonRouteAllowlist.has(file),
      true,
      `singleton-backed workspace route ${file} must be explicitly allowlisted as local-only compatibility`,
    );
  }
  if (!isCloudEnabled) continue;
  assert.equal(isSingletonBacked, false, `cloud-enabled route ${file} must not use singleton-backed workspace persistence`);
}
assert.equal(singletonBackedRouteCount, localOnlySingletonRouteAllowlist.size, "local-only singleton route allowlist must match the current import graph exactly");

const wranglerSource = await readFile("apps/standalone-sveltekit/wrangler.jsonc", "utf8");
assert.equal(wranglerSource.includes("SONIK_AGENT_UI_ALLOW_UNSIGNED_HOST_CONTEXT"), false, "deployed Worker config must not enable unsigned browser host-context authority");

const servicesSource = await readFile("apps/standalone-sveltekit/src/lib/server/workspace-services.ts", "utf8");
assert.equal(servicesSource.includes("createCloudWorkspaceRuntime"), true, "cloud runtime should be mounted through the workspace-session adapter");
assert.equal(servicesSource.includes("SONIK_AGENT_UI_DATABASE_URL"), true, "cloud runtime should use current Worker env database bindings");
assert.equal(servicesSource.includes("process.env"), false, "request runtime resolver must not use ambient process.env for deployed policy");
assert.equal(servicesSource.includes("createWorkspaceRuntimeDiagnosticHeaders"), true, "workspace runtime should expose safe diagnostic headers for deployed smoke tests");
assert.equal(servicesSource.includes("resolveHostSessionFromLocals"), true, "cloud runtime authority should come from a server-local auth adapter seam");
assert.equal(servicesSource.includes("isUnsignedBrowserHostContextAllowed"), true, "unsigned browser host context should be explicitly gated as a fixture path, not a default runtime authority source");
assert.equal(servicesSource.includes("cleanRuntimeString(sessionId)"), false, "trusted runtime must not derive user authority from a browser/session id fallback");

console.log("workspace-runtime-boundary tests passed");

async function collectFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    if (entry.isFile() && path.endsWith(".ts")) files.push(path);
  }
  return files;
}
