# 00-product-strategy-prd — Product strategy and PRD

Status: draft
Audience: product, design, engineering, leadership
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-06

## Purpose

This doc answers what Sonik Agent Workspace + Marketplace is, who it serves, why it matters now, and what must be true before implementation expands. It applies PRD, product-strategy, opportunity-solution, problem-framing, and AI-shaped-readiness skill guidance to the current repo evidence.

## Current state vs target state

| Aspect | Current | Target | Evidence |
| --- | --- | --- | --- |
| Product surface | Agent UI has chat, canvas, JSON-render artifacts, command catalogs, and workflow templates in draft/runtime code. | A coherent workspace product where chat collaborates, canvas hosts live objects, and contracts govern action. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md:7-21`; `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md:27-38` |
| Marketplace model | Contract-only package/bundle model exists in draft files and tests. | Marketplace packages can be searched, previewed, installed, updated, copied/forked, and later published through typed endpoints. | `docs/contracts/marketplace-package-contracts-v0.md:7-16`; `docs/contracts/marketplace-package-contracts-v0.md:74-90` |
| Agent action model | Command-backed artifacts and workflow templates encode preview/approval/write seams. | Users and agents can safely move from draft → preview → trusted approval → receipt. | `packages/tool-contracts/src/marketplace.ts:137-222`; `tests/unit/marketplace-package-contracts.test.mjs:44-82` |
| Runtime maturity | Endpoint map and marketplace persistence are planned, not production implementation. | Runtime endpoints and persistence are implemented only after contracts and docs stabilize. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:48-51` |

## Product narrative

The north star is a live artifact workspace where a user can ask an agent to create, compare, configure, and operationalize domain-specific mini apps backed by typed Sonik contracts. The current design brief frames the mental model as “chat is the collaborator; canvas is the live object; contracts are the source of truth; approval is the boundary between draft and mutation” (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md:7-14`).

The strategic opportunity is not just “a JSON renderer.” The workspace lets agents create deterministic, contract-backed artifacts that can be installed as apps, workflows, skills, agents, command tool packs, artifact templates, MCP add-ons, provider integrations, or bundles (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:21-34`).

## Target users and jobs

| User | Job | Product implication | Evidence |
| --- | --- | --- | --- |
| Operator / business user | Create a booking, campaign, or intelligence workflow without understanding internal commands. | First-class templates and guided forms must hide dev-speak but preserve approvals. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md:15-21`; `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/COMPONENT-INVENTORY.md:1-80` |
| Agent / assistant runtime | Discover available skills/tools/apps and act only within permitted contracts. | Machine-readable package, command, approval, and context state must exist. | `packages/tool-contracts/src/marketplace.ts:8-18`; `packages/tool-contracts/src/marketplace.ts:98-129` |
| Developer / marketplace author | Package useful solutions and ship updates safely. | PackageVersion/Installation semantics must be stable. | `docs/contracts/marketplace-package-contracts-v0.md:18-35`; `packages/tool-contracts/src/marketplace.ts:420-609` |
| Reviewer / enterprise admin | Understand what permissions and host context a package requests before install/run. | Install previews must expose dependencies, permission grants, and update policy. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:87-93` |

## Success metrics

| Metric | Why it matters | Current proof gap |
| --- | --- | --- |
| Time from prompt to valid draft artifact | Measures core workspace usefulness. | Needs live UX telemetry and task-level smoke tests. |
| Percent of mutating workflows with preview → approval → receipt | Measures trust-boundary compliance. | Contract tests exist; production telemetry endpoints remain planned. |
| Install/update success rate by package kind | Measures marketplace viability. | Endpoint implementation is planned, not current. |
| Agent-readable workflow-state completeness | Measures whether agents can continue workflows without scraping UI. | Prior audits noted gaps; this corpus requires machine-readable state as a future slice. |

## Out of scope for this PRD corpus

- Production marketplace ORPC implementation.
- Visual workflow builder implementation.
- New runtime/sandbox engine for arbitrary HTML/apps.
- Creator monetization, public marketplace moderation, or external publishing policy.

These are deferred because current endpoint docs explicitly label marketplace endpoints as planned typed contracts only (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:48-51`).

## Non-negotiable invariants

- Product copy may simplify, but technical contracts must expose immutable version/install semantics (`docs/contracts/marketplace-package-contracts-v0.md:18-27`).
- UX buttons and user text are never trusted approval grants (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md:31-35`).
- Workspace apps default to JSON-render for deterministic state and command binding (`docs/contracts/marketplace-package-contracts-v0.md:55-72`).

## Known blockers and deferred work

- Need production ORPC routes for marketplace search/install/update.
- Need persistence model for installations and copied/forked app definitions.
- Need agent-readable workflow state for intake/approval phases.
- Need design review for workspace app builder and marketplace install UX.

## What developers must not do

- Do not treat this PRD as permission to build writes without preview/approval/receipt.
- Do not expose “bundle” as the only package type.
- Do not store marketplace installs against mutable package ids only.
- Do not imply HTML apps are the canonical deterministic runtime.

## Prove it

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
node --experimental-strip-types tests/unit/marketplace-workflow-templates.test.mjs
```

Passing proves the current contract fixtures and tests still encode package/bundle/workflow invariants. It does not prove product-market fit or production endpoint readiness.

## Sources

- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md`
- `docs/contracts/marketplace-package-contracts-v0.md`
- `packages/tool-contracts/src/marketplace.ts`
- `tests/unit/marketplace-package-contracts.test.mjs`
