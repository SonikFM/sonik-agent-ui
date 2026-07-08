# Agent UI Long-Run Plan — 2026-07-08

**Status: DRAFT — awaiting Dan's signoff**
**Owner:** Dan Letterio · **Drafted by:** Claude (Fable), from the 2026-07-08 regression investigation
**Inputs:** `docs/reviews/ux-parity-ledger-2026-07-08.md`, `docs/reviews/persona-bug-triage-2026-07-07.md`, PR #11, the json-render capability audit (skills: core/svelte/devtools/codegen), `docs/handoffs/agent-ui-open-design-architecture-gap-analysis-2026-07-01.md`

## Why this plan exists

Three regressions shipped under the radar this week (anonymous booking runtime via a 4096-char header cap, "ask"-mode read-command dead end, fresh-session-per-mount) because **failure paths had no telemetry and the eval gate checks contracts, not experience**. The plan orders work so observability lands first, structural contracts replace prompt-steering second, and experience polish comes only when both can be seen and verified.

**Ordering rule (binding):** no Phase 3 polish work starts before Phase 1 items 4–5 are deployed.

---

## Phase 0 — Land what's already done

*Goal: nothing regresses back; nothing gets lost. All S-sized.*

| # | Item | Scope | Verification gate |
|---|------|-------|-------------------|
| 0.1 | **Merge PR #11** (header-cap fix, execute-time host approval, session resume + switcher — already deployed live as worker `134735f9`) | Merge only; protected main | Post-merge: `pnpm test` green on main; redeploy from main; re-run the live probe (`booking.get.availability` → `policy_allowed`) |
| 0.2 | **Harness reconciliation** — merge `backup/persona-harness` (incl. keyless `smoke` command), `backup/workflow-driver-p1`, `backup/demo-seed-batch` into one `scripts/harness/` | Deduplicate the 3 divergent copies of `endpoint-client.mjs` / `host-context.mjs` / `sse-stream.mjs`; keep the seed branch's Origin-header login fix (only copy that has it) | `node scripts/harness/persona-run.mjs smoke --script "..."` passes keyless against the deployed worker; all three harness test files green |
| 0.3 | **Prune stale worktrees/branches** — `/private/tmp/sonik-agent-ui-{deploy,review}-*` (tool-activity `c40c52a` is superseded by main's `f7f4f77`), `.claude/worktrees/agent-*` after 0.2 lands | `git worktree remove` + branch cleanup | `git worktree list` shows only the main checkout |
| 0.4 | **Booking-side envelope diet** — send `approvedCommandGrantMode: "all"` instead of 113 command IDs (3.5KB, 81% of the signed header) | ⚠️ booking-service change — **needs Dan's explicit deploy request per standing rule** | Envelope < 1KB; agent-ui `api.generate.host_context_header_rejected` count stays 0 |

**Decision needed (0.4):** ship now or defer? The 16KB agent-ui cap holds until the catalog roughly triples, so this is not urgent — but it's the root-cause end of the header story.
`[ ] ship now  [ ] defer until next booking deploy window`

---

## Phase 1 — Observability first

*Goal: no more invisible failures. This phase is the gate for everything after it.*

| # | Item | Scope | Verification gate |
|---|------|-------|-------------------|
| 1.1 | **Vendor `@json-render/devtools` + `devtools-svelte`** via the copy-retrofit process (new manifest under `manifests/copy-retrofit/`) and mount `<JsonRenderDevtools />` inside our existing `JsonUIProvider` | Production-safe by design (renders null when `NODE_ENV === "production"`); use `position="right"` (our shell is `100vh`-style); pass `spec` + `messages` per the multiple-renderers recipe (chat inline + canvas share one provider) | Dev build: Spec/State/Actions/Stream panels populate during an intake run; element picker resolves a QuestionCard to its spec key |
| 1.2 | **Server-side stream tap → Pipe-B** — `tapJsonRenderStream(result.toUIMessageStream(), events)` in `/api/generate` | Spec patches + action dispatches persist server-side alongside existing telemetry | Pipe-B query returns spec-patch events for a live run |
| 1.3 | **QuestionCard submit success telemetry** — `QuestionCard.svelte` `submit()` emits only on validation *error* today; the optimistic local checkmark renders regardless of persist outcome | Add submit-attempt + persist-outcome events (client), matching the pattern set by `api.generate.host_context_header_rejected` | A clicked button with a failed persist is distinguishable from success in telemetry; unit pin added |
| 1.4 | **Experience smoke in the eval gate** — extend `scripts/agent-eval-gate.mjs` beyond contract checks: assert session survives widget close/reopen, session switcher present in embedded mode, no `runtime_unavailable` on the reservation path | Deterministic, no-LLM, same harness | Gate fails if any of tonight's three regressions recurs |

---

## Phase 2 — Contracts over prompt-steering

*Goal: stop hoping the model behaves; make the library enforce it. All code already vendored in `packages/core` / `packages/svelte`.*

| # | Item | Scope | Verification gate |
|---|------|-------|-------------------|
| 2.1 | **Patch-first artifact refinement** — adopt `buildUserPrompt({ currentSpec, editModes: ["patch"] })` (RFC 6902) for artifact-update turns; retire the skill-body steering text ("never call createBookingIntakeArtifact again") | Complements the `runtime-skill-intent.ts:95` structural guard (keep `booking.context.intake` active while an active intake artifact exists — **Dan said he'd manage this piece**; plan assumes it lands, flag if not) | Persona smoke (`persona-run.mjs smoke`): artifactId stable across 8 conversational turns; `create*Artifact` called ≤ 1× per run |
| 2.2 | **`catalog.prompt()` for component/action docs** — `defineCatalog` over the intake component set; generated docs replace hand-written prompt text | Fixes the silent 2000-char skill-body truncation (main's intake skill body is 2405 chars pre-truncation) | Composed prompt preview shows generated catalog section; no truncation warning; prompt-composition tests updated |
| 2.3 | **`autoFixSpec` repair loop** — on spec validation failure: lossless fixes → retry → lossy only when retries exhaust — *before* degraded rendering | Replaces parts of the h3 graceful-degradation path | Unit: malformed fixture (dangling child, misplaced field) renders after repair; degradation only on unrepairable input |
| 2.4 | **State patching on library primitives** — evaluate replacing hand-rolled `createQuestionAnswerStateUpdates` internals with `deepMergeSpec` / `diffToPatches` | Refactor-only if diff is net-negative lines; skip if not (ponytail rule) | `question-answer-loop` + `intake-artifact-persistence` tests green, diff is net deletion |

---

## Phase 3 — The experience bar

*Goal: the parity ledger's restore-first list. Gated on Phase 1 (must be able to see what we ship).*

| # | Item | Scope | Verification gate |
|---|------|-------|-------------------|
| 3.1 | **Naming identity pass** — on-screen labels become **Chat / Canvas / Document**; "Artifact" demoted to data-model term. Replaces all five synonyms (cites in ledger §Naming) | Labels-only: `CanvasToolbar.svelte:59`, `ArtifactFrame.svelte:19`, `+page.svelte:327-328,3486`, `WorkspaceDocumentFrame.svelte:40`, `tool-contracts:1047` | Grep: zero remaining "Artifact workspace"/"Workspace Document"/"Artifact Canvas" UI strings; eval-gate label assertions updated in same PR |
| 3.2 | **Polish batch** — readiness badges (keep sentence-case copy, drop `uppercase tracking-[0.12em] text-[10px]` debug look), real icon for the `⚙` glyph (lucide, explicit size), unify the header row's three styling systems | `AgentConversation.svelte:237`, `AgentSettingsPanel.svelte:202-213`, `ThemePicker.svelte` | Screenshot review by Dan (design-taste rules apply: no gradients/emoji) |
| 3.3 | **Repro canvas-behind-left-nav** in the booking host embed — unconfirmed claim; suspect rail-width clip at `WorkspaceRoot.svelte:71` or missing z-index guarantee in `agent-embed` | Repro first; fix is scoped only after confirmation | Browser repro recording; fix verified in the live embed |
| 3.4 | **Progressive spec streaming** — `createSpecStreamCompiler` so the canvas builds while the model streams (Open Design Gap 3, "feels alive") | `/api/generate` stream path + canvas renderer `loading` handling | Visible progressive build in dev; stream tests green |
| 3.5 | **Minimal canvas drag/resize** — wire reposition/resize using vendored Odysseus `windowDrag.js`/`windowResize.js` as reference (behavior translated to Svelte, per the `open-design-run-context` retrofit precedent — no full tiling/z-order manager) | `CanvasViewport.svelte` / canvas window chrome | Canvas pane can be repositioned and resized by pointer; keyboard-accessible fallback |

---

## Phase 4 — Net-new capability (needs product sign-off per item)

| # | Item | Scope | Verification gate |
|---|------|-------|-------------------|
| 4.1 | **@-mention skill composition in the composer** — ephemeral per-turn `skillIds`, Open Design Gap-4 pattern (`gap-analysis-2026-07-01.md:98-107`). This is "dynamic skill pills" | Composer affordance + `resolveRequestSkillIds` already accepts request skillIds server-side | @-mention adds skill for that turn only; visible chip; telemetry shows per-turn skillIds |
| 4.2 | **Slash commands** — no upstream reference exists anywhere (verified); spec before build | Product spec doc first | Dan-approved spec |
| 4.3 | **Upload / drag-drop in composer** — same: never designed; spec first | Product spec doc first | Dan-approved spec |
| 4.4 | **codegen in the eval gate** — vendor `@json-render/codegen`; `collectUsedComponents/StatePaths/Actions` as deterministic conformance checks; later: artifact→HTML export (resolves the wides.json/wides.html identity question) | Eval-gate extension first; export is a separate slice | Gate asserts rendered components ⊆ catalog |

**Explicitly out of scope:** `@json-render/zustand` (React pairing; core's `StateStore` is the right seam if ever needed), react-three-fiber renderer (no demo relevance), full Odysseus tiling/tab-reorder/z-order manager (only minimal drag/resize in 3.5), any booking-service deploy without Dan's explicit request.

---

## Sequencing & effort summary

```
Phase 0  (S)  → immediately, mostly merges          [0.4 needs Dan's deploy decision]
Phase 1  (M)  → next; hard gate for Phase 3
Phase 2  (M)  → parallel with late Phase 1          [2.1 assumes Dan's skill-intent guard]
Phase 3  (M-L)→ after 1.1–1.3 + 1.4 deployed
Phase 4  (L)  → per-item sign-off; 4.1 first
```

Standing verification for every phase: full unit suite + `agent-eval-gate` + the keyless persona smoke against the deployed worker. Every deploy from a clean worktree, never from the shared checkout (a second agent works in it).

## Signoff

- [x] Phase 0 approved (0.4 decision: **DEFERRED** — no booking-side envelope grant change for now, per Dan 2026-07-08)
- [x] Phase 1 approved
- [x] Phase 2 approved (2.1 dependency on skill-intent guard acknowledged)
- [x] Phase 3 approved
- [ ] Phase 4: not yet approved — per-item sign-off still pending

— Dan Letterio, 2026-07-08 ("Execute on phases 1-3 via /ralph")
