# Agent On-Screen Control — Vision, Research Synthesis, and Hitlist

Date: 2026-07-06
Compiled by: Fable/Claude Code agent-ui lane, from three Sonnet research passes (best-in-class web survey, local harness exploration, marketplace vision review) plus the current-HEAD capability audit.
Status: READ-ONLY analysis. All UI work below requires Dan's design approval before implementation.

---

## 1. What the agent can control on-screen TODAY (verified at HEAD `4e5caca`)

Three channels, all deliberately narrow:

1. **Semantic action registry** — `window.__sonikAgentUI.actions`, 13 verbs: `createSession, submitPrompt, stop, clearChat, clearArtifact, reloadSession, openWorkspaceDocument, submitAnswer, markUnknown, saveDraft, requestApproval, approveAndRun, cancelApproval`. Typed results with failure reasons.
2. **Agent-authored JSON-render artifacts** — agent emits/patches JSON specs rendered by 33 registered Svelte components; `$bindState` gives live reactive updates (the Svelte-runes remote-update payoff). Renderer is execution-inert; trusted controller owns writes via `commitCommand` + host-signed `approvedCommandIds`.
3. **Machine-readable read-back** — `getPageContext()`/`getAssertions()`: workflow phase enum, current question, visible errors, disabled reasons.

**Cannot do:** highlight/spotlight, scroll-to-element, open arbitrary panels, navigate the host app, drag/resize, arbitrary DOM. The agent can converse and render its own surfaces but cannot *gesture at the host UI*.

Benchmark verdict from the web survey: Sonik's machine-readable page-context approach is **ahead of the field** (most products have no equivalent of `getAssertions()`); the gaps are the gesture layer (tours) and the eval harness.

## 2. Agent-guided onboarding tours (driver.js) — GREENFIELD, recommended architecture

The survey found **no prior art** of an LLM agent driving driver.js/Shepherd at runtime — this is unclaimed territory, not catch-up.

Architecture (keeps the existing trust model exactly):
- **Named-target registry, never selectors.** Each highlightable region gets a stable semantic ID (`booking.dateField`, `nav.workspaceSwitcher`) mapped to DOM refs by the frontend. Agent calls `highlight(targetId)`; unknown ID → typed rejection (same as component allowlist).
- **Declarative tour spec, not imperative stepping.** Agent emits one JSON tour `{steps: [{targetId, title, body, advanceOn}]}` validated server-side; the client tour runtime (driver.js under the hood) owns playback — same shape as JSON-render artifacts.
- **`advanceOn: "click:target" | "manual"`** as a step field (driver.js/Shepherd support async-gated steps natively), not a separate agent verb.
- **No mid-tour re-targeting.** Agent reacting mid-tour = new turn emitting a replacement tour spec.
- If tours become marketplace-template content, they are a **net-new node type** (`TourNode`) — decide now; the node-type enum is already 9 entries (COMPONENT-INVENTORY.md).

Effort: M. The driver.js wiring is small; the real work is the semantic target-ID registry per page.

## 3. Harness quality for cheap models (DeepSeek-tier) — checklist

- Schema-enforced tool contracts (constrained decoding), never prompt-enforced.
- Risk-tag every action: `readOnlyHint | destructiveHint | idempotentHint | openWorldHint`; permission gating becomes a lookup, not model judgment.
- **Phase-scoped tool availability**: only expose actions valid for the current `workflowPhase` — the enum in page context is exactly the right hook.
- Deterministic replay fixtures from production traces, replayed against stubbed backend in CI (no API burn).
- Deterministic code-evals via `getAssertions()` for everything checkable; LLM-as-judge only for genuinely fuzzy checks (e.g. tour narration coherence).
- Auditable action log: every UI-initiated and agent-initiated call logged in replayable form (MCP Apps' loggable JSON-RPC is the bar).
- CI-gated eval regression before any harness/prompt/tool change merges.
- Known gap: our own smokes still scrape `document.body.innerText` where page-context assertions should exist.

## 4. Best-in-class patterns to adopt (web survey, effort-ranked)

| # | Pattern | Source | Effort |
|---|---|---|---|
| 1 | Formalize the allowlist-resolution invariant (typed `RenderError`, no eval, sanitize agent-supplied href/src) | assistant-ui | S |
| 2 | Confirm/adopt diff-based state sync (`STATE_DELTA`-style JSON Patch, survives concurrent agent+user edits) | AG-UI/CopilotKit | S–M |
| 3 | "Local echo vs committed action" as the explicit two-way-binding model | A2UI v1.0 | S |
| 4 | Risk-annotation vocabulary on the 13 actions (see §3) | MCP tool annotations | M |
| 5 | Consent gate + loggable messages for UI-initiated tool calls | MCP Apps (SEP-1865) | M |
| 6 | `editAndApprove` / `retry-with-modified-params` verbs (HITL beyond approve/cancel) | AG-UI interrupts | S–M |
| 7 | Machine-readable component catalog (platform-agnostic schema, pays forward native mobile) | A2UI catalog | L (watch item) |
| 8 | Keep semantic state over screenshots for grounding (validation: already correct) | harness-eng literature | — |

## 5. Local harness adoption list (open-design / json-render upstream / ui-dojo)

Top items (full ranked list in the harness exploration report):

1. **json-render `devtools` + `devtools-svelte`** — live inspector of streamed specs/patches/state/actions. Pure observation layer; the state-inspection tooling we have none of. (M)
2. **open-design Playwright bundle** (`e2e/lib/playwright/`): `mock-factory.ts`, `visual.ts`, `rail.ts` idempotent page helpers, **`fake-agents.ts` scripted-agent driver** — maps directly onto deterministic `__sonikAgentUI` flow testing. (S–M)
3. **json-render `examples/no-ai`** — static conformance fixture for `$bindState/$cond/watch/$template`; golden renderer regression, zero AI dependency. (S)
4. **`PluginPreviewHero.tsx` pattern** — sandboxed-iframe artifact preview with tab pills; serves marketplace preview-before-install. Verify sandbox can't become a second execution path. (S)
5. **open-design onboarding-profile pattern** — ephemeral Q&A, persist sanitized snapshot; feeds agent-guided onboarding. (S)
6. **`examples/harness-chat`** — agent execution rendered as typed components (FileChange diff view, TestResults); diff against our `tool-activity.ts` for missing node types. (M)
7. `directives`, `yaml`, `dashboard` (drag-reorder/edit-mode-reprompt reference), token confidence/grade schema, `codegen`, `mcp` package (serve artifacts as MCP Apps — deliberate scope decision, not quiet retrofit). (S–L)

Housekeeping: **`ui-dojo/` is a verbatim unmodified Mastra demo clone — delete.** `json-render/` fork has NO engine drift (core/svelte 0.19.0 match); the value is un-forked packages/examples, so keep upstream around (or re-vendor selectively) until devtools/no-ai are ported.

## 6. Marketplace/vision review — critical findings (second-eyes pass)

**Fix-before-any-UI items:**

1. **CRITICAL — `toolPolicy` is decorative.** The real execution path checks only `approvedCommandIds.includes(commandId)`; nothing reads `toolPolicy`/`permissionDefaults` (`artifact-state.ts:324-398`, `tool-contracts:1276-1303`). The `off|ask|allow` matrix the design treats as the install-safety mechanism has no enforcement hook. Wire it into `evaluateCommandPolicy` BEFORE building PermissionMatrix/InstallApprovalCard UI, or the UI lies about safety. (No design time needed — pure engineering.)
2. **CRITICAL — `installMarketplaceTemplate` has no human gate.** It's live in the agent's tool list and mutates session install state the moment the model calls it — no approval card, no review UI exists. Install ≠ write-approval, but it is mutation-without-consent.
3. **Latent authz bug:** `canInstall: disabledReasons.length === 0 || item.readiness === "FIXTURE"` (`templates.ts:467`) — an engineering-readiness label bypasses authorization. Not triggered today; remove before more templates land.
4. **Session-keyed, not org-keyed installs** (`installedBySession` Map) — inherits the existing artifact-warehouse tenant-isolation gap; flag it on the way in, don't propagate it.
5. Unspecified: uninstall/revocation (incl. in-flight runs), template versioning/migration (static `"0.1.0"` strings), moderation for user-published templates (supply-chain-shaped gap — templates carry `tool_commit` nodes), billing hooks, capability-ID registry (`requiredCapabilities` are unvalidated free strings).

**Doc drift:** "marketplace" means two incompatible things across corpora — the handoff docs' installable-template marketplace vs the Sonik_Amplify PRD's two-sided commerce marketplace (Stripe Connect/escrow/trust). Only connective tissue is marketplace-prd §4.11, which cites a "Workflow Builder PRD §4.14" that doesn't exist in the corpus. Convergence decision is unwritten.

**Sequencing (one designer, agents implement):**
1. Wire `toolPolicy` enforcement (engineering-only, prerequisite for honest UI).
2. Template Detail / Install-Permission-Review page (smallest surface, closes the silent-install gap). ← needs Dan's design
3. Workspace Editor read path (Inspector: Schema/Commands/Evidence tabs — mostly renders existing data). ← needs Dan's design
4. Marketplace listing/browse page. ← needs Dan's design
5. Workflow Builder canvas LAST (highest cost; buys time for versioning/moderation decisions before user-authored graphs exist).
6. Defer publish/org-to-org sharing until versioning + moderation are designed.

**What the design gets right:** safety contracts travel with data (`mutatesInstalledState: false` in payloads); `contextMatchers` ranking is real working discovery; donor copies are manifest+hash verified.

## 7. Hitlist (consolidated, ranked)

| # | Item | Type | Effort | Needs Dan's UI approval? |
|---|---|---|---|---|
| 1 | Wire `toolPolicy` → `evaluateCommandPolicy` (kill decorative permission matrix) | eng/security | M | No |
| 2 | Gate `installMarketplaceTemplate` behind a review affordance | eng+UI | M | Yes (card design) |
| 3 | Remove `readiness === "FIXTURE"` authz bypass | eng | S | No |
| 4 | Risk-tag the 13 semantic actions + phase-scoped tool exposure | eng | M | No |
| 5 | Port open-design Playwright bundle (`fake-agents.ts` et al) + json-render `no-ai` fixture → deterministic agent-eval suite in CI | testing | S–M | No |
| 6 | json-render devtools inspector (dev-mode panel; pairs with the earlier Dev Mode proposal) | tooling | M | Light |
| 7 | Tour primitives: named-target registry + declarative tour spec + driver.js runtime | feature | M | Yes (tour visual design) |
| 8 | Replace remaining innerText-scrape assertions in smokes with page-context assertions | testing | S | No |
| 9 | `editAndApprove` verb + diff-based state sync confirmation | eng | S–M | Light |
| 10 | Install-review page → editor read path → listing → builder canvas (sequence per §6) | UI program | L | Yes (all) |
| 11 | Delete `ui-dojo/`; decide json-render vendor strategy after devtools/no-ai port | hygiene | S | No |
| 12 | ~~Write the marketplace-term convergence decision~~ **DECIDED (Dan, 2026-07-06):** the current work is the **agent marketplace** (workflows / templates / workspaces / agents / skills) — a deliberate primer for the future full B2B/B2C commerce marketplace PRD. One strong marketplace model for all things comes later; the agent marketplace establishes the patterns first. Refer to them as "agent marketplace" vs "commerce marketplace" in docs. | docs | done | — |

---
Full agent reports (capability matrix with URLs, complete adoption table, full critique) live in the session transcript of 2026-07-06; this doc is the durable synthesis.
