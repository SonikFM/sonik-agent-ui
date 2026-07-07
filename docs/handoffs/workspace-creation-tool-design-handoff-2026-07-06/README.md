# Workspace Creation Tool — Design Handoff Folder

Date: 2026-07-06  
Purpose: share a design-ready package for a Sonik Agent UI workspace creation tool with Open Design / design agents.

## What this folder contains

| File/folder | Use |
| --- | --- |
| `WORKSPACE-CREATION-DESIGN-BRIEF.md` | Full product/design brief, including marketplace/template additions. |
| `OPEN-DESIGN-UPLOAD-INDEX.md` | What to upload/share with Open Design and how to frame it. |
| `COMPONENT-INVENTORY.md` | Pages/components/states the design agent should create. |
| `MARKETPLACE-ORPC-PLANNING.md` | Planning notes for marketplace/search/install/publish ORPC contracts. |
| `PARITY-MANIFEST.md` | Behavior parity notes for copied donor workflow canvas behavior. |
| `manifests/amplify-campaign-flow-copy-manifest.json` | Copy manifest with upstream revision/integrity hashes. |
| `source-copies/amplify/src/campaign-canvas/` | Direct copy of Amplify's Svelte campaign canvas runtime. |
| `source-copies/amplify/src/design-system/patterns/CampaignFlow/` | Direct copy of Amplify shared flow contracts/theme/fixtures/docs. |

## Source provenance

- Upstream repo: `/Users/danielletterio/Documents/GitHub/sonik-dev/amplify/amplify`
- Remote: `https://github.com/SonikFM/amplify.git`
- Revision: `fb115de82e4177f4669ea69a4cee10786a096978`
- Copied via: `scripts/copy-from-manifest.mjs`
- Drift/integrity verified via: `scripts/verify-source-drift.mjs --write-integrity`

## Design direction in one sentence

Create a marketplace-ready live workspace builder where users can create, edit, save, share, install, and publish agents, apps, workflows, skills, tools, and live artifacts backed by Sonik/Amplify SDK contracts.

## Boundaries the design must preserve

- JSON-render and ask-user-question collect input only; they do not execute commands.
- User answers are not approvals.
- Mutations require command preview, trusted approval, and receipts.
- Non-event verticals like restaurants/tee sheets anchor to `venue_schedule`/`resource`, not fake Events.
- Availability is computed from rules, never stored as authored slot rows.
- Marketplace install must expose `off|ask|allow` tool permissions before runtime execution.
