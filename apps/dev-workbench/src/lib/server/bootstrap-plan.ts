import { z } from "zod";
import {
  DEV_WORKBENCH_MIRROR_PATHS,
  DEV_WORKBENCH_PREVIEW_PORT,
  DEV_WORKBENCH_REPOSITORY_ROOT,
  DEV_WORKBENCH_ROOT,
  DEV_WORKBENCH_STATE_ROOT,
  repositoryManifestSchema,
  tmuxWindowSchema,
  type RepositoryManifest,
  type TmuxWindow,
} from "../contracts/workbench";

export const sandboxCommandSchema = z.object({
  id: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  cmd: z.string().min(1).max(256),
  args: z.array(z.string().max(16_384)).max(128),
  cwd: z.string().min(1).max(2_048).optional(),
  sudo: z.boolean().optional(),
}).strict();
export type SandboxCommand = z.infer<typeof sandboxCommandSchema>;

export const devWorkbenchBootstrapPlanSchema = z.object({
  repositoryRoot: z.literal(DEV_WORKBENCH_REPOSITORY_ROOT),
  stateRoot: z.literal(DEV_WORKBENCH_STATE_ROOT),
  previewPort: z.literal(DEV_WORKBENCH_PREVIEW_PORT),
  tmuxSession: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  windows: z.array(tmuxWindowSchema).length(3),
  commands: z.array(sandboxCommandSchema).min(1),
}).strict();
export type DevWorkbenchBootstrapPlan = z.infer<typeof devWorkbenchBootstrapPlanSchema>;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function shellCommand(argv: readonly string[]): string {
  return argv.map(shellQuote).join(" ");
}

export function createTmuxSessionName(sessionId: string): string {
  const safe = sessionId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!safe) throw new Error("sessionId must contain at least one safe character");
  return `sonik-${safe}`.slice(0, 128);
}

export function createTmuxWindows(manifest: RepositoryManifest, previewHost?: string): TmuxWindow[] {
  const devCommand = previewHost
    ? ["env", `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=${previewHost}`, ...manifest.commands.dev]
    : manifest.commands.dev;
  return [
    { name: "codex", index: 0, command: manifest.commands.codex, workingDirectory: DEV_WORKBENCH_REPOSITORY_ROOT },
    { name: "dev", index: 1, command: devCommand, workingDirectory: DEV_WORKBENCH_REPOSITORY_ROOT },
    { name: "shell", index: 2, command: ["bash", "--login"], workingDirectory: DEV_WORKBENCH_REPOSITORY_ROOT },
  ].map((window) => tmuxWindowSchema.parse(window));
}

export function createDevWorkbenchBootstrapPlan(input: {
  sessionId: string;
  repository: RepositoryManifest;
  previewHost?: string;
}): DevWorkbenchBootstrapPlan {
  const repository = repositoryManifestSchema.parse(input.repository);
  const tmuxSession = createTmuxSessionName(input.sessionId);
  const windows = createTmuxWindows(repository, input.previewHost);
  const commands: SandboxCommand[] = [
    {
      id: "install-tmux",
      cmd: "dnf",
      args: ["install", "-y", "tmux"],
      sudo: true,
    },
    {
      id: "prepare-workspace",
      cmd: "mkdir",
      args: ["-p", DEV_WORKBENCH_ROOT, DEV_WORKBENCH_STATE_ROOT, `${DEV_WORKBENCH_STATE_ROOT}/screenshots`],
    },
    {
      id: "clone-repository",
      cmd: "git",
      args: ["clone", "--no-checkout", "--filter=blob:none", repository.cloneUrl, DEV_WORKBENCH_REPOSITORY_ROOT],
    },
    {
      id: "checkout-revision",
      cmd: "git",
      args: ["checkout", "--detach", repository.revision],
      cwd: DEV_WORKBENCH_REPOSITORY_ROOT,
    },
    {
      id: "install-dependencies",
      cmd: repository.commands.install[0]!,
      args: repository.commands.install.slice(1),
      cwd: DEV_WORKBENCH_REPOSITORY_ROOT,
    },
    {
      id: "start-codex-window",
      cmd: "tmux",
      args: ["new-session", "-d", "-s", tmuxSession, "-n", windows[0]!.name, "-c", DEV_WORKBENCH_REPOSITORY_ROOT, shellCommand(windows[0]!.command)],
    },
    {
      id: "start-dev-window",
      cmd: "tmux",
      args: ["new-window", "-d", "-t", tmuxSession, "-n", windows[1]!.name, "-c", DEV_WORKBENCH_REPOSITORY_ROOT, shellCommand(windows[1]!.command)],
    },
    {
      id: "start-shell-window",
      cmd: "tmux",
      args: ["new-window", "-d", "-t", tmuxSession, "-n", windows[2]!.name, "-c", DEV_WORKBENCH_REPOSITORY_ROOT, shellCommand(windows[2]!.command)],
    },
    {
      id: "select-codex-window",
      cmd: "tmux",
      args: ["select-window", "-t", `${tmuxSession}:${windows[0]!.name}`],
    },
  ];

  // These files are host-written after the sandbox exists; the plan reserves their stable paths.
  void DEV_WORKBENCH_MIRROR_PATHS;

  return devWorkbenchBootstrapPlanSchema.parse({
    repositoryRoot: DEV_WORKBENCH_REPOSITORY_ROOT,
    stateRoot: DEV_WORKBENCH_STATE_ROOT,
    previewPort: DEV_WORKBENCH_PREVIEW_PORT,
    tmuxSession,
    windows,
    commands,
  });
}

export function createRuntimeRehydrationPlan(input: {
  sessionId: string;
  repository: RepositoryManifest;
  previewHost?: string;
}): DevWorkbenchBootstrapPlan {
  const fullPlan = createDevWorkbenchBootstrapPlan(input);
  const runtimeCommandIds = new Set([
    "install-tmux",
    "start-codex-window",
    "start-dev-window",
    "start-shell-window",
    "select-codex-window",
  ]);
  return devWorkbenchBootstrapPlanSchema.parse({
    ...fullPlan,
    commands: fullPlan.commands.filter((command) => runtimeCommandIds.has(command.id)),
  });
}
