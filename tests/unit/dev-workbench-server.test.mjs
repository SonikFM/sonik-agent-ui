import assert from "node:assert/strict";
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
} from "../../apps/dev-workbench/src/lib/contracts/workbench.ts";
import {
  createDevWorkbenchBootstrapPlan,
  createRuntimeRehydrationPlan,
} from "../../apps/dev-workbench/src/lib/server/bootstrap-plan.ts";
import {
  createRepositorySitemap,
  createRepositorySitemapFromTrackedFiles,
} from "../../apps/dev-workbench/src/lib/server/repository-sitemap.ts";
import { readDevWorkbenchConfig } from "../../apps/dev-workbench/src/lib/server/workbench-config.ts";
import { authorizeDevWorkbenchRequest } from "../../apps/dev-workbench/src/lib/server/basic-auth.ts";

const repository = repositoryManifestSchema.parse({
  schemaVersion: DEV_WORKBENCH_SCHEMA_VERSION,
  repositoryId: "sonikfm.sonik-agent-ui",
  cloneUrl: "https://github.com/sonikfm/sonik-agent-ui.git",
  revision: "abc123def456",
  branch: "main",
  deployment: null,
  commands: DEFAULT_REPOSITORY_COMMANDS,
});
assert.equal(DEV_WORKBENCH_PERSISTENT, false, "the first slice must not retain unregistered sandbox snapshots");

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
assert.deepEqual(plan.windows.map((window) => window.name), ["codex", "dev", "shell"]);
assert.deepEqual(plan.commands.map((command) => command.id), [
  "install-tmux",
  "prepare-workspace",
  "clone-repository",
  "checkout-revision",
  "install-dependencies",
  "start-codex-window",
  "start-dev-window",
  "start-shell-window",
  "select-codex-window",
]);
assert.equal(plan.commands[2].args.at(-1), DEV_WORKBENCH_REPOSITORY_ROOT);
assert.equal(DEFAULT_REPOSITORY_COMMANDS.dev.includes("--"), false, "Vite flags must reach the dev script without a positional delimiter");
const hostedPlan = createDevWorkbenchBootstrapPlan({
  sessionId: "session_123",
  repository,
  previewHost: "sb-example.vercel.run",
});
assert.deepEqual(hostedPlan.windows[1].command.slice(0, 2), [
  "env",
  "__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=sb-example.vercel.run",
]);
assert.deepEqual(createRuntimeRehydrationPlan({ sessionId: "session_123", repository }).commands.map((command) => command.id), [
  "install-tmux",
  "start-codex-window",
  "start-dev-window",
  "start-shell-window",
  "select-codex-window",
]);

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
}

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

console.log("dev-workbench server contracts: ok");
