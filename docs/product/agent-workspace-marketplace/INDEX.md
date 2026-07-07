# Agent Workspace + Marketplace PRD corpus — index

Status: draft (decision layer RATIFIED — see below)
Audience: product, design, engineering, agents, reviewers
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files listed in Sources
Last updated: 2026-07-07

> **Ratification notice (2026-07-07):** direction decisions D008–D017 were ratified by Dan after a 5-lane competitive research pass and an internal recon supplement — see `DECISIONS.md` (now the single source of truth for direction), `docs/research/README.md` (full research corpus), and `docs/product/sonik-agent-ui-prd-2026-07-06.md` §8. Key ratified calls: resume amp.pkg v3 trust machinery (promotion ladder = trust tiers, Mockup #5 = install screen, command-registry = capability namespace); JSON-first descriptors-only (§4 posture); per-install kill-switch; kind-varying install semantics; freemium before take-rate; three-marketplace term disambiguation (agent marketplace ≠ commerce marketplace ≠ WhatsApp message templates).

## Purpose

Canonical product/architecture documentation set for Sonik Agent UI workspace, marketplace, command-backed app, and workflow-template work. This corpus mirrors the booking-service architecture-doc pattern: indexed docs, explicit invariants, source-cited architectural claims, and runnable prove-it blocks. The files here are the review surface before more runtime, persistence, UI-builder, or marketplace endpoint implementation.

## Corpus map

| # | Doc | Question it answers | Status | Verified against |
| --- | --- | --- | --- | --- |
| 00 | `00-product-strategy-prd.md` | What product are we building, for whom, and why now? | draft | c9011e4 + draft contracts |
| 01 | `01-opportunity-story-map-roadmap.md` | What journeys, MVP slices, and release phases matter first? | draft | c9011e4 + draft contracts |
| 02 | `02-system-map-and-boundaries.md` | What are the system components and non-runtime boundaries? | draft | c9011e4 + draft contracts |
| 03 | `03-marketplace-package-bundle-contracts.md` | What is the package/version/install/bundle contract? | draft | c9011e4 + draft contracts |
| 04 | `04-command-backed-apps-json-render.md` | How do JSON-render apps become stateful without a new runtime engine? | draft | c9011e4 + draft contracts |
| 05 | `05-workflows-agents-skills-tool-packs.md` | How do workflows, agents, skills, and command tool packs install and compose? | draft | c9011e4 + draft contracts |
| 06 | `06-orpc-endpoint-map-data-model.md` | What endpoint and persistence model should later implementation follow? | draft | c9011e4 + planned endpoints |
| 07 | `07-permissions-approval-trust-boundary.md` | Where is the boundary between form input, preview, approval, and write execution? | draft | c9011e4 + tests |
| 08 | `08-telemetry-proof-accessibility-readiness.md` | What proof, telemetry, accessibility, and enterprise UX gates are required? | draft | c9011e4 + existing tests/docs |
| 09 | `09-design-handoff-component-map.md` | What pages/components/states should design agents work from? | draft | c9011e4 + handoff docs |
| 10 | `10-roadmap-risks-open-questions.md` | What is next, what is risky, and what remains undecided? | draft | c9011e4 + PM skill framing |
| 11 | `11-operations-runbook.md` | How should agents verify, review, and keep this corpus fresh? | draft | c9011e4 + scripts |

Supporting files:

- `_TEMPLATE.md` — required structure for future docs in this corpus.
- `DECISIONS.md` — decision log and invariant source.
- `SUMMARY.md` — final creation summary, open questions, and recommended implementation slices.

## Reading paths by audience

- **Product / exec:** 00 → 01 → 10.
- **Design agent:** 00 → 04 → 07 → 09.
- **Engineer implementing marketplace:** 02 → 03 → 06 → 07 → 11.
- **Agent-tooling author:** 04 → 05 → 07 → 08.
- **Reviewer:** `DECISIONS.md` → 03 → 07 → 08 → 11.

## Non-negotiable invariants summary

1. Marketplace installs target immutable `packageVersionId`, not a mutable package id (`docs/contracts/marketplace-package-contracts-v0.md:20-25`; `packages/tool-contracts/src/marketplace.ts:420-570`).
2. Bundles compose package-version refs or embedded seed definitions; they are not wide nullable JSON blobs (`docs/contracts/marketplace-package-contracts-v0.md:37-52`; `packages/tool-contracts/src/marketplace.ts:347-398`).
3. JSON-render is the canonical deterministic app format; HTML is an escape hatch, not the default runtime model (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md:31-38`; `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md:39-55`).
4. Renderer actions may request state updates, command preview, approval request, navigation, or event emission, but they must not grant trusted approval or directly commit commands (`packages/tool-contracts/src/marketplace.ts:137-193`).
5. Write/destructive/external commands require preview, trusted approval, host context, and receipts (`packages/tool-contracts/src/marketplace.ts:98-129`; `packages/tool-contracts/src/marketplace.ts:207-222`; `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:87-93`).
6. User text, form submission, and artifact button clicks are not approval grants (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md:31-35`; `tests/unit/tool-contracts.test.mjs:241-285`).
7. This corpus is documentation-first; production ORPC routes, persistence, publishing, visual builders, and runtime execution remain explicitly out of scope until later implementation docs say otherwise (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:48-51`; `docs/contracts/marketplace-package-contracts-v0.md:74-90`).

## Prove it

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
node --experimental-strip-types tests/unit/marketplace-workflow-templates.test.mjs
node --experimental-strip-types tests/unit/tool-contracts.test.mjs
python3 scripts/check-markdown-trailing-whitespace.py docs/product/agent-workspace-marketplace
```

Passing proves the current contract/test surface still enforces the package, bundle, approval, and command-catalog invariants this corpus cites. It does not prove planned marketplace ORPC routes exist; those are documented as planned gaps.

## Sources

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
