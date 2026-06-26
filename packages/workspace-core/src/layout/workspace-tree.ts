export type WorkspacePaneKind =
  | "chat"
  | "artifact"
  | "json-viewer"
  | "document-editor"
  | "sandbox-terminal";

export interface WorkspaceArtifactRef {
  id: string;
  title?: string;
  kind: "json-render" | "html" | "document" | "terminal" | "custom";
}

export interface WorkspacePaneNode {
  id: string;
  type: "pane";
  kind: WorkspacePaneKind;
  flex?: number;
  artifact?: WorkspaceArtifactRef;
  props?: Record<string, unknown>;
}

export interface WorkspaceSplitNode {
  id: string;
  type: "split";
  direction: "horizontal" | "vertical";
  panes: WorkspaceNode[];
  flex?: number;
}

export type WorkspaceNode = WorkspacePaneNode | WorkspaceSplitNode;

export interface WorkspaceSnapshot {
  id: string;
  activePaneId?: string;
  activeArtifactId?: string;
  root: WorkspaceNode;
}

export function isWorkspaceSplit(node: WorkspaceNode): node is WorkspaceSplitNode {
  return node.type === "split";
}

export function isWorkspacePane(node: WorkspaceNode): node is WorkspacePaneNode {
  return node.type === "pane";
}

export function walkWorkspaceTree(
  node: WorkspaceNode,
  visit: (node: WorkspaceNode) => void,
): void {
  visit(node);
  if (isWorkspaceSplit(node)) {
    for (const child of node.panes) {
      walkWorkspaceTree(child, visit);
    }
  }
}

export function findWorkspaceNode(
  node: WorkspaceNode,
  id: string,
): WorkspaceNode | undefined {
  if (node.id === id) return node;
  if (!isWorkspaceSplit(node)) return undefined;

  for (const child of node.panes) {
    const match = findWorkspaceNode(child, id);
    if (match) return match;
  }

  return undefined;
}

export function createDefaultWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    id: "default-workspace",
    activePaneId: "pane-chat",
    root: {
      id: "root-split",
      type: "split",
      direction: "horizontal",
      panes: [
        { id: "pane-chat", type: "pane", kind: "chat", flex: 0.38 },
        {
          id: "pane-artifact",
          type: "pane",
          kind: "artifact",
          flex: 0.62,
          artifact: { id: "active-json-render", kind: "json-render" },
        },
      ],
    },
  };
}
