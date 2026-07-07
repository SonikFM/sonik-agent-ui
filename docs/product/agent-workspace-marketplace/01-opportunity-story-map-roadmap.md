# 01-opportunity-story-map-roadmap — Opportunity, story map, and release slices

Status: draft
Audience: product, design, engineering
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-06

## Purpose

This doc turns the product strategy into opportunity areas, user-story backbone, and staged release slices. It uses opportunity-solution-tree, user-story-mapping, user-story-splitting, roadmap-planning, and derisk-measurement guidance.

## Current state vs target state

| Aspect | Current | Target | Evidence |
| --- | --- | --- | --- |
| Opportunity space | Workspace/design docs identify marketplace-ready live workspace builder. | Roadmap uses outcomes and journeys, not disconnected feature requests. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md:27-38`; `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md:63-87` |
| Journey map | Component inventory exists for design handoff. | Story map maps discover → draft → preview → approve → install/run/share. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/COMPONENT-INVENTORY.md:1-120` |
| Release state | Contract-only marketplace model and workflow templates exist. | Runtime endpoint/persistence/UI work follows after contract docs. | `docs/contracts/marketplace-package-contracts-v0.md:74-90`; `tests/unit/marketplace-workflow-templates.test.mjs:1-130` |

## Opportunity solution tree

| Desired outcome | Opportunity | Candidate solution | Test / proof |
| --- | --- | --- | --- |
| Operators can create useful business apps from chat. | Freeform chat loses structure and approvals. | JSON-render command-backed app with guided question cards. | `tests/unit/tool-contracts.test.mjs:280-285`; `tests/unit/marketplace-package-contracts.test.mjs:44-82` |
| Admins can install useful capabilities safely. | Single tools are too fragmented; huge bundles can hide permissions. | Package/version/install envelope plus bundle composition. | `packages/tool-contracts/src/marketplace.ts:347-398`; `docs/contracts/marketplace-package-contracts-v0.md:37-52` |
| Agents can reuse workflows reliably. | Skills/tools/workflows are not consistently packaged. | Marketplace package kinds include workflow, skill, command_tool_pack, agent, app. | `packages/tool-contracts/src/marketplace.ts:8-18`; `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:21-34` |
| Writes are trustworthy. | UI clicks and chat “approve” text can be confused with authorization. | Preview → trusted approval → receipt contract. | `packages/tool-contracts/src/marketplace.ts:98-129`; `packages/tool-contracts/src/marketplace.ts:207-222` |

## User-story backbone

1. Discover a package or start from a workflow launcher.
2. Inspect package contents, dependencies, permissions, update policy, and host-context requirements.
3. Install pinned/copied/forked/subscribed version into org/workspace/user scope.
4. Use the installed app/workflow in chat/canvas.
5. Fill deterministic JSON-render state or answer agent questions.
6. Preview command-backed action.
7. Request trusted approval.
8. Run approved workflow and receive command receipts.
9. Save/share/update/fork the installed package or app.

This backbone is supported by planned endpoint names in `MARKETPLACE-ORPC-PLANNING.md:52-85` and current contract schema/test coverage in `packages/tool-contracts/src/marketplace.ts:420-609` and `tests/unit/marketplace-package-contracts.test.mjs:28-82`.

## Release slices

| Slice | Scope | Exit criteria | Evidence / gap |
| --- | --- | --- | --- |
| R0 Contract docs | This corpus plus existing contract docs/tests. | Docs cite sources and prove current invariants. | This directory; `docs/contracts/marketplace-package-contracts-v0.md` |
| R1 Contract package hardening | Finalize Zod schemas, fixtures, exports, schema migration helper. | `pnpm --filter @sonik-agent-ui/tool-contracts build`; marketplace tests pass. | `packages/tool-contracts/src/marketplace.ts`; `tests/unit/marketplace-package-contracts.test.mjs` |
| R2 Agent-readable app/workflow state | Expose active workflow/intake/approval state in machine-readable context. | Agent no longer scrapes DOM for intake/approval progress. | Gap; referenced by prior UX/testing issues, not fully solved in current contracts. |
| R3 Marketplace ORPC read/preview | Implement search/get/version/install-preview/validate endpoints. | Typed route tests and auth/org gates pass. | Planned in `MARKETPLACE-ORPC-PLANNING.md:52-62`. |
| R4 Install/manage writes | Implement install/update/copy/fork/pin permissions with trusted approval. | Install receipts and audit rows exist. | Planned in `MARKETPLACE-ORPC-PLANNING.md:64-74`. |
| R5 Workflow/app execution | Implement previewRun/requestApproval/runApproved/app preview/applyStatePatch. | Live smoke proves preview → approval → receipt for booking/amplify examples. | Planned in `MARKETPLACE-ORPC-PLANNING.md:76-85`. |
| R6 Publish/update marketplace | Add publishing, moderation, creator updates, package version migrations. | Update/install semantics proven across version changes. | Future; no production endpoints yet. |

## Non-negotiable invariants

- Each release slice must preserve preview/approval/receipt semantics for writes.
- R2 must expose machine-readable workflow state without granting command authority.
- R3/R4 must use immutable packageVersionId for install/update.

## Known blockers and deferred work

- No production data model/migrations for marketplace packages or installations yet.
- No design-approved marketplace install screen yet.
- No public publish/moderation policy yet.

## What developers must not do

- Do not jump from R0 directly to live mutating workflow execution without R2/R3/R4 proof.
- Do not build a visual workflow builder before package/install/update contracts are stable.
- Do not make DOM text the source of truth for workflow state.

## Prove it

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
node --experimental-strip-types tests/unit/marketplace-workflow-templates.test.mjs
```

Passing proves current release-slice contract assumptions. It does not prove R2-R6 are implemented.

## Sources

- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/COMPONENT-INVENTORY.md`
- `packages/tool-contracts/src/marketplace.ts`
- `tests/unit/marketplace-package-contracts.test.mjs`
- `tests/unit/marketplace-workflow-templates.test.mjs`
- `tests/unit/tool-contracts.test.mjs`
