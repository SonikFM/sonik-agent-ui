# Onyx value-scan (Sonik lens) — 2026-07

Local repo: `/Users/danielletterio/Documents/GitHub/onyx`
Read-only scan. No code changed in onyx.

## Current state

- **What it is**: "Onyx - The Open Source AI Platform" — a chat-first app layer over LLMs with RAG, agents/personas, 50+ indexing connectors, MCP actions, deep research, code execution, voice, image gen. MIT license.
- **Remote**: `origin` → `https://github.com/onyx-dot-app/onyx.git`
- **HEAD**: `3deadb6bce fix(open_url): resolve type-ambiguous Google Drive links to indexed docs (#12892)` — tip of `main`, actively developed (PRs in the #128xx range).
- **Version**: no top-level VERSION file; only `.python-version`. Version is carried via `IMAGE_TAG` in the compose env (`env.template:12`, defaults to `latest`) and release tags on GitHub (README references `v3.0.0` demo GIF).
- **Stack**: FastAPI/Python backend (`backend/`), Next.js/React web app (`web/`, uses `bun.lock` + a `@opal/utils` internal component-lib alias), Postgres, OpenSearch (their search index, not Vespa despite a stale comment in `docker-compose.resources.yml` referencing `VESPA_*` — worth noting as a doc-drift artifact, not something to copy), Redis, MinIO, separate inference/indexing model servers, nginx front door. Also has a `cli/`, `desktop/` (Electron?), `mobile/`, `widget/`, `extensions/`, `loadtest/`, `profiling/`.

## Connector framework — compare to our capability registry

- **Interface**: `backend/onyx/connectors/interfaces.py` — `BaseConnector(abc.ABC, Generic[CT])` is the root; connectors implement mixins (`LoadConnector`, `PollConnector`, `CheckpointedConnector`, `EventConnector`, `CredentialsConnector`) to declare which invocation modes they support (one-shot load, incremental poll, checkpointed resumable poll, event-driven). `InputType` enum in `connectors/models.py` gates which mode a given connector accepts.
- **Registration**: `backend/onyx/connectors/registry.py` — a flat dict `CONNECTOR_CLASS_MAP: dict[DocumentSource, ConnectorMapping]` mapping a `DocumentSource` enum value to `(module_path, class_name)`. No decorator/plugin-discovery magic — it's a hand-maintained static map, ~50 entries (Slack, Jira, Confluence, Google Drive, Salesforce, Zendesk, Notion, Linear, Gmail, GitHub, Gitlab, Sharepoint, Teams, Discord, IMAP, Bitbucket, HubSpot, Asana, Airtable, Braintrust, Freshdesk, Guru, Fireflies, Gong, etc. — full list at `backend/onyx/connectors/*` dirs).
- **Instantiation/lazy-load**: `backend/onyx/connectors/factory.py` — `_load_connector_class()` does `importlib.import_module` on first use and caches in a module-level dict, so the ~50 connector packages aren't all imported at boot. `instantiate_connector()` validates the requested `InputType` against the class's mixins before construction, then wires an `OnyxDBCredentialsProvider` if the connector implements `CredentialsConnector`.
- **Scheduling/execution**: lives under `backend/onyx/background/celery/tasks/indexing` and `backend/onyx/background/indexing` — Celery-based, not something built into the connector classes themselves. Didn't deep-dive scheduling internals (out of scope for this pass); flag as a follow-up if we want cron/poll-interval parity details.
- **Steal-candidate**: the `DocumentSource` enum + static `CONNECTOR_CLASS_MAP` + lazy `importlib` loader is a clean, boring pattern for a capability registry that needs to stay import-light at boot but still be statically greppable/typed. Compares favorably to anything dynamic-discovery-based. Mixin-based capability declaration (`LoadConnector`/`PollConnector`/`CheckpointedConnector`/`EventConnector`) is a reasonable model for "what modes does this integration support" that maps onto our own capability_profiles/runtime_mode vocabulary in amp.pkg.
  - `backend/onyx/connectors/interfaces.py`
  - `backend/onyx/connectors/registry.py`
  - `backend/onyx/connectors/factory.py`

## Agent/assistant model

- Called "Personas" internally (UI-facing term is "Agents" — `web/src/app/admin/agents/page.tsx`). CRUD/query surface lives in `backend/onyx/db/persona.py` (~30 functions): creation (`create_update_persona`), sharing (`apply_persona_user_share_diff`, `update_persona_shared`, `resolve_desired_user_shares`), public/private visibility (`update_persona_public_status`), ownership transfer (`transfer_persona_ownership` + validation), paginated/minimal snapshot fetches for list views, and soft-delete (`mark_persona_as_deleted`).
- Sharing is modeled as its own concern in `backend/onyx/db/persona_sharing.py`, separate from the core persona CRUD — a reasonable split if we ever formalize "who can use/edit/see this agent."
- Tools/actions attach to personas via `backend/onyx/tools/` (`tool_constructor.py`, `built_in_tools.py`, `tool_runner.py`) and MCP-specific wiring under `backend/onyx/mcp_server/tools`. Admin UI for actions: `web/src/app/admin/actions/` (list, new, edit, edit-mcp, mcp, open-api — so agents can be given either built-in tools, custom OpenAPI-defined tools, or MCP servers).

## Chat UX patterns worth further porting

- **Confirmed donor already in use**: `web/src/sections/chat/ChatScrollContainer.tsx` (408 lines) — the follow-mode scroll behavior we already ported. Exposes `ChatScrollContainerHandle.scrollToBottom()`, tracks `ScrollState {isAtBottom, hasContentAbove, hasContentBelow}`, and resets on `sessionId` change. Pairs with `web/src/components/chat/ScrollContainerContext.tsx` for context propagation to child message components.
- **Not yet ported, worth a look**:
  - `web/src/components/chat/DynamicBottomSpacer.tsx` — likely solves the "keep last message from being covered by a fixed input bar" sizing problem; small and self-contained enough to be a quick steal.
  - `web/src/components/chat/MinimalMarkdown.tsx` (+ its own `.test.tsx`) — a trimmed-down markdown renderer for chat streaming, presumably faster/safer than a full markdown lib for streamed tokens. Worth comparing against whatever we use today for streamed assistant text.
  - `web/src/components/chat/FederatedOAuthModal.tsx` and `MCPApiKeyModal.tsx` — in-chat credential-collection modals (federated connector OAuth, MCP server API keys) triggered mid-conversation when a tool needs auth. Relevant if we ever want "agent asks for a credential inline" UX rather than forcing a trip to admin settings first.
- Everything under `web/src/sections/chat/` and `web/src/components/chat/` is small (7-8 files at this level — most of the chat UI complexity is presumably nested deeper under `sections/chat/*` subfolders not enumerated here).

## Admin console — enumeration for benchmarking

Top-level sections under `web/src/app/admin/` (plus an `ee/admin` tier for paid features):

- **Connectors/indexing**: `add-connector`, `connectors/[connector]`, `connector/[ccPairId]`, `indexing/status`, `federated/[id]` (federated = query-time connectors vs. index-time)
- **Agents/actions**: `agents`, `actions` (+ `edit`, `edit-mcp`, `mcp`, `new`, `open-api` subpages), `bots` (+ `[bot-id]`, `new` — likely Slack/Discord bot configs), `discord-bot/[guild-id]`
- **Documents**: `documents`, `documents/explorer`, `documents/feedback`, `documents/sets`
- **Model/behavior configuration**: `configuration/language-models`, `configuration/chat-preferences`, `configuration/code-interpreter`, `configuration/craft`, `configuration/document-processing`, `configuration/image-generation`, `configuration/index-settings`, `configuration/voice`, `configuration/web-search`
- **Access/identity**: `users`, `groups` + `groups2` (looks like a v1→v2 migration in progress, both present), `sso-providers`, `scim`, `security`, `service-accounts`
- **Ops/observability**: `systeminfo`, `tracing`, `debug`, `hooks`, `token-rate-limits`, `billing`

This is a genuinely comprehensive admin surface — connectors, agents/tools, document lifecycle, model config, identity/access, and ops all get first-class top-nav sections rather than being buried in settings. Useful as a shape reference when benchmarking our own admin console's coverage gaps (we don't currently spot-check against this repo, so treat this list as a checklist of admin surface *categories* to compare against, not a recommendation to copy their IA wholesale).

## Permissions/access model (surface-level only — not a credential deep-dive)

- Document-level ACL lives in `backend/onyx/access/access.py` via a `DocumentAccess` model built from: `user_emails`, `user_groups`, `external_user_emails`, `external_user_group_ids`, and an `is_public` flag (`PUBLIC_DOC_PAT` sentinel). Functions exist for both single-document (`get_access_for_document`) and batch (`get_access_for_documents`) lookups, plus a per-user ACL set (`get_acl_for_user`).
- Connector-level access mode is a separate, coarser enum: `AccessType` in `backend/onyx/db/enums.py:230` (values not enumerated in this pass — flag for follow-up if needed) — governs whether a connector's docs sync permissions from the source system or are public/private at the connector level (`source_should_fetch_permissions_during_indexing()` in `access.py` suggests some sources support permission sync during indexing, others don't).
- User-file and persona-attached-file access have their own helper functions (`user_can_access_chat_file`, `_user_can_access_persona_attached_file`, `_user_can_access_connector_file`) — access checks are file/object-scoped rather than one global ACL check, which tracks with them having several distinct storage surfaces (indexed docs, user-uploaded chat files, persona knowledge files).
- This is a glance only, per the assignment — no read of the actual permission-sync connector logic, group-membership resolution, or the `ee/` enterprise permission code.

## Bring-up runbook (Apple Silicon macOS)

Environment already has Docker Desktop 28.4.0 / Compose v2.39.4 / arm64 — no new tooling needed.

**Minimum profile — "Onyx Lite"** (`deployment/docker_compose/docker-compose.onyx-lite.yml`, an overlay on the base `docker-compose.yml`): drops OpenSearch, both model servers, Redis, MinIO, and the Celery background worker. Connectors and RAG search are disabled in this mode; core chat (LLM conversations, tools, file uploads, Projects, Agent knowledge, code interpreter) still works. Backed entirely by Postgres for cache/auth/file-store (`DISABLE_VECTOR_DB=true`, `FILE_STORE_BACKEND=postgres`, `CACHE_BACKEND=postgres`, `AUTH_BACKEND=postgres`).

```
cd deployment/docker_compose
cp env.template .env   # edit POSTGRES_PASSWORD, USER_AUTH_SECRET at minimum
docker compose -f docker-compose.yml -f docker-compose.onyx-lite.yml up -d
```

- **Ports**: nginx is the only exposed entrypoint — `${HOST_PORT_80:-80}:80` and `${HOST_PORT:-3000}:80` (so `http://localhost:3000` works out of the box; port 80 also bound, will conflict if something else on the host holds it). No other service ports are exposed by default (api_server, postgres, redis, minio all have their `ports:` blocks commented out in the base compose — only reachable inside the compose network unless uncommented).
- **RAM**: no hard numbers in Lite-mode docs beyond "under 1GB" claimed in the README for Lite specifically. The `docker-compose.resources.yml` overlay (optional, limits are commented out by default) shows what Onyx considers "generous" ceilings for the *full* stack: background worker 6 CPU / 10GB mem, api_server 2 CPU / 4GB mem, nginx 1 CPU / 1GB mem, inference_model_server 5GB mem — so full-stack realistically wants double-digit GB of RAM if you turn everything on; Lite mode is the only profile likely to be comfortable on a laptop without dedicating serious resources.
- **What Dan must provide**: an LLM API key (Anthropic/OpenAI/etc. — configured post-boot through the admin UI at `/admin/configuration/language-models`, not an env var in `env.template`) and, if going beyond Lite, credentials for whichever connectors we want to test (Slack app token, Google OAuth client, Confluence API token, etc. — connector-specific, configured per-connector in `/admin/connectors`). `env.template` itself only needs Postgres creds and `USER_AUTH_SECRET` filled in to boot Lite mode; `AUTH_TYPE=basic` by default so no SSO setup required for a first look.
- **Selective service opt-in** (all still available as compose profiles on top of Lite, if we want to test connectors/indexing without going full prod): `--profile vectordb`, `--profile inference`, `--profile background` (needs `--profile redis` too), `--profile redis`, `--profile opensearch`, `--profile s3-filestore`.
- Full install script exists too (`curl -fsSL https://onyx.app/install_onyx.sh | bash` per README, or `deployment/docker_compose/install.sh` locally) but it targets the full prod-shaped stack, not Lite — for a quick local look, the two-file `docker compose -f ... -f ...onyx-lite.yml up -d` command above is the faster path.

## Confidence

High confidence on repo state, connector framework, and Lite-mode bring-up (all read directly from source/compose files, cross-checked against comments and README). Medium confidence on the admin-console enumeration (directory names only — did not open each page to confirm what's actually implemented vs. scaffolded) and on the permissions summary (intentionally surface-level per scope; `AccessType` enum values and the `ee/` permission-sync internals are unread). Scheduling/Celery internals for connector polling were not traced end-to-end — flag as a follow-up if we need cron-interval parity specifics.
