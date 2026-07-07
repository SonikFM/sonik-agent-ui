# Open Design Retrofit — Execution Handoff (if session cut off)

Date: 2026-07-02
Branch with ALL work: `feat/analytics-hints-release-gate-20260702` (pushed to origin)
Stacked branch chain (each pushed): `feat/run-lifecycle-hardening-20260701` → `feat/composer-context-sources-20260702` → `feat/live-tool-input-streaming-20260702` → `feat/skill-prompt-composition-20260702` → `feat/analytics-hints-release-gate-20260702`
Base: `codex/booking-command-copy-retrofit-20260629150347` (PR #4, untouched)

## Where execution stands

Durable ledger: `.omc/ultragoal/plans/1782954321752-sonik-agent-ui-vs-open-design-architectu/` (goals.json + ledger.jsonl, local only — not pushed).

| Story | State |
|---|---|
| G001 Run lifecycle hardening | ✅ complete, checkpointed |
| G002 Composer context sources | ✅ complete, checkpointed |
| G003 Live tool-input streaming | ✅ complete, checkpointed |
| G004 Skill prompt composition | ✅ complete, checkpointed |
| G005 Analytics hints + release gate | 🔶 review_blocked (implementation done; awaiting G006 + final gate) |
| G006 Resolve code-review blockers | 🔶 in progress — ALL 6 FIX COMMITS LANDED (`0c9c32e`, `b347b3d`, `faaa652`, `ac23015`, `f840d1e` + slop cleanup `1e31e51`); fix executor's final verification report was pending when this handoff was written |

Quality-gate reports (all committed under `docs/reviews/`):
- `retrofit-quality-gate-slop-audit-2026-07-02.md` — no blockers; findings 1/2/4 applied in `1e31e51`, finding 3 rejected (keep `seedWhen` seam)
- `retrofit-quality-gate-verification-2026-07-02.md` — green; fresh reattach smoke PASS (`.omx/logs/run-reattach-smoke-2026-07-02T04-00-33-686Z.json`)
- `retrofit-quality-gate-code-review-2026-07-02.md` — REQUEST CHANGES (2 majors, 4 minors) → all being fixed in G006; security boundaries verified clean

## Exact remaining steps (in order)

1. **Confirm G006 verification** — run: `pnpm test` (exit 0), `pnpm build` (exit 0), `pnpm check-types` (clean). Then the reattach smoke in memory mode: create `apps/standalone-sveltekit/.dev.vars` with `SONIK_AGENT_UI_PERSISTENCE_MODE=memory`, run `pnpm smoke:agent-ui:run-reattach`, expect PASS, **delete `.dev.vars` after**.
2. **Focused re-review of the fix diff** — review `1e31e51..HEAD` against the code-review doc's two majors: (a) no double assistant bubble after failed/canceled run with tab alive AND tab-killed reattach still works; (b) no credentialed connection string in psql argv, stderr, or `.omx/logs/*.json` gate evidence. Verdict must be APPROVE.
3. **Checkpoint G006**: `omc ultragoal checkpoint --plan-id 1782954321752-sonik-agent-ui-vs-open-design-architectu --goal-id G006-resolve-final-code-review-blockers --status complete --evidence "<fix commits + verification>" --claude-goal-json '<snapshot with the aggregate objective from goals.json, status active>'`
4. **Checkpoint G005 (final)**: same command with `--goal-id G005-analytics-hints-and-release-gate` plus `--quality-gate-json` containing `aiSlopCleaner`, `verification`, `codeReview` fields referencing the three docs/reviews files (all clean after step 2). This completes the plan; the session `/goal` auto-clears.
5. **Open PR(s)** — decision for Dan: one PR from `feat/analytics-hints-release-gate-20260702` (≈33 commits) or per-phase PRs from the stacked branches. Note base is the PR #4 branch: merge PR #4 first or stack onto it.
6. **Run the release gate against real infra**: `pnpm gate:agent-ui` with `DATABASE_URL` (PostgreSQL 15+ required — migration 0003 syntax), `AGENT_UI_GATE_APPLY_MIGRATIONS=1` to apply 0003/0004, booking Pipe-B creds, deploy-parity env vars (see `docs/release-gate.md`). This closes the verification report's Gap A.
7. **Deploy + re-run gate** for deployed-commit parity + host-context checks.

## Queued follow-ups (out of plan scope, deliberate)

- Narrow booking prompt module `seedWhen` (seam built; one-line intentional behavior change)
- Progressive preview for document tools (excluded: editor cursor churn)
- Amplify host embedding of context chips / entry points

## Spec + architecture references

- Plan/spec: `docs/handoffs/agent-ui-open-design-architecture-gap-analysis-2026-07-01.md`
- Copy-retrofit manifest: `manifests/copy-retrofit/open-design-run-context.json`
- Prior handoff (feature suite ranking): `docs/handoffs/agent-ui-open-design-feature-suite-upgrade-2026-07-01.md`
