import type { WorkbenchDetail, WorkbenchVisualSourceId } from "./schema";

export type WorkbenchActionId =
  | "startWorkspace"
  | "reconnectTerminal"
  | "restartPreview"
  | "captureSnapshot"
  | "pickVisualTarget"
  | "captureVisualContext"
  | "setupVisualBrowser"
  | "pairVisualExtension"
  | "openPreview"
  | "stopWorkspace"
  | "setDetail";

export type WorkbenchSemanticActionResult = {
  ok: boolean;
  state: "accepted" | "unavailable" | "selected";
  message: string;
  disabledReason: string | null;
};

export type DevWorkbenchCallbacks = {
  onStartWorkspace?: () => WorkbenchSemanticActionResult | void;
  onReconnectTerminal?: () => WorkbenchSemanticActionResult | void;
  onRestartPreview?: () => WorkbenchSemanticActionResult | void;
  onCaptureSnapshot?: () => WorkbenchSemanticActionResult | void;
  onVisualSourceChange?: (sourceId: WorkbenchVisualSourceId) => WorkbenchSemanticActionResult | void;
  onPickVisualTarget?: () => WorkbenchSemanticActionResult | void;
  onCaptureVisualContext?: () => WorkbenchSemanticActionResult | void;
  onSetupVisualBrowser?: () => WorkbenchSemanticActionResult | void;
  onPairVisualExtension?: () => WorkbenchSemanticActionResult | void;
  onOpenPreview?: () => WorkbenchSemanticActionResult | void;
  onStopWorkspace?: () => WorkbenchSemanticActionResult | void;
  onDetailChange?: (detail: WorkbenchDetail) => WorkbenchSemanticActionResult | void;
};

export const workbenchActionDescriptors = {
  startWorkspace: {
    effect: "environment",
    serviceBacked: true,
    approvalRequired: false,
    description: "Create an isolated repository workspace and start its development tools.",
  },
  reconnectTerminal: {
    effect: "environment",
    serviceBacked: true,
    approvalRequired: false,
    description: "Reconnect the visible terminal to the existing tmux session.",
  },
  restartPreview: {
    effect: "environment",
    serviceBacked: true,
    approvalRequired: false,
    description: "Restart the development preview without changing source files.",
  },
  captureSnapshot: {
    effect: "read",
    serviceBacked: true,
    approvalRequired: false,
    description: "Synchronize sanitized, display-only page context into the sandbox mirror.",
  },
  pickVisualTarget: {
    effect: "read", serviceBacked: false, approvalRequired: false,
    description: "Select a semantic target from the active visual source.",
  },
  captureVisualContext: {
    effect: "read", serviceBacked: true, approvalRequired: false,
    description: "Capture the active visual source for the workspace.",
  },
  setupVisualBrowser: {
    effect: "environment", serviceBacked: true, approvalRequired: false,
    description: "Install the controlled preview browser used for capture.",
  },
  pairVisualExtension: {
    effect: "environment", serviceBacked: false, approvalRequired: false,
    description: "Pair the optional active-tab capture extension.",
  },
  openPreview: {
    effect: "local-ui",
    serviceBacked: false,
    approvalRequired: false,
    description: "Open the current signed preview in a new browser tab.",
  },
  stopWorkspace: {
    effect: "environment",
    serviceBacked: true,
    approvalRequired: true,
    description: "Stop the attached development workspace.",
  },
  setDetail: {
    effect: "local-ui",
    serviceBacked: false,
    approvalRequired: false,
    description: "Select the visible diagnostics detail panel.",
  },
} as const satisfies Record<WorkbenchActionId, Record<string, unknown>>;

export function unavailableAction(message: string): WorkbenchSemanticActionResult {
  return { ok: false, state: "unavailable", message, disabledReason: message };
}
