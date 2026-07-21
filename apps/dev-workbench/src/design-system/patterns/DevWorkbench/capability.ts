import type { DevWorkbenchViewProps } from "./schema";

export function derivePreviewStatus(available: boolean, interactive: boolean): "connecting" | "ready" | "unavailable" {
  return !available ? "unavailable" : interactive ? "ready" : "connecting";
}

export function createDevWorkbenchCapability(props: DevWorkbenchViewProps) {
  const state = props.workspace.status === "starting" || props.workspace.status === "stopping"
    ? "loading"
    : props.workspace.status === "stopped"
      ? "disabled"
      : props.workspace.status;
  return {
    id: "sonik.dev-workbench.Workbench",
    family: "developer-workspace",
    state,
    actions: Object.fromEntries(
      Object.entries(props.actions).map(([id, action]) => [
        id,
        { enabled: action.enabled, disabledReason: action.disabledReason },
      ]),
    ),
    assertions: {
      repositoryVisible: Boolean(props.repository.name),
      previewReady: props.preview.status === "ready" && Boolean(props.preview.url),
      terminalReady: props.terminal.status === "ready",
      browserContextIsDisplayOnly: true,
      sourceAndPreviewShareCheckout: props.workspace.status === "ready",
      visualSourceDiscovered: props.visualContext.sources.length > 0,
      visualContextCurrent: props.visualContext.status !== "invalidated",
    },
  } as const;
}
