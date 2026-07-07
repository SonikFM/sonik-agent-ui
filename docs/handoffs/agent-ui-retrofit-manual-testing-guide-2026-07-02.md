# Agent UI Retrofit — Manual Testing Guide & Completion Map

Date: 2026-07-02
Branch: `feat/analytics-hints-release-gate-20260702` (pushed to origin; contains the full stack)
Audience: a human tester and/or an agent driving manual verification.

## Is it ready for manual testing?

**Yes, locally, right now — with two environment notes:**

1. **Memory mode works out of the box.** Create `apps/standalone-sveltekit/.dev.vars` containing `SONIK_AGENT_UI_PERSISTENCE_MODE=memory`, then `pnpm --filter svelte-chat dev`. Everything below is testable except cross-restart persistence.
2. **Cloud mode needs a database.** The dev worker pins `SONIK_AGENT_UI_PERSISTENCE_MODE=cloud` (`wrangler.jsonc`), which fail-closes with a 500 unless a `DATABASE_URL` (PostgreSQL **15+**, e.g. Neon) is set and migrations 0003/0004 are applied (`pnpm db:migrate` or the gate with `AGENT_UI_GATE_APPLY_MIGRATIONS=1`). This is required to test persistence surviving a server restart and RLS scoping.

Not yet testable anywhere: deployed-commit parity and signed host-context checks (need a real deploy — that's the release gate's live mode).

### Migrations that MUST be run for cloud mode

Two new migrations shipped in this stack and have **not been applied to any live database yet**:

| Migration | What it creates |
|---|---|
| `packages/workspace-session/migrations/postgres/0003_agent_run_lifecycle.sql` | `agent_workspace_runs` + `agent_workspace_run_events` tables (run lifecycle, event log), RLS-scoped like the existing 0001/0002 tables |
| `packages/workspace-session/migrations/postgres/0004_run_context_selection.sql` | `context_selection` jsonb column on runs (composer chip persistence) |

How to apply (either way):

```bash
# Option A — migration runner directly
DATABASE_URL="postgres://…" pnpm db:migrate

# Option B — as part of the release gate
DATABASE_URL="postgres://…" AGENT_UI_GATE_APPLY_MIGRATIONS=1 pnpm gate:agent-ui
```

Requirements and behavior:
- **PostgreSQL 15+** — migration 0003 uses column-list `ON DELETE SET NULL` syntax that fails on PG ≤14 (Neon is fine).
- The runner applies 0001→0004 idempotently (already-applied migrations are skipped).
- Credentials are passed to psql via PG* env vars, never argv, and scrubbed from gate logs (the MAJOR 2 fix) — but still run against a staging DB first.
- Without these migrations, cloud mode returns 500s on `/api/generate` and `/api/session` (fail-closed by design; memory mode needs no migrations).

---

## What these commits achieve, in plain English

About 35 commits across five phases, all stacked on the PR #4 branch.

**1. Conversations survive failure (run lifecycle).** Every agent turn is now a "run" recorded in a database event log as it streams. If the stream dies, the tab is killed, or the user hits Stop, the turn is no longer lost: reloading the page rebuilds the partial answer from the log, marks the run as resumable, and offers a **Continue** button that picks up where the model left off (distinct from Retry, which starts over). Failures carry typed codes — a missing host context now shows targeted reconnect guidance instead of a dead chat.

**2. Context became visible and controllable (composer chips).** The chat composer now shows chips for what the agent can see — the current page and active document auto-attach, and a plus-menu lets the user attach documents, artifacts, booking contexts, command families, and runtime skills. Removing a chip is authoritative (it stays removed, even after reload). Each message permanently records what context it ran with, shown as provenance on past turns. Ported from Open Design's composer-context-sources feature, translated to Svelte.

**3. Artifacts render while the model is still typing (live streaming).** When the agent builds a dashboard/canvas artifact, components now mount progressively as the spec streams instead of appearing all at once at the end. Malformed partial specs can never crash the canvas; the final spec seamlessly replaces the preview with no flicker.

**4. The agent's instructions became modular (prompt composition).** The one giant system prompt was decomposed into named modules (booking rules, artifact rules, document rules, etc.) with per-turn skill composition — a skill chip adds its instructions for that turn only. Default behavior is provably unchanged (a test asserts every original rule still reaches the model). Each run records which modules and skills seeded it, so prompt drift is diagnosable.

**5. Usage became measurable and releases became gated (analytics + gate).** Every turn stamps analytics-only hints (where the turn started, turn number, whether an artifact already existed) onto run records and Pipe-B telemetry — answering "did this session reach an artifact, and on which turn?" And `pnpm gate:agent-ui` runs a composed release gate: build, tests, smokes, migration checks, deployed-commit parity, host-context secret presence — where every skipped check is reported with a reason, never silently passed.

**Quality history:** the stack went through a three-reviewer quality gate (slop audit, live verification, code review). The code review found two major bugs — duplicate assistant bubbles after failed runs, and database passwords leaking into gate evidence files — both fixed with regression tests, plus three minor fixes. Full reports in `docs/reviews/`.

### Scope and breadth

| Layer | What changed |
|---|---|
| `packages/tool-contracts` | Run contract, context-selection contract, analytics hints, resume prompt |
| `packages/workspace-session` | Run + run-event persistence (cloud SQL + in-memory), migrations 0003/0004 |
| `packages/chat-surface` | Context chips, plus-menu, provenance, Continue affordance, error panels |
| `apps/standalone-sveltekit` | Stream tee, reattach endpoint, streaming preview, prompt modules, hint stamping, context resolution |
| `scripts/` | Release gate (`gate:agent-ui`), reattach smoke, credential-safe psql helper |
| `docs/`, `manifests/` | Release-gate docs, copy-retrofit manifest, reviews, handoffs |

---

## Skills to reference while testing

- `$sonik-agent-ui` — page-control state, agent-readable observability, Playwright assertions (primary skill for this repo's testing patterns)
- `$ultratest` / `$ultraqa` — deterministic test gates and QA cycling
- `$amplify-auth` + `$amplify-org-context` — when testing signed host context and org-scoped persistence/RLS
- `$svelte-runes` / `$sveltekit-patterns` — when reading the composer/chip/preview code
- `$sonik-component-design` — if chip/panel UI needs adjustment after testing
- `$analyze-copy-retrofit` — if comparing behavior back against the Open Design donor

## Manual testing plan (scenario by scenario)

Setup: memory-mode dev server (above), open `http://localhost:5173`.

**A. Run lifecycle**
1. Send a prompt; while the answer streams, kill the network (or stop the dev server briefly / close the tab). Reload. **Expect:** the partial answer reappears with a failed/resumable state and a Continue button. Exactly ONE assistant bubble for that turn (this was MAJOR 1 — watch for duplicates).
2. Click **Continue**. **Expect:** the answer completes as a new run; history shows a coherent conversation.
3. Hit **Stop** mid-stream with the tab alive, then reload. **Expect:** still one bubble, no duplicate.
4. Break host context (embedded mode) or simulate a failure. **Expect:** an error panel specific to the cause (e.g. reconnect guidance for missing host context), not a silent dead chat.

**B. Context chips**
5. Open the composer plus-menu; attach a document chip. Send a question about it. **Expect:** the agent answers from THAT document's content (this was MINOR 6), and the sent message shows the chip as provenance.
6. Remove the auto-seeded page or document chip, send, reload. **Expect:** the chip stays removed after both the send and the reload (authoritative dismissal).
7. Re-add a previously dismissed chip. **Expect:** it works and persists.

**C. Streaming artifacts**
8. Ask for a dashboard (e.g. "create a crypto dashboard artifact"). **Expect:** components appear progressively while generation is still running, then the final artifact settles with no flicker/duplicate.
9. Interrupt an artifact generation mid-stream. **Expect:** canvas keeps the last good partial; no crash.

**D. Prompt composition + skills**
10. Attach a runtime-skill chip, send. **Expect:** behavior reflects the skill for that turn only; next turn without the chip is back to normal.
11. Booking flows (if booking runtime configured): run a booking intake conversation end-to-end. **Expect:** identical behavior to before the retrofit (zero-default-change guarantee).

**E. Analytics + gate**
12. Start turns from a launcher chip vs the composer vs Continue. **Expect:** Pipe-B/telemetry events show `entryFrom` distinguishing them, plus turnIndex/isFirstRun/hasExistingArtifact.
13. Run `pnpm gate:agent-ui` with no env. **Expect:** GATE: RED with build/unit PASS, local smokes needing persistence, and every live check SKIPPED **with a reason** — never a silent pass.

**F. Cloud persistence (needs DATABASE_URL, PG15+)**
14. Apply migrations, run in cloud mode, repeat scenarios 1–2 and 5–6, then **restart the server** and reload. **Expect:** runs, context selections, and reattach all survive the restart; data is org/user-scoped (RLS).

## Verification gates your agent should hold the line on

| Gate | Command | Must show |
|---|---|---|
| Unit + integration | `pnpm test` | exit 0, booking/Pipe-B suites run (not skipped) |
| Types | `pnpm check-types` | 0 errors, 0 warnings |
| Build | `pnpm build` | exit 0 |
| Reattach end-to-end | `pnpm smoke:agent-ui:run-reattach` (memory mode) | PASS + evidence JSON in `.omx/logs/` |
| Release gate | `pnpm gate:agent-ui` | non-zero exit on ANY failure; skips always carry reasons |
| Secrets | any gate/migration failure output | **no** `postgres://user:password@` anywhere, including `.omx/logs/*.json` |
| Prompt equivalence | `tests/unit/agent-prompt-composition.test.mjs` | every monolith rule fragment present by default |

## Areas to broadly investigate for completion

1. **Independent code re-review (recommended).** The final re-review of the G006 fixes was done by the orchestrating agent (non-author) because the independent reviewer hit the account session limit. Run `/code-review` on the branch for a fully independent second pass. Also note a REVIEW DOC caveat: the doc's "re-review addendum" was of unverified provenance and was not relied upon.
2. **Known residual edge (accepted, non-blocking):** the reattach dedup falls back to assistant/run counting when a run's `message_id` was never captured AND an earlier run produced zero assistant output — worth one adversarial manual poke (scenario A variants).
3. **Live-infra gate has never run green.** Migrations 0003/0004 unapplied to any real Postgres; deployed-commit parity, host-context secret, and run-persistence-against-target checks all unexercised. This is the biggest untested surface.
4. **Embedded/Amplify host path**: context chips auto-seed from host context, but no Amplify-side testing has occurred; the signed-host-context flow (`SONIK_AGENT_UI_HOST_CONTEXT_SECRET` parity across agent-ui / booking service / host) should be verified per the earlier feature-suite handoff.
5. **Deliberately deferred features** (don't mistake for gaps): booking prompt-module `seedWhen` narrowing; progressive preview for document tools; Open Design's plan-mode/Excalidraw flows.
6. **PR mechanics**: base is the PR #4 branch — merge order matters.

## Key references

- Spec: `docs/handoffs/agent-ui-open-design-architecture-gap-analysis-2026-07-01.md`
- Cut-off handoff: `docs/handoffs/agent-ui-retrofit-execution-handoff-2026-07-02.md`
- Reviews: `docs/reviews/retrofit-quality-gate-{slop-audit,verification,code-review}-2026-07-02.md`
- Gate usage: `docs/release-gate.md`
- Ledger: `.omc/ultragoal/plans/1782954321752-sonik-agent-ui-vs-open-design-architectu/` (local)
