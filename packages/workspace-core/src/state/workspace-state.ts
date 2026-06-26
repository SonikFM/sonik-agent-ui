import type { Artifact } from "@sonik-agent-ui/artifact-model";
import {
  createDefaultWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from "../layout/workspace-tree.js";

export interface WorkspaceRuntimeSnapshot<TArtifact extends Artifact = Artifact> {
  workspace: WorkspaceSnapshot;
  activeArtifact: TArtifact | null;
}

export function createWorkspaceRuntimeSnapshot<TArtifact extends Artifact = Artifact>(
  activeArtifact: TArtifact | null = null,
  workspace: WorkspaceSnapshot = createDefaultWorkspaceSnapshot(),
): WorkspaceRuntimeSnapshot<TArtifact> {
  return {
    workspace: {
      ...workspace,
      activeArtifactId: activeArtifact?.id ?? workspace.activeArtifactId,
    },
    activeArtifact,
  };
}

export function withActiveArtifact<TArtifact extends Artifact>(
  snapshot: WorkspaceRuntimeSnapshot<TArtifact>,
  artifact: TArtifact | null,
): WorkspaceRuntimeSnapshot<TArtifact> {
  return {
    workspace: {
      ...snapshot.workspace,
      activeArtifactId: artifact?.id,
    },
    activeArtifact: artifact,
  };
}
