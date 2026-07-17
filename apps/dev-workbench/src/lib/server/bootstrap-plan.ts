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
  windows: z.array(tmuxWindowSchema).length(4),
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

export function createTmuxWindows(
  manifest: RepositoryManifest,
  previewHost?: string,
  agentApiOrigin?: string,
  pipeBWorker = "sonik-dev-observability-pipe-b",
  pipeBLogsEnabled = false,
): TmuxWindow[] {
  const contextEnvironment = [
    `SONIK_DEV_CONTEXT_ROOT=${DEV_WORKBENCH_STATE_ROOT}`,
    `SONIK_PAGE_CONTEXT_PATH=${DEV_WORKBENCH_MIRROR_PATHS.pageContext}`,
    `SONIK_HOST_CONTEXT_PATH=${DEV_WORKBENCH_MIRROR_PATHS.hostContext}`,
    `SONIK_HOST_AUTHORITY_PATH=${DEV_WORKBENCH_MIRROR_PATHS.hostAuthority}`,
    `SONIK_OPENAPI_PATH=${DEV_WORKBENCH_MIRROR_PATHS.openApi}`,
    `SONIK_PIPE_B_WORKER=${pipeBWorker}`,
  ];
  const devEnvironment = [
    ...contextEnvironment,
    ...(previewHost ? [`__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=${previewHost}`] : []),
    ...(agentApiOrigin ? [`SONIK_AGENT_UI_DEV_API_ORIGIN=${agentApiOrigin}`] : []),
  ];
  const withContext = (command: readonly string[]) => ["env", ...contextEnvironment, ...command];
  const logsCommand = pipeBLogsEnabled
    ? ["pnpm", "-C", "apps/standalone-sveltekit", "exec", "wrangler", "tail", pipeBWorker, "--format", "json"]
    : ["bash", "-lc", `printf '%s\\n' 'Pipe B access is not configured for this sandbox.' 'Set DEV_WORKBENCH_CLOUDFLARE_API_TOKEN in Vercel, then create a fresh workspace.'; exec bash --login`];
  return [
    { name: "codex", index: 0, command: withContext(manifest.commands.codex), workingDirectory: DEV_WORKBENCH_REPOSITORY_ROOT },
    { name: "dev", index: 1, command: ["env", ...devEnvironment, ...manifest.commands.dev], workingDirectory: DEV_WORKBENCH_REPOSITORY_ROOT },
    { name: "shell", index: 2, command: withContext(["bash", "--login"]), workingDirectory: DEV_WORKBENCH_REPOSITORY_ROOT },
    { name: "logs", index: 3, command: withContext(logsCommand), workingDirectory: DEV_WORKBENCH_REPOSITORY_ROOT },
  ].map((window) => tmuxWindowSchema.parse(window));
}

export function createDevWorkbenchBootstrapPlan(input: {
  sessionId: string;
  repository: RepositoryManifest;
  previewHost?: string;
  agentApiOrigin?: string;
  pipeBWorker?: string;
  pipeBLogsEnabled?: boolean;
}): DevWorkbenchBootstrapPlan {
  const repository = repositoryManifestSchema.parse(input.repository);
  const tmuxSession = createTmuxSessionName(input.sessionId);
  const windows = createTmuxWindows(
    repository,
    input.previewHost,
    input.agentApiOrigin,
    input.pipeBWorker,
    input.pipeBLogsEnabled,
  );
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
      id: "start-logs-window",
      cmd: "tmux",
      args: ["new-window", "-d", "-t", tmuxSession, "-n", windows[3]!.name, "-c", DEV_WORKBENCH_REPOSITORY_ROOT, shellCommand(windows[3]!.command)],
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
  agentApiOrigin?: string;
  pipeBWorker?: string;
  pipeBLogsEnabled?: boolean;
}): DevWorkbenchBootstrapPlan {
  const fullPlan = createDevWorkbenchBootstrapPlan(input);
  const runtimeCommandIds = new Set([
    "install-tmux",
    "start-codex-window",
    "start-dev-window",
    "start-shell-window",
    "start-logs-window",
    "select-codex-window",
  ]);
  return devWorkbenchBootstrapPlanSchema.parse({
    ...fullPlan,
    commands: fullPlan.commands.filter((command) => runtimeCommandIds.has(command.id)),
  });
}

export function createDevWindowRefreshPlan(input: {
  sessionId: string;
  repository: RepositoryManifest;
  previewHost?: string;
  agentApiOrigin?: string;
  pipeBWorker?: string;
  pipeBLogsEnabled?: boolean;
}): DevWorkbenchBootstrapPlan {
  const fullPlan = createDevWorkbenchBootstrapPlan(input);
  const startDevWindow = fullPlan.commands.find((command) => command.id === "start-dev-window");
  if (!startDevWindow) throw new Error("Dev Workbench bootstrap plan is missing the dev window command");
  return devWorkbenchBootstrapPlanSchema.parse({
    ...fullPlan,
    commands: [
      {
        id: "kill-dev-window",
        cmd: "tmux",
        args: ["kill-window", "-t", `${fullPlan.tmuxSession}:dev`],
      },
      { ...startDevWindow, id: "restart-dev-window" },
    ],
  });
}
