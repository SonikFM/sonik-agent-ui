import type { WorkbenchDetail } from "./schema";

export type WorkbenchActionId =
  | "startWorkspace"
  | "reconnectTerminal"
  | "restartPreview"
  | "captureSnapshot"
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
