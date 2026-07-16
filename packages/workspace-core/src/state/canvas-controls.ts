export type CanvasControlId = "preview" | "document" | "fullscreen" | "clear";

export type CanvasControlDisabledReason =
  | "streaming"
  | "missing_active_artifact"
  | "missing_active_document"
  | "missing_workspace_content";

export interface CanvasControlState {
  id: CanvasControlId;
  label: string;
  enabled: boolean;
  active: boolean;
  disabledReason?: CanvasControlDisabledReason;
}

export type CanvasControlStateMap = Record<CanvasControlId, CanvasControlState>;

export interface DeriveCanvasControlStatesInput {
  panel: string;
  isFullscreen: boolean;
  hasArtifact: boolean;
  hasDocument: boolean;
  isStreaming: boolean;
}

export const CANVAS_CONTROL_DISABLED_MESSAGES: Record<CanvasControlDisabledReason, string> = {
  streaming: "Wait for the current response to finish.",
  missing_active_artifact: "Create or open an artifact to use this control.",
  missing_active_document: "Open a workspace document to use this control.",
  missing_workspace_content: "Create an artifact or open a document to use this control.",
};

export function deriveCanvasControlStates({
  panel,
  isFullscreen,
  hasArtifact,
  hasDocument,
  isStreaming,
}: DeriveCanvasControlStatesInput): CanvasControlStateMap {
  const hasWorkspaceContent = hasArtifact || hasDocument;

  return {
    preview: {
      id: "preview",
      label: "Preview",
      enabled: hasArtifact,
      active: panel === "canvas",
      ...(!hasArtifact
        ? { disabledReason: isStreaming ? "streaming" : "missing_active_artifact" }
        : {}),
    },
    document: {
      id: "document",
      label: "Document",
      enabled: hasDocument,
      active: panel === "document",
      ...(!hasDocument
        ? { disabledReason: isStreaming ? "streaming" : "missing_active_document" }
        : {}),
    },
    fullscreen: {
      id: "fullscreen",
      label: "Fullscreen",
      enabled: hasWorkspaceContent,
      active: isFullscreen,
      ...(!hasWorkspaceContent
        ? { disabledReason: isStreaming ? "streaming" : "missing_workspace_content" }
        : {}),
    },
    clear: {
      id: "clear",
      label: "Clear",
      enabled: hasArtifact && !isStreaming,
      active: false,
      ...(!hasArtifact || isStreaming
        ? { disabledReason: isStreaming ? "streaming" : "missing_active_artifact" }
        : {}),
    },
  };
}
