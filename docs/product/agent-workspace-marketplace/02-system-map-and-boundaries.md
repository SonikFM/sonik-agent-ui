# 02-system-map-and-boundaries — System map and boundaries

Status: draft
Audience: engineering, architecture reviewers, agents
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-06

## Purpose

This doc identifies the current components, contract boundaries, and implementation boundaries for Agent UI workspaces and marketplace packages.

## Current state vs target state

| Component | Current | Target | Evidence |
| --- | --- | --- | --- |
| Tool contracts | Shared package includes marketplace schemas/fixtures in draft. | Contracts remain source of truth before runtime endpoints. | `packages/tool-contracts/src/marketplace.ts:1-80`; `packages/tool-contracts/src/marketplace-fixtures.ts:1-80` |
| Marketplace docs | Contract doc and design handoff exist. | Product corpus explains how product, design, and backend fit. | `docs/contracts/marketplace-package-contracts-v0.md:1-16`; `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md:1-18` |
| Runtime app | Standalone SvelteKit app hosts chat/canvas/workflow UI. | UI consumes marketplace/workflow contracts after endpoint implementation. | `apps/standalone-sveltekit/src/lib/agent-workflows/templates.ts`; `tests/unit/marketplace-workflow-templates.test.mjs` |
| Command catalog | Tool-contract tests cover local UI, ORPC, and host command approvals. | Marketplace packages reference command tool packs through stable command ids. | `tests/unit/tool-contracts.test.mjs:411-493`; `packages/tool-contracts/src/marketplace-fixtures.ts:45-65` |

## System map

```mermaid
flowchart LR
  User[User / Operator]
  Agent[Agent Chat]
  Canvas[Canvas / JSON-render Artifact]
  Contracts[@sonik-agent-ui/tool-contracts]
  Marketplace[Marketplace Package Version]
  Install[Marketplace Installation]
  Host[Trusted Host Context]
  Commands[Command Catalog / ORPC]
  Receipts[Receipts / Evidence]

  User --> Agent
  Agent --> Canvas
  Canvas --> Contracts
  Marketplace --> Contracts
  Marketplace --> Install
  Install --> Canvas
  Canvas -->|preview request| Commands
  Agent -->|learn/search commands| Commands
  Commands -->|requires| Host
  Host -->|trusted approval| Commands
  Commands --> Receipts
  Receipts --> Agent
  Receipts --> Canvas
```

## Boundaries

| Boundary | Owner | Rule | Evidence |
| --- | --- | --- | --- |
| Package contract | `packages/tool-contracts` | Package/version/install/bundle validation is contract-layer. | `packages/tool-contracts/src/marketplace.ts:420-609` |
| Renderer action | JSON-render app definition | Renderer can request preview/approval but not bind direct commit. | `packages/tool-contracts/src/marketplace.ts:137-193` |
| Host trust | Embedded host/runtime | Trusted host context and approval are required for write/destructive/external effects. | `packages/tool-contracts/src/marketplace.ts:98-129`; `packages/tool-contracts/src/marketplace.ts:207-222` |
| Endpoint implementation | Future ORPC routes | Endpoint names are planned typed contracts only in current docs. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:48-51` |
| Design handoff | Design docs/source copies | Design can explore pages/components but must preserve approval and command boundaries. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md:31-38` |

## Non-negotiable invariants

- No UI or artifact layer may bypass contract-layer write gates.
- Runtime endpoint implementation must not redefine package semantics outside `@sonik-agent-ui/tool-contracts`.
- Host context is an authority boundary, not display-only metadata.

## Known blockers and deferred work

- The repo is currently indexed by GitNexus (`npx gitnexus status` reported up-to-date on 2026-07-06 after `npx gitnexus analyze`).
- Production marketplace endpoints are not implemented.
- Persistence tables/migrations for marketplace packages/installations are not present in this pass.

## What developers must not do

- Do not duplicate contract definitions in app code.
- Do not make JSON-render buttons call backend write commands directly.
- Do not treat planned endpoint maps as shipped APIs.

## Prove it

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
```

Passing proves contract code builds and validates current marketplace fixtures.

## Sources

- `packages/tool-contracts/src/marketplace.ts`
- `packages/tool-contracts/src/marketplace-fixtures.ts`
- `tests/unit/tool-contracts.test.mjs`
- `tests/unit/marketplace-package-contracts.test.mjs`
- `docs/contracts/marketplace-package-contracts-v0.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md`
