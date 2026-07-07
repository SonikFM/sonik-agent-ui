# Behavior Parity Manifest — Amplify Campaign Flow → Agent UI Workflow Builder

## Donor behavior records

### donor_behavior_id: graph-canvas-pan-zoom-fit
- upstream source evidence: `source-copies/amplify/src/campaign-canvas/CampaignCanvas.svelte`, `FlowViewportBridge.svelte`
- copied destination: `source-copies/amplify/src/campaign-canvas/`
- Sonik adapter/contract: future `WorkflowCanvas` controlled by workflow definition state
- state owner and persistence seam: Agent UI workflow controller owns nodes/edges/viewport; canvas emits `onFlowChange` and `onViewportChange`
- telemetry events: `workflow.canvas.viewport_change`, `workflow.canvas.fit_view`
- host test / ultratest / manual prompt: create workflow, fit view, reload, viewport persists
- known gaps: not implemented in Agent UI yet

### donor_behavior_id: node-palette-drop-and-context-add
- upstream source evidence: `CampaignCanvas.svelte`, `FlowContextMenu.svelte`, `FlowPaletteDropItem` type
- copied destination: `source-copies/amplify/src/campaign-canvas/components/FlowContextMenu.svelte`
- Sonik adapter/contract: node palette for Trigger, AskUser, Skill, Artifact, ToolPreview, Approval, ToolCommit, RemoteExecution
- telemetry events: `workflow.node.added`, `workflow.context_menu.add_node`
- known gaps: needs Sonik node schema and permission policy mapping

### donor_behavior_id: typed-node-and-edge-contracts
- upstream source evidence: `source-copies/amplify/src/design-system/patterns/CampaignFlow/types/flow.ts`
- copied destination: `source-copies/amplify/src/design-system/patterns/CampaignFlow/types/`
- Sonik adapter/contract: `WorkflowNode`, `WorkflowEdge`, `SerializedWorkflow`
- state owner and persistence seam: workflow registry + versioned workflow definitions
- telemetry events: `workflow.definition.validated`, `workflow.definition.saved`
- known gaps: need ORPC marketplace/workflow schemas

### donor_behavior_id: undo-redo-dirty-status
- upstream source evidence: `source-copies/amplify/src/campaign-canvas/stores/canvas-history.svelte.ts`, `canvas-store.svelte.ts`
- Sonik adapter/contract: save indicator, dirty guard, version timeline
- telemetry events: `workflow.history.undo`, `workflow.history.redo`, `workflow.definition.dirty`
- known gaps: not yet wired into Agent UI persistence

### donor_behavior_id: validation-badges
- upstream source evidence: `source-copies/amplify/src/campaign-canvas/components/NodeValidationBadge.svelte`
- Sonik adapter/contract: required skill/tool/capability/permission validation
- telemetry events: `workflow.node.validation_error`, `workflow.node.validation_success`
- known gaps: validation schemas need marketplace/workflow contracts

## Copy verification

Manifest:

```txt
manifests/amplify-campaign-flow-copy-manifest.json
```

Commands run:

```txt
node scripts/copy-from-manifest.mjs docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/manifests/amplify-campaign-flow-copy-manifest.json
node scripts/verify-source-drift.mjs docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/manifests/amplify-campaign-flow-copy-manifest.json --write-integrity
node scripts/verify-source-drift.mjs docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/manifests/amplify-campaign-flow-copy-manifest.json
```
