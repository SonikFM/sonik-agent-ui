# Agent Workspace + Marketplace PRD corpus — summary

Date: 2026-07-06 (ratification notice added 2026-07-07)
Status: draft corpus; direction decisions D008–D017 RATIFIED — see `DECISIONS.md` and `docs/research/README.md`

## Files created

- `INDEX.md` — corpus map, reading paths, invariants, prove-it block.
- `_TEMPLATE.md` — required structure for future corpus docs.
- `DECISIONS.md` — decision log for package envelope, version installs, bundles, JSON-render, approval boundaries, planned endpoints.
- `00-product-strategy-prd.md` — product strategy and PRD framing.
- `01-opportunity-story-map-roadmap.md` — opportunity tree, user story backbone, release slices.
- `02-system-map-and-boundaries.md` — system map and boundary ownership.
- `03-marketplace-package-bundle-contracts.md` — package/version/install/bundle semantics.
- `04-command-backed-apps-json-render.md` — JSON-render command-backed app model.
- `05-workflows-agents-skills-tool-packs.md` — installable workflow/agent/skill/tool-pack composition.
- `06-orpc-endpoint-map-data-model.md` — planned endpoint and data model map.
- `07-permissions-approval-trust-boundary.md` — draft/input/preview/approval/write boundary.
- `08-telemetry-proof-accessibility-readiness.md` — proof, telemetry, accessibility, enterprise readiness.
- `09-design-handoff-component-map.md` — design surfaces and component map.
- `10-roadmap-risks-open-questions.md` — roadmap, risk register, open questions.
- `11-operations-runbook.md` — maintenance, verification, agent handoff.

## Source evidence used

- `packages/tool-contracts/src/marketplace.ts`
- `packages/tool-contracts/src/marketplace-fixtures.ts`
- `tests/unit/marketplace-package-contracts.test.mjs`
- `tests/unit/marketplace-workflow-templates.test.mjs`
- `tests/unit/tool-contracts.test.mjs`
- `docs/contracts/marketplace-package-contracts-v0.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/COMPONENT-INVENTORY.md`
- `package.json`

## Open questions

1. What exact database/RLS schema should own marketplace packages, versions, installations, approvals, and receipts?
2. Which package kinds may use `subscribed` updates in v0?
3. Should package publishing remain internal-only until runtime/install/update trust is hardened?
4. Where should agent-readable active app/workflow state be exposed?
5. How should command-backed component registry evolve from generic JSON-render?
6. What design language should replace dev-speak for install, permissions, approval, and receipts?

## Recommended next implementation slices

1. Review and merge the docs corpus.
2. Add agent-readable active app/workflow/approval state contract.
3. Create marketplace persistence/RLS PRD and migrations plan.
4. Implement read-only marketplace ORPC routes: search/get/version/validate/install-preview.
5. Implement install/copy/fork/pin/update trusted-write endpoints.
6. Implement app state patch and workflow approval endpoints.
7. Add Pipe-B smoke tests for package install, app preview, approval request, and receipt.
8. Create design prototype for install preview, app builder, approval card, and receipt inspector.

## Verification status

Focused verification commands are listed in `11-operations-runbook.md`. This corpus documents current contract and planned endpoint state; it does not claim production marketplace runtime implementation exists.
