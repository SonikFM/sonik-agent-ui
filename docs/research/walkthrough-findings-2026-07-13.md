# Competitor Walkthrough — Consolidated Findings (2026-07-13)

Live hands-on sessions: **n8n**, **Flowise**, **Dify** (deep). Driven by Dan in
Chrome with local OTel/Jaeger capturing backends. Raw traces preserved in
`docs/research/telemetry-captures/` (418 spans) + Dan's exports in `~/Downloads`.
This is the findings list that feeds the deep interview → ralplan.

## The one-line finding

Every platform in the field governs **who installs** and reports **cost as an API
response**; not one gates **per-call**, signs **approvals**, or issues **verifiable
receipts**. Witnessed live in three consoles, not inferred. That absent category
is the moat — and it can't be an enterprise upsell, because in our architecture
gating, approval, and receipts *are* the product, not monitoring.

## Dan's ratified strategy signals (from the walkthroughs)

- **(f) Pricing — commoditize their cost levers.** Every competitor paywalls
  platform hygiene: variables (Dify, paywalled on self-host), evaluations service
  (n8n `.ee`), workspaces/roles (Flowise EE), observability depth (Dify enterprise
  OTel exporter), plus environments/secrets/SSO/LDAP. Sonik ships all of that
  STANDARD; security/observability/receipts are never an upsell. Charge on usage
  boundaries + premium capability (D017). Every competitor's pricing page becomes
  our pitch.
- **(g) Distribution posture — no download-and-run-yourself, ever.** Third-party
  execution is platform-hosted/sandboxed (the Dify daemon route) or made
  unnecessary by the platform. n8n-style in-process community nodes (arbitrary code
  sharing the instance) = named anti-pattern.
- **(h) Workflow-as-capability.** A published workflow registers its own capability
  id; effect inherited from the strictest inner node; composition never launders
  authority. Validated live by Dify's "tool can be Tool Plugin / Swagger API /
  Workflow-as-Tool / MCP."
- **(i) Evaluation-as-primitive** for the A4 playground, with receipts per row;
  eval datasets shipped as manifest fixtures (the pinData steal).
- **(j) Workflows are invisible.** "Nobody wants to build a workflow. The workflow
  should be behind the scenes… the determinism… if we make the determinism look
  clean we never have to look at a react flow again." Primary authoring is
  conversational/agent-drafted; the node canvas is a power-user/debug view, never
  the front door. Flowise = the anti-benchmark (LangChain taxonomy as user
  taxonomy, 4-input agent assembly, three list screens for one concept).
- **(k) THE central product thesis — scope reduction by audience.** Dify proves you
  CAN do everything AND anybody can figure it out; that dual property is the target.
  We do NOT build Dify — we slice it down, dumbed way down, per audience:
  - **End customer** (organizer's customer): forward-facing, Intercom-level
    customer-service agent. Minimal, conversational, no builder.
  - **The organizer** (Sonik's paying client): manages own agents/workflows but
    DELIBERATELY NARROW — "smaller scope than we may think." Slice hard.
  - **Sonik internal**: full power, everything.
  Dify is the "everything" ceiling; we ship a sliced subset per tier. This reframes
  the admin-console tiers from "what features" to "which audience, how little."
- **Embed story reframed:** not an arbitrary SDK — the organizer publishes their
  own branded customer-service agent to their own site, routed through signed host
  context.

## Tool taxonomy — confirmed complete (Dan: "we're on the ball")

Five groups, all with homes in existing contracts:
1. Workflow (+ workflow-with-agent) → workflow kind + workflow-as-capability
2. MCP → `mcp_addon` kind + MCP transport
3. Internal swagger API call → command catalog (113 booking cmds from
   `bookingOperationManifest`)
4. UI tool calls (control the UI) → target registry + host-action channel
   (`sonik.agent_ui.host_action.v1`)
5. Agent-as-tool / sub-agent chains

## Per-platform findings

### n8n
- Model call IS traced as a first-class span (2080ms of a 2352ms run) — but ZERO
  gen-ai semantics: no model, no tokens, no cost on the span. Economic blindness.
- Pause and resume are TWO disconnected traces; the resume emits NO span at all —
  the approval moment is invisible in telemetry. Exhibit B.
- STEAL: error cause-chain propagates child→parent in span logs; `workflow.version_id`
  stamped per execution; `pinData` test fixtures travel in the export; per-node
  `typeVersion`; the OTel-settings-page "Send test trace" verify button (pattern for
  our B5 exposure toggles).
- AVOID: connections keyed by node NAME (rename-fragile) — ours use nodeId.
- The 4-node agent assembly (agent+model+memory+tools wired via invisible typed
  ports) materialized Dan's "how hard this is to configure" as runtime span errors
  (`No session ID`, `No prompt specified`) — the argument for declarative agent
  profiles over graph-wiring.

### Flowise
- The named anti-benchmark. flowData = raw React Flow JSON, zero runtime schema
  validation (Zod installed, unused). TWO parallel engines mid-migration, three
  list screens for one concept. Manual model-name typing.
- HITL = a Condition node a human picks the branch of (steal the uniformity);
  resume authorized by session possession only.
- Workspaces/Roles EE-gated, no local bypass (pricing-lever evidence).

### Dify (deepest, strongest validation of our architecture)
- **Four distribution surfaces per app, simultaneously:** Web App (forkable client)
  + REST API (`/v1`) + MCP Server (the app IS an MCP server) + A2A agent (extension).
  Each with an "In Service" toggle = exposure control (B5). Validates "one artifact,
  many distribution shapes."
- **Agent config = our agent-definition schema, ~1:1:** Model / Prompt / SKILLS
  ("reusable expertise") / Files / TOOLS ("let the agent act") / Knowledge /
  Advanced (env, sandbox, memory). Skills and Tools are DISTINCT first-class.
- **Permission model witnessed live = the trust contrast:** the plugin Permissions
  popover has ONLY "who can install/manage" + "who can debug" (Everyone/Admins/No
  one). RBAC on the human operator; ZERO disclosure of what the plugin can touch.
  Our per-call capability registry governs what nobody else governs.
- **/develop API page = best receipt-shape prior art found:** `message_end` carries
  full `usage` (prompt/completion/total tokens) + per-token `price` + `currency` +
  `latency`, plus `X-Trace-Id`/`trace_session_id` first-class. They HAVE cost + a
  join key — published as an API response, not a signed artifact. We adopt the shape
  verbatim and add the signature they lack.
- **Marketplace taxonomy maps to our envelope:** Models(142)/Tools/Data
  Sources(28)/Triggers(21)/Agent Strategies/Extensions/**Bundles**. Install from
  Marketplace/GitHub/Local Package File. Install counts = social-proof trust our
  verifiable trust-tier replaces.
- **OpenAPI-paste → 113 tools instantly** (Exhibit C): the strongest single demo of
  registry-generation. Same source as ours; theirs comes out as one ungated ambient
  cookie across all 113 ops (including DELETEs), ours comes out effect-typed,
  per-call-gated, approval-bound. Same source, opposite trust posture — the pitch.
- Monitoring dashboard makes COST first-class (token usage in $). Knowledge
  ingestion is itself a workflow (pipeline of nodes). API-based variables pull from a
  Custom Endpoint at runtime. Model picker (dynamic searchable OpenRouter list, ctx
  badge, "Incompatible" flag before run) = the good model-UX bar + inline
  feature-compat warning to steal.

## UI gaps status (from ui-gaps.html lens)

- **No precedent anywhere (we invent):** Review surface (D011), approvals queue,
  install-with-permission-disclosure, kill-switch/revocation panel, standing-grant
  manager, receipts viewer, endpoint-exposure toggles. Dify's Permissions popover +
  its cost-in-API-response are the closest the field gets, and they fall short
  exactly at the trust line.
- **Benchmarks exist (steal best):** runs timeline (n8n executions is the bar),
  agent profiles (Dify identity-first create), registry browser, workflow versions
  (activepieces draft/publish), playground (Langflow separates it), marketplace
  browse (Dify taxonomy), org admin (Onyx), skills catalog.

## Open questions the interview must settle

1. Live-cutover sequencing (Phase 3a-2) + the source-pinned test updates it needs.
2. Review surface (D011) design — no OSS approvals-queue precedent; design signoff.
3. Standing/recurring agent grants (approve-once-recur-many; WS6 calendar consumer #1).
4. Isolation posture — Dan resolved the WHETHER (hosted/sandboxed, no self-run);
   interview settles sandbox depth/timing.
5. SDK-embed = branded client-facing CS agent on organizer's own site (reframed).
6. **Admin console re-scoped to 3 audiences** — pin exactly which functions each of
   {end customer, organizer, Sonik-internal} gets; confirm organizer tier is
   deliberately narrow.
7. Framework decision ratification (STAY — already gate-1 ratified).

Everything above lives in `.omc/state/deep-interview-state.json` for the interview.
