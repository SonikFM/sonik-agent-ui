# 10-roadmap-risks-open-questions — Roadmap, risks, and open questions

Status: draft
Audience: product, engineering leads, reviewers
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-06

## Purpose

This doc consolidates roadmap sequencing, risk register, and decisions that must be resolved before production implementation expands.

## Current state vs target state

| Aspect | Current | Target | Evidence |
| --- | --- | --- | --- |
| Contract base | Marketplace contracts and fixtures exist. | Contracts are reviewed, merged, and used by endpoints/UI. | `packages/tool-contracts/src/marketplace.ts`; `packages/tool-contracts/src/marketplace-fixtures.ts` |
| Product docs | This corpus is draft. | Reviewers sign off before implementation slices. | `docs/product/agent-workspace-marketplace/INDEX.md` |
| Endpoint implementation | Planned only. | RLS/org-scoped ORPC endpoints with tests. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:48-85` |

## Risk register

| Risk | Severity | Act now or track | Evidence / mitigation |
| --- | --- | --- | --- |
| Agents cannot read workflow/app state and must infer from UI text. | High | Act now | Add machine-readable workflow/app state before relying on agent execution. Current contracts focus packages, not active UI state. |
| Marketplace packages over-grant permissions. | High | Act now | Install preview must expose permissions; active write grants require trusted approval/host context (`packages/tool-contracts/src/marketplace.ts:98-109`). |
| Bundle model becomes an opaque mega-object. | Medium | Act now | Bundle selector validation prevents wide nullable shape (`packages/tool-contracts/src/marketplace.ts:347-398`). |
| HTML escape hatch becomes default app runtime. | Medium | Track/guard | JSON-render canonical invariant documented in `DECISIONS.md`; no sandbox runtime approved. |
| Endpoint names drift from docs. | Medium | Track | Route implementation must update doc 06 and tests. |
| UX remains too dev-speak heavy. | Medium | Act now in design | Doc 09 requires friendly labels plus receipts/inspector. |

## Open questions

1. What database/RLS table set should own marketplace packages, package versions, installations, installation events, approvals, and receipts?
2. Should package publish be internal-only for v0.2, or support external creator drafts?
3. Which package kinds are allowed to use `subscribed` update mode initially?
4. How much of app state is copied into an installation vs referenced from packageVersionId?
5. Where should app/workflow active state appear in `getPageContext()` or equivalent agent-readable context?
6. Should workflow builder use a flow-canvas in v0.2 or remain template/manifest-first?
7. What approval card UX should be standardized across booking, Amplify, and marketplace apps?

## Recommended next implementation slices

1. Review and merge contract/docs corpus.
2. Add agent-readable active workflow/app state contract.
3. Add marketplace persistence PRD/migration plan.
4. Implement read-only marketplace.searchPackages/getPackage/getPackageVersion/validateManifest endpoints.
5. Implement install preview with permissions/dependencies/update policy.
6. Implement install/copy/fork trusted-write endpoints.
7. Implement app state patch + preview/approval request endpoints.
8. Build design-approved install/app/approval UI.
9. Add Pipe-B marketplace smoke and release gate.

## Non-negotiable invariants

- Roadmap must remain outcome- and proof-driven, not a feature list.
- Every runtime implementation slice must include source-cited doc updates and tests.
- Risk register must be updated when implementation discoveries change the model.

## What developers must not do

- Do not proceed to live writes before resolving approval state and RLS model.
- Do not let marketplace UI ship without install-preview permission display.
- Do not make visual builder the first implementation slice.

## Prove it

```bash
rg -n "marketplace\.searchPackages|marketplace\.installPackage|workflow\.runApproved|app\.applyStatePatch" docs/product/agent-workspace-marketplace docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06
```

Passing proves endpoint names are represented in planning docs. It does not prove implementation.

## Sources

- `packages/tool-contracts/src/marketplace.ts`
- `packages/tool-contracts/src/marketplace-fixtures.ts`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md`
- `docs/product/agent-workspace-marketplace/DECISIONS.md`
