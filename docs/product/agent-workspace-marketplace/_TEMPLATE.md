# NN-doc-name — Title

Status: draft | reviewed
Audience: <who this teaches and what they can do after reading>
Verified against: <git commit short SHA or explicit unindexed state>
Last updated: <YYYY-MM-DD>

## Purpose

One paragraph: the question this doc answers and why it matters before implementation or production hardening.

## Current state vs target state

| Aspect | Current | Target | Evidence |
| --- | --- | --- | --- |

Every current-state claim must cite a source file. Every target-state claim must cite a PRD/decision/source artifact or be marked as a proposed target.

## Product / architecture narrative

Use concise prose and tables. Architectural claims require source references, e.g. `packages/tool-contracts/src/marketplace.ts:420-570`.

## Non-negotiable invariants

The subset of corpus invariants this doc owns. Include source files or decision records for each invariant.

## Known blockers and deferred work

What is not proven yet, what is deliberately deferred, and where that is tracked.

## What developers must not do

Concrete anti-patterns, each with the failure it causes.

## Prove it

Runnable commands that validate this doc's claims:

```bash
# example
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
```

Each command states what passing proves. If a claim has no command, say so explicitly and name the coverage gap.

## Sources

Bulleted list of every cited source file so staleness can be checked mechanically.
