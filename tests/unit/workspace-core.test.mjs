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
import { deriveCanvasControlStates } from "../../packages/workspace-core/dist/state/canvas-controls.js";

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

const noContent = deriveCanvasControlStates({
  panel: "canvas",
  isFullscreen: false,
  hasArtifact: false,
  hasDocument: false,
  isStreaming: false,
});
assert.deepEqual(noContent, {
  preview: { id: "preview", label: "Preview", enabled: false, active: true, disabledReason: "missing_active_artifact" },
  document: { id: "document", label: "Document", enabled: false, active: false, disabledReason: "missing_active_document" },
  fullscreen: { id: "fullscreen", label: "Fullscreen", enabled: false, active: false, disabledReason: "missing_workspace_content" },
  clear: { id: "clear", label: "Clear", enabled: false, active: false, disabledReason: "missing_active_artifact" },
});

const streamingWithoutContent = deriveCanvasControlStates({
  panel: "document",
  isFullscreen: false,
  hasArtifact: false,
  hasDocument: false,
  isStreaming: true,
});
assert.equal(streamingWithoutContent.preview.disabledReason, "streaming", "streaming must take precedence for a missing preview");
assert.equal(streamingWithoutContent.document.disabledReason, "streaming", "streaming must take precedence for a missing document");
assert.equal(streamingWithoutContent.fullscreen.disabledReason, "streaming", "streaming must take precedence when no workspace content exists");
assert.equal(streamingWithoutContent.clear.disabledReason, "streaming", "streaming must take precedence for Clear");

const streamingWithBothViews = deriveCanvasControlStates({
  panel: "document",
  isFullscreen: true,
  hasArtifact: true,
  hasDocument: true,
  isStreaming: true,
});
assert.equal(streamingWithBothViews.preview.enabled, true, "existing artifact view switches remain usable while streaming");
assert.equal(streamingWithBothViews.document.enabled, true, "existing document view switches remain usable while streaming");
assert.equal(streamingWithBothViews.fullscreen.enabled, true, "existing workspace content remains fullscreen-capable while streaming");
assert.equal(streamingWithBothViews.clear.enabled, false, "Clear must remain disabled while streaming");
assert.equal(streamingWithBothViews.document.active, true);
assert.equal(streamingWithBothViews.fullscreen.active, true);
assert.equal(streamingWithBothViews.clear.active, false, "Clear is never a pressed-state control");

const artifactOnly = deriveCanvasControlStates({
  panel: "canvas",
  isFullscreen: false,
  hasArtifact: true,
  hasDocument: false,
  isStreaming: false,
});
assert.equal(artifactOnly.preview.enabled, true);
assert.equal(artifactOnly.preview.active, true);
assert.equal(artifactOnly.document.disabledReason, "missing_active_document");
assert.equal(artifactOnly.fullscreen.enabled, true);
assert.equal(artifactOnly.clear.enabled, true);

const documentOnly = deriveCanvasControlStates({
  panel: "document",
  isFullscreen: false,
  hasArtifact: false,
  hasDocument: true,
  isStreaming: false,
});
assert.equal(documentOnly.preview.disabledReason, "missing_active_artifact");
assert.equal(documentOnly.document.enabled, true);
assert.equal(documentOnly.document.active, true);
assert.equal(documentOnly.fullscreen.enabled, true);
assert.equal(documentOnly.clear.disabledReason, "missing_active_artifact");

for (const hasArtifact of [false, true]) {
  for (const hasDocument of [false, true]) {
    for (const isStreaming of [false, true]) {
      for (const panel of ["canvas", "document"]) {
        for (const isFullscreen of [false, true]) {
          const states = deriveCanvasControlStates({ panel, isFullscreen, hasArtifact, hasDocument, isStreaming });
          const hasWorkspaceContent = hasArtifact || hasDocument;

          assert.equal(states.preview.enabled, hasArtifact);
          assert.equal(states.preview.active, panel === "canvas");
          assert.equal(states.preview.disabledReason, hasArtifact ? undefined : isStreaming ? "streaming" : "missing_active_artifact");
          assert.equal(states.document.enabled, hasDocument);
          assert.equal(states.document.active, panel === "document");
          assert.equal(states.document.disabledReason, hasDocument ? undefined : isStreaming ? "streaming" : "missing_active_document");
          assert.equal(states.fullscreen.enabled, hasWorkspaceContent);
          assert.equal(states.fullscreen.active, isFullscreen);
          assert.equal(states.fullscreen.disabledReason, hasWorkspaceContent ? undefined : isStreaming ? "streaming" : "missing_workspace_content");
          assert.equal(states.clear.enabled, hasArtifact && !isStreaming);
          assert.equal(states.clear.active, false);
          assert.equal(states.clear.disabledReason, hasArtifact && !isStreaming ? undefined : isStreaming ? "streaming" : "missing_active_artifact");
        }
      }
    }
  }
}

console.log("workspace-core tests passed");
