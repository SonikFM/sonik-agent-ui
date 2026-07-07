# 11-operations-runbook — Verification and maintenance runbook

Status: draft
Audience: agents, reviewers, release owners
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-06

## Purpose

This doc explains how to keep the PRD corpus current, verify cited contracts, and prevent future agents from working from memory.

## Current state vs target state

| Aspect | Current | Target | Evidence |
| --- | --- | --- | --- |
| Source citations | Corpus cites source paths and lines. | PRs update docs with code changes. | `docs/product/agent-workspace-marketplace/INDEX.md`; `_TEMPLATE.md` |
| Verification | Package/test scripts exist for contracts. | Release gate includes focused marketplace proofs. | `package.json` scripts; `tests/unit/marketplace-package-contracts.test.mjs` |
| GitNexus | Repo is indexed in current run. | Re-run `npx gitnexus analyze` before deeper impact queries after large code movement. | `npx gitnexus status` output: up-to-date at commit c9011e4 on 2026-07-06. |

## Standard verification sequence

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
node --experimental-strip-types tests/unit/marketplace-workflow-templates.test.mjs
node --experimental-strip-types tests/unit/tool-contracts.test.mjs
python3 scripts/check-markdown-trailing-whitespace.py docs/product/agent-workspace-marketplace
```

For broader release confidence:

```bash
pnpm test
pnpm check-types
pnpm build
```

## Doc update rule

Any PR that changes these surfaces must update this corpus or explicitly state why it remains valid:

- `packages/tool-contracts/src/marketplace.ts`
- `packages/tool-contracts/src/marketplace-fixtures.ts`
- `tests/unit/marketplace-package-contracts.test.mjs`
- `tests/unit/marketplace-workflow-templates.test.mjs`
- `tests/unit/tool-contracts.test.mjs`
- `docs/contracts/marketplace-package-contracts-v0.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/*`

## Agent handoff instructions

1. Read `INDEX.md` and `DECISIONS.md` before implementation.
2. Read the doc matching your slice.
3. Verify cited source lines still exist.
4. Make code changes.
5. Run the doc's “Prove it” block.
6. Update docs if implementation diverged.
7. Run final review/verification gates.

## Non-negotiable invariants

- Documentation is a contract, not a chat summary.
- Stale docs are blockers for implementation PRs touching the same contract area.
- Unknown implementation status must be called out as a gap, not implied as done.

## Known blockers and deferred work

- Re-run GitNexus indexing after major refactors so code graph impact analysis stays current.
- Need a dedicated docs-canon skill if this corpus becomes long-lived like booking payments.
- Need CI wiring for doc prove-it commands.

## What developers must not do

- Do not rely on agent memory instead of this corpus.
- Do not update source contracts without updating the docs that cite them.
- Do not claim endpoint implementation from endpoint planning docs.

## Prove it

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
node --experimental-strip-types tests/unit/marketplace-workflow-templates.test.mjs
node --experimental-strip-types tests/unit/tool-contracts.test.mjs
python3 scripts/check-markdown-trailing-whitespace.py docs/product/agent-workspace-marketplace
```

Passing proves current docs and contract tests are syntactically/checkpoint clean.

## Sources

- `package.json`
- `tests/unit/marketplace-package-contracts.test.mjs`
- `tests/unit/marketplace-workflow-templates.test.mjs`
- `tests/unit/tool-contracts.test.mjs`
- `packages/tool-contracts/src/marketplace.ts`
- `docs/product/agent-workspace-marketplace/INDEX.md`
