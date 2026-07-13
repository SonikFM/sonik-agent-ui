# Flowise local bring-up runbook

Repo studied: `/Users/danielletterio/Documents/GitHub/flowise` (working tree, clean, `HEAD` at `bb773ffa710bd22639c4ba2643413a0ea2b679d3`, 2026-07-06). Version `3.1.3` (`package.json:2`).
Purpose: single-user local UX walkthrough of agentexecutions, marketplace templates, and HumanInput node flows. Not a production or multi-user deployment.

All claims below cite a file:line in that repo. Anything without a citation is marked **[speculative]**.

## 0. Environment facts checked before writing this (avoid surprises)

- Host is Apple Silicon macOS, `node -v` → `v26.4.0`, `pnpm -v` → `10.20.0` at check time.
- The repo declares `"node": "^24"` for both the root workspace (`package.json:99-101`) and the publishable server package (`packages/server/package.json:60-61`); `.nvmrc` pins `v24.15.0`. The host's installed Node (`v26.4.0`) is newer than the declared range. `.npmrc:7` sets `engine-strict = false`, so `pnpm install` in this repo will not hard-fail on the mismatch — but that setting is scoped to this workspace's own installs, not to a global `npm install -g flowise`, so the two paths (build-from-source vs. `npx`) carry different risk here. See failure mode 1 below.
- `pnpm -v` (`10.20.0`) is below the repo's declared `"pnpm": "^10.26.0"` (`package.json:100-101`) — only relevant if you choose the build-from-source path; irrelevant for `npx`/Docker.
- Port 3000 (Flowise's only port, `docker/.env.example:1`) was free on the host at check time.
- No `docker/.env` exists yet — would need to be created if the Docker path is chosen.
- No `~/.flowise` directory was inspected/assumed to exist — first run creates it (see §2).

## 1. Path comparison and recommendation

Flowise ships three viable local bring-up paths, documented in the repo's own `README.md`:

| Path | Command | Source | Speed |
|---|---|---|---|
| `npx flowise` | `npm install -g flowise && npx flowise start` (`README.md:41-49`) | Published npm package (independent of this git checkout) | Fastest — no build, no image pull |
| Docker Hub image | `docker compose up -d` from `docker/` (`docker/README.md:5-10`, `docker/docker-compose.yml:1-163`) | Published Docker Hub image `flowiseai/flowise:latest` (`docker/docker-compose.yml:5`) | Fast, but needs Docker Desktop running + ~1GB image pull |
| Build from source | `pnpm install && pnpm build && pnpm start` (`README.md:100-155`) | This exact git checkout | Slowest — full monorepo build via Turbo, documented OOM risk (`README.md:126-147`) |

**Recommendation: `npx flowise start`.** For a UX-capture session (viewing screens, exercising Agentflow/HumanInput/marketplace, no code changes), the published package is functionally identical to this checkout's `packages/server` (same `bin/run` → `@oclif/core` entrypoint, `packages/server/package.json:59-60`, `packages/server/bin/run:1-4`) at essentially the same version. It skips the build entirely and doesn't require Docker Desktop to be running. The Docker path is a reasonable fallback if you want the process fully sandboxed/disposable — it's a single container (unlike Dify's 11), so the overhead difference vs. `npx` is small. Build-from-source is only needed if Dan wants to run *this specific working tree's* modifications, which the task doesn't call for.

```bash
# fastest path
npm install -g flowise
npx flowise start
```

No repo clone, no `pnpm install`, no `.env` file needed for this path — Flowise auto-generates and persists its own secrets on first boot (see §2).

## 2. Env vars, secrets, and storage

### Database — sqlite by default, no setup required

`DATABASE_TYPE` is unset by default (commented out in `docker/.env.example:8`, and simply absent as an env var when running bare `npx flowise start`). The server's `DataSource.init()` switches on `process.env.DATABASE_TYPE`; every case other than `mysql`/`postgres`/`mariadb` falls through to the `default:` branch, which creates a **sqlite** database at `path.resolve(homePath, 'database.sqlite')` where `homePath` is `process.env.DATABASE_PATH ?? ~/.flowise` (`packages/server/src/DataSource.ts:90-100`, fallback path construction at `packages/server/src/DataSource.ts:16-23`). No Postgres/MySQL container or install needed for this session.

### Secrets — auto-generated and persisted, no manual pairing needed

- **Encryption key**: if `FLOWISE_SECRETKEY_OVERWRITE` is unset, `getEncryptionKey()` generates a new key and writes it to `~/.flowise/encryption.key` (or `$SECRETKEY_PATH/encryption.key`) on first use, then reads it back on subsequent boots (`packages/server/src/utils/index.ts:1553-1586`). No action needed.
- **JWT / session secrets**: `docker/.env.example:106-128` documents the same pattern — `JWT_AUTH_TOKEN_SECRET`, `EXPRESS_SESSION_SECRET`, `TOKEN_HASH_SECRET` can be left unset and fall back to file/AWS-backed storage rather than requiring you to hand-generate and pair values.
- **Enterprise license vars** (`LICENSE_URL`, `FLOWISE_EE_LICENSE_KEY`, `OFFLINE`) are empty by default (`docker/.env.example:137-139`) — this is what puts the instance in `Platform.OPEN_SOURCE` mode (see §3).

### What Dan must provide

1. **A local account** — email + password, created via a one-time signup screen (not a secret you configure in advance; see §3).
2. **At least one LLM provider credential** (e.g., an OpenAI API key), entered later through the Credentials screen in the UI, if the capture is meant to actually *execute* an Agentflow with a HumanInput node rather than just view the canvas — HumanInput nodes have a "Dynamic" description mode that calls a model (`packages/components/nodes/agentflow/HumanInput/HumanInput.ts:60-70`), and any surrounding Agent node needs a chat model credential regardless. **[speculative — not verified by running a flow]**: a "Fixed" description HumanInput node with no model dependency may work with zero credentials configured; untested here.
3. **A decision on whether Workspace/Roles screens are in scope** — if yes, Dan needs an actual Enterprise Edition license (`FLOWISE_EE_LICENSE_KEY`) from FlowiseAI; there is no way to unlock those screens locally without one (see §3, "enterprise-gated screens").

## 3. Enterprise-gated screens — checked, and confirmed gated

This directly answers the "may be enterprise-gated" question in the task brief.

**Platform detection**: with no `FLOWISE_EE_LICENSE_KEY` set, `IdentityManager` defaults `currentInstancePlatform` to `Platform.OPEN_SOURCE` and never changes it (`packages/server/src/IdentityManager.ts:45`, `103-109`).

**Feature flags are Enterprise/Cloud-only by construction**: `getFeaturesByPlan()` only populates a non-empty `features` map when the platform is `Platform.ENTERPRISE` (all flags in `ENTERPRISE_FEATURE_FLAGS` forced `'true'`, `packages/server/src/IdentityManager.ts:261-267`) or `Platform.CLOUD` with an active Stripe subscription; otherwise it returns `{}` (`packages/server/src/IdentityManager.ts:268-274`). `ENTERPRISE_FEATURE_FLAGS` explicitly includes `'feat:workspaces'` and `'feat:roles'` (`packages/server/src/utils/quotaUsage.ts:8-19`).

**Server-side enforcement**: the `/workspace` routes are wrapped in `IdentityManager.checkFeatureByPlan('feat:workspaces')` (`packages/server/src/enterprise/routes/workspace.route.ts:9-33`), which 403s any user whose `features` object doesn't contain that key set to `'true'` (`packages/server/src/IdentityManager.ts:277-290`) — and, unlike the plain RBAC `checkPermission`, there is **no** `isOrganizationAdmin` bypass here, so even the sole local admin account is blocked.

**Client-side enforcement (belt and suspenders)**: the Roles and Workspaces sidebar entries are both declared with a `display: 'feat:...'` gate (`packages/ui/src/menu-items/dashboard.js:214-241`), and their routes are wrapped in `<RequireAuth permission=... display={'feat:roles'}>` / `display={'feat:workspaces'}` (`packages/ui/src/routes/MainRoutes.jsx:304-334`) — so in open-source mode these don't even appear in the nav, and hitting the URL directly is blocked client-side too.

**Verdict: Workspace and Roles screens will not be reachable in a plain local `npx flowise` / Docker Hub-image bring-up.** Capturing UX for those specific screens requires a real `FLOWISE_EE_LICENSE_KEY` (`docker/.env.example:138`) — this repo can't produce one; it's an out-of-band ask to FlowiseAI.

**Organization screen** (`packages/ui/src/views/organization/index.jsx`) is *not* feature-flag-gated server-side (`packages/server/src/enterprise/routes/organization.route.ts:1-27` has no `checkFeatureByPlan` call), so it will load, but its actions are all Stripe billing/seat-management operations (`getAdditionalSeatsQuantity`, `updateSubscriptionPlan`, etc., same file) that are meaningless without a Cloud subscription — expect an empty/inert screen, not a genuinely enterprise-gated 403. Low value for this capture session either way.

**Screens confirmed NOT gated (safe to capture)**:
- **agentexecutions** (`/executions`) — route uses only RBAC `checkAnyPermission('executions:view', ...)` (`packages/server/src/routes/executions/index.ts:7-8`), no `display`/feature-flag wrapper on its `MainRoutes.jsx` entry. The lone open-source admin is `isOrganizationAdmin: true` by construction (see below) and bypasses RBAC checks entirely (`packages/server/src/enterprise/rbac/PermissionCheck.ts:9-11`).
- **marketplaces** (`/marketplaces`, templates tab) — same pattern: `checkPermission('templates:marketplace')` only (`packages/server/src/routes/marketplaces/index.ts:7`), no feature-flag gate, no `display` prop in the route table.
- **HumanInput node** — it's a standard Agentflow canvas node (`category: 'Agent Flows'`, `packages/components/nodes/agentflow/HumanInput/HumanInput.ts:22-24`), not gated behind any platform/queue-mode check found in `buildAgentflow.ts`. Reachable by opening any Agentflow canvas and dragging it in.

## 4. First-run account creation (not a config step — a UI flow)

Unlike Dify (self-registration with an empty `INIT_PASSWORD`), Flowise open-source has no pre-seeded admin. The very first page load routes to a signup screen (`packages/ui/src/views/auth/register.jsx`) hitting `POST /account/register` (`packages/server/src/enterprise/routes/account.route.ts:9`). For `Platform.OPEN_SOURCE`, the registration handler:

1. Enforces exactly one organization ever (`ensureOneOrganizationOnly`, throws `'You can only have one organization'` if one already exists) (`packages/server/src/enterprise/services/account.service.ts:181-183`).
2. Auto-creates a `Default Organization` and `Default Workspace`, assigns the new user the `OWNER` general role on both, and immediately activates the account — no email verification, no SMTP required (`packages/server/src/enterprise/services/account.service.ts:187-196`).
3. The `OWNER` role maps to `isOrganizationAdmin: true` on login (`packages/server/src/enterprise/middleware/passport/index.ts:183`), which is what lets this single account bypass every plain RBAC `checkPermission`/`checkAnyPermission` check (§3) — but *not* the feature-flag checks gating Workspaces/Roles.

So: open the app, fill in an email + password on the signup form once, and you're in as the de facto admin of the only organization/workspace this instance will ever have.

## 5. Known failure modes checklist

**Evidenced in this repo:**

1. **Node/pnpm version drift, path-dependent risk.** Declared range is `node ^24` (`package.json:99-101`, `packages/server/package.json:60-61`), `.nvmrc` pins `v24.15.0`, host has `v26.4.0`. For `npx flowise` / global `npm install -g flowise`, npm's own engine check is not overridden by this repo's `.npmrc:7` (`engine-strict = false` only applies to `pnpm install` inside this workspace) — **[speculative]** a global `npm install -g flowise` may itself warn or (with strict npm config) fail on the newer host Node; not tested end-to-end here. If it fails, `nvm install 24.15.0 && nvm use 24.15.0` before retrying is the fix.
2. **README's own Quick Start claims Node `>= 20.0.0`** (`README.md:39`) which is looser than the `package.json` engines field's `^24` — a documented inconsistency in the repo itself, not something this runbook introduced.
3. **Build-from-source OOM** — explicitly documented in-repo: `pnpm build` can exit with code 134 (heap OOM) on the full Turbo build; the fix is `export NODE_OPTIONS="--max-old-space-size=4096"` before rebuilding (`README.md:126-147`). Only relevant if the build-from-source path is chosen instead of the recommended `npx` path.
4. **Workspace/Roles screens will 403 + stay hidden from nav** without a real EE license — this is expected behavior, not a bug to troubleshoot around (§3).
5. **Docker path pulls `flowiseai/flowise:latest`** (`docker/docker-compose.yml:5`), an unpinned tag — version drift against this checkout's `3.1.3` is possible and untestable without actually pulling. Needs Docker Desktop running and outbound internet for the pull.

**Plausible but not directly evidenced — flag as [speculative]:**

6. **[speculative]** HumanInput node's "Dynamic" description mode and any Agent node feeding it require a working LLM credential; a flow with zero credentials configured may fail at execution time rather than at canvas-build time. Not verified by actually running a flow in this session (read-only analysis only).
7. **[speculative]** Marketplace template browsing may call out to a FlowiseAI-hosted template catalog rather than serving purely from `packages/server/marketplaces` bundled JSON (`packages/server/package.json` lists `marketplaces` as a packaged directory alongside `dist`, suggesting local bundling) — not confirmed which source the `/marketplaces/templates` endpoint actually reads from at runtime; if it's local-bundle-only, this works fully offline, if not, it needs outbound internet like Dify's marketplace tab did.

## 6. Exact bring-up sequence

```bash
# 1. Install Node 24 if the global npm install below fails on version check
#    (nvm install 24.15.0 && nvm use 24.15.0)

# 2. Install and start
npm install -g flowise
npx flowise start

# 3. Open the app
open http://localhost:3000
```

Verification checkpoints:

| Checkpoint | How to verify | What "healthy" looks like |
|---|---|---|
| Process up | terminal output from `npx flowise start` | log line indicating server listening on port 3000 |
| API responding | `curl -sf http://localhost:3000/api/v1/ping` | `200 OK` (this is the same endpoint the Docker Hub image's healthcheck uses, `docker/docker-compose.yml:155-160`) |
| First-run signup | open `http://localhost:3000` in a browser | redirected to a signup form (no pre-seeded login) |
| Account created | submit email + password on signup | redirected into the app shell, sidebar visible |
| agentexecutions reachable | click "Executions" in sidebar, or open `http://localhost:3000/executions` | table view loads, no 403 |
| marketplace reachable | click "Marketplace" in sidebar, or open `http://localhost:3000/marketplaces` | template gallery loads, no 403 |
| HumanInput node available | open/create an Agentflow canvas, search node palette for "Human Input" | node appears in "Agent Flows" category, drag-and-drop works |
| Workspace/Roles hidden | check sidebar | neither "Roles" nor "Workspaces" entries appear (confirms §3 without needing to hit a 403 directly) |

Teardown:

```bash
# Stop: Ctrl+C in the terminal running `npx flowise start`

# Full reset: delete all local data (sqlite DB, encryption key, uploaded files, logs)
rm -rf ~/.flowise
```

(If the Docker path was used instead: `docker compose down` from `docker/`, then `docker compose down -v` for a full volume wipe, per `docker/README.md:10`.)

## 7. Resource footprint estimate

**[speculative — no live measurement taken]**: this is a single Node/Express process serving a bundled React UI plus an embedded sqlite file, with no separate Postgres/Redis/vector-store containers needed for `MODE=main` (the default — `MODE=queue` is opt-in via `docker/.env.example:173` and not needed for a single-user session). Ballpark idle RAM: 300–600MB for the Node process, similar or somewhat higher during active LLM calls or a marketplace/plugin fetch (network-bound, not memory-heavy). If the Docker path is chosen instead of `npx`, add Docker Desktop's own macOS VM overhead — commonly another 1–2GB baseline, per the same pattern observed in the Dify runbook for this host. Recommend **2GB free RAM** as a safe floor for the recommended `npx` path — an order of magnitude lighter than Dify's 11-container stack, since Flowise's open-source single-user mode has no required sidecar services.

## Confidence

High confidence (roughly 85%) that the `npx flowise start` path works as described: the sqlite fallback, auto-generated secrets, open-source registration flow, and RBAC bypass for the sole admin are all confirmed directly in source rather than inferred from docs. The two genuine unknowns are both untestable without actually running the app in this session (read-only analysis only, per task scope): (a) whether a global `npm install -g flowise` enforces the `node ^24` engine range strictly enough to reject the host's `v26.4.0`, and (b) whether HumanInput/marketplace features make outbound network calls that would fail offline. The enterprise-gating finding (Workspace/Roles screens blocked without a license) is high confidence — verified independently at both the server route-guard layer and the client menu/route layer, with no bypass path found in either.
