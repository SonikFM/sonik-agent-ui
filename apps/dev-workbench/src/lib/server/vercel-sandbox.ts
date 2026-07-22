import { APIError, Sandbox } from "@vercel/sandbox";
import {
  DEV_WORKBENCH_PREVIEW_PORT,
  DEV_WORKBENCH_PERSISTENT,
  previewConnectionDescriptorSchema,
  sanitizedWorkbenchErrorSchema,
  terminalConnectionDescriptorSchema,
  type PreviewConnectionDescriptor,
  type SanitizedWorkbenchError,
  type TerminalConnectionDescriptor,
} from "../contracts/workbench";
import {
  devWorkbenchBootstrapPlanSchema,
  type DevWorkbenchBootstrapPlan,
} from "./bootstrap-plan";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000;

export type VercelDevWorkbenchResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: SanitizedWorkbenchError };

function sandboxName(sessionId: string): string {
  const safe = sessionId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe) throw new Error("sessionId must contain at least one safe character");
  return `sonik-dev-${safe}`.slice(0, 100);
}

function publicError(
  code: SanitizedWorkbenchError["code"],
  operation: string,
  retryable: boolean,
): SanitizedWorkbenchError {
  const messages: Record<SanitizedWorkbenchError["code"], string> = {
    sandbox_create_failed: "The development sandbox could not be created.",
    sandbox_resume_failed: "The development sandbox could not be resumed.",
    sandbox_bootstrap_failed: "The repository could not be prepared in the development sandbox.",
    sandbox_connection_failed: "The sandbox connection could not be opened.",
    sandbox_stop_failed: "The development sandbox could not be stopped.",
    sandbox_delete_failed: "The development sandbox could not be deleted.",
    invalid_repository_manifest: "The repository configuration is invalid.",
    invalid_bootstrap_plan: "The sandbox bootstrap plan is invalid.",
    unknown: "The Dev Workbench operation failed.",
  };
  return sanitizedWorkbenchErrorSchema.parse({ code, operation, retryable, message: messages[code] });
}

export async function createVercelDevWorkbenchSandbox(input: {
  sessionId: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<VercelDevWorkbenchResult<Sandbox>> {
  try {
    const sandbox = await Sandbox.create({
      name: sandboxName(input.sessionId),
      runtime: "node24",
      persistent: DEV_WORKBENCH_PERSISTENT,
      keepLastSnapshots: { count: 1 },
      ports: [DEV_WORKBENCH_PREVIEW_PORT],
      timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      tags: { app: "sonik-dev-workbench" },
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return { ok: true, value: sandbox };
  } catch {
    return { ok: false, error: publicError("sandbox_create_failed", "create", true) };
  }
}

export async function resumeVercelDevWorkbenchSandbox(input: {
  sessionId: string;
  signal?: AbortSignal;
}): Promise<VercelDevWorkbenchResult<Sandbox>> {
  try {
    const sandbox = await Sandbox.get({
      name: sandboxName(input.sessionId),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    await sandbox.update(
      { persistent: DEV_WORKBENCH_PERSISTENT, keepLastSnapshots: { count: 1 } },
      input.signal ? { signal: input.signal } : undefined,
    );
    return { ok: true, value: sandbox };
  } catch (error) {
    return {
      ok: false,
      error: publicError(
        "sandbox_resume_failed",
        "resume",
        !(error instanceof APIError && error.response.status === 404),
      ),
    };
  }
}

export async function runVercelBootstrapPlan(input: {
  sandbox: Sandbox;
  plan: DevWorkbenchBootstrapPlan;
  signal?: AbortSignal;
}): Promise<VercelDevWorkbenchResult<{ completedStepIds: string[] }>> {
  const parsed = devWorkbenchBootstrapPlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    return { ok: false, error: publicError("invalid_bootstrap_plan", "bootstrap", false) };
  }

  const completedStepIds: string[] = [];
  let currentStepId = "bootstrap";
  try {
    for (const command of parsed.data.commands) {
      currentStepId = command.id;
      const result = await input.sandbox.runCommand({
        cmd: command.cmd,
        args: command.args,
        ...(command.cwd ? { cwd: command.cwd } : {}),
        ...(command.sudo ? { sudo: true } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (result.exitCode !== 0) {
        return { ok: false, error: publicError("sandbox_bootstrap_failed", command.id, command.id !== "checkout-revision") };
      }
      completedStepIds.push(command.id);
    }
    return { ok: true, value: { completedStepIds } };
  } catch {
    return { ok: false, error: publicError("sandbox_bootstrap_failed", currentStepId, true) };
  }
}

export async function createVercelWorkbenchConnections(input: {
  sandbox: Sandbox;
  tmuxSession: string;
  signal?: AbortSignal;
}): Promise<VercelDevWorkbenchResult<{
  preview: PreviewConnectionDescriptor;
  terminal: TerminalConnectionDescriptor;
}>> {
  try {
    const interactive = await input.sandbox.openInteractive(input.signal ? { signal: input.signal } : undefined);
    const expiresAt = input.sandbox.expiresAt ?? new Date(Date.now() + DEFAULT_TIMEOUT_MS);
    const sandboxSessionId = input.sandbox.currentSession().sessionId;
    const preview = previewConnectionDescriptorSchema.parse({
      kind: "preview",
      url: input.sandbox.domain(DEV_WORKBENCH_PREVIEW_PORT),
      port: DEV_WORKBENCH_PREVIEW_PORT,
      expiresAt: expiresAt.toISOString(),
      sandboxSessionId,
    });
    const terminal = terminalConnectionDescriptorSchema.parse({
      kind: "terminal",
      transport: "vercel-interactive-v1",
      url: interactive.url,
      accessToken: interactive.token,
      sandboxExpiresAt: expiresAt.toISOString(),
      credentialExpiresAt: null,
      sandboxSessionId,
      tmuxSession: input.tmuxSession,
      attachCommand: ["tmux", "attach-session", "-t", input.tmuxSession],
      protocol: {
        authorization: "query-token",
        startFrame: "json",
        resizeFrame: "json",
        stdin: "binary",
        stdout: "binary",
      },
    });
    return { ok: true, value: { preview, terminal } };
  } catch {
    return { ok: false, error: publicError("sandbox_connection_failed", "connect", true) };
  }
}

export async function stopVercelDevWorkbenchSandbox(input: {
  sandbox: Sandbox;
  signal?: AbortSignal;
}): Promise<VercelDevWorkbenchResult<{ stopped: true }>> {
  try {
    await input.sandbox.stop(input.signal ? { signal: input.signal } : undefined);
    return { ok: true, value: { stopped: true } };
  } catch {
    return { ok: false, error: publicError("sandbox_stop_failed", "stop", true) };
  }
}

export async function deleteVercelDevWorkbenchSandbox(input: {
  sandbox: Sandbox;
  signal?: AbortSignal;
}): Promise<VercelDevWorkbenchResult<{ deleted: true }>> {
  try {
    await input.sandbox.delete(input.signal ? { signal: input.signal } : undefined);
    return { ok: true, value: { deleted: true } };
  } catch (error) {
    if (error instanceof APIError && error.response.status === 404) {
      return { ok: true, value: { deleted: true } };
    }
    return { ok: false, error: publicError("sandbox_delete_failed", "delete", true) };
  }
}

export async function waitForVercelPreview(input: {
  sandbox: Sandbox;
  tmuxSession: string;
  signal?: AbortSignal;
}): Promise<VercelDevWorkbenchResult<{ ready: true }>> {
  const script = `
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  try {
    const response = await fetch("http://127.0.0.1:${DEV_WORKBENCH_PREVIEW_PORT}/");
    if (response.ok) process.exit(0);
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
process.exit(1);
`;
  try {
    const result = await input.sandbox.runCommand({
      cmd: "node",
      args: ["--input-type=module", "--eval", script],
      timeoutMs: 95_000,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (result.exitCode !== 0) {
      await logPreviewFailure(input.sandbox, input.tmuxSession, input.signal);
      return { ok: false, error: publicError("sandbox_bootstrap_failed", "preview-health", true) };
    }
    const external = await fetch(input.sandbox.domain(DEV_WORKBENCH_PREVIEW_PORT), {
      redirect: "manual",
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!external.ok) {
      console.error("[dev-workbench] external preview health failed", external.status);
      await logPreviewFailure(input.sandbox, input.tmuxSession, input.signal);
      return { ok: false, error: publicError("sandbox_bootstrap_failed", "preview-health", true) };
    }
    return { ok: true, value: { ready: true } };
  } catch (error) {
    console.error("[dev-workbench] preview health command failed", safeDiagnostic(error));
    await logPreviewFailure(input.sandbox, input.tmuxSession, input.signal);
    return { ok: false, error: publicError("sandbox_bootstrap_failed", "preview-health", true) };
  }
}

async function logPreviewFailure(sandbox: Sandbox, tmuxSession: string, signal?: AbortSignal): Promise<void> {
  try {
    const captured = await sandbox.runCommand({
      cmd: "tmux",
      args: ["capture-pane", "-p", "-S", "-200", "-t", `${tmuxSession}:dev`],
      ...(signal ? { signal } : {}),
    });
    const output = await captured.stdout(signal ? { signal } : undefined);
    console.error("[dev-workbench] preview did not become healthy", redactDiagnostic(output.slice(-12_000)));
  } catch (error) {
    console.error("[dev-workbench] preview pane capture failed", safeDiagnostic(error));
  }
}

function safeDiagnostic(error: unknown): string {
  return error instanceof Error ? redactDiagnostic(`${error.name}: ${error.message}`.slice(0, 2_000)) : "Unknown error";
}

export function redactDiagnostic(value: string): string {
  return value
    .replace(/(https?:\/\/)[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/((?:authorization|password|secret|token)[=:]\s*)[^\s]+/gi, "$1[redacted]");
}
