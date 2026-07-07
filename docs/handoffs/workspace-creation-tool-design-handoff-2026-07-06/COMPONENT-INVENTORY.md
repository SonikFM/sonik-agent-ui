# Component Inventory — Workspace Creation Tool

## Pages

### 1. Workspace Home / Launcher Gallery
Components:
- `TemplateCard`
- `RecentWorkspaceCard`
- `MarketplaceSearchBar`
- `ContextChipBar`
- `CapabilityStatusPill`
- `CreateFromPromptComposer`

### 2. Workspace Editor
Components:
- `WorkspaceHeader`
- `ChatStepsRail`
- `LiveArtifactCanvas`
- `WorkspaceInspector`
- `EvidenceChipBar`
- `ApprovalCard`
- `ActivityTimeline`
- `VersionTimeline`

### 3. Workflow Builder
Components:
- `WorkflowCanvas`
- `WorkflowNode`
- `NodePalette`
- `FlowContextMenu`
- `FlowViewportControls`
- `NodeValidationBadge`
- `WorkflowInspector`
- `WorkflowRunPreview`

### 4. Marketplace Listing
Components:
- `MarketplaceListingCard`
- `DependencyList`
- `PermissionSummary`
- `InstallScopeSelector`
- `VersionHistory`
- `TestEvidencePanel`

### 5. Install / Permission Review
Components:
- `PermissionMatrix`
- `ToolPolicySelector`
- `SkillInstallList`
- `HostRequirementList`
- `SecretRequirementList`
- `InstallApprovalCard`

### 6. Agent Settings / Runtime Controls
Components:
- `DynamicModelPicker`
- `SkillManager`
- `ToolPermissionTable`
- `ContextManager`
- `SystemPromptEditor`
- `McpAddonList`
- `TelemetrySettings`

### 7. Publish Review
Components:
- `PublishMetadataForm`
- `PackageDependencyScan`
- `CapabilityLabelReview`
- `ScreenshotUploadPanel`
- `MarketplacePreview`
- `PublishChecklist`

## Workflow node types

| Node | Purpose | States |
| --- | --- | --- |
| TriggerNode | manual/page/webhook/schedule start | unconfigured, configured, active |
| AskUserNode | typed human input | pending, answered, invalid, skipped, expired |
| SkillNode | search/learn/run skill guidance | unresolved, learned, unavailable |
| ArtifactNode | create/update live artifact | draft, saved, invalid, promoted |
| ToolPreviewNode | preview command payload | valid, invalid, blocked |
| ApprovalNode | trusted human approval | requested, approved, denied, expired |
| ToolCommitNode | execute approved command | ready, running, completed, failed |
| RemoteExecutionNode | webhook/MCP/worker trigger | disabled, ask, allow, running, failed |
| EvidenceNode | source/receipt/provenance | source, receipt, warning, error |

## Donor components copied from Amplify

Copied source:

```txt
source-copies/amplify/src/campaign-canvas/CampaignCanvas.svelte
source-copies/amplify/src/campaign-canvas/nodes/AIActionNode.svelte
source-copies/amplify/src/campaign-canvas/nodes/ChannelNode.svelte
source-copies/amplify/src/campaign-canvas/nodes/EventNode.svelte
source-copies/amplify/src/campaign-canvas/nodes/LogicNode.svelte
source-copies/amplify/src/campaign-canvas/edges/*.svelte
source-copies/amplify/src/campaign-canvas/components/FlowContextMenu.svelte
source-copies/amplify/src/campaign-canvas/components/FlowViewportBridge.svelte
source-copies/amplify/src/campaign-canvas/components/NodeValidationBadge.svelte
source-copies/amplify/src/campaign-canvas/stores/*.svelte.ts
source-copies/amplify/src/design-system/patterns/CampaignFlow/types/*.ts
source-copies/amplify/src/design-system/patterns/CampaignFlow/theme/*
```

Design mapping:

| Amplify donor | Agent UI target |
| --- | --- |
| ChannelNode | Tool/command/app node |
| LogicNode | Branch/condition node |
| EventNode | Trigger/page-context node |
| AIActionNode | Skill/agent action node |
| FlowEdge | Normal workflow transition |
| ConditionalBranchEdge | Branch edge |
| EventTriggerEdge | Trigger edge |
| AIActionEdge | Agent/skill edge |
| NodeValidationBadge | Schema/permission/approval status |
| FlowContextMenu | Add node / paste / convert / test run menu |
| Canvas store/history | Stateful workflow editing, undo/redo, dirty/save status |
