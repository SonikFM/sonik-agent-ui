import assert from "node:assert/strict";
import {
  createDefaultWorkspaceSnapshot,
  findWorkspaceNode,
} from "../../packages/workspace-core/dist/layout/workspace-tree.js";
import {
  closePane,
  focusArtifact,
  splitWorkspace,
} from "../../packages/workspace-core/dist/layout/workspace-patches.js";

const artifact = { id: "artifact-a", kind: "json-render", title: "A" };
const secondArtifact = { id: "artifact-b", kind: "json-render", title: "B" };

const initial = createDefaultWorkspaceSnapshot();
const focused = focusArtifact(initial, { paneId: "pane-artifact", artifact });

assert.equal(focused.activePaneId, "pane-artifact");
assert.equal(focused.activeArtifactId, "artifact-a");
assert.equal(findWorkspaceNode(focused.root, "pane-artifact")?.artifact?.id, "artifact-a");
assert.equal(initial.activeArtifactId, undefined, "focusArtifact must not mutate the source snapshot");

const split = splitWorkspace(focused, {
  targetPaneId: "pane-artifact",
  direction: "vertical",
  newPaneId: "pane-artifact-2",
  newPaneKind: "artifact",
  newPaneArtifact: secondArtifact,
  focusNewPane: false,
});

assert.equal(split.activePaneId, "pane-artifact", "split should preserve active pane by default");
assert.equal(split.activeArtifactId, "artifact-a", "split should preserve active artifact by default");
assert.equal(findWorkspaceNode(split.root, "pane-artifact")?.artifact?.id, "artifact-a");
assert.equal(findWorkspaceNode(split.root, "pane-artifact-2")?.artifact?.id, "artifact-b");

const focusSplit = splitWorkspace(focused, {
  targetPaneId: "pane-artifact",
  direction: "horizontal",
  newPaneId: "pane-artifact-focused",
  newPaneKind: "artifact",
  newPaneArtifact: secondArtifact,
  focusNewPane: true,
});
assert.equal(focusSplit.activePaneId, "pane-artifact-focused");
assert.equal(focusSplit.activeArtifactId, "artifact-b");

const closedInactive = closePane(split, "pane-artifact-2");
assert.equal(closedInactive.activePaneId, "pane-artifact");
assert.equal(closedInactive.activeArtifactId, "artifact-a");
assert.equal(findWorkspaceNode(closedInactive.root, "pane-artifact-2"), undefined);

const closedActive = closePane(split, "pane-artifact");
assert.equal(closedActive.activePaneId, "pane-chat");
assert.equal(closedActive.activeArtifactId, "artifact-a", "active artifact identity should survive active pane repair");
assert.equal(findWorkspaceNode(closedActive.root, "pane-artifact"), undefined);

const missingClose = closePane(split, "missing-pane");
assert.equal(missingClose, split, "closing an unknown pane should be a no-op");

console.log("workspace-core tests passed");
