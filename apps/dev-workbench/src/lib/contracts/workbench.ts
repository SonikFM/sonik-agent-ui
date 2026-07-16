import { z } from "zod";

export const DEV_WORKBENCH_SCHEMA_VERSION = "sonik.dev-workbench.v1" as const;
export const DEV_WORKBENCH_ROOT = "/vercel/sandbox/workspace" as const;
export const DEV_WORKBENCH_REPOSITORY_ROOT = `${DEV_WORKBENCH_ROOT}/repo` as const;
export const DEV_WORKBENCH_STATE_ROOT = `${DEV_WORKBENCH_ROOT}/.sonik` as const;
export const DEV_WORKBENCH_PREVIEW_PORT = 3000 as const;
export const DEV_WORKBENCH_PERSISTENT = false as const;

const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const gitRevisionSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._/@{}~^:+-]*$/);
const commandSchema = z.array(z.string().min(1).max(1_024)).min(1).max(64);
const isoDateSchema = z.string().datetime({ offset: true });

const httpsUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && url.username === "" && url.password === "";
}, "Expected an HTTPS URL without embedded credentials");

const webSocketUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (url.protocol === "wss:" || url.protocol === "ws:") && url.username === "" && url.password === "";
}, "Expected a WebSocket URL without embedded credentials");

export const repositoryCommandsSchema = z.object({
  install: commandSchema,
  dev: commandSchema,
  test: commandSchema,
  build: commandSchema,
  codex: commandSchema,
}).strict();
export type RepositoryCommands = z.infer<typeof repositoryCommandsSchema>;

export const DEFAULT_REPOSITORY_COMMANDS = repositoryCommandsSchema.parse({
  install: ["npx", "--yes", "pnpm@11.1.3", "install", "--frozen-lockfile"],
  dev: ["npx", "--yes", "pnpm@11.1.3", "dev", "--host", "0.0.0.0", "--port", String(DEV_WORKBENCH_PREVIEW_PORT)],
  test: ["pnpm", "test"],
  build: ["pnpm", "build"],
  codex: ["npx", "--yes", "@openai/codex@0.144.5"],
});

export const repositoryManifestSchema = z.object({
  schemaVersion: z.literal(DEV_WORKBENCH_SCHEMA_VERSION),
  repositoryId: identifierSchema,
  cloneUrl: httpsUrlSchema,
  revision: gitRevisionSchema,
  branch: gitRevisionSchema.nullable(),
  deployment: z.object({
    id: identifierSchema,
    url: httpsUrlSchema,
  }).strict().nullable(),
  commands: repositoryCommandsSchema,
}).strict();
export type RepositoryManifest = z.infer<typeof repositoryManifestSchema>;

export const repositoryFileInputSchema = z.object({
  path: z.string().min(1).max(2_048),
  bytes: z.number().int().nonnegative().optional(),
}).strict();
export type RepositoryFileInput = z.infer<typeof repositoryFileInputSchema>;

export const repositoryPackageInputSchema = z.object({
  path: z.string().min(1).max(2_048),
  name: z.string().min(1).max(256),
  private: z.boolean(),
  scripts: z.array(z.string().min(1).max(128)).max(128),
  workspaceDependencies: z.array(z.string().min(1).max(256)).max(512),
}).strict();
export type RepositoryPackageInput = z.infer<typeof repositoryPackageInputSchema>;

export const repositoryRouteInputSchema = z.object({
  route: z.string().min(1).max(2_048),
  file: z.string().min(1).max(2_048),
  kind: z.enum(["page", "layout", "endpoint", "error"]),
}).strict();
export type RepositoryRouteInput = z.infer<typeof repositoryRouteInputSchema>;

export const repositorySitemapInputSchema = z.object({
  repositoryId: identifierSchema,
  revision: gitRevisionSchema,
  files: z.array(repositoryFileInputSchema).max(250_000),
  packages: z.array(repositoryPackageInputSchema).max(10_000),
  routes: z.array(repositoryRouteInputSchema).max(50_000),
}).strict();
export type RepositorySitemapInput = z.infer<typeof repositorySitemapInputSchema>;

export const repositorySitemapSchema = z.object({
  schemaVersion: z.literal(DEV_WORKBENCH_SCHEMA_VERSION),
  repositoryId: identifierSchema,
  revision: gitRevisionSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(repositoryFileInputSchema),
  packages: z.array(repositoryPackageInputSchema),
  routes: z.array(repositoryRouteInputSchema),
  importantFiles: z.array(z.string().min(1).max(2_048)),
}).strict();
export type RepositorySitemap = z.infer<typeof repositorySitemapSchema>;

export const tmuxWindowSchema = z.object({
  name: z.enum(["codex", "dev", "shell"]),
  index: z.number().int().min(0).max(2),
  command: commandSchema,
  workingDirectory: z.literal(DEV_WORKBENCH_REPOSITORY_ROOT),
}).strict();
export type TmuxWindow = z.infer<typeof tmuxWindowSchema>;

export const pageContextMirrorPathsSchema = z.object({
  pageContext: z.literal(`${DEV_WORKBENCH_STATE_ROOT}/page-context.json`),
  consoleEvents: z.literal(`${DEV_WORKBENCH_STATE_ROOT}/console.jsonl`),
  networkEvents: z.literal(`${DEV_WORKBENCH_STATE_ROOT}/network.jsonl`),
  latestScreenshot: z.literal(`${DEV_WORKBENCH_STATE_ROOT}/screenshots/latest.png`),
  sitemap: z.literal(`${DEV_WORKBENCH_STATE_ROOT}/sitemap.json`),
  workspace: z.literal(`${DEV_WORKBENCH_STATE_ROOT}/workspace.json`),
}).strict();
export type PageContextMirrorPaths = z.infer<typeof pageContextMirrorPathsSchema>;

export const DEV_WORKBENCH_MIRROR_PATHS = pageContextMirrorPathsSchema.parse({
  pageContext: `${DEV_WORKBENCH_STATE_ROOT}/page-context.json`,
  consoleEvents: `${DEV_WORKBENCH_STATE_ROOT}/console.jsonl`,
  networkEvents: `${DEV_WORKBENCH_STATE_ROOT}/network.jsonl`,
  latestScreenshot: `${DEV_WORKBENCH_STATE_ROOT}/screenshots/latest.png`,
  sitemap: `${DEV_WORKBENCH_STATE_ROOT}/sitemap.json`,
  workspace: `${DEV_WORKBENCH_STATE_ROOT}/workspace.json`,
});

export const devWorkbenchLifecycleStatusSchema = z.enum([
  "provisioning",
  "cloning",
  "installing",
  "starting",
  "ready",
  "suspending",
  "suspended",
  "stopping",
  "stopped",
  "failed",
]);
export type DevWorkbenchLifecycleStatus = z.infer<typeof devWorkbenchLifecycleStatusSchema>;

export const previewConnectionDescriptorSchema = z.object({
  kind: z.literal("preview"),
  url: httpsUrlSchema,
  port: z.literal(DEV_WORKBENCH_PREVIEW_PORT),
  expiresAt: isoDateSchema,
  sandboxSessionId: identifierSchema,
}).strict();
export type PreviewConnectionDescriptor = z.infer<typeof previewConnectionDescriptorSchema>;

export const terminalConnectionDescriptorSchema = z.object({
  kind: z.literal("terminal"),
  transport: z.literal("vercel-interactive-v1"),
  url: webSocketUrlSchema,
  accessToken: z.string().min(1).max(16_384),
  sandboxExpiresAt: isoDateSchema,
  credentialExpiresAt: isoDateSchema.nullable(),
  sandboxSessionId: identifierSchema,
  tmuxSession: identifierSchema,
  attachCommand: z.tuple([z.literal("tmux"), z.literal("attach-session"), z.literal("-t"), identifierSchema]),
  protocol: z.object({
    authorization: z.literal("query-token"),
    startFrame: z.literal("json"),
    resizeFrame: z.literal("json"),
    stdin: z.literal("binary"),
    stdout: z.literal("binary"),
  }).strict(),
}).strict();
export type TerminalConnectionDescriptor = z.infer<typeof terminalConnectionDescriptorSchema>;

export const sanitizedWorkbenchErrorSchema = z.object({
  code: z.enum([
    "sandbox_create_failed",
    "sandbox_resume_failed",
    "sandbox_bootstrap_failed",
    "sandbox_connection_failed",
    "sandbox_stop_failed",
    "sandbox_delete_failed",
    "invalid_repository_manifest",
    "invalid_bootstrap_plan",
    "unknown",
  ]),
  message: z.string().min(1).max(512),
  operation: z.string().min(1).max(128),
  retryable: z.boolean(),
}).strict();
export type SanitizedWorkbenchError = z.infer<typeof sanitizedWorkbenchErrorSchema>;

export const devWorkbenchSessionDescriptorSchema = z.object({
  schemaVersion: z.literal(DEV_WORKBENCH_SCHEMA_VERSION),
  sessionId: identifierSchema,
  organizationId: identifierSchema,
  sandboxName: identifierSchema,
  sandboxSessionId: identifierSchema,
  status: devWorkbenchLifecycleStatusSchema,
  repository: repositoryManifestSchema,
  repositoryRoot: z.literal(DEV_WORKBENCH_REPOSITORY_ROOT),
  tmuxSession: identifierSchema,
  tmuxWindows: z.array(tmuxWindowSchema).length(3),
  mirrorPaths: pageContextMirrorPathsSchema,
  preview: previewConnectionDescriptorSchema.nullable(),
  terminal: terminalConnectionDescriptorSchema.nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  error: sanitizedWorkbenchErrorSchema.nullable(),
}).strict();
export type DevWorkbenchSessionDescriptor = z.infer<typeof devWorkbenchSessionDescriptorSchema>;

export const devWorkbenchPersistenceRecordSchema = z.object({
  schemaVersion: z.literal(DEV_WORKBENCH_SCHEMA_VERSION),
  sessionId: identifierSchema,
  organizationId: identifierSchema,
  sandboxName: identifierSchema,
  repository: repositoryManifestSchema,
  tmuxSession: identifierSchema,
  createdAt: isoDateSchema,
}).strict();
export type DevWorkbenchPersistenceRecord = z.infer<typeof devWorkbenchPersistenceRecordSchema>;

export const pageContextMirrorSchema = z.object({
  schemaVersion: z.literal("1.0"),
  route: z.string().min(1).max(2_048),
  url: z.string().min(1).max(2_048),
  title: z.string().min(1).max(256),
  theme: z.string().min(1).max(64),
  auth: z.object({
    signedIn: z.boolean(),
    organizationPresent: z.boolean(),
    source: z.enum(["server-session", "unavailable"]),
  }).strict(),
  domain: z.object({
    repository: z.object({
      name: z.string().min(1).max(512),
      branch: z.string().min(1).max(256),
      revision: z.string().min(1).max(256),
      dirty: z.boolean(),
    }).strict(),
    previewPath: z.string().min(1).max(2_048),
    tmuxSession: identifierSchema,
    workingDirectory: z.literal(DEV_WORKBENCH_REPOSITORY_ROOT),
  }).strict(),
  interaction: z.object({
    kind: z.enum(["idle", "starting", "ready", "stopping", "stopped", "error"]),
    activeDetail: z.enum(["problems", "changes", "console", "network"]),
  }).strict(),
  actions: z.record(identifierSchema, z.object({
    enabled: z.boolean(),
    disabledReason: z.string().min(1).max(512).nullable(),
  }).strict()),
  assertions: z.record(identifierSchema, z.boolean()),
  correlation: z.object({
    sessionId: identifierSchema,
    sandboxSessionId: identifierSchema,
  }).strict().nullable(),
  warnings: z.array(z.string().min(1).max(512)).max(100),
  errors: z.array(z.string().min(1).max(512)).max(100),
  browserContextAuthority: z.literal("display-only"),
}).strict();
export type PageContextMirror = z.infer<typeof pageContextMirrorSchema>;

const realtimePayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status.changed"), status: devWorkbenchLifecycleStatusSchema }).strict(),
  z.object({ type: z.literal("preview.available"), expiresAt: isoDateSchema }).strict(),
  z.object({ type: z.literal("terminal.available"), sandboxExpiresAt: isoDateSchema }).strict(),
  z.object({ type: z.literal("page-context.updated"), path: z.literal(DEV_WORKBENCH_MIRROR_PATHS.pageContext) }).strict(),
  z.object({ type: z.literal("repository.changed"), paths: z.array(z.string().min(1).max(2_048)).max(10_000) }).strict(),
  z.object({ type: z.literal("error"), error: sanitizedWorkbenchErrorSchema }).strict(),
]);

/** Serializable wire only. The beacon is greenfield; this does not implement transport. */
export const devWorkbenchRealtimeEnvelopeSchema = z.object({
  schemaVersion: z.literal(DEV_WORKBENCH_SCHEMA_VERSION),
  eventId: identifierSchema,
  sequence: z.number().int().nonnegative(),
  occurredAt: isoDateSchema,
  sessionId: identifierSchema,
  organizationId: identifierSchema,
  channelKey: z.tuple([
    z.literal("org"),
    identifierSchema,
    z.literal("agentChannel"),
    identifierSchema,
  ]),
  payload: realtimePayloadSchema,
}).strict();
export type DevWorkbenchRealtimeEnvelope = z.infer<typeof devWorkbenchRealtimeEnvelopeSchema>;
