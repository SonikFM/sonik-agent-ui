# Sonik Agent UI

Sonik Agent UI is a modular SvelteKit agent workspace for embedding a production-oriented AI assistant inside Sonik, Amplify, booking surfaces, or any host application that can donate safe page context. The v0.1 baseline combines a streaming chat surface, a live artifact canvas, JSON-rendered UI artifacts, a document editor island, signed host context, a deterministic command registry, and cloud-ready workspace persistence.

The product direction is deliberately **copy/retrofit first**: when a best-in-class scaffold already exists, copy the exact source into a reviewable boundary, preserve behavior, then adapt it behind Sonik contracts. Do not recreate working UI primitives from scratch unless the source boundary is missing, unsafe, or impossible to integrate.

## What this repo is

This repo is the standalone and embeddable Agent UI runtime. It can run as:

1. **Hosted Agent UI** — a Cloudflare Worker/SvelteKit app loaded by host apps through an iframe and `@sonik-agent-ui/agent-embed`.
2. **Standalone workspace** — a local or hosted SvelteKit app for chat + artifacts + document workflows.
3. **SDK seam** — typed packages that Sonik/Amplify/booking hosts can import to mount the UI, donate page context, validate commands, and run smoke tests.

The current production target is a hosted Agent UI, e.g. `agent-ui.sonik.fm` or a Worker preview URL, embedded into Amplify and the Sonik booking app with signed host context and organization-scoped persistence.

## Core v0.1 capabilities

### 1. Embeddable chat and canvas shell

- `@sonik-agent-ui/agent-embed` exports the host-side one-liner seam, centered on `mountSonikAgentUI(...)`.
- Host apps provide real DOM slots/buttons plus a `getPageContext()` provider.
- The embed supports three intents:
  - `chat` — right-side sidecar that compresses the host layout instead of covering it.
  - `canvas` — full workspace modal for artifacts/documents.
  - `workspace` — normalized to the richer canvas mode.
- Host controls are annotated with `data-sonik-agent-ui-control` and `data-testid` for deterministic testing.
- The SDK posts sanitized context via `postMessage` and responds when the iframe requests fresh page context.

### 2. Signed host context and page awareness

The agent can know the page it is embedded on through a sanitized machine-readable page context. Host context is split into two classes:

- **Display/page context** from the browser: route, title, surface, page type, active entity, visible actions, command families, skill families, theme, warnings, errors.
- **Trusted host context** from the host/server: authenticated state, user/session identity, organization ID, scopes, signed metadata.

Important constants and types live in `packages/agent-embed` and `apps/standalone-sveltekit/src/lib/server/workspace-services.ts`:

- Header: `x-sonik-agent-ui-host-context`
- Signature version: `sonik.agent_ui.host_context.hmac.v1`
- Message source: `sonik-agent-ui-host`
- Message type: `sonik:agent-ui:page-context`
- Request type: `sonik:agent-ui:request-page-context`

Browser page context is useful context for the model, but it must **never** be treated as authority for writes. Cloud writes are authorized through trusted/signed host context only.

### 3. Streaming chat

- `apps/standalone-sveltekit` uses the Vercel AI Gateway SDK through `@ai-sdk/gateway`.
- Model selection is environment-driven through `AI_GATEWAY_MODEL`.
- The AI Gateway token is a secret: `AI_GATEWAY_API_KEY`.
- Streaming is guarded by app-side safety/telemetry paths so crashes are testable instead of silent.
- The visible chat can stream normal text, tool call summaries, artifact creation, document creation, and command registry responses.

### 4. Artifact canvas

The canvas is the central workspace, not a decorative preview. v0.1 supports:

- JSON-render artifacts with a typed component catalog.
- Document artifacts backed by the workspace document editor island.
- Artifact promotion from chat into the canvas.
- Artifact/document versioning and reload restoration when cloud persistence is available.
- Canvas controls for preview/document/edit JSON/inspector/raw/fullscreen/clear depending on artifact type.
- Validation-first JSON artifact creation; invalid empty or malformed specs are rejected instead of rendering undefined UI.

### 5. Workspace document editor island

The document editor was copied/retrofitted from an upstream workspace document-editor scaffold because its tab model, markdown/HTML/code switching, import/export flows, and light document UX were the desired baseline. In v0.1 it is mounted as an isolated document island inside the artifact canvas and supports:

- Markdown and HTML document rendering.
- Multiple tabs.
- Import from library/device.
- Export markdown, Word, PDF/print-oriented flows where supported by the copied scaffold.
- Agent-created and agent-updated document artifacts.

Long-term, this becomes Sonik-owned source with a clean document model and styling surface, but the initial behavior was intentionally preserved through copy/retrofit to avoid transfer loss.

### 6. Cloud-ready workspace persistence

The cloud persistence package is `@sonik-agent-ui/workspace-session`. PostgreSQL migrations live in:

- `packages/workspace-session/migrations/postgres/0001_agent_workspace_persistence.sql`
- `packages/workspace-session/migrations/postgres/0002_agent_workspace_access_grants.sql`

Tables are under the `sonik_agent_ui` schema:

- `agent_workspace_sessions`
- `agent_workspace_messages`
- `agent_workspace_documents`
- `agent_workspace_document_versions`
- `agent_workspace_artifacts`
- `agent_workspace_artifact_versions`
- `agent_workspace_tool_calls`
- `agent_workspace_layout_snapshots`
- `agent_workspace_page_context_snapshots`
- `agent_workspace_telemetry_events`
- `agent_workspace_access_grants`
- `agent_workspace_access_grant_audit`

The migration contract is explicit: runtime code must set `app.organization_id` and `app.user_id` from trusted server-side auth/org context before touching these tables. Browser page context is display-only.

### 7. Command registry and tool manifests

The v0.1 command system is contract-driven, not handwritten tool sprawl:

- `@sonik-agent-ui/tool-contracts` defines command descriptors, command families, manifests, policy evaluation, and execution receipts.
- `@sonik-agent-ui/command-generator` generates command artifacts from API/contract inputs.
- `@sonik-agent-ui/platform-adapters` maps host sessions and command adapters into runtime context.
- Generated artifacts live in `apps/standalone-sveltekit/src/lib/server/generated/` and test fixtures live in `tests/fixtures/generated/`.
- Current generators:
  - `scripts/generate-sonik-booking-command-fixture.mjs`
  - `scripts/generate-sonik-global-command-registry.mjs`
- Runtime APIs:
  - `/api/tool-manifest`
  - `/api/command-registry`
  - `/api/commands/search`
  - `/api/commands/learn`

This is the foundation for ORPC/OpenAPI/MCP/CLI-backed tool availability without flooding the model context.

### 8. Observability and testability

v0.1 is designed to be tested by agents, not only by humans looking at screenshots.

- Browser state exposes `window.__sonikAgentUI` and `window.__SONIK_AGENT_UI_PAGE_CONTEXT__` where available.
- Dev telemetry can be written locally with `SONIK_AGENT_UI_TELEMETRY_LOG` and served by `pnpm dev:evidence`.
- Cloudflare Worker observability is enabled in `apps/standalone-sveltekit/wrangler.jsonc` with invocation logs and traces sampled at 100% for this testing phase.
- Tail consumer: `sonik-dev-observability-pipe-b`.
- Smoke scripts capture JSON evidence and screenshots under `.omx/logs` and `.omx/artifacts`.

## Repository map

```txt
apps/standalone-sveltekit/        Hosted/standalone SvelteKit Agent UI app
packages/agent-embed/             Host SDK for iframe mounting, context posting, resize/open/close controls
packages/agent-observability/     Sanitized page context and machine-readable UI state helpers
packages/artifact-model/          Artifact spec/model contracts and promotion behavior
packages/chat-surface/            Chat text/stream presentation utilities
packages/command-generator/       Deterministic command manifest/registry generation
packages/core/                    @json-render/core copied/owned runtime package
packages/json-ui-runtime/         Sonik JSON UI runtime bridge
packages/platform-adapters/       Host session, command adapter, and runtime context helpers
packages/svelte/                  @json-render/svelte runtime package
packages/tool-contracts/          Command/tool schema, families, policy, manifest contracts
packages/workspace-core/          Workspace store/runtime primitives
packages/workspace-session/       Persistence interfaces, in-memory adapter, cloud SQL migrations
scripts/                          Generators, migrations, smoke/evidence scripts
tests/                            Unit and smoke-support tests
json-render/                      Source scaffold retained for copy/retrofit reference
ui-dojo/                          Source scaffold retained for copy/retrofit reference
amplify-svelte/                   Source scaffold retained for theme/component reference
```

## Local development

Requirements:

- Node `>=24`
- pnpm `>=11`

Install and run:

```sh
pnpm install
pnpm dev
```

Common checks:

```sh
pnpm check-types
pnpm test
pnpm build
pnpm phase0:verify
```

Command registry gates:

```sh
pnpm generate:commands:sonik-booking
pnpm check:commands:sonik-booking
pnpm generate:commands:sonik-global
pnpm check:commands:sonik-global
pnpm check:commands
```

Database migrations:

```sh
DATABASE_URL='<postgres-url>' pnpm run db:migrate:dry-run
DATABASE_URL='<postgres-url>' pnpm run db:migrate
```

Smoke tests:

```sh
pnpm smoke:agent-ui
pnpm smoke:agent-ui:real-model
pnpm smoke:agent-ui:embed
pnpm smoke:agent-ui:embed:real-model
pnpm smoke:agent-ui:amplify
```

## Environment and Worker configuration

The hosted app is configured by `apps/standalone-sveltekit/wrangler.jsonc`.

Current Worker vars:

```jsonc
{
  "PUBLIC_AGENT_UI_ALLOWED_HOST_ORIGINS": "https://*.workers.dev,https://*.sonik.fm",
  "AI_GATEWAY_MODEL": "deepseek/deepseek-v4-flash",
  "RATE_LIMIT_PER_MINUTE": "10",
  "RATE_LIMIT_PER_DAY": "100",
  "SONIK_BOOKING_API_BASE_URL": "https://sonik-booking-app.liam-trampota.workers.dev",
  "SONIK_BOOKING_AUTH_MODE": "anonymous",
  "SONIK_AGENT_UI_PERSISTENCE_MODE": "cloud"
}
```

Required/important secrets:

```sh
# Vercel AI Gateway / model inference
wrangler secret put AI_GATEWAY_API_KEY

# Cloud persistence; any one of these names is accepted by runtime resolution.
wrangler secret put SONIK_AGENT_UI_DATABASE_URL
# or DATABASE_URL / POSTGRES_URL / NEON_DATABASE_URL

# Signed host context verification.
wrangler secret put SONIK_AGENT_UI_HOST_CONTEXT_SECRET

# Optional booking runtime auth, if the booking provider should call protected routes directly.
wrangler secret put SONIK_BOOKING_API_BEARER_TOKEN
# or SONIK_BOOKING_API_TOKEN / BOOKING_SERVICE_API_TOKEN
```

Optional local env is documented in `apps/standalone-sveltekit/.env.example`.

## Embedding in a host app

The host app owns the page layout. Agent UI owns the iframe runtime. The host should donate context and provide slots/buttons for chat/canvas.

Minimal shape:

```ts
import { mountSonikAgentUI } from '@sonik-agent-ui/agent-embed';

const agent = mountSonikAgentUI({
  agentUrl: 'https://sonik-agent-ui.liam-trampota.workers.dev',
  hostOrigin: window.location.origin,
  elements: {
    iframe: '#sonik-agent-ui-frame',
    chatSlot: '#sonik-agent-ui-chat-slot',
    canvasSlot: '#sonik-agent-ui-canvas-slot',
    sidecar: '#sonik-agent-ui-sidecar',
    canvasWindow: '#sonik-agent-ui-canvas-window',
    resizeHandle: '#sonik-agent-ui-resize-handle',
    openChat: '#sonik-agent-ui-open-chat',
    openCanvas: '#sonik-agent-ui-open-canvas',
    dockChat: '#sonik-agent-ui-dock-chat',
    closeChat: '#sonik-agent-ui-close-chat',
    closeCanvas: '#sonik-agent-ui-close-canvas',
  },
  getPageContext: () => ({
    route: window.location.pathname,
    surface: 'booking-console',
    pageType: 'event-booking-detail',
    title: document.title,
    activeEntity: { type: 'booking', id: 'booking_123', label: 'Summer Jazz Night' },
    visibleActions: ['view', 'list_resources', 'assign_resource'],
    commandFamilies: ['booking', 'event', 'booking-ops'],
    skillFamilies: ['booking', 'event'],
  }),
  theme: () => document.documentElement.getAttribute('data-theme') ?? 'system',
  initialMode: null,
});

// Open from host UI.
agent.open('chat');
agent.open('canvas');

// Push fresh context after host state changes.
await agent.postContext();
```

For production hosts, context should be signed server-side and forwarded to Agent UI through the trusted host context path. Do not expose raw cookies, tokens, or headers in page context.

## v0.1 validation evidence

Latest focused authenticated smoke evidence from this repo:

- `.omx/logs/v01-focused-authenticated-smoke.json`
- `.omx/logs/v01-focused-authenticated-smoke-after-artifact.png`
- `.omx/logs/v01-focused-authenticated-smoke-after-reload.png`
- `.omx/artifacts/agent-ui-tail-focused-20260625184445.txt`
- `.omx/artifacts/booking-pipeb-env-tail-focused-20260625184445.txt`

Reported pass fields from that run included:

- authenticated login succeeded
- host context present
- page context present
- iframe received context
- chat response succeeded
- artifact creation succeeded
- persistence after reload succeeded
- no bad network responses
- no page errors

One warning was retained from historical invalid artifact replay. Fresh v0.1 artifact creation/persistence passed in the focused run.

## Known v0.1 limitations

- The model can still attempt poor artifact specs. The schema now rejects malformed/empty specs, but generation quality needs continued prompt/catalog hardening.
- Some command families are discovery-first. The global command registry exists, but not every Sonik/Amplify/booking ORPC route is mounted as an executable runtime command yet.
- Booking provider write commands still require clear auth mode decisions before broad production use.
- The document editor island is functional but still being converted from copied scaffold to Sonik-owned source/style contracts.
- Shared workspaces and Google-doc-style permissions are schema-prepped but not fully productized in UI.
- File upload, screenshot upload, contacts, and rich document analysis are v0.2+ work.

## v0.2 goals

### Product and UX

- Persistent shared workspaces: multi-user AI sessions, shared artifact canvases, shared live documents.
- Google-doc-style sharing: owner/grantee roles, org/user/external identity grants, audit trails, revocation, retention.
- Rich page context attachment: simple context, rich context, detachable/reattachable page context, visible context chips similar to file uploads.
- File/photo/screenshot upload with analysis and artifact creation.
- Contacts/person context: safe user/customer/contact references across Sonik surfaces.
- Better artifact authoring: incremental JSON artifact patching, component-catalog learning, schema-aware retry loops, and clearer repair messages.
- First-class inline document editing and preview switching controlled by agent actions.

### Tooling and platform

- Full ORPC-backed global command registry across Sonik SDK, booking service, Amplify, and future host surfaces.
- Deterministic CI gate that fails on command drift, duplicate command IDs/families, stale OpenAPI inputs, or missing generated fixtures.
- Command loading policy by page/surface: eager summary, surface eager, lazy, hidden.
- Host-specific command providers that remain modular and productizable outside Sonik.
- MCP/desktop bridge for local tools without making MCP mandatory for native hosted chat.
- CLI/sandbox execution lane for environment-level actions, separated from ORPC app-state actions.

### Runtime and observability

- Stronger trace correlation across host app, Agent UI iframe, model request, command execution, and persistence writes.
- Optional OpenTelemetry/LangSmith/LangChain-style observer layer for token accounting, run inspection, and ride-along evaluators.
- Production-grade dev evidence server and log streaming beyond local/Worker tail workflows.
- Cloud and local adapters: Postgres/Neon for hosted, SQLite for local desktop/MCP-style deployments.

## Development doctrine

1. Preserve working upstream behavior through direct copy before retrofit.
2. Keep host integrations modular; Sonik/Amplify/booking details enter through adapters, context, and command providers.
3. Treat browser page context as helpful but untrusted.
4. Treat organization/user/session context as server-derived authority.
5. Keep command availability contract-driven and generated where possible.
6. Prefer deterministic tests and machine-readable evidence over visual inspection alone.
7. Keep this repo productizable: it should embed into Sonik first, but remain clean enough to license or deploy as a standalone Agent UI product.
