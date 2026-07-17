import type { DevWorkbenchViewProps } from "./schema";

const unavailable = (disabledReason: string) => ({ enabled: false, disabledReason });

export const devWorkbenchStartingFixture = {
  title: "Sonik Dev Workbench",
  repository: {
    name: "sonikfm/sonik-agent-ui",
    branch: "main",
    revision: "revision pending",
    dirty: false,
  },
  workspace: {
    status: "idle",
    label: "Workspace not started",
    message: "Start an isolated checkout when you are ready to work.",
  },
  preview: {
    status: "unavailable",
    url: null,
    path: "/",
    viewportLabel: "Responsive desktop",
    disabledReason: "Preview transport is not connected.",
  },
  terminal: {
    status: "unavailable",
    sessionName: "sonik-pending",
    cwd: "/vercel/sandbox/workspace/repo",
    transport: "tmux via authenticated PTY",
    disabledReason: "Terminal transport is not connected.",
  },
  activeDetail: "problems",
  problems: [],
  changedFiles: [],
  consoleEntries: [],
  failedRequests: [],
  actions: {
    startWorkspace: { enabled: true, disabledReason: null },
    reconnectTerminal: unavailable("Terminal transport is not connected."),
    restartPreview: unavailable("Preview transport is not connected."),
    captureSnapshot: unavailable("Page context requires a running workspace."),
    openPreview: unavailable("No preview URL is available."),
    stopWorkspace: unavailable("No running workspace is attached."),
  },
} satisfies DevWorkbenchViewProps;

export const devWorkbenchReadyFixture = {
  ...devWorkbenchStartingFixture,
  repository: {
    ...devWorkbenchStartingFixture.repository,
    revision: "91a3d6e",
    dirty: true,
  },
  workspace: {
    status: "ready",
    label: "Workspace ready",
    message: "Codex and the development server are attached to the same checkout.",
  },
  preview: {
    status: "ready",
    url: "https://example.vercel.run",
    path: "/",
    viewportLabel: "1440 × 900",
    disabledReason: null,
  },
  terminal: {
    status: "ready",
    sessionName: "sonik-workbench-demo",
    cwd: "/vercel/sandbox/workspace/repo",
    transport: "tmux via authenticated PTY",
    disabledReason: null,
  },
  problems: [
    {
      id: "problem-1",
      severity: "warning",
      message: "Example fixture warning",
      file: "src/routes/+page.svelte",
      line: 42,
    },
  ],
  changedFiles: [{ path: "src/routes/+page.svelte", status: "modified" }],
  consoleEntries: ["Vite development server ready."],
  actions: {
    startWorkspace: unavailable("A workspace is already running."),
    reconnectTerminal: { enabled: true, disabledReason: null },
    restartPreview: { enabled: true, disabledReason: null },
    captureSnapshot: { enabled: true, disabledReason: null },
    openPreview: { enabled: true, disabledReason: null },
    stopWorkspace: { enabled: true, disabledReason: null },
  },
} satisfies DevWorkbenchViewProps;
