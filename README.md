# Sonik Agent UI

Sonik Agent UI is a modular SvelteKit agent workspace for embedding a production-oriented AI assistant inside Sonik, Amplify, booking surfaces, or any host application that can donate safe page context. The v0.1 baseline combines a streaming chat surface, a live artifact canvas, JSON-rendered UI artifacts, a document editor island, signed host context, a deterministic command registry, and cloud-ready workspace persistence.

The product direction is deliberately **copy/retrofit first**: when a best-in-class scaffold already exists, copy the exact source into a reviewable boundary, preserve behavior, then adapt it behind Sonik contracts. Do not recreate working UI primitives from scratch unless the source boundary is missing, unsafe, or impossible to integrate.

## What this repo is

This repo is the standalone and embeddable Agent UI runtime. It can run as:

1. **Hosted Agent UI** — a Cloudflare Worker/SvelteKit app loaded by host apps through an iframe and `@sonik-agent-ui/agent-embed`.
2. **Standalone workspace** — a local or hosted SvelteKit app for chat + artifacts + document workflows.
3. **SDK seam** — typed packages that Sonik/Amplify/booking hosts can import to mount the UI, donate page context, validate commands, and run smoke tests.

The current production target is a hosted Agent UI, e.g. `agent-ui.sonik.fm` or a Worker preview URL, embedded into Amplify and the Sonik booking app with signed host context and organization-scoped persistence.

## v0.2 deep init — app-aware contract tool platform

v0.1 proved the Agent UI shell: embedded chat, canvas, document artifacts, JSON rendering, signed host context, cloud persistence, and initial command discovery. v0.2 turns that shell into an **app-aware, contract-driven tool platform**. The demo bar is no longer "can the assistant chat inside a host page?" It is: **can the assistant understand the current page, discover exact allowed commands, perform a real read/write booking workflow safely, and keep the user in control of artifacts, page context, and command execution?**

### v0.2 north star

- **App-aware agent**: the assistant sees sanitized page context by default, can explain where the user is, and can keep page context attached/detached like any other context source.
- **Contract tool platform**: command availability comes from generated ORPC/OpenAPI/SDK contracts plus host policy, not handwritten prompt-only tools.
- **Real workflow mutation**: the first write demo is a reversible booking hold lifecycle: read availability → create hold → confirm hold → release hold.
- **Host-owned authority**: browser context is helpful but untrusted; writes require signed host context, org/user/session identity, scopes, command approval, and runtime adapter policy.
- **No visual redesign dependency**: v0.2 should deepen behavior without requiring a major UI restyle. The existing chat/canvas/document shell remains the working baseline.

### Current paired-system state

As of the v0.2 init pass, the paired booking-service work has been normalized around the clean signed-runtime bridge:

- `sonik-agent-ui` `main` includes the v0.1/v0.2 foundation after PR #2 merge.
- `sonik-booking-service` `main` includes PR #20, `Mount signed Agent UI booking runtime bridge`, as the canonical booking host-context implementation.
- Older booking-service Agent UI PRs such as PR #16 and PR #13 are stale for the signed Agent UI bridge. They are conflicting, broad, or superseded by PR #20 and should not be merged for this seam without surgical salvage.
- Booking-service PR #20 constrains signed Agent UI context to the selected booking runtime commands and denies broad `/rpc` bypass for `agent-ui-host-context`.

### v0.2 phase map

1. **Exact booking contract mapping**
   - Bind the demo to the booking hold lifecycle, not durable booking creation.
   - Canonical commands: `booking.get.availability`, `booking.create.hold`, `booking.get.hold`, `booking.release.hold`.
   - Keep generated registry descriptors deterministic and shadow by default.

2. **Command discovery and learning UX**
   - Use compact command search first.
   - Load detailed command schemas/policies only when needed.
   - Keep model context small by surfacing command families and page-scoped eager summaries rather than flooding every route.

3. **Trusted runtime adapter promotion**
   - Promote only selected host-approved descriptors to mounted runtime status in a trusted host catalog.
   - Require signed host context, organization id, principal/user id, session id, scopes, explicit command approval, and idempotency keys before write commits.
   - Redact receipts and never echo credentials.

4. **Booking provider runtime smoke**
   - Run availability read, hold create, hold confirm, and hold release against the booking host/runtime.
   - Fail closed if the page or test environment does not donate a resource target where one is required.
   - Capture Worker/tail/evidence logs for every mutation.

5. **Agent site navigation capabilities**
   - Add page/action descriptors that let the assistant route the user through supported Sonik/Amplify/booking surfaces.
   - Navigation commands should be distinct from data mutations and should be host-controlled.

6. **Context attachments**
   - Treat page context as an attachable context source, similar to future file uploads.
   - Support simple page context, rich page context, and visible context chips so users can see what the agent is using.

7. **Persistence and sharing hardening**
   - Continue cloud-session persistence for chats, messages, artifacts, documents, versions, telemetry, access grants, and access-grant audit.
   - Prepare shared chats and shared artifact workspaces with owner/grantee semantics before productizing collaborative sessions.

### v0.2 demo acceptance criteria

A v0.2 demo is not complete until all of the following are true:

- Embedded Agent UI can identify the current booking page from donated page context.
- The assistant can search/learn the booking command set without loading the entire registry into prompt context.
- The assistant can execute a mounted booking availability read through the trusted runtime path.
- The assistant can create a temporary booking hold only after explicit approval and only with valid host-scoped org/session/user context.
- The assistant can confirm and release that hold, leaving the test environment clean.
- The UI shows meaningful command/tool progress instead of opaque "thinking" or silent failure.
- Persistence survives close/reopen for the chat, messages, artifact/document state, and relevant command receipts.
- Automated evidence exists: unit tests, command drift checks, smoke JSON, screenshots where useful, and Worker/tail log excerpts for runtime writes.

### v0.2 non-goals

- Do not mount the full ORPC surface as executable by default. Discovery can be broad; execution must be scoped and policy-gated.
- Do not use browser page context as write authority.
- Do not make MCP mandatory for hosted chat; MCP remains a desktop/local-tool bridge.
- Do not create durable bookings, payments, cancellations, or destructive mutations as the first demo write path.
- Do not fork host app logic into Agent UI; host apps donate context and adapters, and Agent UI consumes contracts.

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
- Default model selection is environment-driven through `AI_GATEWAY_MODEL`; Agent Settings can request an allowlisted per-run model through the same Gateway.
- The AI Gateway token is a secret: `AI_GATEWAY_API_KEY`.
- Streaming is guarded by app-side safety/telemetry paths so crashes are testable instead of silent.
- The visible chat can stream normal text, tool call summaries, artifact creation, document creation, and command registry responses.

### 3a. Agent settings gear

The chat header includes an Agent Settings gear inspired by the Twenty AI settings donor pack preserved at `docs/upstream-proofs/twenty-ai-settings/`. The runtime retrofit is intentionally Sonik-native and lives outside the copied source island:

- `packages/chat-surface/src/components/AgentSettingsPanel.svelte` renders model, skill, tool-family, context, and add-on tabs.
- `apps/standalone-sveltekit/src/lib/agent-settings.ts` defines the type-safe model list, runtime skill options, and tool permission modes.
- `/api/generate` sanitizes the submitted settings before composing the prompt or building tools.
- Model selection is passed through to the Vercel AI Gateway per run; unknown model ids fall back to the server default.
- Skill toggles append runtime skill ids for that run only. They do not persist hidden instructions onto the session.
- Tool family modes are `off`, `ask`, and `allow`. `off` removes/blocks that family. `ask`/`allow` never bypass signed host context, org/user/session checks, scopes, or approved command ids for mutations.

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
packages/json-ui-runtime/         Reusable JSON artifact renderer bridge
packages/workspace-session/       Persistence interfaces, in-memory adapter, cloud SQL migrations
scripts/                          Generators, migrations, smoke/evidence scripts
tests/                            Unit and smoke-support tests
json-render/                      Source scaffold retained for copy/retrofit reference
ui-dojo/                          Source scaffold retained for copy/retrofit reference
amplify-svelte/                   Source scaffold retained for theme/component reference
```

## JSON-render component registry

The ready-to-render JSON component surface is intentionally centralized in the standalone app until the next package extraction pass:

- **Catalog/schema:** `apps/standalone-sveltekit/src/lib/render/catalog.ts`
- **Svelte registry bindings:** `apps/standalone-sveltekit/src/lib/render/registry.ts`
- **Human/agent registry map:** `apps/standalone-sveltekit/src/lib/render/component-registry.ts`
- **Component implementations:** `apps/standalone-sveltekit/src/lib/render/components/`
- **Reusable renderer bridge:** `packages/json-ui-runtime/src/renderer/JsonArtifactRenderer.svelte`
- **Core renderer/action/state runtime:** `packages/svelte/src/` and `packages/core/src/`
- **Ask-user/intake contracts:** `packages/tool-contracts/src/index.ts`
- **Booking/event/campaign intake artifact factory:** `apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts`

Treat `catalog.ts` as the validation authority, `registry.ts` as the Svelte binding authority, and `component-registry.ts` as the orientation/index layer for agents, docs, and future package extraction. Stateful inputs such as `QuestionCard`, `ChoiceCards`, `EditableField`, `TextareaField`, `SelectInput`, `RadioGroup`, `Tabs`, and `Button` currently edit JSON-render state; durable persistence and command execution must be supplied by the trusted host/controller seam, not by the renderer component itself.

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

## v0.2 command/runtime verification runbook

Use this runbook before claiming that a contract-tool slice is ready for demo testing:

```sh
# Registry determinism and drift gates
pnpm check:commands

# Focused contract/runtime unit coverage
node --experimental-strip-types tests/unit/sonik-booking-demo-command-binding.test.mjs
node --experimental-strip-types tests/unit/booking-runtime-write-adapter.test.mjs
node --experimental-strip-types tests/unit/global-command-registry-runtime.test.mjs

# Full local regression suite when touching runtime, SDK, persistence, or generation
pnpm test
```

For hosted/embedded validation, pair the Agent UI evidence with booking-service evidence:

1. Deploy the Agent UI Worker with `AI_GATEWAY_API_KEY`, database URL, and `SONIK_AGENT_UI_HOST_CONTEXT_SECRET`.
2. Deploy the booking host/service branch that includes the signed host context bridge.
3. Open the embedded host page while authenticated.
4. Confirm page context is present in the iframe and signed host context is present server-side.
5. Ask the assistant to summarize the current page.
6. Ask it to search/learn booking commands.
7. Run the hold lifecycle with explicit approval and cleanup.
8. Pull Worker/tail evidence and confirm no broad `/rpc`, missing-host-context, auth-scope, or persistence errors occurred.

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

## v0.2 backlog after the booking demo gate

The deep-init phase above is the immediate v0.2 path. The broader backlog below remains valid after the booking hold demo is green.

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
