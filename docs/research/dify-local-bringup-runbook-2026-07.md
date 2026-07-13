# Dify local docker bring-up runbook

Repo studied: `/Users/danielletterio/Documents/GitHub/dify` (working tree, clean, no local `docker/` diffs).
Purpose: single-user local UX walkthrough + plugin install flow capture. Not a production or multi-user deployment.

All claims below cite a file:line in that repo. Anything without a citation is marked **[speculative]**.

## 0. Environment facts checked before writing this (avoid surprises)

- Docker Desktop is installed (`docker --version` → 28.4.0, `docker compose` v2.39.4-desktop.1) but **the daemon was not running** when checked — start Docker Desktop before step 1.
- Host is Apple Silicon (`arm64`).
- Ports 80, 443, 5003, 5432, 6379 were all free on the host at check time.
- No `docker/.env` exists yet — must be created (step 2).
- `docker/volumes/{opensearch,oceanbase,myscale,sandbox}/*` subdirectories already exist, but `git status --short docker/` is clean — these are **repo-committed config scaffolding** for optional non-default vector-store profiles (`opensearch_dashboards.yml`, `oceanbase/init.d`, `myscale/config`, `sandbox/conf`), not leftover state from a prior bring-up attempt. Nothing to clean up here.

## 1. Service map (full default `docker-compose.yaml`)

Source: `docker/docker-compose.yaml` (1259 lines, auto-generated — do not hand-edit; regenerate via `generate_docker_compose` if you need to change it, per the file's own header at `docker/docker-compose.yaml:1-5`).

Compose profile selection is driven by `.env`'s `COMPOSE_PROFILES=${VECTOR_STORE:-weaviate},${DB_TYPE:-postgresql},collaboration` (`docker/.env.example:287`). With the shipped defaults (`VECTOR_STORE` unset → `weaviate`, `DB_TYPE` unset → `postgresql`), the containers that actually start are:

| Service | Role | Profile-gated? | Hard dependency of api/worker? |
|---|---|---|---|
| `init_permissions` | one-shot busybox job, chowns `./volumes/app/storage` to uid 1001 before anything else touches it | no (`docker-compose.yaml:208-224`) | api/worker wait on `service_completed_successfully` (`docker-compose.yaml:242-243`, `312-313`) |
| `db_postgres` | Postgres 15 | yes, `postgresql` profile (`docker-compose.yaml:419-420`) | yes, `service_healthy`, `required: false` (`docker-compose.yaml:244-246`) |
| `redis` | cache + Celery broker + plugin-daemon KV | no (`docker-compose.yaml:484`) | yes, `service_started` (`docker-compose.yaml:256-257`) |
| `plugin_daemon` | Go plugin runtime, installs/runs marketplace plugins | no (`docker-compose.yaml:547`) | not a listed api/worker dependency, but `agent_backend` depends on it (`docker-compose.yaml:664-665`) |
| `agent_backend` | Dify Agent v2 backend | no (`docker-compose.yaml:634`) | **yes, hard**: `condition: service_started`, no `required: false` (`docker-compose.yaml:258-259`, `328-329`) |
| `local_sandbox` | shell workspace sandbox for Agent v2 | no (`docker-compose.yaml:532`) | hard dependency of `agent_backend` (`docker-compose.yaml:666-667`), so transitively required |
| `api` | Flask API/console | no | — |
| `worker` | Celery worker (dataset, workflow, mail, etc. queues) | no | — |
| `worker_beat` | Celery beat scheduler | no | — |
| `web` | Next.js frontend | no | — |
| `nginx` | reverse proxy, only thing exposed to the host by default besides plugin debug port | no | `depends_on: [api, web]` (`docker-compose.yaml:755-757`) |
| `sandbox` (DifySandbox) | code-execution sandbox for workflow "code" nodes | no, always starts (`docker-compose.yaml:502`) | **not** a dependency of api/worker/agent_backend — nothing in compose requires it |
| `ssrf_proxy` | squid egress proxy, used by `sandbox`'s `HTTP_PROXY`/`HTTPS_PROXY` env (`docker-compose.yaml:519-520`) | no, always starts | not a `depends_on` of anything — only referenced by env var |
| `weaviate` | default vector store | yes, `weaviate` profile (`docker-compose.yaml:765-766`) | not a `depends_on` of api/worker — only called at request time |
| `api_websocket` | dedicated websocket server for real-time collaboration editing | yes, `collaboration` profile (`docker-compose.yaml:277-278`) | no |

Everything else in the file (`db_mysql`, `oceanbase`, `seekdb`, `qdrant`, `couchbase-server`, `pgvector`, `vastbase`, `pgvecto-rs`, `chroma`, `iris`, `oracle`, Milvus's `etcd`/`minio`/`milvus-standalone`, `opensearch`/`opensearch-dashboards`, `opengauss`, `myscale`, `matrixone`, `elasticsearch`/`kibana`, `unstructured`, `certbot`) is gated behind a profile that is **not** in the default `COMPOSE_PROFILES` list and will not start unless you explicitly change `VECTOR_STORE`/`DB_TYPE` or pass `--profile`.

Startup ordering enforced by compose (from `depends_on`/`healthcheck` blocks cited above):
1. `init_permissions` completes.
2. `db_postgres` becomes healthy (pg_isready loop, `docker-compose.yaml:437-451`).
3. `redis` starts (no healthcheck gating on api, just `service_started`).
4. `local_sandbox` → `plugin_daemon` → `agent_backend` starts (agent_backend's own depends_on, `docker-compose.yaml:661-667`).
5. `api`/`worker`/`worker_beat` start once 2–4 are satisfied.
6. `nginx` starts once `api` and `web` have started (not "healthy" — just container-started, `docker-compose.yaml:755-757`).

## 2. Minimum viable profile for this session (UX walkthrough + plugin install, single user)

Goal: fewest containers that leave the plugin-install flow and general app-builder UX fully functional.

**Must run** (hard dependencies, cannot be dropped without editing compose):
`init_permissions`, `db_postgres`, `redis`, `local_sandbox`, `plugin_daemon`, `agent_backend`, `api`, `worker`, `web`, `nginx`.

**Recommended to keep** (cheap, avoids surprising broken features mid-walkthrough):
`weaviate` — knowledge-base/dataset features will 500 without it since `api` has no startup dependency on it (nothing blocks boot, but first RAG action will fail). Keep it; it's one lightweight container.
`worker_beat` — scheduled/periodic tasks (trigger polling, retention). Not needed for a single interactive session but cheap to leave on.

**Safe to skip for this session** (not a dependency of anything in the must-run set):
- `sandbox` (DifySandbox) — only used by workflow "code execution" nodes. Skip if the walkthrough doesn't touch code nodes.
- `ssrf_proxy` — only exists to proxy `sandbox`'s egress; nothing else depends on it (`docker-compose.yaml` has no `depends_on: [ssrf_proxy]` anywhere). Skip together with `sandbox`.
- `api_websocket` — only used for real-time multi-user collaborative editing. For a single-user capture, drop `collaboration` from `COMPOSE_PROFILES`.

To skip `sandbox`/`ssrf_proxy` cleanly, don't add them to your explicit `docker compose up -d <services>` list (see step 3's exact command) rather than trying to strip them from the profile — they aren't profile-gated in this compose file, so `docker compose up -d` with no service args would start them regardless.

### Required env vars and safe local values

Base file: copy `docker/.env.example` → `docker/.env` (`docker/README.md:22`, "Copy `.env.example` to `.env`"). The example file already ships safe, matched local defaults for every variable below — you do **not** need to hand-generate or manually pair any secrets for a local single-user run:

| Var | Default in `.env.example` | Note |
|---|---|---|
| `SECRET_KEY` | empty | Leave empty — Dify auto-generates and persists a key inside the storage volume (`docker/.env.example:33-34`, confirmed in README `docker/README.md:96`). No action needed. |
| `INIT_PASSWORD` | empty | Empty means open self-registration for the first admin account on first web visit (`docker/.env.example:35`). Fine for local single-user. |
| `DB_USERNAME`/`DB_PASSWORD`/`DB_DATABASE` | `postgres`/`difyai123456`/`dify` | `docker/.env.example:79-83`, consumed by `db_postgres` service (`docker-compose.yaml:423-425`). |
| `REDIS_PASSWORD` | `difyai123456` | `docker/.env.example:105`, matches `redis`'s `--requirepass` (`docker-compose.yaml:493`) and `CELERY_BROKER_URL` (`docker/.env.example:120`). |
| `PLUGIN_DIFY_INNER_API_KEY` | `QaHbTe77CtuXmsfyhR7+vRjI/+XbV1AaFy691iy+kGDv2Jvy0/eAh8Y1` | **This single var is the pairing** — it sets `api`/`worker`'s `INNER_API_KEY_FOR_PLUGIN` (`docker-compose.yaml:239`, `309`) **and** `plugin_daemon`'s `DIFY_INNER_API_KEY` (`docker-compose.yaml:575`) from the same source value. They cannot drift out of sync unless you edit one of them by hand. This directly contradicts the commonly-assumed "plugin daemon key mismatch" failure mode for a default/unmodified `.env` — it's a non-issue here. |
| `PLUGIN_DAEMON_KEY` | `lYkiYYT6owG+71oLerGzA7GXCgOT++6ovaezWAjpCjf+Sjc3ZtU+qUEi` | Same shared-var pattern: sets `plugin_daemon`'s `SERVER_KEY` (`docker-compose.yaml:571`) and is echoed to `agent_backend` (`docker-compose.yaml:649`). No manual pairing needed. |
| `SANDBOX_API_KEY` | `dify-sandbox` | Only relevant if you keep the `sandbox` service. |
| `DIFY_AGENT_SERVER_SECRET_KEY` | `MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY` | Explicitly flagged in the compose file itself as a **dev-only default to replace in production** (`docker-compose.yaml:655-658`). Fine to leave as-is for a local capture session; do not reuse this value anywhere real. |
| `VECTOR_STORE` | unset → falls back to `weaviate` | Leave unset. |
| `COMPOSE_PROFILES` | `${VECTOR_STORE:-weaviate},${DB_TYPE:-postgresql},collaboration` | Remove `,collaboration` in your local `.env` if you want to skip `api_websocket` per the "safe to skip" list above. |

No `SECRET_KEY`/API-key generation step, no `envs/*.env` optional files need to be copied for this minimal session — `docker/README.md:9-13` and the header of `.env.example` (`docker/.env.example:1-13`) both state the root `.env.example` alone is sufficient for a default startup; `envs/*.env.example` files are opt-in extras (OTEL, non-default vector stores, alternate storage backends) that this session doesn't need.

## 3. Known failure modes checklist

**Evidenced in this repo (not speculative):**

1. **Storage directory permissions** — already mitigated by design. `init_permissions` chowns `./volumes/app/storage` to `1001:1001` before `api`/`worker` start and only re-runs once (flag file check) (`docker-compose.yaml:208-224`). Don't skip or reorder this service.
2. **Migration race across `api`/`worker`/`worker_beat`** — looks like a classic trap (three containers all run `flask upgrade-db` on boot per `api/docker/entrypoint.sh:12-14`) but is **evidenced as already handled**: `upgrade_db()` in `api/commands/system.py:135-166` takes a non-blocking Redis advisory lock (`DbMigrationAutoRenewLock`) before running Alembic; a container that loses the race just logs "Database migration skipped" and continues rather than erroring (`api/commands/system.py:145-166`). No manual sequencing needed.
3. **MySQL healthcheck false-positive** — documented directly in-repo: `mysqladmin ping` reports healthy while MySQL 8.0 is still finalizing init, causing "Lost connection during query" on the first real connection; the middleware compose file works around it with a real `SELECT 1` healthcheck instead (`docker-compose.middleware.yaml:62-64`). **Does not apply to this session** — default `DB_TYPE=postgresql` means `db_mysql` never starts — but worth knowing if you ever switch `DB_TYPE=mysql`.
4. **`api`/`worker` won't boot without `agent_backend`** — it's a hard, non-optional dependency (`docker-compose.yaml:258-259`, `328-329`), unlike `db_postgres`/`db_mysql` which are `required: false`. If `agent_backend`, `local_sandbox`, or `plugin_daemon` fail to start, `api` will not come up at all — check those three first if `api` never becomes healthy.
5. **nginx starts before api/web are actually ready** — `nginx`'s `depends_on: [api, web]` only waits for container start, not for `api`'s own healthcheck (`docker-compose.yaml:263-268` defines a healthcheck on `api` but `nginx`'s depends_on doesn't reference `condition: service_healthy` for it — `docker-compose.yaml:755-757`). Expect nginx to return 502s for the first ~30 seconds after `docker compose up` even though `docker compose ps` shows nginx running; this is normal, not a bug, don't restart nginx over it.

**Plausible but not directly evidenced in the files reviewed — flag as [speculative]:**

6. **[speculative]** Port 80/443 collisions with other local dev servers (common with any other proxy/webserver running on the host). Was free at check time on this machine; not something the repo can guarantee.
7. **[speculative]** First plugin install from the marketplace (`MARKETPLACE_API_URL=https://marketplace.dify.ai`, `docker/.env.example:245`) requires outbound internet access from the `plugin_daemon`/`api` containers over Docker's normal NAT (this call is not evidenced to route through `ssrf_proxy` — no `HTTP_PROXY`/`HTTPS_PROXY` env is set on `plugin_daemon` in `docker-compose.yaml:567-614`, unlike `sandbox` which explicitly sets it at `docker-compose.yaml:519-520`). If your network blocks outbound HTTPS from Docker containers, the marketplace tab will fail to load — this wasn't testable without actually bringing the stack up.
8. **[speculative]** Apple Silicon image compatibility: `docker manifest inspect` confirmed **native arm64 manifests exist** for every image in the minimum-viable set (`dify-api:1.16.0-rc1`, `dify-web:1.16.0-rc1`, `dify-sandbox:0.2.15`, `dify-agent-local-sandbox:1.16.0-rc1`, `dify-agent-backend:1.16.0-rc1`, `dify-plugin-daemon:0.6.3-local`, `semitechnologies/weaviate:1.27.0`) — so no Rosetta emulation expected for this session. Not checked: `postgres:15-alpine` / `redis:6-alpine` / `nginx:latest` (all long-standing multi-arch official images, effectively certain to have arm64 builds, but not explicitly re-verified here).

## 4. Exact bring-up sequence

Run from `docker/` in the repo.

```bash
# 0. Start Docker Desktop first (was not running at check time) and wait for it to report "running".

# 1. Create your local env file
cp .env.example .env
# Optional: edit .env and remove ",collaboration" from COMPOSE_PROFILES if you want to skip api_websocket.

# 2. Bring up only the minimum-viable set (skips sandbox, ssrf_proxy, api_websocket)
docker compose up -d \
  init_permissions db_postgres redis local_sandbox plugin_daemon agent_backend \
  api worker worker_beat web nginx weaviate
```

Verification checkpoints, in the order things should turn green:

| Checkpoint | How to verify | What "healthy" looks like |
|---|---|---|
| `init_permissions` ran once | `docker compose ps init_permissions` | `Exited (0)` |
| Postgres healthy | `docker compose ps db_postgres` | `healthy` (uses `pg_isready`, `docker-compose.yaml:437-451`) |
| Redis up | `docker compose logs redis --tail 20` | `Ready to accept connections` |
| plugin_daemon / agent_backend / local_sandbox up | `docker compose ps plugin_daemon agent_backend local_sandbox` | all `Up`, agent_backend has no healthcheck defined so rely on log tail: `docker compose logs agent_backend --tail 20` shows no crash loop |
| API healthy | `docker compose ps api` then `curl -sf http://localhost/console/api/health` (via nginx) or directly `docker compose exec api curl -f http://localhost:5001/health` | `healthy` in `ps`; healthcheck is `curl -f http://localhost:5001/health` every 30s (`docker-compose.yaml:263-268`) |
| Worker healthy | `docker compose exec worker celery -A celery_healthcheck.celery inspect ping` | `pong` — note the compose-shipped healthcheck for this is `disable: true` by default (`docker-compose.yaml:333-339`, driven by `COMPOSE_WORKER_HEALTHCHECK_DISABLED=true` in `.env.example:73`), so `docker compose ps` will not show a health status for `worker`/`worker_beat` — check logs or run the command manually. |
| Web reachable | `curl -sI http://localhost/` | `HTTP/1.1 200` (or a redirect to `/apps` / `/signin`) once nginx is proxying to `web:3000` |
| Full stack UI | open `http://localhost` in a browser | Dify signup/login screen loads; first account creation works since `INIT_PASSWORD` is empty |
| Plugin install path | in the web UI, go to Plugins → Marketplace, install any plugin | plugin install completes; if this hangs, check `docker compose logs plugin_daemon` first (see failure mode 4/7 above) |

Teardown / reset:

```bash
# Stop containers, keep data volumes (fast restart later)
docker compose down

# Full reset: stop and delete all local data (Postgres, Redis, storage, weaviate, plugin installs)
docker compose down -v
rm -rf volumes/app volumes/db volumes/redis volumes/weaviate volumes/plugin_daemon volumes/sandbox/dependencies
```

(`rm -rf` list intentionally excludes `volumes/{opensearch,oceanbase,myscale}` and `volumes/sandbox/conf` — those are the repo-committed config scaffolding noted in section 0, not generated data, and `git status` will flag it if you accidentally delete a tracked file.)

## 5. Resource footprint estimate

11 containers in the minimum-viable set (`init_permissions` exits immediately, so 10 stay running: `db_postgres`, `redis`, `local_sandbox`, `plugin_daemon`, `agent_backend`, `api`, `worker`, `worker_beat`, `web`, `nginx`, `weaviate` — that's actually 11 persistent containers).

**[speculative — no live measurement taken, ballparked from typical image sizes/runtimes for this container mix]**: idle RAM roughly 1.5–2.5 GB across all 11 containers (Postgres ~100MB, Redis ~20MB, Weaviate ~300MB idle, nginx ~20MB, the Go services — plugin_daemon/agent_backend/local_sandbox — ~50-150MB each, api gunicorn ~250-400MB, worker celery ~150-300MB, worker_beat ~100MB, web Next.js node process ~150-300MB), spiking toward 3–4 GB during an actual plugin install (plugin_daemon spins up a fresh Python venv subprocess per plugin, typically 100–300MB while it installs). Add Docker Desktop's own Linux VM overhead on macOS, commonly another 1–2 GB baseline regardless of workload. Recommend allocating **at least 6 GB, ideally 8 GB**, to Docker Desktop's resource limit for this session; on a normal 16GB+ dev laptop this leaves enough headroom to keep an IDE and browser running alongside it, but don't expect to comfortably run this next to another heavy Docker workload at the same time.

## Confidence

The default-profile bring-up (this exact minimum-viable set) is well-supported by the compose file's own healthchecks and dependency graph, the migration-lock code is confirmed race-safe, the plugin-daemon key pairing is confirmed non-drifting by construction, and every core image has a native arm64 manifest for this host. The two open unknowns are both untestable without actually running the stack: outbound marketplace connectivity from inside the containers, and whether port 80/443 stay free at run time. Given that, I'd put this at **high confidence (roughly 80-85%) for a clean first-try bring-up** if the sequence in section 4 is followed as written — the main way to lose that confidence is skipping the `cp .env.example .env` step or trying to hand-edit the auto-generated `docker-compose.yaml` instead of using it as shipped.
