# OpenAgent — value scan + bring-up runbook

**Repo:** `/Users/danielletterio/Documents/GitHub/openagent`, remote `https://github.com/the-open-agent/openagent` (org: `the-open-agent`, Docker image published under `casbin/openagent` — same lineage as Casdoor/Casibase). Apache 2.0. HEAD at scan time: `72113280` ("fix: contain file preview...").

## What it is

OpenAgent is a self-hostable, single-binary personal AI assistant: Go/Beego backend + React admin frontend + MySQL/SQLite, offering 30+ LLM provider connectors, RAG knowledge bases, autonomous agent loops (browser-use, shell, office file automation, MCP tool integration), a BPMN-style visual workflow builder, and a full admin dashboard (usage analytics, activity monitoring, tool management, request logs). It ships prebuilt binaries and a Docker image, and embeds a bundled skill library.

Read order used: `README.md`, repo-root `CLAUDE.md` (architecture doc for AI agents working on this codebase), `go.mod`, `docker-compose.yml`, `Dockerfile`, `object/adapter.go`, `object/marketplace.go`, `object/skill.go`, `tool/skill.go`, `mcp/toolset.go`, `object/merge_agent_tools.go`, `web/craco.config.js`.

---

## 1. Value scan — Sonik agent-marketplace lens

**Verdict: genuinely relevant.** This is one of the few OSS codebases we've looked at with a *working, end-to-end skill marketplace* — pluggable sources, search, install, and a runtime disclosure mechanism — not just a manifest schema on paper. Given the memory note that Sonik's agent-marketplace lane has contracts (D001–D017) but no runtime yet, this is a useful existence proof for several of the missing pieces.

### Steal candidates

- **`object/marketplace.go`** (352 lines) — the marketplace core. `MarketplaceSource` models a pluggable source (`type: "manifest"` = fetch one JSON manifest URL, `type: "github"` = recursively scan a repo's git tree via GitHub's API for `skills/<name>/SKILL.md` blobs). `GetMarketplaceSkills(sourceID, keyword)` fans out across sources and does keyword matching over name/description/tags. `InstallMarketplaceSkill(item)` downloads the `SKILL.md`, parses front matter, pulls any `references/` files, and materializes a DB-backed `Skill` row. Two source adapters behind one interface is the right shape if Sonik wants "a marketplace can be a repo, or a hosted registry" without hardcoding either.
- **`object/skill.go`** — the `Skill` entity schema and its comment block documenting the SKILL.md → struct field mapping (`Content` = markdown body injected into system prompt, `Metadata` = raw front-matter metadata block, `References` = files from `references/`). This is effectively "Claude Skill format as a first-class DB row" — worth comparing against however Sonik's own SKILL.md/agent-card conventions are meant to persist.
- **`tool/skill.go`** — the runtime side: a single `load_skill` builtin tool exposed to the model, which lazily loads full skill instructions (and one optional reference file) only when the model decides a catalog entry is relevant. This is the "thin catalog now, full content on demand" two-stage disclosure pattern — keeps the system prompt small regardless of how many skills are installed. Directly applicable to a marketplace with many installed items.
- **`object/merge_agent_tools.go`** — per-"Store" (their unit of agent/workspace config) tool registry assembly: `buildMergedBuiltinRegistry` merges the skill-loader builtin, configured builtin tools, and (in `mcp/toolset.go` / `mcp/tools.go` / `mcp/client.go`) live MCP server connections into one `ToolSet` handed to the model at conversation time. This is the "capability resolution" layer Sonik's marketplace lane doesn't have a runtime for yet — worth reading end to end if/when that gap gets picked up.
- **`skills/` directory** — ~56 bundled skills, all real `SKILL.md` files (front matter: `name`, `description`, `homepage`, `metadata.emoji`) spanning dev tools (`github`, `gh-issues`), comms (`slack`, `discord`, `imsg`), productivity (`notion`, `obsidian`, `trello`, `1password`), and media (`camsnap`, `video-frames`, `sherpa-onnx-tts`). Useful as a corpus of real-world SKILL.md authoring conventions across categories, independent of the marketplace mechanism itself.

### Caveats — don't copy blind

- The marketplace has exactly **two hardcoded sources** (their own repo + a "ClawHub" endpoint); the code comment literally says "additional sources can be added by the user via the UI in the future" — that's still a TODO in their own codebase, not a solved multi-tenant registry.
- **No versioning, no ratings/reviews, no dependency graph, and no permission/sandboxing model** on installed skills — install just means "fetch markdown, store it, inject it into a prompt." There's no security boundary here worth copying if Sonik ever needs to gate what an installed skill can *do* (skills are prompt content only; actual tool execution — browser/shell/office — is a separate, more mature subsystem in `tool/`).
- The GitHub adapter re-fetches the whole recursive tree and then fetches every matching `SKILL.md` individually per search call — no caching layer. Fine for a demo marketplace, not a pattern to scale past a few dozen skills.

---

## 2. Local bring-up runbook

**Runnable: yes, worth capturing.** Full web admin UI (chat, marketplace modal, tool management, dashboards) on top of a Go backend that auto-provisions its own database — no external services required for a quick look.

### Fastest path (no Docker, no MySQL)

`object/adapter.go` (`resolveDatabase`, line ~79) transparently falls back to a pure-Go SQLite driver whenever the config still holds the default MySQL DSN and nothing is listening on `localhost:3306` — confirmed no MySQL is running locally, so this fallback fires automatically. No config edits needed for a first look.

1. **Backend** (terminal 1), from repo root:
   ```bash
   go run main.go
   ```
   Look for the printed line `OpenAgent: connecting to database [driver=sqlite3, ...]` — confirms the SQLite fallback engaged. Backend listens on port **14000**; DB file lands next to the binary (`openagent.db` under Go's temp build dir when using `go run`, so expect it in a `go-build*` tmp dir — fine for a throwaway look; a real `go build && ./openagent` run will place it next to the binary instead).

2. **Frontend** (terminal 2):
   ```bash
   cd web && yarn install && yarn start
   ```
   Dev server on port **13001**; `web/craco.config.js` proxies `/api` and `/swagger` to `localhost:14000`. Open **http://localhost:13001**.

3. First-run checkpoint: the admin UI should load with a sign-in/setup screen. `object/init.go` (not read in depth, but referenced by `CLAUDE.md`'s auto-migration note) is responsible for seeding the `admin` owner and default entities on first boot via `Sync2`.

### Alternative: Docker Compose (if you want MySQL parity with prod)

```bash
docker-compose up
```
Brings up `openagent` (built from the repo `Dockerfile`, `STANDARD` target) plus a `mysql:8.0.25` container (root password `123456`, DB `casibase`), exposed on **14000** and **3306**. Slower (image build compiles both the Go backend and the React frontend, plus a Node-based `pptx-worker`), but matches the real deployment topology. `docker-compose.yml` and `Dockerfile` are both at repo root.

### What Dan must provide

- Nothing required just to see the shell UI and marketplace modal.
- To actually exercise chat / RAG / agent loops, an LLM provider API key entered through the admin UI (Settings → Providers) — any of the 30+ supported providers; OpenAI or Anthropic key is the obvious choice.
- No GPU, no special hardware. Go build + yarn dev server both run comfortably on Apple Silicon.

### Resource notes

- Repo checkout: 53 MB on disk (before `node_modules` / Go module cache / build artifacts).
- Go 1.25.8 and yarn 1.22 / Node v26 already present locally — both `go run main.go` and `yarn start` should work immediately without toolchain installs.
- `go run main.go` first run will pull Go module dependencies (`go.sum` is ~120 KB, i.e. a large dependency graph — expect a few minutes on first build, seconds after that from cache). `yarn install` similarly will take a minute or two on first run.
- RAM: lightweight for a first look — Go binary + SQLite + a CRA dev server is well under 1 GB combined; no database container needed on the fast path.

### To see the marketplace UI specifically

Relevant frontend files once the app is up: `web/src/SkillMarketplaceModal.js` (the browse/install modal), `web/src/SkillListPage.js` / `SkillEditPage.js` (installed skills CRUD), `web/src/LoadSkillModal.js`. Backend routes for these live under the `Skill` entity group in `routers/router.go` per the repo's own three-layer convention (`object/skill.go` → `controllers/skill.go` → `routers/router.go`).

---

**One-line summary:** OpenAgent is a self-hostable Go/React personal-AI-assistant platform (LLM connectors + RAG + agent loops + BPMN workflows) with a genuinely working skill marketplace (pluggable source adapters, install flow, lazy-load runtime tool) worth studying for Sonik's marketplace runtime gap; it's trivially runnable locally via `go run main.go` (auto-SQLite) + `yarn start`, no Docker or external services required.
