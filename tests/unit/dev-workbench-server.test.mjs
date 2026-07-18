import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_REPOSITORY_COMMANDS,
  DEV_WORKBENCH_MIRROR_PATHS,
  DEV_WORKBENCH_PERSISTENT,
  DEV_WORKBENCH_REPOSITORY_ROOT,
  DEV_WORKBENCH_SCHEMA_VERSION,
  devWorkbenchRealtimeEnvelopeSchema,
  pageContextMirrorSchema,
  repositoryManifestSchema,
  terminalConnectionDescriptorSchema,
  visualBrowserStateSchema,
  visualBrowserStateFromResult,
  visualContextOperationPromotesStableArtifact,
  workspaceContextSyncSchema,
  workbenchVisualContextStateSchema,
} from "../../apps/dev-workbench/src/lib/contracts/workbench.ts";
import {
  createDevWindowRefreshPlan,
  createDevWorkbenchBootstrapPlan,
  createRuntimeRehydrationPlan,
} from "../../apps/dev-workbench/src/lib/server/bootstrap-plan.ts";
import {
  createRepositorySitemap,
  createRepositorySitemapFromTrackedFiles,
} from "../../apps/dev-workbench/src/lib/server/repository-sitemap.ts";
import { readDevWorkbenchConfig } from "../../apps/dev-workbench/src/lib/server/workbench-config.ts";
import { authorizeDevWorkbenchRequest } from "../../apps/dev-workbench/src/lib/server/basic-auth.ts";
import { devWorkbenchSessionCookieOptions } from "../../apps/dev-workbench/src/lib/server/session-cookie.ts";
import {
  classifyVisualContextResult,
  createEmbeddedPreviewUrl,
  createVisualContextSubmission,
  defaultVisualSourceId,
  discoverVisualSources,
  hostVisualPersistenceState,
  pendingHostVisualRequestDisabledReason,
  isAgentHostActionRequestMessage,
  isAgentHostActionResultMessage,
  isAgentHostPageContextMessage,
  isVisualContextResultMessage,
  resolveEmbeddedHostColorScheme,
  resolveEmbeddedHostOrigin,
  visualPickDisabledReason,
} from "../../apps/dev-workbench/src/lib/client/host-context-bridge.ts";
import { resolveAgentUiDevApiProxyTarget } from "../../apps/standalone-sveltekit/src/lib/server/dev-api-proxy.ts";

const repository = repositoryManifestSchema.parse({
  schemaVersion: DEV_WORKBENCH_SCHEMA_VERSION,
  repositoryId: "sonikfm.sonik-agent-ui",
  cloneUrl: "https://github.com/sonikfm/sonik-agent-ui.git",
  revision: "abc123def456",
  branch: "main",
  deployment: null,
  commands: DEFAULT_REPOSITORY_COMMANDS,
});
assert.equal(DEV_WORKBENCH_PERSISTENT, true, "developer workspaces retain one provider-managed snapshot for reconnects");

assert.throws(() => visualBrowserStateSchema.parse({ capability: "missing", setup: "idle", disabledReason: null }), /requires a reason/);
assert.doesNotThrow(() => visualBrowserStateSchema.parse({ capability: "missing", setup: "pending", disabledReason: "Controlled browser capture is not installed." }));
assert.equal(visualContextOperationPromotesStableArtifact("get-capabilities"), false);
assert.equal(visualContextOperationPromotesStableArtifact("setup-browser"), false);
assert.equal(visualContextOperationPromotesStableArtifact("capture"), true, "capture alone may enter the G009 stable artifact coordinator");

const visualSources = discoverVisualSources({
  previewUrl: "https://preview.example.test/?private=ignored",
  previewRoute: "/reservations?token=ignored",
  hostOrigin: "https://booking.example.test/private?ignored=true",
  hostRoute: "/booking/42?secret=ignored",
});
assert.deepEqual(visualSources, [
  { id: "preview", label: "Preview", surface: "workbench-preview", route: "/reservations" },
  { id: "host", label: "Host · booking.example.test", surface: "embedded-host", route: "/booking/42" },
]);
assert.equal(defaultVisualSourceId(visualSources), "host", "Connected Host is the default source");
assert.equal(defaultVisualSourceId(visualSources.slice(1)), "host");
const pendingVisualRequest = {
  requestId: "request-1",
  operation: "get-capabilities",
  sourceContextRevision: 2,
  routeRevision: 3,
  source: visualSources[1],
  messageSource: "sonik-agent-ui",
  type: "sonik:visual-context:request",
  version: "sonik.visual-context.v1",
  origin: "https://workbench.example.test",
};
const validVisualResult = {
  ...pendingVisualRequest,
  messageSource: "sonik-agent-host",
  type: "sonik:visual-context:result",
  status: "completed",
  capabilities: [{ operation: "pick", status: "available", provider: "host" }],
};
assert.deepEqual(visualBrowserStateFromResult({ ...validVisualResult, operation: "get-capabilities", provider: "playwright", capabilities: [{ operation: "capture", status: "available", provider: "playwright" }] }), {
  capability: "installed", setup: "idle", disabledReason: null,
});
assert.deepEqual(visualBrowserStateFromResult({ ...validVisualResult, operation: "setup-browser", provider: "playwright", capabilities: [{ operation: "capture", status: "unavailable", provider: "playwright", disabledReason: "Browser unavailable" }] }), {
  capability: "missing", setup: "failed", disabledReason: "Controlled browser capture is not installed.",
});
assert.equal(isVisualContextResultMessage(validVisualResult), true, "Workbench accepts strict neutral Agent Embed results");
assert.equal(isVisualContextResultMessage({
  messageSource: "sonik-agent-ui-host",
  type: "sonik:visual-context:result",
  version: "sonik.visual-context.v1",
}), false, "page-context message provenance must not be accepted as visual-result provenance");
assert.equal(isVisualContextResultMessage({ ...validVisualResult, secret: "Bearer abcdefghijklmnop" }), false, "extra or secret-bearing generic payloads fail closed");
assert.equal(visualPickDisabledReason("host"), null);
assert.match(visualPickDisabledReason("preview") ?? "", /only.*Host/i, "Preview cannot post Host-only picker requests");
assert.equal(classifyVisualContextResult({
  pending: pendingVisualRequest,
  result: { ...validVisualResult, requestId: "old-request" },
  sourceContextRevision: 2,
  routeRevision: 3,
  source: visualSources[1],
}), "ignore", "a late result cannot clear the newer active request");
assert.equal(pendingHostVisualRequestDisabledReason(null), null);
assert.match(pendingHostVisualRequestDisabledReason(pendingVisualRequest) ?? "", /current Host visual request/i);
let rapidPending = null;
let rapidIssueCount = 0;
const issueHostRequest = (request) => {
  if (pendingHostVisualRequestDisabledReason(rapidPending)) return false;
  rapidPending = request;
  rapidIssueCount += 1;
  return true;
};
assert.equal(issueHostRequest(pendingVisualRequest), true);
assert.equal(issueHostRequest({ ...pendingVisualRequest, requestId: "request-2" }), false);
assert.equal(rapidIssueCount, 1, "rapid Host re-entry issues only one request");
assert.equal(rapidPending, pendingVisualRequest, "rapid Host re-entry cannot replace the sole pending request");
let behaviorallyPending = pendingVisualRequest;
if (classifyVisualContextResult({
  pending: behaviorallyPending,
  result: { ...validVisualResult, requestId: "old-request" },
  sourceContextRevision: 2,
  routeRevision: 3,
  source: visualSources[1],
}) === "accept") behaviorallyPending = null;
assert.equal(behaviorallyPending, pendingVisualRequest, "a nonmatching completion leaves the sole pending request intact");
if (classifyVisualContextResult({
  pending: behaviorallyPending,
  result: validVisualResult,
  sourceContextRevision: 2,
  routeRevision: 3,
  source: visualSources[1],
}) === "accept") behaviorallyPending = null;
assert.equal(behaviorallyPending, null, "only the exact matching completion clears the pending request");
assert.equal(classifyVisualContextResult({
  pending: pendingVisualRequest,
  result: validVisualResult,
  sourceContextRevision: 2,
  routeRevision: 3,
  source: { ...visualSources[1], route: "/other" },
}), "invalidate", "the active result must exactly match the current full source");
assert.deepEqual(hostVisualPersistenceState(false, { operation: "capture", status: "completed" }), {
  status: "invalidated", staleReason: "navigation", message: "A stale Host result was discarded. Retry the visual action.",
}, "HTTP 202/accepted=false is stale even when the provider completed");
assert.deepEqual(hostVisualPersistenceState(true, { operation: "capture", status: "completed" }), {
  status: "idle", staleReason: null, message: "Host Capture is current.",
}, "accepted=true alone may report current Host capture");
const workbenchPageSource = readFileSync("apps/dev-workbench/src/routes/+page.svelte", "utf8");
assert.match(workbenchPageSource, /let pendingVisualRequest = \$state\.raw<VisualContextRequest \| null>\(null\)/, "pending Host request readiness is reactive without changing request identity");
assert.ok((workbenchPageSource.match(/pendingHostVisualRequestDisabledReason\(pendingVisualRequest\)/g) ?? []).length >= 4, "UI readiness and every Host action function share the pending-request guard");
assert.match(workbenchPageSource, /classification === "ignore"[^]*classification === "invalidate"[^]*pendingVisualRequest = null/, "nonmatching results return before exact completion clears pending state");
assert.ok((workbenchPageSource.match(/pendingVisualRequest !== request/g) ?? []).length >= 2, "only the exact registration request callback may post or clear pending state");
assert.match(workbenchPageSource, /if \(source\?\.id !== "host"[^]*return unavailableAction/, "Preview is rejected before the Host picker postMessage seam");
assert.equal(workbenchPageSource.match(/isVisualContextResultMessage\(event\.data\)/g)?.length, 1, "only the exact embedded Host window may return picker results");
assert.match(workbenchPageSource, /visualBrowser\?\.capability === "installed"[^]*captureVisualContext/, "Preview Capture is enabled only by an installed browser probe");
assert.match(workbenchPageSource, /aria-live="polite"[^]*announcement/, "browser setup and capture announcements use the existing polite live region");
assert.match(workbenchPageSource, /function cancelHostPicker[^]*operation: "clear"[^]*invalidateVisualContext[^]*cancelHostPicker/, "source changes and navigation clear the host picker before invalidating local state");
assert.match(workbenchPageSource, /return \(\) => \{[^]*cancelHostPicker\(\)[^]*removeEventListener/, "unmount clears the host picker before removing the bridge");
assert.match(workbenchPageSource, /providerLost[^]*visualExtensionPaired = false[^]*"provider-lost"/, "provider or pairing loss resets paired capability and invalidates current context");
assert.match(workbenchPageSource, /selectedVisualSourceId !== sourceId[^]*visualExtensionPaired = false/, "source context changes reset the context-bound extension pairing");
assert.match(workbenchPageSource, /previousRoute[^]*pairingLost = visualExtensionPaired[^]*visualExtensionPaired = false/, "Host navigation resets the active-tab pairing before reporting stale context");
assert.match(workbenchPageSource, /method: "PUT"[^]*body: JSON\.stringify\(request\)[^]*visualContextRequestSchema\.safeParse/, "host operations await a strict server-registered request before postMessage");
assert.match(workbenchPageSource, /submitVisualResult\(request, result\)/, "pairing results reach the existing server telemetry route");
assert.match(workbenchPageSource, /payload\.accepted === true[^]*"Preview Capture is current\."/, "Preview success requires server acceptance, not provider completion alone");
assert.match(workbenchPageSource, /visualContextPersistenceResponseSchema\.safeParse[^]*hostVisualPersistenceState\(persisted\.data\.accepted, result\)/, "Host persistence strictly parses the response before deriving terminal UI");
assert.match(workbenchPageSource, /persistedHostOperation[^]*submitVisualResult\(request, result\)[^]*return/, "Host pick/capture/clear defer terminal success UI until persistence returns");
assert.equal(workbenchPageSource.includes("Booking session context connected."), false, "runtime messaging must not hard-code a Booking host");
assert.match(workbenchPageSource, /hostSourceLabel\(\)[^]*context connected/, "runtime messaging uses the sanitized discovered host label");
const visualBrowserRouteSource = readFileSync("apps/dev-workbench/src/routes/api/workspaces/visual-browser/+server.ts", "utf8");
assert.match(visualBrowserRouteSource, /visualContextRequestSchema\.safeParse/, "the authenticated browser endpoint accepts only strict visual requests");
assert.match(visualBrowserRouteSource, /runWorkspacePlaywrightVisualContext/, "the endpoint delegates to the canonical provider/coordinator service seam");
assert.match(visualBrowserRouteSource, /emitVisualBrowserTelemetry[^]*phase: "started"[^]*phase: "failed"[^]*phase: accepted \? "completed" : "failed"/, "Preview browser requests emit start and terminal telemetry through the privacy-allowlisted seam");
assert.match(visualBrowserRouteSource, /result\.value\.accepted[^]*status: accepted \? 200 : 202/, "the Preview route propagates stale coordinator outcomes without reporting current success");
const workspaceServiceSource = readFileSync("apps/dev-workbench/src/lib/server/workspace-service.ts", "utf8");
assert.equal(workspaceServiceSource.indexOf("capturePlaywrightPreview") < workspaceServiceSource.indexOf("submitWorkspaceVisualContext(sessionId"), true, "provider temp output reaches the G009 coordinator before any stable artifact promotion");
assert.match(workspaceServiceSource, /if \(!visualContextOperationPromotesStableArtifact\(request\.data\.operation\)\)[^]*snapshot: null[^]*submitWorkspaceVisualContext/, "probe/setup return state without taking the stable artifact coordinator lease");
assert.match(workspaceServiceSource, /consumeVisualContextRequest\([^]*parsed\.data\.request\)[^]*if \(!consumed\)[^]*removeSandboxPath\([^]*accepted: false[^]*writeVisualContextRequestRegistry/, "a mutated same-id POST cleans staged pixels and is discarded before the exact issuance is consumed");
assert.deepEqual(
  Object.keys(createVisualContextSubmission("workspace-1", pendingVisualRequest, validVisualResult)),
  ["workspaceSessionId", "request", "result"],
  "visual coordinator submissions preserve the exact pending request beside its result",
);
assert.doesNotThrow(() => workbenchVisualContextStateSchema.parse({
  sources: visualSources,
  selectedSourceId: "preview",
  sourceContextRevision: 2,
  routeRevision: 3,
  status: "invalidated",
  statusMessage: "Route changed.",
  staleReason: "route-changed",
}));
assert.throws(() => workbenchVisualContextStateSchema.parse({
  sources: visualSources.slice(0, 1), selectedSourceId: "host", sourceContextRevision: 0, routeRevision: 0,
  status: "idle", statusMessage: null, staleReason: null,
}), /must be discovered/);

assert.throws(
  () => repositoryManifestSchema.parse({ ...repository, cloneUrl: "https://token@github.com/private/repo.git" }),
  /embedded credentials/,
  "repository URLs must not carry credentials into serializable manifests",
);
assert.throws(
  () => repositoryManifestSchema.parse({ ...repository, unexpected: true }),
  /Unrecognized key/,
  "workbench contracts must reject unknown fields",
);

const firstSitemap = createRepositorySitemap({
  repositoryId: repository.repositoryId,
  revision: repository.revision,
  files: [
    { path: "./apps/dev-workbench/src/routes/+page.svelte", bytes: 20 },
    { path: "package.json", bytes: 10 },
    { path: "package.json", bytes: 10 },
  ],
  packages: [{
    path: "apps/dev-workbench",
    name: "@sonik-agent-ui/dev-workbench",
    private: true,
    scripts: ["build", "dev", "build"],
    workspaceDependencies: ["@sonik-agent-ui/workspace-core"],
  }],
  routes: [{ route: "workbench", file: "apps/dev-workbench/src/routes/+page.svelte", kind: "page" }],
});
const secondSitemap = createRepositorySitemap({
  repositoryId: repository.repositoryId,
  revision: repository.revision,
  files: [
    { path: "package.json", bytes: 10 },
    { path: "apps/dev-workbench/src/routes/+page.svelte", bytes: 20 },
  ],
  packages: [{
    path: "apps/dev-workbench",
    name: "@sonik-agent-ui/dev-workbench",
    private: true,
    scripts: ["dev", "build"],
    workspaceDependencies: ["@sonik-agent-ui/workspace-core"],
  }],
  routes: [{ route: "/workbench", file: "apps/dev-workbench/src/routes/+page.svelte", kind: "page" }],
});
assert.deepEqual(firstSitemap, secondSitemap, "sitemap output and digest must not depend on input order or duplicates");
assert.deepEqual(firstSitemap.importantFiles, ["apps/dev-workbench/src/routes/+page.svelte", "package.json"]);
assert.throws(
  () => createRepositorySitemap({
    repositoryId: repository.repositoryId,
    revision: repository.revision,
    files: [{ path: "../secret.env" }],
    packages: [],
    routes: [],
  }),
  /must stay relative/,
  "sitemap paths cannot escape the repository",
);
assert.throws(
  () => createRepositorySitemap({
    repositoryId: repository.repositoryId,
    revision: repository.revision,
    files: [{ path: "package.json", bytes: 1 }, { path: "package.json", bytes: 2 }],
    packages: [],
    routes: [],
  }),
  /Conflicting repository sitemap entry/,
  "conflicting duplicate paths must not make the sitemap depend on input order",
);

const plan = createDevWorkbenchBootstrapPlan({ sessionId: "session_123", repository });
assert.equal(plan.repositoryRoot, DEV_WORKBENCH_REPOSITORY_ROOT);
assert.equal(plan.previewPort, 3000);
assert.deepEqual(plan.windows.map((window) => window.name), ["codex", "dev", "shell", "logs"]);
assert.deepEqual(plan.commands.map((command) => command.id), [
  "install-tmux",
  "prepare-workspace",
  "clone-repository",
  "checkout-revision",
  "install-dependencies",
  "start-codex-window",
  "start-dev-window",
  "start-shell-window",
  "start-logs-window",
  "select-codex-window",
]);
assert.equal(plan.commands[2].args.at(-1), DEV_WORKBENCH_REPOSITORY_ROOT);
assert.equal(plan.windows[0].command.includes(`SONIK_HOST_AUTHORITY_PATH=${DEV_WORKBENCH_MIRROR_PATHS.hostAuthority}`), true);
assert.equal(plan.windows[3].command.join(" ").includes("Pipe B access is not configured"), true);
assert.equal(DEFAULT_REPOSITORY_COMMANDS.dev.includes("--"), false, "Vite flags must reach the dev script without a positional delimiter");
const hostedPlan = createDevWorkbenchBootstrapPlan({
  sessionId: "session_123",
  repository,
  previewHost: "sb-example.vercel.run",
  agentApiOrigin: "https://agent.example.com",
});
assert.equal(hostedPlan.windows[1].command[0], "env");
assert.equal(hostedPlan.windows[1].command.includes("__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=sb-example.vercel.run"), true);
assert.equal(hostedPlan.windows[1].command.includes("SONIK_AGENT_UI_DEV_API_ORIGIN=https://agent.example.com"), true);
assert.deepEqual(createRuntimeRehydrationPlan({ sessionId: "session_123", repository }).commands.map((command) => command.id), [
  "install-tmux",
  "start-codex-window",
  "start-dev-window",
  "start-shell-window",
  "start-logs-window",
  "select-codex-window",
]);
const devRefreshPlan = createDevWindowRefreshPlan({
  sessionId: "session_123",
  repository,
  previewHost: "sb-example.vercel.run",
  agentApiOrigin: "https://agent.example.com",
});
assert.deepEqual(devRefreshPlan.commands.map((command) => command.id), [
  "kill-dev-window",
  "restart-dev-window",
]);
assert.equal(
  devRefreshPlan.commands[1].args.join(" ").includes("SONIK_AGENT_UI_DEV_API_ORIGIN=https://agent.example.com"),
  true,
  "preview-only refreshes must adopt the trusted API proxy without terminating the Codex tmux window",
);

const terminal = terminalConnectionDescriptorSchema.parse({
  kind: "terminal",
  transport: "vercel-interactive-v1",
  url: "wss://interactive.vercel.run/connect",
  accessToken: "short-lived-token",
  sandboxExpiresAt: "2026-07-16T12:30:00.000Z",
  credentialExpiresAt: null,
  sandboxSessionId: "sbx-session-1",
  tmuxSession: plan.tmuxSession,
  attachCommand: ["tmux", "attach-session", "-t", plan.tmuxSession],
  protocol: {
    authorization: "query-token",
    startFrame: "json",
    resizeFrame: "json",
    stdin: "binary",
    stdout: "binary",
  },
});
assert.equal(terminal.transport, "vercel-interactive-v1", "terminal uses the provider-native interactive protocol");

const event = devWorkbenchRealtimeEnvelopeSchema.parse({
  schemaVersion: DEV_WORKBENCH_SCHEMA_VERSION,
  eventId: "evt-1",
  sequence: 1,
  occurredAt: "2026-07-16T12:00:00.000Z",
  sessionId: "session-123",
  organizationId: "org-123",
  channelKey: ["org", "org-123", "agentChannel", "session-123"],
  payload: { type: "page-context.updated", path: DEV_WORKBENCH_MIRROR_PATHS.pageContext },
});
assert.equal(JSON.stringify(event).includes("accessToken"), false, "realtime wires must never broadcast terminal credentials");

const trackedSitemap = createRepositorySitemapFromTrackedFiles(repository, [
  "apps/dev-workbench/src/routes/+page.svelte",
  "apps/dev-workbench/src/routes/api/workspaces/+server.ts",
  "src/routes/account/+page.svelte",
  "package.json",
]);
assert.deepEqual(trackedSitemap.routes.map(({ route, kind }) => ({ route, kind })), [
  { route: "/account", kind: "page" },
  { route: "/api/workspaces", kind: "endpoint" },
  { route: "/", kind: "page" },
]);

assert.deepEqual(readDevWorkbenchConfig({ DEV_WORKBENCH_ENABLED: "false" }), {
  ok: false,
  reason: "Dev Workbench is disabled by server configuration.",
});
const configured = readDevWorkbenchConfig({
  DEV_WORKBENCH_ENABLED: "true",
  DEV_WORKBENCH_REPOSITORY_URL: "https://github.com/sonikfm/sonik-agent-ui.git",
  DEV_WORKBENCH_REPOSITORY_REVISION: "main",
  DEV_WORKBENCH_ORGANIZATION_ID: "sonikfm",
  DEV_WORKBENCH_TIMEOUT_MS: "2700000",
});
assert.equal(configured.ok, true);
if (configured.ok) {
  assert.equal(configured.value.repository.repositoryId, "github.com.sonikfm.sonik-agent-ui");
  assert.deepEqual(configured.value.repository.commands.codex, ["npx", "--yes", "@openai/codex@0.144.5"]);
  assert.equal(configured.value.agentApiOrigin, "https://sonik-agent-ui.liam-trampota.workers.dev");
  assert.equal(configured.value.pipeBWorker, "sonik-dev-observability-pipe-b");
  assert.equal(configured.value.cloudflareApiToken, null);
}
assert.deepEqual(devWorkbenchSessionCookieOptions(new URL("https://workbench.example.com")), {
  httpOnly: true,
  sameSite: "none",
  secure: true,
  partitioned: true,
  path: "/",
  maxAge: 30 * 24 * 60 * 60,
});
assert.equal(resolveAgentUiDevApiProxyTarget({}), null);
assert.equal(resolveAgentUiDevApiProxyTarget({ SONIK_AGENT_UI_DEV_API_ORIGIN: "https://agent.example.com" }), "https://agent.example.com");
assert.throws(() => resolveAgentUiDevApiProxyTarget({ SONIK_AGENT_UI_DEV_API_ORIGIN: "http://agent.example.com" }), /must use HTTPS/);

const signedDonation = {
  source: "sonik-agent-ui-host",
  type: "sonik:agent-ui:page-context",
  payload: { authenticated: true, organizationId: "org-1", signature: "opaque" },
  sentAt: "2026-07-16T00:00:00.000Z",
};
assert.equal(isAgentHostPageContextMessage(signedDonation), true);
assert.equal(resolveEmbeddedHostOrigin({
  search: "?agentUiHostOrigin=https%3A%2F%2Fbooking.sonik.fm",
  referrer: "https://booking.sonik.fm/settings",
  allowlist: "https://*.sonik.fm",
}), "https://booking.sonik.fm");
assert.equal(resolveEmbeddedHostOrigin({
  search: "?agentUiHostOrigin=https%3A%2F%2Fevil.example.com",
  referrer: "https://evil.example.com/",
  allowlist: "https://*.sonik.fm",
}), null);
assert.equal(resolveEmbeddedHostColorScheme("?colorScheme=dark"), "dark");
assert.equal(resolveEmbeddedHostColorScheme("?colorScheme=light"), "light");
assert.equal(resolveEmbeddedHostColorScheme("?colorScheme=sepia"), null);
const embeddedPreview = new URL(createEmbeddedPreviewUrl({
  previewUrl: "https://sandbox.vercel.run/",
  workbenchOrigin: "https://workbench.vercel.app",
  theme: "neumorphic-dark",
}));
assert.equal(embeddedPreview.searchParams.get("agentUiHostOrigin"), "https://workbench.vercel.app");
assert.equal(embeddedPreview.searchParams.get("embedMode"), "workspace");
assert.equal(isAgentHostActionRequestMessage({ source: "sonik-agent-ui", type: "sonik:agent-ui:action-request" }), true);
assert.equal(isAgentHostActionResultMessage({ source: "sonik-agent-ui-host", type: "sonik:agent-ui:action-result" }), true);

const authorization = `Basic ${Buffer.from("developer:correct horse battery staple").toString("base64")}`;
assert.deepEqual(authorizeDevWorkbenchRequest({
  enabled: true,
  username: "developer",
  password: "correct horse battery staple",
  authorization,
  protocol: "https:",
  hostname: "workbench.example.com",
}), { allowed: true });
assert.equal(authorizeDevWorkbenchRequest({
  enabled: true,
  username: "developer",
  password: "correct horse battery staple",
  authorization: null,
  protocol: "https:",
  hostname: "workbench.example.com",
}).status, 401);
assert.equal(authorizeDevWorkbenchRequest({
  enabled: true,
  username: "developer",
  password: "correct horse battery staple",
  authorization,
  protocol: "http:",
  hostname: "workbench.example.com",
}).status, 503);

const mirroredContext = pageContextMirrorSchema.parse({
  schemaVersion: "1.0",
  route: "/",
  url: "/",
  title: "Sonik Dev Workbench",
  theme: "host",
  auth: { signedIn: false, organizationPresent: true, source: "server-session" },
  domain: {
    repository: { name: "sonikfm/sonik-agent-ui", branch: "main", revision: "abc123", dirty: false },
    previewPath: "/",
    tmuxSession: plan.tmuxSession,
    workingDirectory: DEV_WORKBENCH_REPOSITORY_ROOT,
  },
  interaction: { kind: "ready", activeDetail: "problems" },
  actions: { captureSnapshot: { enabled: true, disabledReason: null } },
  assertions: { browserContextIsDisplayOnly: true },
  correlation: { sessionId: "session-123", sandboxSessionId: "sandbox-session-123" },
  warnings: [],
  errors: [],
  browserContextAuthority: "display-only",
});
assert.equal(JSON.stringify(mirroredContext).includes("accessToken"), false);
assert.throws(
  () => pageContextMirrorSchema.parse({ ...mirroredContext, accessToken: "must-not-pass" }),
  /Unrecognized key/,
);
const syncedContext = workspaceContextSyncSchema.parse({
  pageContext: mirroredContext,
  host: {
    origin: "https://booking.sonik.fm",
    pageContext: { route: "/reservations", authenticated: true },
    authority: {
      header: "opaque_signed_host_authority",
      revision: 1,
      expiresAt: "2026-07-16T12:30:00.000Z",
    },
  },
});
assert.equal(syncedContext.host?.authority?.header, "opaque_signed_host_authority");
assert.throws(
  () => workspaceContextSyncSchema.parse({ ...syncedContext, host: { ...syncedContext.host, origin: "http://localhost:3000" } }),
  /Expected an HTTPS URL/,
  "server-side OpenAPI synchronization only accepts an allowlisted HTTPS host origin",
);

console.log("dev-workbench server contracts: ok");
