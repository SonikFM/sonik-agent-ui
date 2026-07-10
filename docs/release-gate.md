# Agent UI release gate

`pnpm gate:agent-ui` runs a single deterministic gate that composes the existing
build/test/smoke checks with the deploy-time checks called for in the
feature-suite handoff (§"A. Production release gate"). It is the mandatory
signoff before merging/deploying an Agent UI change.

```bash
pnpm gate:agent-ui
```

The gate always runs every check and reports each as **PASS**, **FAIL**, or
**SKIPPED**. Required production checks fail closed when their real-host
credentials or parity metadata are missing. The process exits non-zero if any
check **FAILS**; explicit skips do not fail the gate. A JSON evidence file is
written to `.omx/logs/agent-ui-release-gate-<timestamp>.json`.

For local-only development runs, use the explicit waiver path:

```bash
AGENT_UI_GATE_SKIP=booking-pipeb-context,booking-pipeb-document,booking-pipeb-reservation,commit-parity-agent-ui,commit-parity-booking-app,commit-parity-booking-service \
  pnpm gate:agent-ui
```

Do not add ad-hoc bypass flags; `AGENT_UI_GATE_SKIP` is the audited waiver list.

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
| `booking-pipeb-context` | live | Deployed booking app + Agent UI worker load the booking context via Pipe-B | `TEST_EMAIL` + `TEST_PASSWORD` required; missing creds FAIL unless explicitly skipped |
| `booking-pipeb-document` | live | Deployed booking app + Agent UI worker create/update a document with host context, proven via Pipe-B | `TEST_EMAIL` + `TEST_PASSWORD` required; missing creds FAIL unless explicitly skipped |
| `booking-pipeb-reservation` | live | Deployed reservation command flow works end-to-end via Pipe-B | `TEST_EMAIL` + `TEST_PASSWORD` required; missing creds FAIL unless explicitly skipped |
| `migrations` | live | Postgres migrations (incl. 0003 run lifecycle / 0004 run context) are applied or up-to-date | `DATABASE_URL` set |
| `commit-parity-agent-ui` | deploy | Deployed Agent UI worker is the expected commit (no stale deploy) | `AGENT_UI_GATE_AGENT_UI_URL` + `AGENT_UI_GATE_AGENT_UI_SHA` required; missing values FAIL unless explicitly skipped |
| `commit-parity-booking-app` | deploy | Deployed booking app is the expected commit | `AGENT_UI_GATE_BOOKING_APP_URL` + `AGENT_UI_GATE_BOOKING_APP_SHA` required; missing values FAIL unless explicitly skipped |
| `commit-parity-booking-service` | deploy | Deployed booking service is the expected commit | `AGENT_UI_GATE_BOOKING_SERVICE_URL` + `AGENT_UI_GATE_BOOKING_SERVICE_SHA` required; missing values FAIL unless explicitly skipped |
| `host-context-secret` | deploy | The shared host-context secret is present (never prints the value) | reports presence; SKIPPED when the secret is not exported |
| `run-persistence-target` | live | Run persistence + reattach works against a deployed environment | `AGENT_UI_GATE_TARGET_BASE_URL` set |

> **PostgreSQL 15+ required** for the `migrations` check: `packages/workspace-session/migrations/postgres/0003_agent_run_lifecycle.sql` uses column-list `ON DELETE SET NULL (session_id)` syntax, which fails to apply on PostgreSQL ≤14 (Neon runs 15+; verify the version before applying elsewhere).

## Environment variables

| Variable | Effect |
|---|---|
| `DATABASE_URL` | Postgres URL for the `migrations` check. |
| `AGENT_UI_GATE_APPLY_MIGRATIONS=1` | Apply pending migrations (`pnpm db:migrate`) instead of verify-only (`pnpm db:migrate:dry-run`). |
| `TEST_EMAIL` / `TEST_PASSWORD` | Required credentials for the real deployed booking-host Pipe-B smokes (`context`, `document`, `reservation`). Missing values are FAIL by default. |
| `BOOKING_URL` | Deployed booking app origin for the Pipe-B smokes (defaults to the Pipe-B workers.dev host). |
| `AGENT_UI_BOOKING_RESERVATION_USE_FAKE_HOST=1` | Manual reservation smoke mode only. It can be used with `pnpm smoke:agent-ui:booking-pipeb:reservation`, but it does **not** satisfy the production release gate. |
| `AGENT_UI_GATE_AGENT_UI_URL` / `_SHA` | Version endpoint + expected commit sha for the Agent UI worker parity check. |
| `AGENT_UI_GATE_BOOKING_APP_URL` / `_SHA` | Version endpoint + expected sha for the booking app parity check. |
| `AGENT_UI_GATE_BOOKING_SERVICE_URL` / `_SHA` | Version endpoint + expected sha for the booking service parity check. |
| `SONIK_AGENT_UI_HOST_CONTEXT_SECRET` | The shared secret; the gate reports only presence + length, never the value. |
| `AGENT_UI_GATE_TARGET_BASE_URL` | Base URL of a deployed environment to assert run persistence + reattach against (does not spawn a local server). |
| `AGENT_UI_GATE_SKIP` | Comma-separated check names to skip explicitly; each is reported as SKIPPED (for operability, not a silent pass). |
| `AGENT_UI_GATE_RUN_ID` | Overrides the evidence file name. |

### Deployed-commit parity

Deploy the Agent UI worker with the git SHA as the Cloudflare version tag:

```bash
pnpm --filter svelte-chat deploy:cloudflare -- --tag "$(git rev-parse HEAD)"
# equivalent from the app directory:
# wrangler deploy --tag "$(git rev-parse HEAD)"
```

Cloudflare exposes the Worker version metadata through the configured
`CF_VERSION_METADATA` binding. The Agent UI `/api/version` endpoint returns only
`{ version, id, tag, timestamp }`, where `version` is `tag ?? id ?? null`, and
sets `Cache-Control: no-store`. Point `AGENT_UI_GATE_AGENT_UI_URL` at that
endpoint and set `AGENT_UI_GATE_AGENT_UI_SHA` to the same `git rev-parse HEAD`
value used for `--tag`.

Each parity check fetches the given URL and looks for a commit sha in a response
header (`x-commit-sha` / `x-git-sha` / `x-version` / …) or a JSON body field
(`commit` / `sha` / `gitSha` / `version` / …), then compares it to the expected
sha (prefix match, so short shas work). A mismatch is a FAIL; a missing sha at
the URL is a FAIL; missing URL/SHA env is a FAIL unless the check is explicitly
waived through `AGENT_UI_GATE_SKIP`.

## Example: full deploy signoff

```bash
DATABASE_URL='postgres://…' \
AGENT_UI_GATE_APPLY_MIGRATIONS=1 \
TEST_EMAIL='…' TEST_PASSWORD='…' \
AGENT_UI_GATE_AGENT_UI_URL='https://sonik-agent-ui.example.workers.dev/api/version' \
AGENT_UI_GATE_AGENT_UI_SHA="$(git rev-parse HEAD)" \
AGENT_UI_GATE_BOOKING_APP_URL='https://booking.example.workers.dev/api/version' \
AGENT_UI_GATE_BOOKING_APP_SHA='…' \
AGENT_UI_GATE_BOOKING_SERVICE_URL='https://booking-service.example.workers.dev/api/version' \
AGENT_UI_GATE_BOOKING_SERVICE_SHA='…' \
SONIK_AGENT_UI_HOST_CONTEXT_SECRET='…' \
AGENT_UI_GATE_TARGET_BASE_URL='https://sonik-agent-ui.example.workers.dev' \
pnpm gate:agent-ui
```
