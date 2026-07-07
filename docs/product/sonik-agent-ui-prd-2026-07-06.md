# Sonik Agent UI — Product Requirements Document

Status: LIVING · Version 1.0 · 2026-07-06
Owner: Dan Letterio
Scope: the embedded Sonik Agent UI product — the agent-controlled chat sidecar for the Sonik booking platform, its page-control contract, demo-readiness bar, testing doctrine, and near-term roadmap.

> This PRD supersedes scattered handoff docs as the standing reference for *what this product is and what "done" means*. It does not replace the marketplace corpus (`docs/product/agent-workspace-marketplace/`) — that is a parked adjacent program (see §8). Everything marked VERIFIED was proven by automated evidence on 2026-07-06 against deploy `e54e4e0b`; everything else is labeled PLANNED, FLAKY, or BLOCKED honestly.

---

## 1. Problem & vision

Booking operators (restaurants, golf/tee sheets, venues, hotels) do skilled setup and reservation work through dense operational UI. Sonik Agent UI puts a conversational agent *inside* that UI as an embedded sidecar that can read the page, render its own interactive surfaces, and drive real booking operations — while never being able to act without trusted authorization.

The wow: a user asks in plain language, the agent renders a guided setup canvas, collects answers, previews a concrete command, and — only after trusted approval — creates a real booking context or reservation, with a visible receipt. The agent guides and previews; the trusted host and command receipts are the source of authority.

## 2. Users & jobs

- **Booking operator** (primary): set up a venue/restaurant booking context; create reservations; manage schedules — conversationally, without learning the full console.
- **Host application** (Sonik booking app, Amplify): embeds the sidecar, donates signed page/host context, owns the trust boundary.
- **Agent** (LLM, model-tier-agnostic): discovers skills, renders input surfaces, previews commands, requests approval. Must work reliably enough that a **cheaper model** can drive production flows (see §6).
- **Engineers/QA**: validate flows deterministically without a human in the loop.

## 3. Product principles (non-negotiable invariants)

1. **Renderer is execution-inert.** JSON-render specs collect input only; they never carry executable `tool_call`/endpoint/commit payloads. A trusted controller maps input to commands. *(VERIFIED — architecture audit found zero boundary violations.)*
2. **User text is never authorization.** Typing "approve" does not commit anything. Writes go through `commitCommand` gated on host-signed `approvedCommandIds`. *(VERIFIED — triple-gated: flag + `APPROVE_AND_RUN` literal + host grant.)*
3. **No cloud call without signed host context** in embedded mode; show a reconnect state instead of firing headerless requests.
4. **The page is machine-readable.** `window.__sonikAgentUI` exposes `getPageContext()`, `getAssertions()`, and a typed semantic-action registry. Agents and tests read state; they never scrape the DOM for routine flows.
5. **Evidence over vibes.** No flow is "done" without correlated proof (page context + network + Pipe-B events + command receipt). Screenshots and empty/stale logs are INCONCLUSIVE, never PASS.
6. **Honest degradation.** Unavailable controls expose a typed `disabledReason`; no silent no-ops, no dev-speak in user copy.

## 4. Current capability — what the agent can control on screen

Three channels (VERIFIED at HEAD):

1. **Semantic action registry** — 13 typed verbs: `createSession, submitPrompt, stop, clearChat, clearArtifact, reloadSession, openWorkspaceDocument, submitAnswer, markUnknown, saveDraft, requestApproval, approveAndRun, cancelApproval`. Each returns `{ok, state, disabledReason?}`.
2. **Agent-authored JSON-render artifacts** — the agent emits/patches specs rendered by ~33 allowlisted Svelte components with `$bindState` live binding.
3. **Machine-readable read-back** — page context (route, surface, workflow phase, current question, visible errors, disabled reasons) + assertions.

Deliberately absent (roadmap, §7): host-UI gesturing (highlight/tour), navigation, drag/resize, arbitrary DOM.

## 5. Demo-readiness definition & status

Demo-ready = one full scenario works end to end with no manual prompt hacks, proven by evidence.

### Scenario A — Booking setup (the payoff flow)
User: "Help me set up a restaurant booking context."
Path: search/suggest → intake canvas opens → fill state → preview `booking.create.context` → approval card → trusted commit → receipt → context exists in booking service.

| Stage | Status | Evidence |
|---|---|---|
| Skill discovery + intake artifact creation (live agent) | **VERIFIED PASS** | Pipe-B: `tool.learnSkill`, `tool.createBookingIntakeArtifact ok` |
| Fill answers → approval → commit via **automation** | **BLOCKED** | `getPageContext().workflow` null for agent-created artifacts (§9 F1) |
| Fill answers → commit via **human clicking** | **UNVERIFIED** — likely works (separate renderer-action path); needs one manual pass |
| Success receipt card | Built & unit-tested; not yet seen end-to-end live |

### Scenario B — Reservation workflow
User: "Book a table for two tomorrow at 6pm."
Path: discover reservation workflow → availability → guest → booking → approval → receipt.

| Status | Evidence |
|---|---|
| **VERIFIED PASS (flaky ~2/3)** | Pipe-B command evidence for availability/guest/booking, no hold commands; live-model nondeterminism causes occasional narrate-without-execute runs (§9 F2) |

### Demo-day bar (what "share-ready" means for THIS demo)
- Green: browsing the sidecar, suggestions, intake questions, settings, reservation happy path (with a retry), all demo-UX copy.
- Presenter-driven, human-in-the-loop is the demo mode; the automated-path gaps (F1) and unreachable pin/archive surface (F3) do not block a human presenter.
- Full marketplace install UX is **explicitly out of scope for this demo** (parked, §8).

## 6. Testing doctrine (how we prove readiness)

A world-class harness is the prerequisite for running a cheaper model safely in production. Standing requirements:

1. **Deterministic contract gate first** — `scripts/agent-eval-gate.mjs` validates the page-control contract (all actions, typed refusals, schema versions) and renderer conformance with no live model. Must pass before browser QA. *(VERIFIED 2/2.)*
2. **Ultratest for flows** — bounded, evidence-correlated runs (browser + page context + network + Pipe-B) classified PASS/FAIL/INCONCLUSIVE. Empty/stale Pipe-B = INCONCLUSIVE.
3. **Pipe-B evidence** — tail `sonik-dev-observability-pipe-b` before browser actions; correlate by request/trace id and time window.
4. **No screenshot-only PASS. No DOM-scrape where page context exists.**
5. **Cheap-model readiness checklist** (target: DeepSeek-tier): schema-enforced tool contracts; risk-tagged actions; phase-scoped tool exposure; deterministic replay fixtures in CI; auditable action log. *(PLANNED — see roadmap.)*

## 7. Roadmap (ranked; approval-gated items marked)

| # | Item | Type | Status | Needs Dan's UI approval |
|---|---|---|---|---|
| 1 | Fix null `workflow` snapshot for agent-created intake artifacts (unblocks automated Scenario A) | bug | QUEUED | No |
| 2 | `toolPolicy` enforcement — wire `off/ask/allow` into `evaluateCommandPolicy` (plan written) | eng/security | PLANNED | No |
| 3 | Reservation flake mitigation — retry-guard now, prompt/skill hardening later | reliability | QUEUED | No |
| 4 | Risk-tag the 13 actions + phase-scoped exposure | harness | PLANNED | No |
| 5 | Pin/archive demo surface decision (rail in embed workspace mode vs signed standalone link) | UX | DECISION | Yes |
| 6 | Agent-guided onboarding tours (driver.js, named-target registry) — spec written | feature | PROPOSED | Yes |
| 7 | Agent UI Dev Mode inspector overlay — spec written | tooling | PROPOSED | Yes |
| 8 | Deterministic replay fixtures + CI eval gate | harness | PLANNED | No |
| 9 | Booking-service host-controller (`__sonikAgentHost`) port into `@sonikfm/sonik-sdk` (unblocks automated E2E smoke) | cross-repo | QUEUED (other lane) | No |

## 8. Out of scope (parked, not cancelled)

- **Agent marketplace** (workflows/templates/workspaces/agents/skills as installable packages) — contract-v0 skeleton exists and is tested; runtime endpoints, install UI, and persistence are deferred. Dan's decision 2026-07-06: hold until after this demo; the demo proves the point without it. This is the *agent* marketplace, a primer for the future full B2B/B2C commerce marketplace (a separate, larger PRD).
- Full workflow-builder canvas; publishing/moderation; template versioning; billing.

## 9. Known issues (evidence-backed)

- **F1 (BLOCKING, automation): `getPageContext().workflow` stays null** for artifacts the live agent creates via `createBookingIntakeArtifact`, so page-control `submitAnswer`/`markUnknown` can't drive them. The renderer-click path (human) is separate and likely unaffected. Root-cause pointer: how `AgentUiWorkflowSnapshot` is derived from live QuestionCard/intake state.
- **F2 (FLAKY): reservation live-agent nondeterminism** — ~1/3 runs the agent narrates the flow without executing tool calls. Platform is healthy; occurrence is model-side. Mitigate with a retry-guard.
- **F3 (SURFACE GAP): pin/archive/restore has no reachable demo surface** — embed hides the rail; standalone cloud-persistence mode 503s without signed context. Features are built but live-untested. Decision needed (#5).
- **Known gap (not a regression): `window.__sonikAgentHost`** was never implemented in `@sonikfm/sonik-sdk`; the deterministic host-controller open path is pending that port. DOM open-chat is the canonical path today.

## 10. Success metrics

- Scenario A automated E2E: PASS with Pipe-B commit evidence (blocked on F1).
- Scenario B: PASS rate ≥ 95% with retry-guard (currently ~66% raw).
- Contract gate: 100% green pre-deploy, CI-enforced.
- Zero dev-speak strings and zero silent no-ops on demo surfaces *(VERIFIED clean as of this deploy).*
- A model one tier cheaper passes the full eval suite (north-star; gated on §6 checklist).

## 11. References

- Vision/hitlist: `docs/handoffs/agent-onscreen-control-vision-hitlist-2026-07-06.md`
- toolPolicy plan: `docs/plans/toolpolicy-enforcement-plan-2026-07-07.md`
- Tour spec: `docs/proposals/agent-tour-primitives-spec-2026-07-06.md`
- Dev Mode: `docs/proposals/agent-ui-dev-mode-proposal-2026-07-06.md`
- Host-controller gap: `docs/handoffs/booking-host-controller-e2e-gap-evidence-2026-07-06.md`
- Eval harness: `tests/agent-eval/README.md`
- Marketplace corpus (parked): `docs/product/agent-workspace-marketplace/`
