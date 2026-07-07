# Agent UI release gate

`pnpm gate:agent-ui` runs a single deterministic gate that composes the existing
build/test/smoke checks with the deploy-time checks called for in the
feature-suite handoff (§"A. Production release gate"). It is the mandatory
signoff before merging/deploying an Agent UI change.

```bash
pnpm gate:agent-ui
```

The gate always runs every check and reports each as **PASS**, **FAIL**, or
**SKIPPED**. A check that needs infrastructure or env it was not given reports
**SKIPPED with a reason** — it is never silently passed. The process exits
non-zero if any check **FAILS**; skips do not fail the gate. A JSON evidence file
is written to `.omx/logs/agent-ui-release-gate-<timestamp>.json`.

Run it with no extra env ("no-live-infra mode") to exercise the local checks and
see every deploy-time check report SKIPPED with the env it needs.

### Local prerequisites

The `embed-smoke` and `run-reattach-smoke` checks spawn a local dev server and
exercise run persistence, so that server needs working workspace persistence.
The standalone worker defaults to `SONIK_AGENT_UI_PERSISTENCE_MODE=cloud`
(`apps/standalone-sveltekit/wrangler.jsonc`), which fails closed without a
database — the smokes then get HTTP 500s. For a DB-less local run, point the dev
server at in-memory persistence by adding `SONIK_AGENT_UI_PERSISTENCE_MODE=memory`
to `apps/standalone-sveltekit/.dev.vars` (or provide a real `DATABASE_URL`).
Use `AGENT_UI_GATE_SKIP=embed-smoke,run-reattach-smoke` to run the rest of the
gate when neither is available (each is then reported as an explicit SKIP).

## Checks

| Check | Category | Proves | Runs when |
|---|---|---|---|
| `build` | local | `pnpm build` succeeds across all packages | always |
| `unit` | local | `pnpm test` unit suite passes | always |
| `embed-smoke` | local | Embedded host-context flow works against a locally-spawned dev server (mock stream) | always |
| `run-reattach-smoke` | local | An interrupted run persists, reattaches from its event log, and Continue completes a new run (Phase 1) | always |
| `booking-pipeb-document` | live | Deployed booking app + Agent UI worker create/update a document with host context, proven via Pipe-B | `TEST_EMAIL` + `TEST_PASSWORD` set |
| `booking-pipeb-reservation` | live | Deployed reservation command flow works end-to-end via Pipe-B | `TEST_EMAIL` + `TEST_PASSWORD` set (or `AGENT_UI_BOOKING_RESERVATION_USE_FAKE_HOST=1`) |
| `migrations` | live | Postgres migrations (incl. 0003 run lifecycle / 0004 run context) are applied or up-to-date | `DATABASE_URL` set |
| `commit-parity-agent-ui` | deploy | Deployed Agent UI worker is the expected commit (no stale deploy) | `AGENT_UI_GATE_AGENT_UI_URL` + `AGENT_UI_GATE_AGENT_UI_SHA` set |
| `commit-parity-booking-app` | deploy | Deployed booking app is the expected commit | `AGENT_UI_GATE_BOOKING_APP_URL` + `AGENT_UI_GATE_BOOKING_APP_SHA` set |
| `commit-parity-booking-service` | deploy | Deployed booking service is the expected commit | `AGENT_UI_GATE_BOOKING_SERVICE_URL` + `AGENT_UI_GATE_BOOKING_SERVICE_SHA` set |
| `host-context-secret` | deploy | The shared host-context secret is present (never prints the value) | reports presence; SKIPPED when the secret is not exported |
| `run-persistence-target` | live | Run persistence + reattach works against a deployed environment | `AGENT_UI_GATE_TARGET_BASE_URL` set |

> **PostgreSQL 15+ required** for the `migrations` check: `packages/workspace-session/migrations/postgres/0003_agent_run_lifecycle.sql` uses column-list `ON DELETE SET NULL (session_id)` syntax, which fails to apply on PostgreSQL ≤14 (Neon runs 15+; verify the version before applying elsewhere).

## Environment variables

| Variable | Effect |
|---|---|
| `DATABASE_URL` | Postgres URL for the `migrations` check. |
| `AGENT_UI_GATE_APPLY_MIGRATIONS=1` | Apply pending migrations (`pnpm db:migrate`) instead of verify-only (`pnpm db:migrate:dry-run`). |
| `TEST_EMAIL` / `TEST_PASSWORD` | Credentials for the booking Pipe-B smokes. |
| `BOOKING_URL` | Deployed booking app origin for the Pipe-B smokes (defaults to the Pipe-B workers.dev host). |
| `AGENT_UI_BOOKING_RESERVATION_USE_FAKE_HOST=1` | Run the reservation smoke against the Agent UI's fake host without booking-app creds. |
| `AGENT_UI_GATE_AGENT_UI_URL` / `_SHA` | Version endpoint + expected commit sha for the Agent UI worker parity check. |
| `AGENT_UI_GATE_BOOKING_APP_URL` / `_SHA` | Version endpoint + expected sha for the booking app parity check. |
| `AGENT_UI_GATE_BOOKING_SERVICE_URL` / `_SHA` | Version endpoint + expected sha for the booking service parity check. |
| `SONIK_AGENT_UI_HOST_CONTEXT_SECRET` | The shared secret; the gate reports only presence + length, never the value. |
| `AGENT_UI_GATE_TARGET_BASE_URL` | Base URL of a deployed environment to assert run persistence + reattach against (does not spawn a local server). |
| `AGENT_UI_GATE_SKIP` | Comma-separated check names to skip explicitly; each is reported as SKIPPED (for operability, not a silent pass). |
| `AGENT_UI_GATE_RUN_ID` | Overrides the evidence file name. |

### Deployed-commit parity

Each parity check fetches the given URL and looks for a commit sha in a response
header (`x-commit-sha` / `x-git-sha` / `x-version` / …) or a JSON body field
(`commit` / `sha` / `gitSha` / `version` / …), then compares it to the expected
sha (prefix match, so short shas work). A mismatch is a FAIL; a missing sha at
the URL is a FAIL; missing env is a SKIP.

## Example: full deploy signoff

```bash
DATABASE_URL='postgres://…' \
AGENT_UI_GATE_APPLY_MIGRATIONS=1 \
TEST_EMAIL='…' TEST_PASSWORD='…' \
AGENT_UI_GATE_AGENT_UI_URL='https://sonik-agent-ui.example.workers.dev/api/version' \
AGENT_UI_GATE_AGENT_UI_SHA="$(git rev-parse HEAD)" \
SONIK_AGENT_UI_HOST_CONTEXT_SECRET='…' \
AGENT_UI_GATE_TARGET_BASE_URL='https://sonik-agent-ui.example.workers.dev' \
pnpm gate:agent-ui
```
