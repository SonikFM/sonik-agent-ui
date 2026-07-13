# Langflow local bring-up runbook

Repo studied: `/Users/danielletterio/Documents/GitHub/langflow` (working tree, clean, `git status --short` empty).
Purpose: single-user local UX-capture session. Not a production or multi-user deployment.

All claims below cite a file:line in that repo. Anything without a citation is marked **[speculative]**.

## 0. Environment facts checked before writing this

- Host is Apple Silicon (`arm64`), Python 3.14.6 already on `PATH`, `uv` 0.8.0 already installed at `~/.local/bin/uv`.
- Docker Desktop is installed (`docker --version` → 28.4.0, `docker compose` v2.39.4-desktop.1) but **the daemon was not running** when checked. Irrelevant to the recommended path below — noted only because Docker is the alternative path.
- Repo's own `requires-python = ">=3.10,<3.15"` (`pyproject.toml:5`) — the host's Python 3.14.6 is inside this range, no separate interpreter needed.
- Port 7860 (Langflow's default) was free on the host at check time.

## 1. Fastest viable path: pip/uv install, not Docker

Langflow ships as one importable Python package with a built-in web app (`pyproject.toml:4`, `"description": "A Python package with a built-in web application"`), backed by SQLite by default and a single ASGI process that serves both the API and the prebuilt frontend. There is no multi-container architecture to stand up for a single-user session — that's a structural difference from Dify, which is a multi-service platform by design.

Three ways to run it are documented in-repo:

| Path | Source | Verdict for this session |
|---|---|---|
| `uv pip install langflow -U` then `uv run langflow run` | `README.md:38-59` | **Recommended.** No Docker daemon needed, no services to sequence, single command to reach the UI. |
| `docker run -p 7860:7860 langflowai/langflow:latest` | `README.md:72-78` | Works, but pulls a large image and gains nothing for a single-user local capture over the pip path — skip. |
| `docker_example/docker-compose.yml` (langflow + postgres) | `docker_example/README.md` | Swaps SQLite for Postgres; only useful if you specifically need to exercise the Postgres code path. Not needed here. |
| `make run_cli` (run from source) | `README.md:66-70`, `DEVELOPMENT.md:43-44` | Requires `uv >=0.4` (have it) **and** Node.js v22.12/npm v10.9 to build the frontend from source (`DEVELOPMENT.md:44`) — unnecessary extra toolchain when the PyPI wheel already ships a built frontend. Skip unless you intend to edit source. |
| `deploy/docker-compose.yml` (+ Traefik, Postgres, RabbitMQ, Celery worker, Flower, pgadmin, Prometheus, Grafana) | `deploy/docker-compose.yml:1-238` | This is the horizontally-scaled deployment topology (Traefik reverse proxy with Let's-Encrypt labels, a Celery/RabbitMQ task queue, a separate Postgres, monitoring stack). Nine services for one user watching a UI walkthrough — explicitly the wrong tool here. |

**Recommendation: `uv pip install langflow -U` + `uv run langflow run`.** No `.env` file, no docker-compose, no service dependency graph to reason about — it's the single-process case the exemplar's compose-file analysis doesn't even apply to.

## 2. What happens on first boot (evidenced defaults, no config needed)

Every one of these is a shipped default — nothing needs to be set for a working single-user session:

- **Database**: SQLite. If `LANGFLOW_DATABASE_URL` is unset, Langflow falls back to a SQLite file (`src/lfx/src/lfx/services/settings/groups/database.py:22-26,155`). Unless `LANGFLOW_SAVE_DB_IN_CONFIG_DIR=true` is set (default `false`, `src/lfx/src/lfx/services/settings/groups/database.py:18`), the DB file (`langflow.db`) is written **inside the installed package directory** in your venv's site-packages, not in a config dir (`database.py:110-123`) — see the teardown note in section 4.
- **Auth**: `AUTO_LOGIN` defaults to `True` (`src/lfx/src/lfx/services/settings/auth.py:71-78`). On first boot Langflow auto-provisions a bootstrap superuser and logs you straight into the UI — there is no login screen to get past and no username/password you need to know for this session (`src/backend/base/langflow/services/utils.py:142-187`, `AUTO_LOGIN_INITIALIZED` outcome).
- **Secret key**: auto-generated and persisted under the resolved config dir (`src/lfx/src/lfx/services/settings/auth.py:188-215`) — no `SECRET_KEY` to set by hand.
- **Host/port**: `localhost:7860` (`src/lfx/src/lfx/services/settings/groups/server.py:14-17`).
- **Config dir** (secret key, logs, knowledge-base storage): defaults to the OS cache dir via `platformdirs` — on macOS that's `~/Library/Caches/langflow` (`src/lfx/src/lfx/services/settings/groups/paths.py:34-54`).

### Optional env vars — only set if you want non-default behavior

| Var | Default | Note |
|---|---|---|
| `LANGFLOW_DO_NOT_TRACK` | `false` (i.e. tracking **on**) | Anonymous telemetry posts to `https://langflow.gateway.scarf.sh` by default (`src/lfx/src/lfx/services/settings/groups/telemetry.py:14-17`, `env_prefix="LANGFLOW_"` at `base.py:111`). Set to `true` if you don't want a capture session phoning home. |
| `LANGFLOW_PORT` | `7860` | Only needed if 7860 is taken — but see the auto-increment behavior in section 3, item 1; you likely don't need to set this manually. |
| `LANGFLOW_OPEN_BROWSER` | `false` | Set `true` to have Langflow open your default browser automatically on start (`server.py:34-35`, CLI flag also available: `--open-browser`). |
| `LANGFLOW_LOG_LEVEL` | `critical` | Set to `info` or `debug` if you want to watch startup/request logs during the capture. |
| `<PROVIDER>_API_KEY` (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) | unset | Only needed once you drag an LLM component onto the canvas and want it to actually call a model. Not required to reach the UI. Full recognized list at `src/lfx/src/lfx/services/settings/constants.py:8-45`. |

No `.env` file is required at all for a default local run — set these only as plain shell env vars if you want to override something, e.g.:

```bash
LANGFLOW_DO_NOT_TRACK=true uv run langflow run
```

## 3. Known failure modes checklist

**Evidenced in this repo (not speculative):**

1. **Port-in-use is already handled, not a trap** — `run()` checks `is_port_in_use(port, host)` before binding and silently walks forward to the next free port with `get_free_port(port)` if 7860 is taken (`src/backend/base/langflow/__main__.py:494-499,609-634`). No manual `--port` juggling needed; just note the printed URL on startup in case it isn't 7860.
2. **First install is heavy** — the default PyPI package resolves `langflow-base[complete]`, which pulls in ~28 optional integrations (`src/backend/base/pyproject.toml:429-...`) including a full CPU build of PyTorch and ONNX Runtime (both present in `uv.lock`, e.g. `uv.lock:18599-18625`). Expect a multi-minute `uv pip install` and a large venv (see section 5) — this is not a hang, just genuinely that many wheels.
3. **Apple Silicon wheel compatibility confirmed for the heaviest dependency** — `uv.lock` lists a native `macosx_14_0_arm64` wheel for `torch==2.12.1` built for `cp314` (matches this host's Python 3.14.6) at `uv.lock:18620` (`torch-2.12.1-cp314-cp314-macosx_14_0_arm64.whl`). No Rosetta/emulation expected for the install's heaviest package.
4. **Telemetry is on by default** — see section 2 table; not a bug, just worth knowing before you start a customer-facing capture session on someone else's machine.
5. **SQLite DB file location is easy to lose track of** — with the default `LANGFLOW_SAVE_DB_IN_CONFIG_DIR=false`, the DB lands inside your venv's installed `langflow` package directory, not in an obvious project folder (`database.py:110-123`). If you `uv pip uninstall`/recreate the venv, the DB (and every flow you built in the capture session) goes with it. Set `LANGFLOW_SAVE_DB_IN_CONFIG_DIR=true` first if you want the DB to survive under `~/Library/Caches/langflow` instead.
6. **SSRF protection is on by default** (`src/lfx/src/lfx/services/settings/groups/security.py:20-27`) — blocks component calls to localhost/private IP ranges/cloud metadata endpoints. If the UX walkthrough includes a component that calls another local service (e.g. a webhook to `localhost:PORT`), it will be blocked unless that host is added via `LANGFLOW_SSRF_ALLOWED_HOSTS` or protection is disabled. Not an issue for a walkthrough that only calls external LLM APIs.

**Plausible but not directly evidenced in the files reviewed — flag as [speculative]:**

7. **[speculative]** PyPI network reliability during install — the `uv pip install` step pulls ~800+ locked packages (`uv.lock` has 815 `name =` entries) from PyPI and the PyTorch CPU wheel index; a flaky connection mid-install is a generic risk, not something evidenced as a repo-specific issue.
8. **[speculative]** First-run component indexing time — Langflow indexes its full component library on first boot before the UI is fully interactive; not measured here, just worth budgeting a short wait after the server reports "started" before the canvas is fully responsive.

## 4. Exact bring-up sequence

Run from any working directory (a fresh scratch directory is fine — the venv and DB will live there):

```bash
# 1. Create an isolated environment and install
mkdir -p ~/langflow-local && cd ~/langflow-local
uv venv
uv pip install langflow -U

# 2. Run (foreground; Ctrl-C to stop)
uv run langflow run
# Optional, to skip telemetry and open the browser automatically:
# LANGFLOW_DO_NOT_TRACK=true uv run langflow run --open-browser
```

Verification checkpoints, in the order things should turn green:

| Checkpoint | How to verify | What "working" looks like |
|---|---|---|
| Install completes | watch `uv pip install` output | no errors; expect several minutes given the dependency count (section 3, item 2) |
| Server starts | terminal output from `uv run langflow run` | a startup banner printing the bound URL, e.g. `http://127.0.0.1:7860` (port may differ if 7860 was taken — item 1 above) |
| API reachable | `curl -sI http://localhost:7860/health` (adjust port if it auto-shifted) | `HTTP/1.1 200` |
| UI reachable, already logged in | open the printed URL in a browser | the flow canvas loads directly — no login screen, because `AUTO_LOGIN=true` by default (section 2) |
| Component library loaded | in the UI, open the component sidebar | providers/component categories are populated (confirms first-boot indexing, item 8, has finished) |

Teardown:

```bash
# Stop the server: Ctrl-C in the running terminal

# Full reset: delete the venv (also deletes the SQLite DB unless you set
# LANGFLOW_SAVE_DB_IN_CONFIG_DIR=true, in which case also remove the config dir)
rm -rf ~/langflow-local
rm -rf ~/Library/Caches/langflow   # only if LANGFLOW_SAVE_DB_IN_CONFIG_DIR was used
```

## 5. Resource footprint estimate

**[speculative — no live measurement taken, ballparked from the locked dependency set]**: the `complete` extra's heaviest packages are the CPU build of PyTorch and ONNX Runtime (both confirmed present in `uv.lock`), so expect the venv on disk to land in the **1.5–3 GB** range and the initial `uv pip install` to take several minutes even on a fast connection (815 locked packages, per `uv.lock`). Idle RAM for the single running process is likely modest — **roughly 300–600 MB** — since it's one Python/uvicorn process with no separate database server, cache, or worker processes to add up (unlike the Dify Docker stack's 10+ containers). This is a single-process, single-user run; there's no Docker Desktop VM overhead to add on top since Docker isn't in the recommended path.

## What Dan must provide

- Nothing is required just to reach the UI and click around — `AUTO_LOGIN` and SQLite mean zero setup for that.
- To actually exercise a flow that calls a model (the likely point of a "UX-capture" session), he needs to decide which LLM provider(s) to demo and supply the matching API key as a plain env var before starting the server, or paste it into the component's field in the UI once it's running — e.g. `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (full recognized list at `src/lfx/src/lfx/services/settings/constants.py:8-45`).
- A decision on whether this session's data should phone home to Langflow's telemetry endpoint (`LANGFLOW_DO_NOT_TRACK=true` to opt out, off by default).

## Confidence

The pip/uv path is directly documented in the repo's own README as the primary quickstart (`README.md:38-61`), the SQLite/auto-login/secret-key defaults are all confirmed in source rather than inferred, the port-conflict handling is confirmed non-blocking by code inspection, and the heaviest dependency (PyTorch) has a confirmed native arm64 wheel matching this host's exact Python version. The two open unknowns are both untestable without actually running the install: PyPI network reliability for an 815-package resolve, and first-boot component-indexing latency. Given that, I'd put this at **high confidence (roughly 85-90%) for a clean first-try bring-up** — higher than the Dify case, since there's no multi-service dependency graph to get wrong, just one `uv pip install` and one `uv run langflow run`.
