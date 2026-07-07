# Open Design Upload Index

Upload/share these as the design package:

1. `WORKSPACE-CREATION-DESIGN-BRIEF.md`
2. `COMPONENT-INVENTORY.md`
3. `MARKETPLACE-ORPC-PLANNING.md`
4. `PARITY-MANIFEST.md`
5. `source-copies/amplify/src/campaign-canvas/`
6. `source-copies/amplify/src/design-system/patterns/CampaignFlow/`

## Prompt for Open Design / design agent

Design a Sonik Agent UI workspace creation tool. It should let operators create live artifacts and workflow templates from chat, edit them on a canvas, inspect schema/commands/evidence, request approval for writes, and publish/share/install templates through a marketplace.

Use the copied Amplify campaign flow as the interaction donor for graph editing. Preserve these concepts:

- graph nodes/edges as workflow truth
- node palette
- context menu add/paste
- validation badges
- dirty/save/undo status
- framework-agnostic serialized workflow DTOs
- host-owned persistence bridge

Do not make the renderer execute commands directly. Writes go through preview → approval → trusted command receipt.

## Core demo scenarios

1. Set up a restaurant booking workflow template.
2. Create an event intake workflow template.
3. Create an Amplify campaign wizard template.
4. Compare two artists and save an intelligence workspace.
5. Publish a workflow template to an org-private marketplace.

## Visual deliverables requested

- Workspace home / launcher gallery
- Full workspace editor
- Workflow builder canvas
- Template marketplace listing
- Install / permission review modal
- Agent settings controls
- Publish review screen
- Approval card states
- Evidence/receipt panel
