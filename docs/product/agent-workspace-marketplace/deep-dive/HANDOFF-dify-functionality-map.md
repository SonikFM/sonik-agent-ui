# HANDOFF — Dify Functionality Mental Map (dify-functionality-map.html)

## Intent (Dan, 2026-07-13)

Dify is the best-in-practice reference — do NOT throw the baby out with the
bathwater. Before slicing anything down per audience, we outline **all** of
Dify's functionality and map it: how their canvas starts, what their nodes
are, what their marketplace holds, all of it. **Start from the whole and
break down from there.** This page is the mental map we work off: a complete,
navigable functionality tree of Dify (as witnessed live 2026-07-12/13 on
self-hosted 1.16.x), with a Sonik-mapping annotation on every branch — which
of our existing contracts/decisions covers it, or `unmapped`.

The page is a WORKING artifact, not marketing: dense, scannable, everything on
one page, tree/columns over prose. Think "one giant annotated org-chart of a
product."

## Deliverable

`docs/product/agent-workspace-marketplace/deep-dive/dify-functionality-map.html`
joining the existing deep-dive suite:
- Use `assets/tokens.css` + `assets/nav.js` exactly like sibling pages (read
  `index.html` and one sibling page, e.g. `stopgate.html`, for conventions).
- Add the page to the nav and an index card on `index.html`.
- Dark operator theme. HARD BANS (Dan's taste, binding): no gradients, no
  emoji, no left-stripe accent cards, no Inter/Roboto, no tiny uppercase
  eyebrows on every section, no identical card grids. Print styles +
  reduced-motion per suite standard. Inline SVG only, from real data.
- Every Dify fact below is witnessed; do not invent features. Where our map
  is uncertain, label `unverified`.

Suggested anatomy: a fixed mini-TOC; one section per top-level domain (below);
within each, a two-column pattern — left the Dify functionality tree (nested,
compact), right the Sonik mapping chips (contract name / decision ID / tier
note / `unmapped`). A summary "coverage" strip at top computed from real
counts of mapped vs unmapped leaves (no fake numbers).

## The complete Dify functionality inventory (witnessed)

### 1. Studio — app creation
- Entry: create from **blank** / from **template** / **import DSL file**.
- App types (blank): **Chatflow** (chat-oriented workflow; starts User Input →
  Answer), **Workflow** (automation), and basic types: **Chatbot** (direct
  config, no canvas), **Agent**, **Text Generator**. Difference = what the
  thing can do.
- Template gallery categories: Dify 101, Customer Service & Operations,
  Knowledge Retrieval, Data Analysis, Marketing, AI Coding, Research, Utilities.
- Sidebar: Home, Studio, Agents (BETA), Knowledge, Integrations, Marketplace,
  Web Apps section listing published web apps.

### 2. Chatbot "Orchestrate" surface (no-canvas app config)
- Instructions panel: prompt editor with **Generate** assist; `{` inserts
  variable, `/` inserts prompt content block.
- Variables: form variables (text/paragraph/select) + **API-based variables**
  (Type=api; Name; Variable Name; bound to a **Custom Endpoint** — value pulled
  at runtime).
- Knowledge: attach KBs; **Retrieval Setting**; **Metadata Filtering**
  (Disabled/enabled).
- Vision toggle (+ settings).
- Right rail: **Debug & Preview** chat; model settings flyout — dynamic
  searchable model list per provider (OpenRouter etc.), context-size badges
  (e.g. 163K), **"Incompatible" flag on unfit models at config time**.
- Publish dropdown.

### 3. Agents (BETA)
- List: All / Published(n) / Drafts(n), Created-by-me filter, sort, Create.
- Create modal = identity-first: Name (req), Role (opt, "e.g. Research
  Assistant"), Description (opt), avatar. Config comes after.
- Agent config (Configure screen): **MODEL** (Auto Router default) /
  **PROMPT** ("/" insert) / **SKILLS** ("reusable expertise it can call while
  working") / **FILES** ("docs the agent can read — specs, templates,
  guidelines") / **TOOLS** ("let the agent act, like searching the web or
  calling your apps") / **KNOWLEDGE RETRIEVAL** / **ADVANCED SETTINGS** ("for
  power users. Env vars, sandbox & memory").
- Skills ≠ Tools: distinct first-class sections.
- BUILD / PREVIEW split; "Unpublished changes · Saved n min ago"; Publish
  update (⌘⇧P); version history icon.

### 4. Workflow / Chatflow canvas
- React-flow canvas; Start/User Input node; comment notes (with author);
  auto-positioning; mini-map; toolbar (pointer/hand modes, add node, add note).
- Node types (add-node panel, witnessed): Agent, LLM, Knowledge Retrieval,
  Answer/Output, Question (Classifier), If/Else, Human Input, Iteration, Loop,
  Code, Template, Variable Aggregator, Doc Extractor, Variable Assigner.
- Add-node panel tabs: **Nodes / Tools / Start / Snippets** (Snippets =
  unexplored, label unverified).
- Tools tab filter: **All / Tool Plugin / Swagger API / Workflow / MCP** +
  "Find more in Marketplace" — i.e. a "tool" is any of 4 sources, unified.
- Header: Auto-Saved timestamp · Unpublished; Preview (test run); feature
  toggles; ENV (environment variables); Features panel; **Publish**; history.
- **Features panel** (chatflow): Conversation Opener, Follow-up (next-question
  suggestions), File Upload, Citations and Attributions, Content Moderation
  (moderation API or word list).
- LLM node: model per node (Auto Router CHAT badge); Agent node exists as a
  node inside workflows.

### 5. Per-app access points (publish surfaces) — app detail left rail
- App detail header: Edit Info / Duplicate / **Export DSL** / More.
- **Web App**: IN SERVICE toggle; Public URL (`/chat/<id>`); actions:
  **Launch / Embedded / Customize / Settings**.
  - Customize = WAY 1: fork `Dify-WebClient` GitHub repo → deploy to Vercel →
    env `NEXT_PUBLIC_APP_ID` / `NEXT_PUBLIC_APP_KEY` / `NEXT_PUBLIC_API_URL`;
    WAY 2: write your own client against the API.
  - Settings: web app name, description, icon (replace bot icon toggle),
    language, chat color theme (+inverted), **Workflow Details show/hide**,
    author name, privacy policy, more settings.
- **Backend Service API**: IN SERVICE toggle; endpoint `/v1`; API Key mgmt;
  auto-generated **API Reference** (~25 endpoints: chat-messages w/ streaming
  SSE events, files upload/preview, stop generate, feedbacks, suggested
  questions, conversation history/list/delete/rename, **conversation
  variables get/update**, audio↔text, info, parameters, meta, site,
  annotations CRUD). Response metadata carries full usage: prompt/completion/
  total tokens + unit prices + total price + currency + latency;
  `trace_id`/`X-Trace-Id` + `trace_session_id` first-class; `workflow_id` to
  pin a version; `agent_thought` events (thought/tool/tool_input/observation).
- **MCP Server**: IN SERVICE toggle; Server URL (`/mcp/server/<token>/mcp`) —
  the app itself is an MCP server.
- Left rail: Orchestrate / API Access / Logs / Annotations / **Monitoring**
  (Total Messages, Active Users, Avg. Session Interactions, Token Output
  Speed, User Satisfaction Rate, **Token Usage with ~$ cost**; date range;
  source filter).

### 6. Knowledge
- Three creation paths: **ready-to-use KB** (upload docs, Dify handles it —
  RECOMMENDED), **custom knowledge pipeline** (workflow-style graph; node
  templates: Blank, General Mode-ECO, Parent-child-HQ, Simple Q&A, Convert to
  Markdown, LLM Generated Q&A; **Import from DSL**), **connect external KB via
  API** (no migration).
- KB attaches to apps/agents via Knowledge sections; retrieval settings +
  metadata filtering at attach point.

### 7. Integrations (workspace-level plugin system)
- Sub-nav: **Model Provider / Tools (→ Tool Plugin, MCP, Workflow as Tool,
  Swagger API as Tool) / Data Source / Trigger / Agent Strategy / Extension /
  Custom Endpoint**; bottom: **Debugging / Permissions**.
- Install sources: **Marketplace / GitHub / Local Package File**; Auto-update
  (LATEST vs FIX ONLY modes).
- Model Provider: installed w/ version + Configure vs "Configuration required
  — API key required" state; per-provider models list; Default Models;
  install counts on cards.
- **Swagger API as Tool**: paste an OpenAPI/Swagger doc → full toolset
  generated (witnessed: Sonik booking OpenAPI → 113 tools instantly); auth
  config = API key in header or cookie (one ambient credential applied to ALL
  generated ops — no per-op gating; their weakness, our contrast).
- **Permissions popover (entire plugin permission model):** "Who can install
  and manage?" + "Who can debug?" — Everyone / Admins / No one. Nothing else.
- Custom Endpoint: register external API as reusable module ("centralized API
  management"; used by API-based variables etc.).

### 8. Dify Marketplace (marketplace.dify.ai)
- Categories: **Models (142) / Tools / Data Sources (28) / Agent Strategies /
  Triggers (21) / Extensions / Bundles**; sort by Most Popular; tags
  (SEARCH/UTILITIES/PRODUCTIVITY/RAG/NEWS…); Featured/Latest rows; install
  counts everywhere (DeepSeek 1.25M, Gemini 347k, JSON Process 231k).
- Triggers = webhook trigger plugins (Gmail, Telegram, Outlook, GitHub,
  Notion, Slack, Google Calendar/Drive, Stripe, Zendesk, Twilio, WooCommerce,
  Airtable, Typeform, Linear, Discord, RSS…).
- Extensions = endpoint-ish integrations (Slack Bot, WeCom, Line, Cron
  self-call, Moderation, A2A Server = "expose Dify apps as A2A protocol
  agents", LlamaCloud/VikingDB/AWS Bedrock KB connectors, DSL→mermaid
  convertor, novelty items).
- Agent Strategies = installable reasoning strategies (plugin kind).
- Bundles = grouped multi-plugin packages.

### 9. Workspace / misc
- Workspace switcher; account menu; global search (⌘K); Explore/template
  gallery; Web Apps list in sidebar; Logs per app; Annotations (Q/A pairs,
  hit counts) per app.
- Self-host env flags: ENABLE_OTEL → OTLP export (langgenius/dify +
  dify-plugin-daemon services; spans lack token/cost attrs — cost lives only
  in API responses).

## Sonik mapping vocabulary (use these as the right-column chips)

Map each leaf to the closest of: package kinds (`bundle/app/workflow/skill/
command_tool_pack/agent/artifact_template/mcp_addon/provider_integration/
managed_internal`), decisions (D008–D017, esp. D011 review surface, D012
kill-switch, D014 install semantics, D016 JSON-first), contracts
(`workflowDefinitionSchema`, WorkflowRunState reducer, capability-registry
per-call gating, command catalog = 113 generated booking commands, target
registry + `host_action.v1` UI tools, semantic receipts), tiers (P1 guest /
P2 organizer / P3 internal — from `features-first-2026-07-13.md`, as a
SECONDARY annotation only), or `unmapped` / `deliberate-gap` (e.g. install
counts → replaced by verifiable trust tiers; ambient credential → replaced by
per-call gating).

**Special callout (Dan):** Swagger-API-as-Tool ("upload an OpenAPI doc for
tool calls") maps to **/sonik-tool-creation** — flag this branch visually as a
confirmed convergence: their UX proves the pattern; ours adds effect-typing +
per-call gating + approval binding.

## Acceptance
- One self-contained HTML page in the suite, nav + index card added.
- Every inventory item above appears exactly once in the tree; each leaf has a
  mapping chip; unmapped/deliberate-gap leaves are visually distinct.
- Coverage strip counts derived from the actual DOM leaves (real data only).
- Passes the suite bans; readable in print; reduced-motion safe.
