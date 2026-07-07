# Agent UI Embed Hitlist — Manual Testing Findings & Fix Waves

Date: 2026-07-02
Source: manual testing of the deployed embed (booking app host) after the Open Design retrofit merge candidate (`feat/analytics-hints-release-gate-20260702`, PR #5).
Base branch for all fix lanes: `feat/analytics-hints-release-gate-20260702`.
Each lane: own branch `fix/<id>-<slug>-20260702`, conventional commits, `pnpm test` green before reporting, no pushes unless told.

## How to use this doc

This is the shared brief for all workers (Codex `exec` lanes and Claude teammates). Workers cannot see the chat session that produced it — everything needed is here. Read your lane's section fully, including Root cause and Verification, before editing.

---

## Wave 1 — Codex lanes (small, file-scoped)

### H1 — `createJsonArtifact` strips `on` handlers → all canvas artifacts are non-interactive

**Symptom:** buttons/choices in tool-created artifacts render but do nothing. Agent's own in-session diagnosis: the returned spec had no `on` field; the tool input schema declares `"on": {"type":"object","propertyNames":{"type":"string"},"additionalProperties":false}`, so nested `{action, params}` action objects fail validation and are silently stripped. Inline ```spec fences (JSONL patches) keep handlers and work.
**Where:** `apps/standalone-sveltekit/src/lib/tools/artifact.ts` (tool definition). NOTE: no `additionalProperties` literal in app code — the spec schema is likely imported/derived from the `@json-render` dependency; find where the tool's input schema is constructed and widen the `on` value schema to accept the same action-object shape the inline-fence path accepts (see `apps/standalone-sveltekit/src/lib/render/registry.ts` / `json-render-state-controller.ts` for the runtime action shape: `{action: string, params?: object}` and arrays thereof).
**Fix:** align tool schema with the renderer's actual action contract. Do NOT loosen to arbitrary objects — enumerate the action-binding shape.
**Verify:** unit test that a createJsonArtifact call with `on.press: {action:"setState", params:{...}}` survives tool validation and reaches the stored spec; existing artifact tests unchanged. Update `AGENT_INSTRUCTIONS`/artifact guidance module if it claims tool artifacts can't be interactive.

### H3 — Intake ChoiceCards dead: `maxSelections: 0` + raw Zod error rendered to user

**Symptom (screenshot):** venue intake question shows `[{"origin":"number","code":"too_small","minimum":0,"inclusive":false,"path":["maxSelections"],"message":"Invalid input"}]` in pink; choice clicks do nothing.
**Where:** `apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts:259` (`maxSelections: question.maxSelections ?? null`) and `:302` (null→undefined); `apps/standalone-sveltekit/src/lib/render/components/ChoiceCards.svelte`; schema in `apps/standalone-sveltekit/src/lib/render/catalog.ts`; `QuestionCard.svelte`.
**Fix (both halves):** (a) never emit an invalid `maxSelections` — for single-select questions omit it or use 1; clamp/normalize at the intake-artifact builder; (b) component-level: on prop validation failure, degrade to a safe default (single-select) and log to telemetry — raw Zod JSON must never render in end-user UI.
**Verify:** unit test: intake question without explicit maxSelections renders selectable ChoiceCards; invalid props degrade gracefully with a telemetry event, no error text in DOM.

### H7 — Theme must derive from host page, not the chat's own picker

**Symptom:** "Gunmetal Light" chat theme bleeds over the embed; theme picker inside embedded chat is wrong — the booking page's theme should govern.
**Where:** `apps/standalone-sveltekit/src/lib/theme/` (ThemePicker.svelte, theme-registry.ts, theme-runtime.ts); host context already carries `setTheme` in `visibleActions`; check `@sonik-agent-ui/platform-adapters` HostSessionEnvelope/page context for a theme field to consume or add one.
**Fix:** embedded mode: apply host-provided theme, hide ThemePicker. Standalone mode: unchanged (picker stays).
**Verify:** unit test on theme resolution precedence (host theme > stored pref > default in embedded mode); svelte-check clean.

### H8 — Conversation titles never generated → session rail shows single letters

**Symptom (screenshot):** left rail items render as bare "U"/"C" letters; no titles exist anywhere (`grep titleGeneration` = zero hits).
**Where:** session persistence (`packages/workspace-session`), sessions routes (`apps/standalone-sveltekit/src/routes/api/session*`), rail rendering in `apps/standalone-sveltekit/src/routes/+page.svelte`.
**Fix (donor pattern):** Open Design's `titleGeneration` — on a conversation's first turn, ask the model for a short title via a marker in the stream (strip from visible text), fall back to truncated first user message. Persist on the session; rail renders it.
**Verify:** unit test for title extraction + fallback; rail shows titles.

### H10 — Two small correctness fixes

**(a) LineChart month ordering:** x-axis rendered "Apr, Jun, May" (screenshot). `apps/standalone-sveltekit/src/lib/render/components/LineChart.svelte` — render in data order but fix the agent guidance/example that produced unordered months, OR sort when x-values parse as dates/months. Decide and test.
**(b) Event chip unresolved:** after the agent created an event, the auto-seeded chip shows bare kind `event` with no detail/binding, so it injects nothing. `apps/standalone-sveltekit/src/lib/agent-context/context-sources.ts` — when a turn creates an entity (event/booking context), the catalog/auto-seed must capture the created entity id + label into the chip.
**Verify:** unit tests for both.

---

## Wave 1 — Claude teammates (judgment work)

### H2 — Question-answer loop (Opus lane) — THE core feature

**Product intent (from `docs/handoffs/agent-ui-open-design-feature-suite-upgrade-2026-07-01.md` §5D and §9):** user edits the ask-user-question canvas → presses Continue → the answer (1) patches artifact state at the question's `writes_to` path, (2) persists an artifact version, (3) submits a structured `question_answer` turn to the agent, (4) agent asks the next question. Today only (1) happens — nothing returns to the agent, the loop stalls.
**Already built for this:** `AGENT_ANALYTICS_ENTRY_FROM` includes `"question_answer"` (`packages/tool-contracts/src/index.ts:1967`); run/context persistence rails from the retrofit; `QuestionCard.svelte` + `question-state.ts` + `ActionRail`.
**Design (donor: Open Design `<question-form>` submission → `entry_from: question_answer`):** an action (e.g. `submitAnswer`) bindable from QuestionCard/ActionRail that serializes `{questionId, value, writesTo, artifactId}`, applies the state patch + version persist, then posts a structured user turn through the existing generate transport with `analyticsHints.entryFrom: "question_answer"` and the answer payload in a machine-readable block the agent's intake skill understands. Agent-side: intake skill guidance to consume the answer and emit the next question.
**Files:** `packages/chat-surface/src/components/AgentConversation.svelte` (turn submission seam), `apps/standalone-sveltekit/src/routes/+page.svelte` (transport + state controller wiring), `lib/render/json-render-state-controller.ts` + `registry.ts` (new action), `lib/server/intake-artifacts.ts` + intake skill body (next-question flow), `api/generate/+server.ts` (accept answer turn).
**Verify:** end-to-end test: render intake question → programmatic answer + Continue → generate request carries question_answer turn → artifact version persisted → next question renders. Booking smokes unchanged.

### H4 — Embed abort/cutoff doesn't offer resume (Sonnet lane) — retrofit regression

**Symptom (session script):** a response cut off mid-word; no Continue affordance appeared; "keep going" typed manually regenerated from scratch instead of continuing.
**Root-cause hypotheses (verify in order):** (a) user-initiated stop / embed disconnect finalizes the run `succeeded` or non-resumable (the retrofit's MINOR 3 fix covered error *parts*; check the user-abort and transport-disconnect paths in `apps/standalone-sveltekit/src/lib/server/run-event-log.ts` `teeRunEvents`/finalize and the client stop path in `+page.svelte`); (b) run finalized correctly but the embed UI doesn't surface the Continue panel (`packages/chat-surface/src/components/AgentConversation.svelte` resumable rendering vs embed layout).
**Fix:** whichever hypothesis holds (possibly both). Cancel/abort should finalize `canceled`+`resumable`; Continue must render in the embedded sidecar layout.
**Verify:** extend `scripts/agent-ui-run-reattach-smoke.mjs` or dev-smoke fail injection with a client-abort scenario; assert resumable + Continue completes. Existing reattach tests unchanged.

---

## Wave 2 (after Wave 1 merges)

- **H5 — Embed survives host navigation + style isolation** (`/oh-my-claudecode:ultraqa`): host SPA route change tears the chat down (state loss) and embed styles bleed into host page (court-bookings spacing broke; "My Spaces" stat columns collide). Confirm iframe/shadow isolation; re-mount + rehydrate via session reattach on host navigation.
- **H6 — Session delta loading** (`/oh-my-claudecode:ralplan` FIRST): tab/chat switching is slow — every switch full-reads `/api/session/[id]`. Direction: load once + push/pull deltas using the run event log as cursor substrate. Architectural; plan before code.
- **H9 — Layout cluster** (one executor): header text collision at sidecar width; drag-to-resize chat/canvas splitter; reduce nested chrome boxes; gate Edit JSON/Inspector/Raw behind dev flag in embedded prod; fix occluded "Install another context" button.
- **H12 — TTFT measurement** (read-only, Pipe-B): 16s "Waiting for model response" observed before artifact stream.

## Wave 3 (spec first)

- **H11 — Attachments / rich context model** (`/oh-my-claudecode:plan`): two-tier model — `AgentContextItem` (references, exists) + new `AgentContextAttachment` payloads (`file-upload | clipboard-paste | screenshot-auto | screenshot-manual | drag-drop`), mime/size caps, blob storage route (R2), persisted on message + run for provenance. Donor: Open Design `ChatRequest.attachments` + comment attachments. Auto-screenshot is host-side capture posted on send.

## Verification gates (every lane)

- `pnpm test` exit 0 (full suite; booking/Pipe-B suites untouched), `pnpm build` exit 0, `pnpm check-types` 0 errors.
- New behavior needs a test that reproduces the reported symptom first.
- No raw validation errors in end-user DOM. No secrets in logs. No new dependencies without justification.
- Regression sentinels: reattach smoke (`pnpm smoke:agent-ui:run-reattach`, memory mode), prompt-equivalence test, context-selection lifecycle tests.

## What already works (do not "fix")

Context chips render/persist/provenance; inline-spec interactivity incl. state actions; progressive artifact streaming; run persistence + reattach in standalone; booking command flows; My Spaces page-context chip.

## Merge discipline

Lane branches merge back into `feat/analytics-hints-release-gate-20260702` sequentially, orchestrator-reviewed, order: H1 → H3 → H7/H8/H10 (any order) → H2 → H4. Full suite + smoke after each merge batch. Ledger: `.omc/ultragoal/plans/` (embed-hitlist plan).
