# Activepieces local bring-up runbook

Repo studied: `/Users/danielletterio/Documents/GitHub/activepieces` (working tree, clean, HEAD `63150713e7d9` 2026-07-12, `docker-compose.yml` pins image `ghcr.io/activepieces/activepieces:0.86.2`).
Purpose: single-user local UX-capture session (builder walkthrough, DRAFT→publish flow, Todos/HITL surface check). Not a production or multi-user deployment.

All claims below cite a file:line in that repo. Anything without a citation is marked **[speculative]**.

## 0. Environment facts checked before writing this (avoid surprises)

- Docker Desktop is installed (`docker --version` → 28.4.0, `docker compose` v2.39.4-desktop.1) but **the daemon was not running** when checked.
- Host is Apple Silicon (`arm64`).
- Host Node is `v26.4.0` (`node -v`) — this is **too new** for the source-based dev path (see failure mode 1). Homebrew already has `node@22` installed (`22.21.1`, via `brew list --versions node@22`) which is compatible; no download needed, just link/use it.
- `bun` is already installed globally at `/Users/danielletterio/.bun/bin/bun`, version `1.3.0`.
- `nvm` is **not** on PATH in this shell — don't assume it's available; use Homebrew's `node@22` instead (see step 1).
- `git status --short` in the repo is clean — no local diffs to worry about contaminating the walkthrough.

## 1. Two viable paths — pick one

Activepieces ships two completely different ways to stand it up locally, and they are not the same weight. Read both before picking.

### Path A — source dev mode (recommended for a UX-capture session)

This is the fast, lazy path. `npm start` → `tools/setup-dev.js` (Node/bun version check, `bun install`, pre-builds only the dev pieces listed in `AP_DEV_PIECES`) → `npm run dev` → `turbo run serve --filter=web --filter=api --filter=@activepieces/engine --filter=worker` (`package.json:19,22`, `tools/setup-dev.js:1-83`).

The dev env file `.env.dev` (auto-loaded by both server bootstraps via `require('dotenv').config({ path: ... '.env.dev' })`, `packages/server/api/src/app/bootstrap.ts:5`, same pattern in `packages/server/worker/src/bootstrap.ts`) sets:
- `AP_DB_TYPE=PGLITE` (`.env.dev:4`) — an **embedded** Postgres-compatible engine that runs in-process. **No `docker compose` Postgres container needed for this path.**
- `AP_QUEUE_MODE=MEMORY` (`.env.dev:10`) — in-memory job queue. **No Redis container needed either.**
- `AP_FRONTEND_URL="http://localhost:4200"` (`.env.dev:7`), `AP_WEBHOOK_URL="http://localhost:3000"` (`.env.dev:15`).
- `AP_DEV_PIECES="google-sheets,store"` (`.env.dev:5`) — only these two pieces get pre-built; anything else you drag into a flow during the walkthrough will need an explicit build (see failure mode 3).

So `docker-compose.dev.yml` (Postgres 14.4 on :5432, Redis 7.0.7 on :6379) is an **optional companion file for this path, not a requirement** — it exists so contributors can point `.env.dev` at real Postgres/Redis instead of PGLITE/MEMORY if they want closer-to-prod behavior, but the shipped `.env.dev` defaults don't need it. Skip Docker entirely for Path A unless you specifically want to test against real Postgres.

**Fastest viable command sequence:**

```bash
# 0. Get a compatible Node onto PATH for this shell (host default v26.4.0 fails the check below)
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
node -v   # must print v18.x, v22.x, or v24.x — v22.21.1 from brew satisfies this

# 1. From repo root
npm start
# → runs tools/scripts/install-bun.js, checks node version (tools/setup-dev.js:7-20),
#   confirms/installs bun, runs `bun install`, pre-builds google-sheets + store pieces,
#   then launches turbo (web :4200, api, engine, worker) all in one foreground process.
```

Checkpoints:

| Checkpoint | How to verify | What "healthy" looks like |
|---|---|---|
| Node version accepted | watch first lines of `npm start` output | `Node.js version is compatible vX.X.X.` (`tools/setup-dev.js:16`); a mismatch hard-exits (`tools/setup-dev.js:18-19`) |
| Bun install completes | terminal output | `bun install` finishes with no error, `node_modules` populated |
| Dev pieces built | terminal output | `Building dev pieces: google-sheets,store` then turbo build success (`tools/setup-dev.js:80-81`) |
| API up | `curl -sf http://localhost:3000/v1/flags` (webhook/api port per `AP_WEBHOOK_URL`) | JSON response, not connection-refused |
| Web up | open `http://localhost:4200` | Activepieces sign-in/sign-up screen loads |
| Worker up | terminal output (single foreground process, no separate container) | log lines from the worker filter, no crash loop |

Teardown: `Ctrl-C` the foreground process. PGLite data lives under `AP_CONFIG_PATH="./dev/config"` (`.env.dev:3`) and `AP_CACHE_PATH="./dev/cache"` (`.env.dev:2`); `rm -rf ./dev` for a full reset.

### Path B — prebuilt Docker image (closer to what an end user actually deploys)

`docker-compose.yml` (repo root) is a 4-service compose: `app` + `worker` (both the same all-in-one image `ghcr.io/activepieces/activepieces:0.86.2`, distinguished only by `AP_CONTAINER_TYPE=APP`/`WORKER`), `postgres` (`pgvector/pgvector:0.8.0-pg14`), `redis` (`redis:7.0.7`) (`docker-compose.yml:1-58`). `worker` runs 5 replicas by default (`docker-compose.yml:26-27`) — drop that to `1` for a single-user session, it's pure overkill otherwise.

`app` exposes `8080:80` (`docker-compose.yml:6-7`); `postgres`/`redis` are internal-only (no host port mappings in this file, unlike `docker-compose.dev.yml`).

Env: copy `.env.example` → `.env` in repo root (consumed via `env_file: .env` on both `app` and `worker`, `docker-compose.yml:11,23`). Required to fill in yourself — the example ships these **blank**, unlike Dify's `.env.example` which ships safe matched defaults for everything:
- `AP_POSTGRES_PASSWORD` (`.env.example:22`) — must match whatever you set; `docker-compose.yml` also reads `AP_POSTGRES_PASSWORD` directly for the `postgres` container's `POSTGRES_PASSWORD` (`docker-compose.yml:39`), so one value, no drift risk, but you must set it or Postgres starts with an empty password.
- `AP_ENCRYPTION_KEY` — 32 hex chars, blank by default (`.env.example:9`). The file's own header recommends generating it via `tools/deploy.sh` rather than hand-rolling it (`.env.example:1`); `openssl rand -hex 16` also produces a valid 32-hex-char value.
- `AP_JWT_SECRET` — blank by default (`.env.example:12`), same "don't hand-fill" guidance.
- `AP_API_KEY` — optional, blank is fine for a single local user (`.env.example:6`).

```bash
cp .env.example .env
# fill AP_POSTGRES_PASSWORD, AP_ENCRYPTION_KEY (32 hex chars), AP_JWT_SECRET
docker compose up -d
```

Checkpoints: `docker compose ps` → `app`, `worker`, `postgres`, `redis` all `Up`; `curl -sI http://localhost:8080/` → `200`/redirect to sign-in.

Teardown: `docker compose down` (keeps volumes) or `docker compose down -v` (wipes Postgres/Redis data — this compose file has no bind-mounted `volumes/` directory to `rm -rf`, everything lives in the two named Docker volumes `postgres_data`/`redis_data`, `docker-compose.yml:53-55`).

### Which path for this session

**Path A (source dev mode)** is the better fit for a UX-capture session: no Docker daemon dependency, faster iteration, and — importantly — it's the only path where you can be certain you're looking at the same code state as this checkout (Path B pulls a separately-versioned prebuilt image, `0.86.2`, which may not exactly match HEAD `6315071`). Use Path B only if the goal is specifically to validate the packaged/self-hosted deploy experience.

## 2. Known failure modes checklist

**Evidenced in this repo (not speculative):**

1. **Host Node too new for source dev mode.** `tools/setup-dev.js:8-19` hard-requires the running `node --version` to start with `v18`, `v22`, or `v24`; this host reports `v26.4.0`, which fails that check and `process.exit(1)`s before `bun install` even runs. Fix: prepend a compatible Node to `PATH` for the session, e.g. `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` (already installed via Homebrew on this machine — confirmed present, no download needed). `.nvmrc` at repo root pins `v24.14.0` (`.nvmrc:1`) if you'd rather match that exactly and have `nvm`/`fnm` available (this shell doesn't).
2. **`AP_DEV_PIECES` is a narrow allowlist.** Only `google-sheets` and `store` get pre-built by `tools/setup-dev.js:65-81` before the server starts. Dragging any other piece into a flow during the walkthrough (e.g. Slack, HTTP, a random trigger) will likely fail to load/render until it's built — either add it to `AP_DEV_PIECES` in `.env.dev` before starting, or expect the first use of an unlisted piece to error and require a manual `npx turbo run build --filter=<piece-package-name>`.
3. **`docker-compose.dev.yml` looks required but isn't, for the default `.env.dev`.** It's easy to assume you need `docker compose -f docker-compose.dev.yml up` before `npm start` (that's the typical pattern in most repos with a `*.dev.yml`); here it's dead weight unless you've edited `.env.dev` to point `AP_DB_TYPE` at `POSTGRES` and `AP_QUEUE_MODE` at `REDIS`. Don't spin up Docker for Path A.
4. **Path B's `.env.example` ships blank secrets, not safe defaults.** Unlike some other self-hosted stacks, `AP_POSTGRES_PASSWORD`, `AP_ENCRYPTION_KEY`, `AP_JWT_SECRET` are empty strings in `.env.example` (`.env.example:6-12,22`) — `docker compose up` will start but `app`/`worker` are near-certain to fail auth/crypto init with these unset. Must fill all three before `docker compose up` for Path B; Path A doesn't have this problem (`.env.dev:17` ships a real, if dev-only, `AP_JWT_SECRET`).
5. **Todos / manual-task approval UI does not exist in this checkout at all** — not merely flag-gated. Full trace:
   - The DB layer still carries it: TypeORM migrations rename `ManualTask*` → `Todo*` tables (`packages/server/api/src/app/database/migration/postgres/1742432827826-ChangeManualTasksToTodo.ts` and ~10 sibling migrations through `1751217652277-RevertTodoActivties.ts`), and `Todo`-named migrations are registered in `postgres-connection.ts:202-246`.
   - But there is **no runtime module**: no `todo.controller.ts`, `todo.service.ts`, or route registration anywhere in `packages/server/api/src/app/` (confirmed via repo-wide grep for `TodoController`/`TodoStatus`/`/v1/todos`/`todo-controller` — zero hits outside the migration files and the two DB-connection files that just register those migrations).
   - No frontend route either: `packages/web/src/app/routes/` has no `todos/` directory (compare to `tables/`, `runs/`, `flows/`, `forms/`, `chat/`, `automations/`, etc., which all exist as real route folders).
   - The only remaining trace in the frontend is a `'TODOS'` entry in the `FeatureKey` union used by the paywall/upsell component `request-trial.tsx:30` — but nothing in the current codebase actually renders `<RequestTrial featureKey="TODOS">`, so even the "upgrade to unlock" prompt for it isn't wired up anywhere reachable.
   - Corroboration from the repo's own agent-facing docs: `.agents/features/` has one `.md` per real module (`flows.md`, `human-input.md`, `tables.md`, even EE-only ones like `ee-platform.md`) — there is **no `todo.md`**, and `CONTEXT-MAP.md`/`CONTEXT.md` have zero mentions of Todo/manual-task as a bounded context.
   - The deprecated `wait_for_approval` piece action (`packages/pieces/core/approval/src/lib/actions/wait-for-approval.ts:13`) literally tells users: *"Please use Manual Task feature instead from 0.48.0 and above"* — so the feature existed as of 0.48.0, was renamed Manual Task→Todo sometime after, and by this checkout's HEAD (well past 0.86.2) has been pulled from the open-source module tree entirely, most likely relocated into a closed-source Cloud service not shipped in this repo.
   - **Verdict: there is no Todos/HITL inbox UI to capture in this checkout, full stop — not a build flag, not an EE license gate, the code isn't here.** If a UX capture of human-approval flows is still wanted, the closest available surface is the `approval` piece (`create_approval_link` / deprecated `wait_for_approval` actions) or the Forms/Chat human-input surface below — both fundamentally different UX (a generated link/webhook you visit, not an inbox) from what "Todos" implies.

**Plausible but not directly evidenced — flag as [speculative]:**

6. **[speculative]** Port 4200/3000 (Path A) or 8080 (Path B) collisions with other local dev servers. Not checked at bring-up time on this machine.
7. **[speculative]** `bun install` network/registry flakiness on first run — untestable without actually running it.

## 3. DRAFT → publish flow (traced, not speculative)

This is a single-endpoint, discriminated-union operation model — all 26 flow-modification types post through `POST /v1/flows/:id` (`.agents/features/flows.md:4`). The parts relevant to a UX capture:

1. **New flow → DRAFT.** `flow.service.ts:86` defaults `versionState = FlowVersionState.DRAFT` on creation. `FlowVersionState` is a two-value enum, `LOCKED` and `DRAFT` (`packages/core/execution/src/lib/flows/flow-version.ts:9-12`).
2. **Editing always happens on the DRAFT version** — every builder change (add step, rename, reconnect) is an `applyOperation` call against the current DRAFT `FlowVersion` row.
3. **Publish = `LOCK_AND_PUBLISH` operation**, dispatched from the same `POST /v1/flows/:id` endpoint (`flow.controller.ts:88`, checked for the `publishDisabledFlow`/`turnOnFlow` active-flow-quota gate at lines 87-93). It routes to `flowService.updatedPublishedVersionId` (`flow.service.ts:423-467`), which:
   - Loads the current (DRAFT) flow version.
   - If the flow was already `ENABLED` with a prior `publishedVersionId`, disables the old trigger source first (`flow.service.ts:436-443`).
   - In a DB transaction: calls `lockFlowVersionIfNotLocked`, which — if the version isn't already `LOCKED` — applies a `LOCK_FLOW` operation that flips its `state` from `DRAFT` to `LOCKED` (`flow.service.ts:636-659`). A `LOCKED` version is immutable from that point on.
   - Sets `flow.publishedVersionId` to that now-locked version's id and `flow.status = FlowStatus.DISABLED` (`flow.service.ts:455-456`) — **publishing and enabling are separate concerns**: publish just snapshots a runnable version; a following `CHANGE_STATUS` to `ENABLED` (or the same `LOCK_AND_PUBLISH` call, if `publishDisabledFlow` short-circuits both in one request per `flow.controller.ts:88-89`) is what actually registers the trigger source and lets it fire.
   - Notifies workers over websocket (`flowPublished` event, `flow.service.ts:465`) so a running worker picks up the new published version without a restart.
4. **Editing after publish creates a fresh DRAFT automatically.** Once the latest version is `LOCKED`, the next edit attempt runs `createNewDraftIfVersionIsPublished` (`flow.service.ts:828-857`): it creates a new empty `FlowVersion`, imports the locked snapshot's content into it via an `IMPORT_FLOW` operation, and that becomes the new editable DRAFT — the published `LOCKED` snapshot itself is never mutated in place.
5. **`USE_AS_DRAFT`** is the inverse manual action — copies the currently published version back over the draft, discarding in-progress draft edits (`.agents/features/flows.md:88`).

For a UX capture: build/edit a flow (auto-saves each change to the DRAFT), click Publish in the builder UI (fires `LOCK_AND_PUBLISH`), optionally toggle it on (`CHANGE_STATUS` → `ENABLED`), then make one more edit afterward to observe the auto-created new DRAFT — that round-trip is the full lifecycle in one capture.

## 4. Resource footprint estimate

**Path A (source dev mode):** **[speculative — no live measurement taken]** one foreground Node/turbo process running 4 services (web dev server, api, engine, worker) in-process against embedded PGLite — no separate DB/queue processes. Ballpark 1.5–3 GB RAM for the whole `npm start` tree on first run (Vite dev server + ts-node-ish API + worker), likely less once builds are warm. No Docker Desktop VM overhead since this path doesn't touch Docker at all.

**Path B (Docker):** **[speculative — no live measurement taken]** 4 containers with `worker` replicas trimmed to 1: `postgres` (~100–150MB, pgvector extension adds a little over stock Postgres), `redis` (~20MB), `app` + `worker` (same monolithic image, each likely 300–600MB given it bundles the full Node server + prebuilt piece catalog). Ballpark 1–2 GB across containers, plus Docker Desktop's own Linux VM overhead on macOS (commonly another 1–2 GB baseline). Recommend 4–6 GB allocated to Docker Desktop if going this route.

## 5. What Dan must provide

- Nothing for Path A beyond what's already on this machine — Homebrew `node@22`, `bun` 1.3.0, and a clean checkout are all present and sufficient. No secrets to generate; `.env.dev` ships everything needed including a (dev-only, clearly-labeled) JWT secret.
- For Path B: start Docker Desktop (not running at check time), then generate/fill `AP_POSTGRES_PASSWORD`, `AP_ENCRYPTION_KEY` (32 hex chars), `AP_JWT_SECRET` in a copied `.env` — none of these are pre-filled in `.env.example`.
- A decision on whether the "Todos" capture is actually in scope given it's absent from the codebase (see failure mode 5) — if the ask was specifically "capture the Todos inbox UX," that surface needs to come from somewhere else (Cloud account, older release tag, or a different feature substituted).

## Confidence

**Path A is well-supported by direct code reading** — `tools/setup-dev.js`, `.env.dev`, and both server bootstraps were read directly, and the Node-version gate was verified against this exact host's `node -v` output (a real, not hypothetical, blocker). The only real unknowns are network flakiness on `bun install` and whether ports 4200/3000 are free at run time — both untestable without actually running it. Confidence in Path A's bring-up sequence as documented: **high (roughly 80%)**, docked slightly because I did not execute the sequence end-to-end (Docker was down and this was scoped read-only).

**Path B is well-supported by the compose file and `.env.example` read directly**; confidence similarly **high (roughly 75-80%)** for a clean first-try bring-up once secrets are filled, docked for the same reason (not executed) plus the extra manual-secret step being more error-prone than Path A.

**The Todos/HITL absence finding is high confidence (roughly 90%)** — it's a negative claim (no such module exists), backed by five independent lines of evidence (no controller/service/route in server code, no frontend route directory, no `.agents/features/todo.md` doc, no `CONTEXT-MAP.md` mention, and an explicit in-code deprecation pointer from the old approval-piece action toward "Manual Task" which itself has since vanished from this tree). The residual uncertainty is only about *why* — whether it was moved to a private Cloud repo, is mid-removal, or something else — the "not present in this checkout" fact itself is solid.
