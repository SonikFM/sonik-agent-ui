import type {
  WorkspaceArtifactRef,
  WorkspaceNode,
  WorkspacePaneKind,
  WorkspacePaneNode,
  WorkspaceSnapshot,
  WorkspaceSplitNode,
} from "./workspace-tree.js";
import { findWorkspaceNode, isWorkspacePane, isWorkspaceSplit } from "./workspace-tree.js";

export type WorkspaceSplitDirection = "horizontal" | "vertical";

export interface SplitWorkspaceInput {
  targetPaneId: string;
  direction: WorkspaceSplitDirection;
  newPaneId: string;
  newPaneKind?: WorkspacePaneKind;
  newPaneArtifact?: WorkspaceArtifactRef;
  newPaneProps?: Record<string, unknown>;
  focusNewPane?: boolean;
}

export interface FocusArtifactInput {
  paneId: string;
  artifact: WorkspaceArtifactRef;
}

function clonePaneWithFlex(pane: WorkspacePaneNode, flex: number): WorkspacePaneNode {
  return { ...pane, flex };
}

function createPane({
  newPaneId,
  newPaneKind = "artifact",
  newPaneArtifact,
  newPaneProps,
}: Omit<SplitWorkspaceInput, "targetPaneId" | "direction" | "focusNewPane">): WorkspacePaneNode {
  return {
    id: newPaneId,
    type: "pane",
    kind: newPaneKind,
    flex: 0.5,
    artifact: newPaneArtifact,
    props: newPaneProps,
  };
}

function mapWorkspaceNode(
  node: WorkspaceNode,
  mapper: (node: WorkspaceNode) => WorkspaceNode,
): WorkspaceNode {
  if (!isWorkspaceSplit(node)) return mapper(node);

  const withMappedChildren: WorkspaceSplitNode = {
    ...node,
    panes: node.panes.map((pane) => mapWorkspaceNode(pane, mapper)),
  };

  return mapper(withMappedChildren);
}

export function splitWorkspace(
  snapshot: WorkspaceSnapshot,
  input: SplitWorkspaceInput,
): WorkspaceSnapshot {
  const target = findWorkspaceNode(snapshot.root, input.targetPaneId);
  if (!target || !isWorkspacePane(target)) return snapshot;

  const replacementPane = createPane(input);
  const root = mapWorkspaceNode(snapshot.root, (node) => {
    if (node.id !== input.targetPaneId || !isWorkspacePane(node)) return node;

    return {
      id: `${input.targetPaneId}-split-${input.direction}`,
      type: "split",
      direction: input.direction,
      flex: node.flex,
      panes: [clonePaneWithFlex(node, 0.5), replacementPane],
    } satisfies WorkspaceSplitNode;
  });

  return {
    ...snapshot,
    activePaneId: input.focusNewPane ? input.newPaneId : snapshot.activePaneId,
    activeArtifactId: input.focusNewPane
      ? input.newPaneArtifact?.id ?? snapshot.activeArtifactId
      : snapshot.activeArtifactId,
    root,
  };
}

export function focusArtifact(
  snapshot: WorkspaceSnapshot,
  input: FocusArtifactInput,
): WorkspaceSnapshot {
  const target = findWorkspaceNode(snapshot.root, input.paneId);
  if (!target || !isWorkspacePane(target)) return snapshot;

  const root = mapWorkspaceNode(snapshot.root, (node) => {
    if (node.id !== input.paneId || !isWorkspacePane(node)) return node;

    return {
      ...node,
      kind: "artifact",
      artifact: input.artifact,
    } satisfies WorkspacePaneNode;
  });

  return {
    ...snapshot,
    activePaneId: input.paneId,
    activeArtifactId: input.artifact.id,
    root,
  };
}

function removePaneFromNode(node: WorkspaceNode, paneId: string): WorkspaceNode | null {
  if (isWorkspacePane(node)) return node.id === paneId ? null : node;

  const remaining = node.panes
    .map((pane) => removePaneFromNode(pane, paneId))
    .filter((pane): pane is WorkspaceNode => pane !== null);

  if (remaining.length === 0) return null;
  if (remaining.length === 1) {
    const [only] = remaining;
    if (!only) return null;
    return { ...only, flex: node.flex ?? only.flex };
  }

  const equalFlex = 1 / remaining.length;
  return {
    ...node,
    panes: remaining.map((pane) => ({ ...pane, flex: pane.flex ?? equalFlex })),
  };
}

function findFirstPane(node: WorkspaceNode): WorkspacePaneNode | undefined {
  if (isWorkspacePane(node)) return node;
  for (const pane of node.panes) {
    const found = findFirstPane(pane);
    if (found) return found;
  }
  return undefined;
}

export function closePane(
  snapshot: WorkspaceSnapshot,
  paneId: string,
): WorkspaceSnapshot {
  const target = findWorkspaceNode(snapshot.root, paneId);
  if (!target || !isWorkspacePane(target)) return snapshot;

  const root = removePaneFromNode(snapshot.root, paneId);
  if (!root) return snapshot;

  const activePaneClosed = snapshot.activePaneId === paneId;
  const repairPane = activePaneClosed ? findFirstPane(root) : undefined;

  return {
    ...snapshot,
    root,
    activePaneId: activePaneClosed ? repairPane?.id : snapshot.activePaneId,
    activeArtifactId: activePaneClosed
      ? repairPane?.artifact?.id ?? snapshot.activeArtifactId
      : snapshot.activeArtifactId,
  };
}
