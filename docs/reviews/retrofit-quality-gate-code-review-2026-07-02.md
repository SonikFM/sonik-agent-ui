# Quality Gate — Code Review (Open Design Retrofit Stack)

Date: 2026-07-02
Reviewer: independent code-reviewer agent (read-only)
Scope: `git diff codex/booking-command-copy-retrofit-20260629150347..feat/analytics-hints-release-gate-20260702` (full G001–G005 stack)
Gate field: `codeReview`

## Verdict

**REQUEST CHANGES — 2 major defects block a clean merge.** Architecture sound; security boundaries hold (no trust-escalation or prompt-injection path found). Majors + paired minor are being fixed as a ledger blocker story before G005 can checkpoint.

---

## MAJOR 1 — Reattach doubles the last assistant turn after a failed/canceled run

Files: `apps/standalone-sveltekit/src/routes/api/session/[id]/+server.ts:41-49`; `apps/standalone-sveltekit/src/routes/+page.svelte:1446-1452`, `1750-1757`, `1832-1867`

The server reattaches the latest run's rebuilt message for any non-succeeded run under id `run:${runId}`, assuming such runs were never persisted client-side. False when the tab stayed alive: the client persist effect fires on any transition to not-streaming with no error/cancel guard, persisting the partial assistant message under its AI-SDK id (`msg-…`). On reload the dedup guard compares across two id namespaces and can never match.

**Failure scenario:** send prompt → stream fails mid-turn (or user hits Stop) → partial persisted under `msg-…` → reload → reattach adds `run:<id>` message → **two assistant bubbles for one turn.** Reproducible for `failed` and `canceled`.

Root cause reinforced by the recorder never back-filling `message_id` (`startRunRecorder` called with `messageId: null`), so no shared id exists to dedup on.

**Fix direction:** share one id namespace or skip reattach when a persisted assistant message already exists for that run.
**Disposition: BLOCKER — fixing before G005 checkpoint.**

## MAJOR 2 — DATABASE_URL (with password) leaks to logs and persisted gate evidence

Files: `scripts/run-postgres-migrations.mjs:71`; `scripts/agent-ui-release-gate.mjs:45-55`, `223-226`

`psql()` passes the full credentialed `postgres://user:password@…` string as argv to `execFileSync` with no try/catch at any call site. Any non-zero psql exit throws an uncaught error whose message contains the argv, printed to stderr — which the release gate captures into its `tail` buffer and **writes to the on-disk evidence JSON** (`.omx/logs/<runId>.json`). A transient log leak becomes a persisted secret, reachable on any ordinary migration failure.

**Fix direction:** pass the connection string via env (`PGPASSWORD`/`PGDATABASE` etc.) and/or scrub connection strings before logging. Confined to tooling, not the request path.
**Disposition: BLOCKER — fixing before G005 checkpoint.**

---

## Minors

| # | Finding | Disposition |
|---|---|---|
| 3 | Run finalizes `succeeded` when the turn emitted an error *part* (AI SDK `error` chunk) rather than a stream rejection — such runs neither reattach nor offer Continue (`run-event-log.ts:382`) | **Fix with MAJOR 1** (same subsystem) |
| 4 | Root-element prop resolution during streaming preview runs outside an error boundary; a partially-streamed directive-shaped root prop passes the structural guard and `resolvePropValue` can throw into the canvas (`streaming-artifact.ts:91-98`) | **Fix in blocker story** (cheap guard) |
| 5 | `on delete set null (session_id)` column-list syntax in `0003_agent_run_lifecycle.sql:57` requires PostgreSQL 15+; fails to apply on ≤14 | **Document deploy-target prerequisite** in `docs/release-gate.md` (Neon runs PG15+; verify before applying elsewhere) |
| 6 | Attaching a non-active `document` chip sets `activeDocumentId` but injected content still comes from the request's active document — selected doc's content not fed to the agent | **Fix in blocker story** (completes Phase 2's intent) |

---

## Checked and clean

- **Context-selection trust boundary — no escalation.** Explicit selection only layers into `pageContext` (already client-supplied/untrusted). The real authz gate — `approvedCommandIds` from the trusted host header and `hostSession` — is never influenced by the selection; chips can alter the advertised index, never what the agent may execute.
- **Dismissal is authoritative and cannot resurrect**; dismissal-only selection still counts as explicit so removed context is not silently re-injected.
- **Prompt composition is a faithful verbatim move** (deleted monolith diffed against core+5 modules — every rule present; reordering non-semantic); zero default behavior change; recorded moduleIds/skillIds provably equal what seeds the agent; **no prompt-injection path** (skillIds are lookup keys into a fixed server registry; unknown ids no-op; caps at route 8/160 and resolver 6/2k/8k).
- **Analytics hints analytics-only**: four named fields through validators, no arbitrary-key iteration, no prototype pollution; never reach createAgent/prompt/tools/authorization.
- **Run-store SQL/RLS consistent with 0001/0002**: per-txn request context, force-RLS org/user scoping, seq monotonicity safe (serialized tail chain + unique backstop), status/ended_at invariant holds on insert and finalize.
- **Recorder failure cannot break the user-facing stream** (record/finalize fully best-effort/pass-through).
- **Partial→final streaming handoff clean** (shared stable id, no double-render).

## Gate outcome for `codeReview`

Not clean at first pass → blocker story recorded in the ledger (per ultragoal non-clean-review protocol). G005 checkpoint is deferred until the blocker story completes: majors 1–2 and minors 3, 4, 6 fixed and re-verified, minor 5 documented, and the fixes re-reviewed.
