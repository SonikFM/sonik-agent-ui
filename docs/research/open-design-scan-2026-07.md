# Open Design — architecture scan + marketplace value-scan

Date: 2026-07-12
Repo scanned: `/Users/danielletterio/Documents/GitHub/open-design` (nexu-io/open-design, Apache 2.0, MIT-adjacent OSS "Claude Design alternative")
Lens: `[[agent-marketplace-architect-lane]]` — does anything here change our `MarketplacePackageKind` design (`packages/tool-contracts/src/marketplace.ts`) or our MCP tool catalog conventions?

## 1. Architecture

Node 24 / pnpm monorepo. Three moving pieces:

- **`apps/daemon`** — a local Express-style HTTP daemon (default port `7456`), the single source of truth. Owns SQLite (better-sqlite3) for metadata (projects, conversations, runs) and a project-storage layer for file bytes. Spawns coding-agent subprocesses (Claude Code, Codex, OpenCode, 22 CLIs total — adapter table in `apps/daemon/src/agents.ts`) to actually generate designs.
- **`apps/web`** — Next.js 16 App Router UI, talked to the daemon over `/api/*` (dev-mode rewrite; prod the daemon serves the static export itself).
- **`apps/desktop`** — Electron-ish shell wrapping daemon+web as one app.

MCP is a *third, parallel* surface: `apps/daemon/src/mcp.ts` implements `od mcp`, a stdio MCP server any external coding agent (Claude Code in a different repo, Cursor, Codex) can attach to. It is stateless — every tool call is a `fetch()` proxy to the running daemon's HTTP API over `OD_DAEMON_URL`. If the daemon isn't running, the MCP server still starts (so `tools/list` works) but tool calls return a clear "daemon not reachable" error. This is the mode this Sonik session is actually running in (see §5).

Storage is two-tier and deliberately local-first:
- `apps/daemon/src/storage/daemon-db.ts` — SQLite by default; `OD_DAEMON_DB=postgres` is a **stub** gated behind an explicit adapter interface (`DaemonDbConfig`), throws clearly if misconfigured rather than silently dropping writes. The seam exists for a future multi-replica deploy; nothing today exercises it.
- `apps/daemon/src/storage/project-storage.ts` — `ProjectStorage` interface (`readFile`/`writeFile`/`listFiles`/`deleteFile`/`statFile`, keyed by `projectId` + relpath). `LocalProjectStorage` (flat disk, default) is a thin wrapper over pre-existing `apps/daemon/src/projects.ts` helpers; `S3ProjectStorage` is a stub for cloud parity, opt-in via `OD_PROJECT_STORAGE=s3`.

The split matters: SQLite indexes metadata, but actual project files live as **plain files on disk** — HTML/JSX/CSS plus a `DESIGN.md` brand-contract file per project. That's why 22 different file-native coding-agent CLIs can operate on an OD project without a custom SDK: they just `cd` into the project directory and read/write like any repo.

## 2. MCP tool design — comparison to our command catalog

`apps/daemon/src/mcp.ts` declares 17 tools (`list_projects`, `get_active_context`, `get_artifact`, `get_project`, `get_file`, `search_files`, `list_files`, `create_artifact`, `write_file`, `delete_file`, `delete_project`, `create_project`, `list_skills`, `list_plugins`, `start_run`, `get_run`, `cancel_run`, `list_agents`). Three patterns worth noting against our own command-catalog/approval work (`[[a2-reservation-commit-deploy-gate]]`, `[[host-context-envelope-size-budget]]`):

- **Shared annotation constants.** `READ_ANNOTATIONS`/`WRITE_ANNOTATIONS` objects (`readOnlyHint`, `idempotentHint`, `openWorldHint`, `destructiveHint`) are spread into every tool def instead of repeated per-tool. `delete_project` additionally sets `destructiveHint: true` and requires *both* an explicit project id (no active-context fallback) *and* a literal `confirm: true` — the same "irreversible ops need an explicit non-defaultable target plus a confirm flag" shape our `marketplacePermissionGrantSchema.superRefine` enforces for write/destructive/external grants (`packages/tool-contracts/src/marketplace.ts:101-108`). Good cross-validation, nothing to change.
- **"Active context" defaulting.** Most read tools accept an optional `project` (and `get_file`/`get_artifact` additionally `entry`/`path`) that default to whatever the user has focused in the OD desktop app, with a 5-minute expiry. Every response threads back `usedActiveContext`/`resolvedProject` so the calling agent can confirm what it actually hit, and the server's `instructions` block tells the model explicitly not to ask the user "which project" first. This is a genuinely useful pattern for reducing round-trips in a multi-project host — worth remembering if Sonik ever needs a "the workspace the human currently has open" default for agent tool calls, though we don't have an equivalent notion of a focused workspace today.
- **Discovery vs. commissioned execution.** `list_skills`/`list_plugins` are pure discovery — the calling agent never runs a skill itself. It calls `start_run(prompt, skill|plugin, inputs, agent, model)`, gets a `runId` back immediately, and polls `get_run(runId)` (queued→running→succeeded/failed/canceled) while the **daemon spawns its own agent subprocess** to do the work (`apps/daemon/src/mcp.ts:1074-1159`). The tool's `instructions` string is explicit and repeated: runs take 5–30 minutes, do not `cancel_run` out of impatience, do not substitute `write_file` as a "faster" workaround because that throws away pipeline quality. This is an async-job-over-MCP pattern (start → poll → terminal state with `previewUrl`/`agentMessage`) that maps cleanly onto our own `workflow.previewRun` / `workflow.runApproved` split in `docs/contracts/marketplace-package-contracts-v0.md:87-89` — if we ever expose a long-running generation command through the MCP surface (not just workflow nodes), this is the shape to copy: return a job id immediately, no tool blocks on daemon-internal work.
- **Model-facing payload discipline.** `listPlugins`/`listAgents` deliberately flatten the daemon's internal record (16+ fields — `fsPath`, `sourceMarketplaceId`, `installedAt`, `resolvedSource`, …) down to `id`/`title`/`description`/`kind`/`tags` before returning to the calling agent, with an inline comment explaining why (`apps/daemon/src/mcp.ts:1002-1057`). Directly relevant to `[[host-context-envelope-size-budget]]` — same "don't leak internal representation into the token-priced response" discipline we already apply to `approvedCommandIds`.

## 3. Plugin/artifact model — comparison to `artifact_template` / marketplace package kinds

Spec: `plugins/spec/SPEC.md`, example manifest: `plugins/spec/examples/create-prototype-dashboard/open-design.json`.

A minimal OD plugin is a directory with `SKILL.md` (portable YAML-frontmatter `name`+`description`, works standalone in any agent). An "enriched" plugin adds `open-design.json`: `$schema`/`specVersion`/`name`/`title`/`version`/`description`/`license`/`tags`/`compat.agentSkills[].path`, then an `od` namespace —

- `taskKind`: `new-generation | figma-migration | code-migration | tune-collab`
- `mode`: `prototype | deck | live-artifact | image | video | hyperframes | audio | design-system`
- `useCase.query` (i18n-able natural-language brief template)
- `pipeline.stages[]` — `{id, atoms[], repeat?, until?}`, atoms drawn from a fixed first-party vocabulary (`discovery-question-form`, `direction-picker`, `todo-write`, `file-write`, `live-artifact`, `critique-theater`, `handoff`, …)
- `inputs[]` — `{name, type, required, default, label}`
- `capabilities[]` — `prompt:inject | fs:read | fs:write | mcp | subprocess | bash | network | connector | connector:<id>`
- `genui.surfaces[]` — `form | choice | confirmation | oauth-prompt`, each with a persistence scope (`run | conversation | project`)

The `pipeline.stages[].atoms[]` shape is worth comparing to our `WorkflowDefinition`/`workflow_graph` runtime mode — both are "named stages built from a closed vocabulary of typed steps," and OD's `until: "critique.score>=4 || iterations>=3"` repeat-guard on a stage is a concrete precedent for bounded-loop workflow nodes if we ever add one.

**Artifact manifest** (`packages/contracts/src/api/artifacts.ts:94-134`) is instance-provenance-shaped, not template-shaped: `kind` (html/deck/react-component/markdown-document/svg/diagram/code-snippet/mini-app/design-system), `renderer`, `exports[]`, a first-class `status: streaming|complete|error` (interesting — most artifact models treat "still generating" as an implicit UI state, OD makes it part of the manifest), `supportingFiles[]`, then a provenance block (`sourcePluginId`, `sourcePluginVersion`, `sourceTaskKind`, `sourceRunId`, `sourceProjectId`, `parentArtifactId`) plus **three separate taxonomies** for what the artifact is: `artifactKind` (html-prototype/deck/interactive-video/design-system/code-diff/production-app/asset-pack), `renderKind` (html/jsx/pptx/markdown/video/image/diff/repo), and `handoffKind` (**design-only / implementation-plan / patch / deployable-app**). Plus `exportTargets[]`/`deployTargets[]` — a history log of where the artifact has been exported/deployed to (provider/location/timestamp), not just a static field.

Our `artifactTemplateDefinitionSchema` (`packages/tool-contracts/src/marketplace.ts:331-346`) is much thinner by design — it describes the *rendering contract* a template exposes (`mode: json_render|document|html_escape_hatch`, `jsonRenderSpecRef`, `stateSchemaRef`, `htmlPresentation`), not a generated instance's history. Different axis, both needed, no contradiction. **One steal-candidate**: OD's `handoffKind` (design-only/implementation-plan/patch/deployable-app) is a genuinely useful field we don't have anywhere — it tells a downstream consumer what kind of follow-on work an artifact instance implies. If Sonik ever tracks generated JSON-render app *instances* (not just templates) this is worth adding as a field there, not on `artifact_template` itself.

## 4. Registry / trust model

`packages/registry-protocol/src/schemas.ts` + `plugins/registry/{official,community}/open-design-marketplace.json`. `RegistryTrust`: `official | trusted | restricted`. `RegistryBackendKind`: `github | http | local | db`. `RegistryEntry` carries `dist` (archive+`integrity`+`manifestDigest`), `versions[]`, `distTags`, `publisher` (id/name/github/url/**verified**), `metrics` (downloads/installs/stars), and `signatures[]` with an explicit `kind: github-oidc | cosign | minisign | custom` + issuer/subject/signature/certificate.

This lines up closely with our own `marketplacePublisherSchema` (`sonik|organization|creator|partner|managed_internal`) and `manifestHash`/`sha256Schema` invariant already in `docs/contracts/marketplace-package-contracts-v0.md` — mostly validation, not new information. The one concrete thing we don't have modeled yet: an explicit **signature-kind enum** (`github-oidc | cosign | minisign | custom`) for provenance attestation on package versions. Worth a look if/when Sonik marketplace package signing gets designed — OD's is a small, copyable shape.

## 5. Bring-up — how to inspect/restart

**Contrary to the task assumption, the daemon is not currently running on this machine** — confirmed both `lsof -i :7456` and `ps aux | grep open-design` came back empty, and the four MCP tool calls I made (`list_projects`, `get_active_context`, `list_plugins`, `list_agents`) all failed with `cannot reach the Open Design daemon at http://127.0.0.1:7456`. The `od mcp` stdio server itself is alive (it started and served `tools/list`), it just has nothing to proxy to.

To bring it up (from `QUICKSTART.md:175-213`; `pnpm tools-dev` is the **only** supported local lifecycle entrypoint — legacy root aliases like `pnpm dev`/`pnpm daemon`/`pnpm start` are explicitly removed):

```bash
pnpm tools-dev                 # daemon + web + desktop, background
pnpm tools-dev run web         # daemon + web, foreground
pnpm tools-dev status          # inspect managed runtimes
pnpm tools-dev logs            # daemon/web/desktop logs
pnpm tools-dev check           # status + recent logs + common diagnostics
pnpm tools-dev restart --daemon-port 7457 --web-port 5175   # if port conflicts
pnpm tools-dev stop
curl -s http://127.0.0.1:7456/api/health                    # once up
```

Once running, the MCP tools in this session (`mcp__open-design__*`) should resolve immediately — no reconnect needed on the Claude Code side since the stdio server already started; it just needs the HTTP daemon to answer.

**UI worth capturing**: I did not browse it live (daemon down, and this was scoped read-only/no bring-up). `README.md` documents six product surfaces with screenshots checked into `docs/screenshots/` and hosted thumbnails: Home (skill+design-system+brief picker), Automation, Design System (`DESIGN.md` brand-contract editor), Plugin browser, Integrations (MCP server picker), and Studio's four artifact-type views (Prototype/HyperFrame/Deck/Image). If a live UI capture is wanted later, bring the daemon up first via the commands above, then `pnpm tools-dev run web` and hit whatever port it prints.

## 6. `mcp_addon` manifest sketch — Open Design as an installable Sonik package

Our `mcpAddonDefinitionSchema` (`packages/tool-contracts/src/marketplace.ts:348-355`) is `{addonId, title, serverRef, requiredScopes[], credentialRefKind: none|vault_ref|host_managed}`. Sketch for wrapping OD's `od mcp` stdio server as an installable addon:

```json
{
  "packageId": "open-design-mcp",
  "kind": "mcp_addon",
  "currentVersionId": "open-design-mcp@0.13.0",
  "publisher": { "publisherId": "nexu-io", "displayName": "Open Design", "type": "partner" },
  "runtimeCapabilities": {
    "jsonRenderCanonical": false,
    "htmlEscapeHatch": true,
    "sandboxRuntime": true,
    "commandBackedComponents": false,
    "requiresHostContext": true,
    "requiresTrustedApproval": false
  },
  "mcpAddon": {
    "addonId": "open-design",
    "title": "Open Design (local design workspace)",
    "serverRef": "stdio:od mcp",
    "requiredScopes": ["od:projects:read", "od:artifacts:read", "od:projects:write", "od:runs:start"],
    "credentialRefKind": "host_managed"
  }
}
```

**Verdict: mostly fits, one real gap.** `serverRef` as a bare string works fine for OD's case (stdio, spawn `od mcp`, no daemon auth), but it can't express what OD's *own* MCP-client config (`packages/contracts/src/api/mcp.ts:12-45`, `McpServerConfig`) already models explicitly: a `transport: stdio|sse|http` discriminator plus, for HTTP/SSE, a daemon-managed OAuth flow (`authMode: none|oauth`) with tokens persisted server-side and injected as `Authorization: Bearer` headers per spawn. If Sonik only ever wraps stdio addons, `serverRef` is enough. The moment we want to install an **HTTP or SSE** MCP addon (most hosted MCP servers today — Higgsfield, Composio, etc. — are HTTP/SSE, not stdio), `mcp_addon` needs a transport field and an auth-mode enum, because `credentialRefKind: host_managed` today just means "the host manages it somehow" and doesn't distinguish "no auth needed" from "daemon-owned OAuth token store" the way OD's `authMode` does. Our `requiredScopes[]` is genuinely *more* explicit than anything OD models (their scopes are implicit inside the OAuth flow) — that's a point in our favor, keep it.

Separately: `start_run`/`get_run` is a spawn-a-subprocess, consumes-API-credits operation — under our `marketplaceCommandEffectSchema` it should be classified `effect: "external"`, which per `marketplacePermissionGrantSchema`'s `superRefine` (line 101-108) forces `approvalPolicy: preview_then_trusted_approval` and a non-empty `requiredHostContext`. That's the correct classification if we ever gate an OD `start_run` call behind our approval flow — not a schema gap, just noting it so a future integrator doesn't mis-tag it `write` (which OD's own `WRITE_ANNOTATIONS` on `start_run` implies but understates — it's not merely a local write, it spawns an external agent process).

## 7. Steal-candidates (file paths)

| Idea | Source | Why |
| --- | --- | --- |
| Shared `READ_ANNOTATIONS`/`WRITE_ANNOTATIONS` constants spread into tool defs | `apps/daemon/src/mcp.ts:130-141` | Cuts per-tool boilerplate; we should do the same if our MCP tool defs don't already. |
| "Active context" default + `resolvedProject`/`usedActiveContext` echo pattern | `apps/daemon/src/mcp.ts:148-151`, `751-948` | Reusable if Sonik ever needs a "workspace the human currently has focused" default for agent tools. |
| Start-job-then-poll pattern for long-running generation, with explicit anti-impatience instructions baked into the tool description | `apps/daemon/src/mcp.ts:1069-1159` | Template for exposing `workflow.runApproved`-style long ops over MCP without blocking. |
| Flatten-internal-record-before-returning-to-model discipline | `apps/daemon/src/mcp.ts:1002-1057` | Same discipline as `[[host-context-envelope-size-budget]]`; good cross-validation. |
| `handoffKind` taxonomy on generated artifacts (design-only/implementation-plan/patch/deployable-app) | `packages/contracts/src/api/artifacts.ts:58-62` (OD side) | Worth adding to a future Sonik "generated app instance" record, not `artifact_template` itself. |
| Adapter-interface seam pattern (ship local default now, stub the cloud backend behind an explicit interface + env-var switch) | `apps/daemon/src/storage/daemon-db.ts`, `apps/daemon/src/storage/project-storage.ts` | Clean local-first-now/cloud-later precedent if Sonik ever needs the same for any local-first surface. |
| `transport` + `authMode` discriminators on MCP server config | `packages/contracts/src/api/mcp.ts:12-45` | Direct input to closing the `mcp_addon.serverRef` gap noted in §6 if/when HTTP/SSE addons are needed. |
| Explicit signature-kind enum for package provenance (`github-oidc\|cosign\|minisign\|custom`) | `packages/registry-protocol/src/schemas.ts:35-43` | Copyable shape if Sonik designs package signing. |
| `DESIGN.md` as a plain-file, agent-editable "brand contract" per project (not hidden DB state) | Referenced throughout `README.md`, `AGENTS.md` | Local-first pattern: keep the thing agents most need to read/edit as a plain file in the tree, not behind an API. |

## Top findings summary

1. **MCP surface**: 17 stateless proxy tools over a local HTTP daemon, with shared read/write annotation constants, an "active context" default-and-echo pattern, and a start-job/poll pattern for long-running generation (agent never runs a skill itself — it commissions the daemon's own spawned agent). All directly comparable to, and mostly validating, our existing command-catalog conventions.
2. **Artifact model**: instance-provenance-shaped (status/provenance/handoffKind/exportTargets history), not template-shaped like our `artifact_template`. `handoffKind` (design-only/implementation-plan/patch/deployable-app) is the one field worth stealing, for a future generated-instance record rather than the template schema.
3. **Local-first storage**: two-tier — SQLite metadata index (with a stubbed Postgres adapter seam) + plain files on disk (with a stubbed S3 adapter seam) — is why 22 different file-native coding CLIs can operate on OD projects with zero custom SDK.
4. **`mcp_addon` manifest verdict**: fits for a stdio-transport addon like `od mcp` itself with only cosmetic sketching needed. It does **not** yet cover HTTP/SSE MCP servers with daemon-managed OAuth, which is the majority of real-world hosted MCP servers — recommend adding a `transport` + `authMode` pair to `mcpAddonDefinitionSchema` before onboarding any non-stdio addon.
5. **Bring-up**: daemon is currently **down** on this machine (confirmed via `lsof`/`ps` and four failed MCP calls), contrary to the assumption it was already running. `pnpm tools-dev` is the sole lifecycle entrypoint; `pnpm tools-dev run web` (foreground) or `pnpm tools-dev` (background) brings it up, `pnpm tools-dev status|logs|check` diagnose it.
