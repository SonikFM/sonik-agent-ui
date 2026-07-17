import { randomUUID } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";
import {
  DEV_WORKBENCH_MIRROR_PATHS,
  DEV_WORKBENCH_PREVIEW_PORT,
  DEV_WORKBENCH_REPOSITORY_ROOT,
  DEV_WORKBENCH_SCHEMA_VERSION,
  devWorkbenchPersistenceRecordSchema,
  devWorkbenchSessionDescriptorSchema,
  workspaceContextSyncSchema,
  sanitizedWorkbenchErrorSchema,
  type DevWorkbenchPersistenceRecord,
  type DevWorkbenchSessionDescriptor,
  type WorkspaceContextSync,
  type PreviewConnectionDescriptor,
  type SanitizedWorkbenchError,
  type TerminalConnectionDescriptor,
} from "../contracts/workbench";
import {
  createDevWindowRefreshPlan,
  createDevWorkbenchBootstrapPlan,
  createRuntimeRehydrationPlan,
} from "./bootstrap-plan";
import { createRepositorySitemapFromTrackedFiles } from "./repository-sitemap";
import {
  createVercelDevWorkbenchSandbox,
  createVercelWorkbenchConnections,
  deleteVercelDevWorkbenchSandbox,
  resumeVercelDevWorkbenchSandbox,
  runVercelBootstrapPlan,
  stopVercelDevWorkbenchSandbox,
  waitForVercelPreview,
} from "./vercel-sandbox";
import type { DevWorkbenchServerConfig } from "./workbench-config";

export type WorkspaceServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SanitizedWorkbenchError };

export async function provisionWorkspace(
  config: DevWorkbenchServerConfig,
  signal?: AbortSignal,
): Promise<WorkspaceServiceResult<DevWorkbenchSessionDescriptor>> {
  const sessionId = randomUUID();
  const created = await createVercelDevWorkbenchSandbox({
    sessionId,
    timeoutMs: config.timeoutMs,
    env: sandboxEnvironment(config),
    signal,
  });
  if (!created.ok) return created;
  const sandbox = created.value;
  const createdAt = new Date().toISOString();

  try {
    const plan = createDevWorkbenchBootstrapPlan({
      sessionId,
      repository: config.repository,
      previewHost: sandboxPreviewHost(sandbox),
      agentApiOrigin: config.agentApiOrigin,
      pipeBWorker: config.pipeBWorker,
      pipeBLogsEnabled: Boolean(config.cloudflareApiToken),
    });
    const bootstrapped = await runVercelBootstrapPlan({ sandbox, plan, signal });
    if (!bootstrapped.ok) {
      await cleanupSandbox(sandbox);
      return bootstrapped;
    }
    const previewReady = await waitForVercelPreview({ sandbox, tmuxSession: plan.tmuxSession, signal });
    if (!previewReady.ok) {
      await cleanupSandbox(sandbox);
      return previewReady;
    }

    const sitemap = await collectSitemap(sandbox, config, signal);
    const record = devWorkbenchPersistenceRecordSchema.parse({
      schemaVersion: DEV_WORKBENCH_SCHEMA_VERSION,
      sessionId,
      organizationId: config.organizationId,
      sandboxName: sandbox.name,
      repository: config.repository,
      tmuxSession: plan.tmuxSession,
      createdAt,
    });
    await sandbox.writeFiles([
      { path: DEV_WORKBENCH_MIRROR_PATHS.workspace, content: JSON.stringify(record, null, 2) },
      { path: DEV_WORKBENCH_MIRROR_PATHS.sitemap, content: JSON.stringify(sitemap, null, 2) },
      { path: DEV_WORKBENCH_MIRROR_PATHS.pageContext, content: JSON.stringify({ authority: "display-only" }, null, 2) },
      { path: DEV_WORKBENCH_MIRROR_PATHS.hostContext, content: JSON.stringify({ status: "awaiting-host-context" }, null, 2) },
      { path: DEV_WORKBENCH_MIRROR_PATHS.hostAuthority, content: JSON.stringify({ status: "awaiting-host-authority" }, null, 2) },
      { path: DEV_WORKBENCH_MIRROR_PATHS.openApi, content: JSON.stringify({ status: "awaiting-host-openapi" }, null, 2) },
      { path: DEV_WORKBENCH_MIRROR_PATHS.guide, content: createSandboxContextGuide(config.pipeBWorker, Boolean(config.cloudflareApiToken)) },
      { path: DEV_WORKBENCH_MIRROR_PATHS.consoleEvents, content: "" },
      { path: DEV_WORKBENCH_MIRROR_PATHS.networkEvents, content: "" },
    ], signal ? { signal } : undefined);

    const connections = await createVercelWorkbenchConnections({ sandbox, tmuxSession: plan.tmuxSession, signal });
    if (!connections.ok) {
      await cleanupSandbox(sandbox);
      return connections;
    }
    return {
      ok: true,
      value: descriptorFromRecord(record, sandbox, connections.value, createdAt, config),
    };
  } catch {
    await cleanupSandbox(sandbox);
    return { ok: false, error: workspaceError("sandbox_bootstrap_failed", "provision", true) };
  }
}

export async function reconnectWorkspace(
  sessionId: string,
  config?: DevWorkbenchServerConfig,
  signal?: AbortSignal,
): Promise<WorkspaceServiceResult<DevWorkbenchSessionDescriptor>> {
  const resumed = await resumeVercelDevWorkbenchSandbox({ sessionId, signal });
  if (!resumed.ok) return resumed;
  try {
    const record = await readPersistenceRecord(resumed.value, signal);
    if (record.sessionId !== sessionId) {
      return { ok: false, error: workspaceError("sandbox_resume_failed", "session-mismatch", false) };
    }
    const rehydrated = await rehydrateRuntime(resumed.value, record, config, signal);
    if (!rehydrated.ok) return rehydrated;
    const connections = await createVercelWorkbenchConnections({
      sandbox: resumed.value,
      tmuxSession: record.tmuxSession,
      signal,
    });
    if (!connections.ok) return connections;
    return {
      ok: true,
      value: descriptorFromRecord(record, resumed.value, connections.value, new Date().toISOString(), config),
    };
  } catch {
    return { ok: false, error: workspaceError("sandbox_resume_failed", "read-workspace", false) };
  }
}

async function rehydrateRuntime(
  sandbox: Sandbox,
  record: DevWorkbenchPersistenceRecord,
  config?: DevWorkbenchServerConfig,
  signal?: AbortSignal,
): Promise<WorkspaceServiceResult<{ running: true }>> {
  const expectedWindows = new Set(["codex", "dev", "shell", "logs"]);
  let hasExpectedWindows = false;
  try {
    const existing = await sandbox.runCommand({
      cmd: "tmux",
      args: ["list-windows", "-t", record.tmuxSession, "-F", "#{window_name}"],
      ...(signal ? { signal } : {}),
    });
    if (existing.exitCode === 0) {
      const windows = new Set((await existing.stdout(signal ? { signal } : undefined)).split("\n").filter(Boolean));
      hasExpectedWindows = [...expectedWindows].every((window) => windows.has(window));
    }
  } catch {
    // A restored base image may not have tmux installed yet; the runtime plan is idempotent.
  }

  if (hasExpectedWindows) {
    const expectedAgentApiMarker = config?.agentApiOrigin
      ? `SONIK_AGENT_UI_DEV_API_ORIGIN=${config.agentApiOrigin}`
      : null;
    let devWindowCurrent = expectedAgentApiMarker === null;
    if (expectedAgentApiMarker) {
      try {
        const devPane = await sandbox.runCommand({
          cmd: "tmux",
          args: ["list-panes", "-t", `${record.tmuxSession}:dev`, "-F", "#{pane_start_command}"],
          ...(signal ? { signal } : {}),
        });
        devWindowCurrent = devPane.exitCode === 0
          && (await devPane.stdout(signal ? { signal } : undefined)).includes(expectedAgentApiMarker);
      } catch {
        devWindowCurrent = false;
      }
    }
    if (!devWindowCurrent) {
      const refreshPlan = createDevWindowRefreshPlan({
        sessionId: record.sessionId,
        repository: record.repository,
        previewHost: sandboxPreviewHost(sandbox),
        agentApiOrigin: config?.agentApiOrigin,
        pipeBWorker: config?.pipeBWorker,
        pipeBLogsEnabled: Boolean(config?.cloudflareApiToken),
      });
      const refreshed = await runVercelBootstrapPlan({ sandbox, plan: refreshPlan, signal });
      if (!refreshed.ok) return refreshed;
      const healthy = await waitForVercelPreview({ sandbox, tmuxSession: record.tmuxSession, signal });
      if (!healthy.ok) return healthy;
      return { ok: true, value: { running: true } };
    }
    const healthy = await waitForVercelPreview({ sandbox, tmuxSession: record.tmuxSession, signal });
    if (healthy.ok) return { ok: true, value: { running: true } };
  }

  await sandbox.runCommand({
    cmd: "tmux",
    args: ["kill-session", "-t", record.tmuxSession],
    ...(signal ? { signal } : {}),
  }).catch(() => undefined);
  const runtimePlan = createRuntimeRehydrationPlan({
    sessionId: record.sessionId,
    repository: record.repository,
    previewHost: sandboxPreviewHost(sandbox),
    agentApiOrigin: config?.agentApiOrigin,
    pipeBWorker: config?.pipeBWorker,
    pipeBLogsEnabled: Boolean(config?.cloudflareApiToken),
  });
  const restarted = await runVercelBootstrapPlan({ sandbox, plan: runtimePlan, signal });
  if (!restarted.ok) return restarted;
  const healthy = await waitForVercelPreview({ sandbox, tmuxSession: record.tmuxSession, signal });
  if (!healthy.ok) return healthy;
  return { ok: true, value: { running: true } };
}

async function cleanupSandbox(sandbox: Sandbox): Promise<void> {
  await stopVercelDevWorkbenchSandbox({
    sandbox,
    signal: AbortSignal.timeout(15_000),
  });
  await deleteVercelDevWorkbenchSandbox({
    sandbox,
    signal: AbortSignal.timeout(15_000),
  });
}

export async function stopWorkspace(
  sessionId: string,
): Promise<WorkspaceServiceResult<{ stopped: true }>> {
  const resumed = await resumeVercelDevWorkbenchSandbox({ sessionId, signal: AbortSignal.timeout(15_000) });
  if (!resumed.ok) return resumed;
  await stopVercelDevWorkbenchSandbox({ sandbox: resumed.value, signal: AbortSignal.timeout(15_000) });
  const deleted = await deleteVercelDevWorkbenchSandbox({ sandbox: resumed.value, signal: AbortSignal.timeout(15_000) });
  if (!deleted.ok) return deleted;
  return { ok: true, value: { stopped: true } };
}

export async function writeWorkspacePageContext(
  sessionId: string,
  context: WorkspaceContextSync,
  openApiDocument: unknown | null,
  signal?: AbortSignal,
): Promise<WorkspaceServiceResult<{ written: true; openApiWritten: boolean }>> {
  const parsed = workspaceContextSyncSchema.safeParse(context);
  if (!parsed.success) {
    return { ok: false, error: workspaceError("unknown", "page-context-validate", false) };
  }
  const resumed = await resumeVercelDevWorkbenchSandbox({ sessionId, signal });
  if (!resumed.ok) return resumed;
  try {
    const record = await readPersistenceRecord(resumed.value, signal);
    if (record.sessionId !== sessionId) {
      return { ok: false, error: workspaceError("sandbox_resume_failed", "session-mismatch", false) };
    }
    const authority = parsed.data.host?.authority ?? null;
    await resumed.value.writeFiles([
      { path: DEV_WORKBENCH_MIRROR_PATHS.pageContext, content: JSON.stringify(parsed.data.pageContext, null, 2) },
      {
        path: DEV_WORKBENCH_MIRROR_PATHS.hostContext,
        content: JSON.stringify(parsed.data.host
          ? { origin: parsed.data.host.origin, pageContext: parsed.data.host.pageContext }
          : { status: "host-context-unavailable" }, null, 2),
      },
      {
        path: DEV_WORKBENCH_MIRROR_PATHS.hostAuthority,
        content: JSON.stringify(authority ?? { status: "host-authority-unavailable" }, null, 2),
      },
      ...(openApiDocument === null
        ? []
        : [{ path: DEV_WORKBENCH_MIRROR_PATHS.openApi, content: JSON.stringify(openApiDocument, null, 2) }]),
    ], signal ? { signal } : undefined);
    await resumed.value.runCommand({
      cmd: "chmod",
      args: ["600", DEV_WORKBENCH_MIRROR_PATHS.hostAuthority],
      ...(signal ? { signal } : {}),
    });
    return { ok: true, value: { written: true, openApiWritten: openApiDocument !== null } };
  } catch {
    return { ok: false, error: workspaceError("unknown", "page-context-write", true) };
  }
}

async function collectSitemap(
  sandbox: Sandbox,
  config: DevWorkbenchServerConfig,
  signal?: AbortSignal,
) {
  const result = await sandbox.runCommand({
    cmd: "git",
    args: ["ls-files"],
    cwd: DEV_WORKBENCH_REPOSITORY_ROOT,
    ...(signal ? { signal } : {}),
  });
  if (result.exitCode !== 0) throw new Error("git ls-files failed");
  const paths = (await result.stdout(signal ? { signal } : undefined)).split("\n").filter(Boolean);
  return createRepositorySitemapFromTrackedFiles(config.repository, paths);
}

async function readPersistenceRecord(sandbox: Sandbox, signal?: AbortSignal): Promise<DevWorkbenchPersistenceRecord> {
  const buffer = await sandbox.readFileToBuffer(
    { path: DEV_WORKBENCH_MIRROR_PATHS.workspace },
    signal ? { signal } : undefined,
  );
  if (!buffer) throw new Error("Workspace record not found");
  return devWorkbenchPersistenceRecordSchema.parse(JSON.parse(buffer.toString("utf8")));
}

function descriptorFromRecord(
  record: DevWorkbenchPersistenceRecord,
  sandbox: Sandbox,
  connections: { preview: PreviewConnectionDescriptor; terminal: TerminalConnectionDescriptor },
  updatedAt: string,
  config?: DevWorkbenchServerConfig,
): DevWorkbenchSessionDescriptor {
  const plan = createDevWorkbenchBootstrapPlan({
    sessionId: record.sessionId,
    repository: record.repository,
    agentApiOrigin: config?.agentApiOrigin,
    pipeBWorker: config?.pipeBWorker,
    pipeBLogsEnabled: Boolean(config?.cloudflareApiToken),
  });
  return devWorkbenchSessionDescriptorSchema.parse({
    schemaVersion: DEV_WORKBENCH_SCHEMA_VERSION,
    sessionId: record.sessionId,
    organizationId: record.organizationId,
    sandboxName: sandbox.name,
    sandboxSessionId: sandbox.currentSession().sessionId,
    status: "ready",
    repository: record.repository,
    repositoryRoot: DEV_WORKBENCH_REPOSITORY_ROOT,
    tmuxSession: record.tmuxSession,
    tmuxWindows: plan.windows,
    mirrorPaths: DEV_WORKBENCH_MIRROR_PATHS,
    preview: connections.preview,
    terminal: connections.terminal,
    createdAt: record.createdAt,
    updatedAt,
    error: null,
  });
}

function sandboxEnvironment(config: DevWorkbenchServerConfig): Record<string, string> {
  return {
    ...(config.cloudflareApiToken ? { CLOUDFLARE_API_TOKEN: config.cloudflareApiToken } : {}),
    ...(config.cloudflareAccountId ? { CLOUDFLARE_ACCOUNT_ID: config.cloudflareAccountId } : {}),
  };
}

function createSandboxContextGuide(pipeBWorker: string, pipeBEnabled: boolean): string {
  return `# Sonik Agent UI Dev Context

This directory is host-written runtime context for the isolated Agent UI checkout.

- \`page-context.json\`: redacted Workbench state.
- \`host-context.json\`: booking-host origin plus redacted page context.
- \`host-authority.json\`: short-lived opaque host authorization. Treat it as a credential.
- \`openapi.json\`: the booking host OpenAPI document fetched with that authority.
- \`sitemap.json\`: tracked source and route map for the checkout.

The primary Codex window receives \`SONIK_*_PATH\` environment variables for these files.
Pipe B uses tmux window \`logs\` (${pipeBWorker}); access is ${pipeBEnabled ? "configured" : "not configured"} for this workspace.
Use \`tmux capture-pane -p -S -200 -t \"$TMUX_PANE\"\` only for the current pane; switch to the logs window with the normal tmux window controls when evidence is needed.
`;
}

function sandboxPreviewHost(sandbox: Sandbox): string {
  return new URL(sandbox.domain(DEV_WORKBENCH_PREVIEW_PORT)).hostname;
}

function workspaceError(
  code: SanitizedWorkbenchError["code"],
  operation: string,
  retryable: boolean,
): SanitizedWorkbenchError {
  return sanitizedWorkbenchErrorSchema.parse({
    code,
    operation,
    retryable,
    message: operation.startsWith("page-context")
      ? "The page context could not be synchronized."
      : code === "sandbox_resume_failed"
        ? "The development sandbox could not be resumed."
        : "The repository could not be prepared in the development sandbox.",
  });
}
