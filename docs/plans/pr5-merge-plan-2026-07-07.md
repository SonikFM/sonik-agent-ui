# PR #5 Merge Plan

Status: AWAITING DAN'S GREENLIGHT · 2026-07-07 · No merge happens until he says go.

## The stack (verified via gh)

```text
main
 └── PR #4: codex/booking-command-copy-retrofit-20260629150347 → main   (28 commits; main has 0 commits the branch lacks — clean)
      └── PR #5: feat/analytics-hints-release-gate-20260702 → codex/…  (≥100 commits, ≥100 files, state MERGEABLE)
```

PR #5 carries everything from 2026-06-29 → 07-07: the Open Design retrofit, Pipe-B evidence gates, enterprise UX foundation, demo-UX batch, agent-eval harness, F1/toolPolicy/rail fixes, PRD, research corpus, and ratified decisions. Deployed worker `d11201a7` is built from its HEAD.

## Recommended sequence

1. **Merge PR #5 into the codex base branch** (child first — keeps PR #4's diff review-true).
2. **Merge PR #4 into main** immediately after (the codex branch is strictly ahead of main, so this is conflict-free by construction today; don't let it sit and drift).
3. Alternative if a single review is preferred: merge #4 first, retarget #5 to main (gh auto-retargets when a base branch merges+deletes). Same end state; sequence 1→2 is fewer moving parts.

## Merge method: MERGE COMMIT, not squash

The branch's commit history is load-bearing — we used `git log -S` archaeology repeatedly this week (the F1 root cause, the `__sonikAgentHost` non-regression proof, the smoke-string drift all hinged on per-commit history). Squashing ~100 commits into one destroys that. Merge commits on both PRs preserve it.

## Pre-merge gates (all currently green at HEAD `9d76cf8`)

- [x] `pnpm check-types` 0 errors · full `pnpm test` exit 0 · `pnpm build` ✔ (last run post-`03ad662`)
- [x] Deterministic eval gate 2/2 PASS against deployed `d11201a7`
- [ ] Re-run the three commands once more at merge time (cheap insurance against drift between now and greenlight)
- [ ] **Marketplace lane's uncommitted work**: `agent.ts`, `suggestions.ts`, `package.json`, `tool-contracts/package.json` + untracked marketplace files are NOT in the PR (uncommitted) — no merge blocker, but that lane must either commit to this branch BEFORE merge (their work rides along) or accept rebasing onto main after. **Needs their/Dan's call — the one open decision in this plan.**
- [ ] The stray `.gitignore` GitNexus line: commit it (one line) or drop it before merge so the tree is clean.

## Post-merge steps

1. Deploy `sonik-agent-ui` from main (same artifact expectation as `d11201a7`; keeps deploy lineage on main going forward). Booking-service untouched, per standing rule.
2. Run the eval gate + one reservation smoke against the post-merge deploy.
3. Other lanes rebase onto main; delete merged branches; `npx gitnexus analyze` to reindex.
4. Future work branches cut from main (ends the long-lived shared-branch/treaty era that required file-ownership handoffs).

## Risks / notes

- PR #4's 28 commits get reviewed implicitly by merging — if Dan wants a real review of that older slice, do it before step 2.
- The research/docs corpus (~20 files) rides into main with the code; if docs-vs-code separation matters for review, it's possible to split, but not recommended (the decisions cite the code they govern).
- sonik-skills repo is independent (its own branch `feat/parity-gate-0.9.0`) — unaffected by this merge.
