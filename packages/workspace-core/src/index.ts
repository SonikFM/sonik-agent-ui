export type {
  WorkspaceArtifactRef,
  WorkspaceNode,
  WorkspacePaneKind,
  WorkspacePaneNode,
  WorkspaceSnapshot,
  WorkspaceSplitNode,
} from "./layout/workspace-tree.js";

export {
  createDefaultWorkspaceSnapshot,
  findWorkspaceNode,
  isWorkspacePane,
  isWorkspaceSplit,
  walkWorkspaceTree,
} from "./layout/workspace-tree.js";

export type { FocusArtifactInput, SplitWorkspaceInput, WorkspaceSplitDirection } from "./layout/workspace-patches.js";
export { closePane, focusArtifact, splitWorkspace } from "./layout/workspace-patches.js";

export type { WorkspaceRuntimeSnapshot } from "./state/workspace-state.js";
export { createWorkspaceRuntimeSnapshot, withActiveArtifact } from "./state/workspace-state.js";

export type {
  CanvasControlDisabledReason,
  CanvasControlId,
  CanvasControlState,
  CanvasControlStateMap,
  DeriveCanvasControlStatesInput,
} from "./state/canvas-controls.js";
export { CANVAS_CONTROL_DISABLED_MESSAGES, deriveCanvasControlStates } from "./state/canvas-controls.js";

export { default as CanvasToolbar } from "./components/CanvasToolbar.svelte";
export { default as CanvasViewport } from "./components/CanvasViewport.svelte";
export { default as ChatWindow } from "./components/ChatWindow.svelte";
export { default as WorkspaceRoot } from "./components/WorkspaceRoot.svelte";
export type { WorkspaceLayoutMode, WorkspaceRailMode } from "./components/WorkspaceRoot.svelte";
export type { CanvasPanel, CanvasToolbarProps } from "./components/CanvasToolbar.svelte";
export type { CanvasViewportProps } from "./components/CanvasViewport.svelte";
export type { ChatWindowProps } from "./components/ChatWindow.svelte";


export { default as WorkspaceDocumentFrame } from "./components/WorkspaceDocumentFrame.svelte";
export type { WorkspaceDocumentEvent, WorkspaceDocumentFrameProps, WorkspaceDocumentSnapshot } from "./components/WorkspaceDocumentFrame.svelte";
