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
import {
  VISUAL_CONTEXT_LEASE_PATH,
  VISUAL_CONTEXT_PATH,
  VISUAL_CONTEXT_REQUESTS_PATH,
  VISUAL_CONTEXT_STAGE_ROOT,
  createVisualContextLeaseAcquireScript,
  consumeVisualContextRequest,
  decodeCanonicalBase64,
  invalidatedVisualContextSnapshot,
  isStaleVisualContextInvalidation,
  isStaleVisualContextResult,
  isStaleVisualContextSequence,
  issueVisualContextRequest,
  requestTemporaryPath,
  validateVisualContextPng,
  validateVisualContextSnapshotPng,
  validateVisualContextSubmission,
  visualContextInvalidationSchema,
  visualContextSnapshotFromResult,
  visualContextSubmissionSchema,
  visualContextRequestRegistrySchema,
  type VisualContextInvalidation,
  type VisualContextSubmission,
  type VisualContextRequestRegistry,
} from "./visual-context-coordinator";
import { visualContextSnapshotSchema, type VisualContextSnapshot } from "@sonik-agent-ui/tool-contracts/visual-context";
import { capturePlaywrightPreview } from "./playwright-preview-capture";
import { visualBrowserStateFromResult, visualContextOperationPromotesStableArtifact, type VisualBrowserState } from "../contracts/workbench";
import { visualContextRequestSchema, type VisualContextRequest, type VisualContextResult } from "@sonik-agent-ui/tool-contracts/visual-context";

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
    try {
      const panes = await sandbox.runCommand({
        cmd: "tmux",
        args: ["list-panes", "-a", "-t", record.tmuxSession, "-F", "#{pane_start_command}"],
        ...(signal ? { signal } : {}),
      });
      const commands = await panes.stdout(signal ? { signal } : undefined);
      hasExpectedWindows = panes.exitCode === 0
        && commands.split(`SONIK_VISUAL_CONTEXT_PATH=${VISUAL_CONTEXT_PATH}`).length - 1 >= expectedWindows.size;
    } catch {
      hasExpectedWindows = false;
    }
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

export async function runWorkspacePlaywrightVisualContext(
  sessionId: string,
  input: VisualContextRequest,
  signal?: AbortSignal,
): Promise<WorkspaceServiceResult<{ browser: VisualBrowserState; result: VisualContextResult; snapshot: VisualContextSnapshot | null; accepted: boolean }>> {
  const request = visualContextRequestSchema.safeParse(input);
  if (!request.success || request.data.provider !== "playwright") {
    return { ok: false, error: workspaceError("unknown", "visual-context-validate", false) };
  }
  const resumed = await resumeVerifiedWorkspace(sessionId, signal);
  if (!resumed.ok) return resumed;
  try {
    if (visualContextOperationPromotesStableArtifact(request.data.operation)) {
      const registered = await registerWorkspaceVisualContextRequest(sessionId, request.data, signal);
      if (!registered.ok) return registered;
    }
    const result = await capturePlaywrightPreview({
      sandbox: resumed.value,
      request: request.data,
      previewUrl: resumed.value.domain(DEV_WORKBENCH_PREVIEW_PORT),
      signal,
    });
    if (!visualContextOperationPromotesStableArtifact(request.data.operation)) {
      return { ok: true, value: { browser: visualBrowserStateFromResult(result), result, snapshot: null, accepted: true } };
    }
    const submitted = await submitWorkspaceVisualContext(sessionId, { workspaceSessionId: sessionId, request: request.data, result }, signal);
    if (!submitted.ok) return submitted;
    return { ok: true, value: { browser: visualBrowserStateFromResult(result), result, snapshot: submitted.value.snapshot, accepted: submitted.value.accepted } };
  } catch {
    return { ok: false, error: workspaceError("unknown", "playwright-visual-context", true) };
  }
}

export async function registerWorkspaceVisualContextRequest(
  sessionId: string,
  input: VisualContextRequest,
  signal?: AbortSignal,
): Promise<WorkspaceServiceResult<{ request: VisualContextRequest }>> {
  const request = visualContextRequestSchema.safeParse(input);
  if (!request.success) return { ok: false, error: workspaceError("unknown", "visual-context-validate", false) };
  const resumed = await resumeVerifiedWorkspace(sessionId, signal);
  if (!resumed.ok) return resumed;
  const leaseOwner = randomUUID();
  if (!await acquireVisualContextLease(resumed.value, leaseOwner, signal)) return { ok: false, error: workspaceError("unknown", "visual-context-lease", true) };
  try {
    const issued = issueVisualContextRequest(await readVisualContextRequestRegistry(resumed.value, signal), request.data);
    await writeVisualContextRequestRegistry(resumed.value, issued.registry, signal);
    return { ok: true, value: { request: request.data } };
  } catch {
    return { ok: false, error: workspaceError("unknown", "visual-context-register", false) };
  } finally {
    await releaseVisualContextLease(resumed.value, leaseOwner, signal).catch(() => undefined);
  }
}

export async function submitWorkspaceVisualContext(
  sessionId: string,
  input: VisualContextSubmission,
  signal?: AbortSignal,
): Promise<WorkspaceServiceResult<{ accepted: boolean; snapshot: VisualContextSnapshot | null }>> {
  const parsed = visualContextSubmissionSchema.safeParse(input);
  if (!parsed.success || parsed.data.workspaceSessionId !== sessionId) {
    return { ok: false, error: workspaceError("unknown", "visual-context-validate", false) };
  }
  let temporaryPath: string | null = null;
  try {
    validateVisualContextSubmission(parsed.data);
    temporaryPath = requestTemporaryPath(parsed.data.result);
  } catch {
    return { ok: false, error: workspaceError("unknown", "visual-context-validate", false) };
  }
  const resumed = await resumeVerifiedWorkspace(sessionId, signal);
  if (!resumed.ok) return resumed;
  const leaseOwner = randomUUID();
  const lease = await acquireVisualContextLease(resumed.value, leaseOwner, signal);
  if (!lease) {
    if (temporaryPath) await removeVisualContextTemporaryPath(resumed.value, temporaryPath, signal);
    return { ok: false, error: workspaceError("unknown", "visual-context-lease", true) };
  }
  try {
    const result = parsed.data.result;
    const consumed = consumeVisualContextRequest(await readVisualContextRequestRegistry(resumed.value, signal), parsed.data.request);
    if (!consumed) {
      if (temporaryPath) await removeSandboxPath(resumed.value, temporaryPath, signal);
      return { ok: true, value: { accepted: false, snapshot: null } };
    }
    await writeVisualContextRequestRegistry(resumed.value, consumed.registry, signal);
    const requestSequence = consumed.sequence;
    if (result.status !== "completed") {
      if (result.status === "cancelled" && (result.operation === "pick" || result.operation === "capture")) {
        const current = await readVisualContextSnapshot(resumed.value, signal);
        if (isStaleVisualContextResult(current, result) || isStaleVisualContextSequence(current, requestSequence)) {
          if (temporaryPath) await removeSandboxPath(resumed.value, temporaryPath, signal);
          return { ok: true, value: { accepted: false, snapshot: null } };
        }
        const invalidation = visualContextInvalidationSchema.parse({
          workspaceSessionId: sessionId,
          sourceContextRevision: result.sourceContextRevision,
          routeRevision: result.routeRevision,
          source: result.source,
          staleReason: "cancelled",
        });
        const snapshot = invalidatedVisualContextSnapshot(invalidation, result.requestId, requestSequence);
        await promoteVisualContextManifest(resumed.value, snapshot, null, signal);
        if (temporaryPath) await removeSandboxPath(resumed.value, temporaryPath, signal);
        return { ok: true, value: { accepted: false, snapshot } };
      }
      if (temporaryPath) await removeSandboxPath(resumed.value, temporaryPath, signal);
      return { ok: true, value: { accepted: false, snapshot: null } };
    }
    if (result.operation === "get-capabilities" || result.operation === "setup-browser" || result.operation === "pair-extension" || result.operation === "unpair-extension") {
      return { ok: true, value: { accepted: true, snapshot: null } };
    }
    const current = await readVisualContextSnapshot(resumed.value, signal);
    if (result.operation === "clear") {
      if (isStaleVisualContextResult(current, result) || isStaleVisualContextSequence(current, requestSequence)) {
        return { ok: true, value: { accepted: false, snapshot: null } };
      }
      const invalidation = visualContextInvalidationSchema.parse({
        workspaceSessionId: sessionId,
        sourceContextRevision: result.sourceContextRevision,
        routeRevision: result.routeRevision,
        source: result.source,
        staleReason: "cancelled",
      });
      const snapshot = invalidatedVisualContextSnapshot(invalidation, result.requestId, requestSequence);
      await promoteVisualContextManifest(resumed.value, snapshot, null, signal);
      return { ok: true, value: { accepted: true, snapshot } };
    }
    if (isStaleVisualContextResult(current, result) || isStaleVisualContextSequence(current, requestSequence)) {
      if (temporaryPath) await removeSandboxPath(resumed.value, temporaryPath, signal);
      return { ok: true, value: { accepted: false, snapshot: null } };
    }
    let png: Buffer | null = null;
    if (result.screenshot?.temporaryPath) {
      png = await resumed.value.readFileToBuffer({ path: result.screenshot.temporaryPath }, signal ? { signal } : undefined);
      if (!png) throw new Error("Visual context temporary PNG was not found.");
    } else if (result.screenshot?.pngBase64) {
      png = decodeCanonicalBase64(result.screenshot.pngBase64);
    }
    if (result.operation === "capture") {
      if (!png) throw new Error("Visual context capture did not produce PNG bytes.");
      validateVisualContextPng(png, result);
    }
    const snapshot = visualContextSnapshotFromResult(result, requestSequence);
    await promoteVisualContextManifest(resumed.value, snapshot, png, signal);
    if (temporaryPath) await removeSandboxPath(resumed.value, temporaryPath, signal);
    return { ok: true, value: { accepted: true, snapshot } };
  } catch {
    if (temporaryPath) await removeSandboxPath(resumed.value, temporaryPath, signal).catch(() => undefined);
    return { ok: false, error: workspaceError("unknown", "visual-context-promote", true) };
  } finally {
    await releaseVisualContextLease(resumed.value, leaseOwner, signal).catch(() => undefined);
  }
}

export async function invalidateWorkspaceVisualContext(
  sessionId: string,
  input: VisualContextInvalidation,
  signal?: AbortSignal,
): Promise<WorkspaceServiceResult<{ snapshot: VisualContextSnapshot }>> {
  const parsed = visualContextInvalidationSchema.safeParse(input);
  if (!parsed.success || parsed.data.workspaceSessionId !== sessionId) {
    return { ok: false, error: workspaceError("unknown", "visual-context-validate", false) };
  }
  const resumed = await resumeVerifiedWorkspace(sessionId, signal);
  if (!resumed.ok) return resumed;
  const leaseOwner = randomUUID();
  if (!await acquireVisualContextLease(resumed.value, leaseOwner, signal)) {
    return { ok: false, error: workspaceError("unknown", "visual-context-lease", true) };
  }
  try {
    const current = await readVisualContextSnapshot(resumed.value, signal);
    const registry = await readVisualContextRequestRegistry(resumed.value, signal);
    const requestSequence = registry.nextSequence;
    await writeVisualContextRequestRegistry(resumed.value, { ...registry, nextSequence: requestSequence + 1 }, signal);
    if (isStaleVisualContextInvalidation(current, parsed.data)) {
      return { ok: true, value: { snapshot: current! } };
    }
    const snapshot = invalidatedVisualContextSnapshot(parsed.data, null, requestSequence);
    await promoteVisualContextManifest(resumed.value, snapshot, null, signal);
    return { ok: true, value: { snapshot } };
  } catch {
    return { ok: false, error: workspaceError("unknown", "visual-context-invalidate", true) };
  } finally {
    await releaseVisualContextLease(resumed.value, leaseOwner, signal).catch(() => undefined);
  }
}

export async function readWorkspaceVisualContext(
  sessionId: string,
  includePng: boolean,
  signal?: AbortSignal,
): Promise<WorkspaceServiceResult<{ snapshot: VisualContextSnapshot; png: Buffer | null }>> {
  const resumed = await resumeVerifiedWorkspace(sessionId, signal);
  if (!resumed.ok) return resumed;
  try {
    const snapshot = await readVisualContextSnapshot(resumed.value, signal);
    if (!snapshot || snapshot.status !== "current") throw new Error("No current visual context.");
    const png = includePng && snapshot.screenshot
      ? await resumed.value.readFileToBuffer({ path: DEV_WORKBENCH_MIRROR_PATHS.latestScreenshot }, signal ? { signal } : undefined)
      : null;
    if (includePng) {
      if (!png) throw new Error("No current visual context PNG.");
      validateVisualContextSnapshotPng(png, snapshot);
    }
    return { ok: true, value: { snapshot, png } };
  } catch {
    return { ok: false, error: workspaceError("unknown", "visual-context-read", false) };
  }
}

async function resumeVerifiedWorkspace(sessionId: string, signal?: AbortSignal): Promise<WorkspaceServiceResult<Sandbox>> {
  const resumed = await resumeVercelDevWorkbenchSandbox({ sessionId, signal });
  if (!resumed.ok) return resumed;
  try {
    const record = await readPersistenceRecord(resumed.value, signal);
    return record.sessionId === sessionId
      ? { ok: true, value: resumed.value }
      : { ok: false, error: workspaceError("sandbox_resume_failed", "session-mismatch", false) };
  } catch {
    return { ok: false, error: workspaceError("sandbox_resume_failed", "read-workspace", false) };
  }
}

async function acquireVisualContextLease(sandbox: Sandbox, owner: string, signal?: AbortSignal): Promise<boolean> {
  const expires = Date.now() + 60_000;
  const script = createVisualContextLeaseAcquireScript();
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", script, "_", VISUAL_CONTEXT_LEASE_PATH, owner, String(expires)],
    ...(signal ? { signal } : {}),
  });
  return result.exitCode === 0;
}

async function releaseVisualContextLease(sandbox: Sandbox, owner: string, signal?: AbortSignal): Promise<void> {
  const script = `set -eu
lease="$1"; owner="$2"
[ "$(sed -n '1p' "$lease" 2>/dev/null || true)" = "$owner" ] && rm -f "$lease" || true`;
  await sandbox.runCommand({ cmd: "bash", args: ["-lc", script, "_", VISUAL_CONTEXT_LEASE_PATH, owner], ...(signal ? { signal } : {}) });
}

async function readVisualContextSnapshot(sandbox: Sandbox, signal?: AbortSignal): Promise<VisualContextSnapshot | null> {
  const buffer = await sandbox.readFileToBuffer({ path: VISUAL_CONTEXT_PATH }, signal ? { signal } : undefined);
  if (!buffer) return null;
  return visualContextSnapshotSchema.parse(JSON.parse(buffer.toString("utf8")));
}

async function readVisualContextRequestRegistry(sandbox: Sandbox, signal?: AbortSignal): Promise<VisualContextRequestRegistry> {
  const buffer = await sandbox.readFileToBuffer({ path: VISUAL_CONTEXT_REQUESTS_PATH }, signal ? { signal } : undefined);
  return buffer ? visualContextRequestRegistrySchema.parse(JSON.parse(buffer.toString("utf8"))) : { nextSequence: 1, pending: {} };
}

async function writeVisualContextRequestRegistry(sandbox: Sandbox, registry: VisualContextRequestRegistry, signal?: AbortSignal): Promise<void> {
  const staged = `${VISUAL_CONTEXT_REQUESTS_PATH}.${randomUUID()}.tmp`;
  await sandbox.writeFiles([{ path: staged, content: JSON.stringify(registry) }], signal ? { signal } : undefined);
  const result = await sandbox.runCommand({ cmd: "mv", args: [staged, VISUAL_CONTEXT_REQUESTS_PATH], ...(signal ? { signal } : {}) });
  if (result.exitCode !== 0) throw new Error("Visual context request registry publication failed.");
}

async function promoteVisualContextManifest(
  sandbox: Sandbox,
  snapshot: VisualContextSnapshot,
  png: Buffer | null,
  signal?: AbortSignal,
): Promise<void> {
  const stageManifest = `${VISUAL_CONTEXT_STAGE_ROOT}/${snapshot.generation}.json`;
  const stagePng = `${VISUAL_CONTEXT_STAGE_ROOT}/${snapshot.generation}.png`;
  const stageInvalidation = `${VISUAL_CONTEXT_STAGE_ROOT}/${snapshot.generation}.invalidated.json`;
  const invalidation = snapshot.status === "invalidated" ? snapshot : visualContextSnapshotSchema.parse({
    ...snapshot,
    status: "invalidated",
    selection: null,
    ariaSnapshot: null,
    selectionResolution: "not-requested",
    screenshot: null,
    invalidatedAt: new Date().toISOString(),
    staleReason: "provider-lost",
  });
  await sandbox.writeFiles([
    { path: stageManifest, content: JSON.stringify(snapshot, null, 2) },
    { path: stageInvalidation, content: JSON.stringify(invalidation, null, 2) },
    ...(png ? [{ path: stagePng, content: png }] : []),
  ], signal ? { signal } : undefined);
  const script = createVisualContextPromotionScript();
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", script, "_", stageManifest, stagePng, stageInvalidation, VISUAL_CONTEXT_PATH, DEV_WORKBENCH_MIRROR_PATHS.latestScreenshot, png ? "1" : "0", "none"],
    ...(signal ? { signal } : {}),
  });
  if (result.exitCode !== 0) throw new Error("Visual context promotion failed.");
}

export function createVisualContextPromotionScript(): string {
  return `set -eu
manifest="$1"; png="$2"; invalidation="$3"; stable_manifest="$4"; stable_png="$5"; has_png="$6"; failpoint="$7"
[ "$failpoint" != before-invalidation ] || exit 86
if [ "$has_png" = 1 ]; then
  mv "$invalidation" "$stable_manifest"
  rm -f "$stable_png"
  [ "$failpoint" != after-invalidation ] || exit 86
  mv "$png" "$stable_png"
  [ "$failpoint" != after-png-rename ] || exit 86
  [ "$failpoint" != before-manifest-rename ] || exit 86
fi
mv "$manifest" "$stable_manifest"
if [ "$has_png" = 0 ]; then rm -f "$stable_png"; fi`;
}

async function removeSandboxPath(sandbox: Sandbox, path: string, signal?: AbortSignal): Promise<void> {
  await sandbox.runCommand({ cmd: "rm", args: ["-f", path], ...(signal ? { signal } : {}) });
}

export async function removeVisualContextTemporaryPath(sandbox: Sandbox, path: string, signal?: AbortSignal): Promise<void> {
  await removeSandboxPath(sandbox, path, signal);
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
