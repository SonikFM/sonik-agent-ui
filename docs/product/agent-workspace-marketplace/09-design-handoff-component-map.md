# 09-design-handoff-component-map — Design handoff and component map

Status: draft
Audience: design agents, frontend engineers, product reviewers
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-06

## Purpose

This doc tells design agents what pages/components/states to design, and which contract boundaries must remain visible.

## Current state vs target state

| Aspect | Current | Target | Evidence |
| --- | --- | --- | --- |
| Handoff folder | Design handoff folder exists with brief, upload index, component inventory, parity manifest, source copies. | Designers use this corpus plus the handoff folder as a single package. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md:6-18` |
| Design north star | Workspace design brief defines chat/canvas/contracts/approval mental model. | UI expresses the mental model without dev-speak overload. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md:7-14` |
| Component map | Component inventory enumerates pages/components/states. | Design output includes install, app builder, approval card, inspector, receipts, and marketplace cards. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/COMPONENT-INVENTORY.md:1-120` |

## Design surfaces

Design must cover at least these surfaces:

1. Workspace shell: chat, canvas, inspector, subject/context chips.
2. Marketplace package cards: kind, version, update policy, trust requirements.
3. Install preview: dependency list, permissions, install mode, packageVersionId.
4. JSON-render app editor: deterministic form/state controls.
5. Command preview card: inputs, effects, host context, expected receipt.
6. Approval card: request, approve, cancel, run result.
7. Receipt/evidence panel: command receipts, source provenance, package version.
8. Package update/fork/copy screen.
9. Agent-readable state inspector.

The design brief already recommends three workspace zones: chat/steps, canvas artifact, and inspector (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md:88-100`).

## UX vocabulary

Use product-friendly labels by default, with technical details available in receipts/inspector:

| User label | Technical object |
| --- | --- |
| App | `MarketplaceManifest.kind="app"` / `CommandBackedAppDefinition` |
| Workflow | `WorkflowDefinition` package payload |
| Bundle | `BundleManifest` composition |
| Tool access | `PermissionGrant` |
| Request approval | preview/approval request state |
| Approve and run | trusted approval + command/workflow run |
| Receipt | command/evidence receipt |

## Non-negotiable invariants

- Design cannot remove packageVersionId/version visibility from install/update detail views.
- Permission controls must expose off/ask/allow semantics where applicable.
- Approval UI must distinguish draft save, submit to agent, request approval, approve and run, cancel, and receipt.

## Known blockers and deferred work

- Need refined component registry for command-backed JSON-render components.
- Need design prototype for compact session rail and marketplace install screens.
- Need accessibility pass on approval/action controls.

## What developers must not do

- Do not ship dev-speak-only marketplace screens.
- Do not hide permission or update policy details behind decorative cards only.
- Do not remove inspector/receipt affordances needed for enterprise trust.

## Prove it

```bash
test -f docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/COMPONENT-INVENTORY.md
test -f docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md
```

Passing proves design source artifacts exist. It does not prove final visual design quality.

## Sources

- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/COMPONENT-INVENTORY.md`
- `packages/tool-contracts/src/marketplace.ts`
