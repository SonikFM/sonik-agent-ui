# Fable 5 / Claude Code Operational Handoff — Agent UI Embedded Reliability + Future Skill Onboarding

Date: 2026-07-06  
Primary repo/worktree: `/Users/danielletterio/Documents/GitHub/sonik-agent-ui`  
Primary branch: `feat/analytics-hints-release-gate-20260702`  
Open PR: https://github.com/SonikFM/sonik-agent-ui/pull/5  
PR title: `Open Design architecture retrofit: run lifecycle, context chips, live streaming, prompt modules, analytics + release gate`  
Base: `codex/booking-command-copy-retrofit-20260629150347`

This handoff is for a stronger/faster Claude Code/Fable 5 agent working in the **same local workspace and same open PR** as the current agent. Do not create a competing branch unless asked. Coordinate before touching files currently modified by another agent.

---

## 0. First task for the incoming agent

Get up to speed before implementing:

1. Run GitNexus / repo orientation against the current workspace.
   - Use GitNexus-style exploration for file/symbol impact, not memory.
   - Recommended first commands:
     ```bash
     git status --short --branch
     git log --oneline --decorate -20
     gh pr view --json number,title,headRefName,baseRefName,url,state
     rg -n "booking.context.intake|QuestionCard|submitAnswer|commitActiveIntake|previewActiveIntake|approvedCommand|workspace docs|Start Over|SessionRail|commandFamilies|host-context|missing-host-context" apps packages tests docs
     ```
2. Read the key skills listed below.
3. Review the current uncommitted diff and do **not** overwrite unrelated marketplace/workflow-template work.
4. Inspect recent `.omx/logs` / `.omx/artifacts` for Pipe-B and ultratest evidence before claiming backend success.
5. Produce a short “current state + proposed first slice” note before implementing.

---

## 1. Current local state

`sonik-agent-ui` currently has uncommitted work from the marketplace/workflow-template lane:

```text
 M apps/standalone-sveltekit/src/lib/agent-workflows/suggestions.ts
 M apps/standalone-sveltekit/src/lib/agent.ts
 M docs/handoffs/workspace-creation-tool-design-agent-handoff-2026-07-05.md
 M package.json
?? apps/standalone-sveltekit/src/lib/agent-workflows/templates.ts
?? apps/standalone-sveltekit/src/lib/tools/marketplace-workflows.ts
?? docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/
?? tests/unit/marketplace-workflow-templates.test.mjs
```

Do not discard these. If your task does not touch marketplace workflow templates, avoid these files.

---

## 2. What the current agent can deterministically fix

These are bounded, mostly local, and suitable for the current agent or any standard executor. They should be test-first where feasible.

### A. Copy/label cleanup and dev-speak removal

Files likely involved:

- `apps/standalone-sveltekit/src/routes/+page.svelte`
- `apps/standalone-sveltekit/src/lib/agent-workflows/suggestions.ts`
- `apps/standalone-sveltekit/src/lib/session/SessionRail.svelte`
- `apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts`
- `packages/json-ui-runtime/src/intake.ts`

Deterministic changes:

- Rename `Start Over` to `New chat` or `Clear chat`, matching actual behavior.
- Rename/clarify `Workspace Docs` to a user-facing label or hide it when not available.
- Stop showing command IDs and raw tool names as primary UX copy.
- Replace “booking created” with domain-specific neutral receipts:
  - `Context created`
  - `Reservation confirmed`
  - `Draft saved`
  - `Approval requested`
- Improve command/tool activity projection copy so users see helpful summaries, not `searchCommandCatalog`, `learnSkill`, or `commitCommand` spam.

### B. Session rail visual/UX cleanup

File:

- `apps/standalone-sveltekit/src/lib/session/SessionRail.svelte`

Deterministic changes:

- Convert collapsed side rail from bubble-like one-letter chips to compact rows.
- Remove native `title` tooltip usage; use accessible label + app tooltip if needed.
- Use readable compact labels like `Reservation`, `Venue setup`, `Policy Q&A` instead of `P`, `A`, `R` bubbles.
- Avoid hover spinner unless a session is actually loading.
- Ensure disabled controls expose `disabledReason` / aria label rather than silent no-op.

### C. Host-context guard and visible recovery state

Files likely involved:

- `apps/standalone-sveltekit/src/routes/+page.svelte`
- `packages/agent-embed/src/index.ts`
- related tests in `tests/unit/*host*`, `tests/unit/*workspace*`, `tests/unit/*embed*`

Deterministic changes:

- Gate workspace cloud calls until signed host context exists.
- If signed context is temporarily missing, show `Reconnecting to host context…` instead of firing cloud requests without headers.
- Cache last valid signed host context until expiry; never use it after expiry.
- Emit telemetry for `host_context_missing`, `host_context_expired`, `host_context_recovered`.
- Regression: no `/api/session`, `/api/document`, `/api/artifact`, or `/api/generate` cloud call should be made from embedded mode with missing signed host context unless explicitly marked local-only.

### D. Deterministic session open behavior

File:

- `apps/standalone-sveltekit/src/routes/+page.svelte`
- maybe `packages/workspace-session/src/index.ts`

Known cause:

- Current boot loads sessions and auto-switches to `sessions[0]`, ordered by `last_accessed desc`.
- UI can briefly show default chat, then jump to the last open chat.

Deterministic fix:

- Embedded mode should open deterministically:
  - explicit `sessionId` from host/URL → load that;
  - otherwise show `New chat` or `Continue last chat` affordance;
  - do not silently auto-jump after initial render.
- Show a loading skeleton while session state is resolving.
- Avoid updating `last_accessed` just because a session was read for bootstrap; update it on explicit switch/send.

### E. Intake save/selector receipts

Files:

- `packages/json-ui-runtime/src/components/QuestionCard.svelte`
- `packages/svelte/src/ElementRenderer.svelte`
- `apps/standalone-sveltekit/src/routes/+page.svelte`
- `apps/standalone-sveltekit/src/lib/tools/artifact-state.ts`

Deterministic changes:

- Do not show “saved”/“sent” until server persistence succeeds.
- Add `saving`, `saved`, `failed`, `retry` lifecycle states.
- `Save draft` must produce visible receipt or visible error.
- Failed `persistActiveArtifactStatePatch` must keep the user on the same question and explain the retry.

### F. Approval-card phase gating

Files:

- `apps/standalone-sveltekit/src/routes/+page.svelte`
- `apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts`
- `packages/json-ui-runtime/src/intake.ts`

Deterministic changes:

- Do not show persistent “Ready to create context” just because a booking intake artifact is active.
- Show approval affordance only when:
  - required fields valid;
  - preview command computed;
  - input hash stable;
  - host says command can be requested.
- User text approval is not trusted approval. Trusted UI/host/session action only.

---

## 3. Work that should go to the stronger Fable 5 / Claude Code agent

These require more judgment, cross-repo awareness, or architecture design.

### A. Agent onboarding skill design

Goal: create a reusable local/remote skill that gets new agents up to speed quickly.

Suggested output:

- `sonik-agent-onboarding` skill or equivalent.
- Should teach agents:
  - repo topology;
  - branch/PR discipline;
  - Pipe-B evidence requirements;
  - host-context handshake;
  - booking/amplify/agent-ui relationship;
  - what to verify before claiming success;
  - which skills to load for which work.

This should be created using `$sonik-skill-creation` + `writing-skills` methodology, not just a prompt blob.

### B. Workflow-builder / marketplace template architecture

Goal: think through agents/apps/workflows as marketplace-publishable templates.

Inputs already in repo:

- `docs/handoffs/workspace-creation-tool-design-agent-handoff-2026-07-05.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/`
- Marketplace PRD:
  `/Users/danielletterio/Documents/Sonik_Amplify/prds-vision-2026-05-01/Amplify Future Features_unfinished/uploads/marketplace-prd-vision-2026-05-01.md`
- Web builder PRD:
  `/Users/danielletterio/Documents/Sonik_Amplify/prds-vision-2026-05-01/Amplify Future Features_unfinished/uploads/web-builder-prd-vision-2026-05-01.md`
- Dify/n8n recon:
  `/Users/danielletterio/Documents/Sonik_Amplify/recon-mission-2026-05-06/summit-corpus/06-dify`
  `/Users/danielletterio/Documents/Sonik_Amplify/recon-mission-2026-05-06/summit-corpus/05-n8n`

Important direction:

- Agents, apps, workflows, templates should become typed, installable, shareable, and eventually marketplace-publishable.
- Do not embed executable command payloads inside JSON renderer specs.
- Renderer collects input; trusted controller maps to commands.
- Marketplace install should eventually grant skill/tool visibility and host command permissions through typed contracts and audit trails.

### C. Type-safe ORPC / contract placement plan

Need a stronger architectural pass on where contracts live:

- `packages/tool-contracts` for generic command/result/approval/workflow contracts.
- `packages/json-ui-runtime` for JSON-render/A2UI surface contracts.
- Agent UI app for host adapters and runtime registries.
- Booking service owns booking business ORPC/OpenAPI contracts.
- Amplify owns campaign/customer/message workflow contracts.
- Marketplace install/grant/search endpoints should likely live in the platform host, then be exposed through Agent UI.

### D. Dev mode / embedded dev server idea

The user is considering a dev mode where a development server is embedded directly on the site for faster iteration.

Research target:

- Cloudflare deployment tools / Workers dev, version aliases, preview URLs, service bindings, and possibly a dev overlay panel.
- Goal is not to ship a heavy dev console to users; it is an internal harness for rapid embedded Agent UI iteration.

Likely deliverable:

- One-page design/proposal: `Agent UI Dev Mode`
- Features:
  - current deploy/version/commit display;
  - host context inspector;
  - Pipe-B tail status;
  - command/skill catalog inspector;
  - active artifact state inspector;
  - “copy repro prompt” / “copy page context”;
  - local/deployed URL switcher.

### E. Design/UX critique pass

Use `$sonik-enterprise-ux-elevation` + `$impeccable` after gates. The stronger agent should evaluate:

- sidecar IA;
- session rail;
- approval flow;
- context chips;
- form/agent parity;
- workflow launchers;
- marketplace/workflow template UX;
- dead controls and disabled reasons;
- dev-speak leaks.

---

## 4. Key skills the incoming agent must know/use

The user explicitly wants these skills in play.

### Agent UI / contracts / commands

- `$sonik-agent-ui`
  - machine-readable page context;
  - semantic actions;
  - question surfaces are input collectors, not command executors;
  - answered questions are not approval;
  - integrated boundary proof required.

- `$sonik-tool-creation`
  - commands are registry-backed contracts;
  - no inline family strings;
  - explicit load policies;
  - writes go through `commitCommand` with trusted host/session approval;
  - generated ORPC/OpenAPI catalogs must be drift-checked;
  - renderer JSON must not include executable `tool_call`, endpoint strings, or commit payloads.

- `$sonik-skill-creation`
  - skills teach workflow; tools/commands execute;
  - runtime skills need family registry, load policy, learn/search tests, examples, wrong-path prevention;
  - demo-critical flows require integrated proof from `searchSkillCatalog -> learnSkill -> renderer answer -> trusted command receipt`.

- `$sonik-accessibility`
  - use for booking/capability modeling;
  - never model restaurants/tee sheets/hotel stays as Events;
  - use `bookable_context = event | venue_schedule | resource`;
  - availability computed from rules, not authored slot rows;
  - honest labels: EXISTS / FIXTURE / MISSING / CANDIDATE-GAP / FROZEN / UNDECIDED.

### Svelte / component work

- `$svelte-code-writer`
  - use Svelte MCP docs/autofixer when editing `.svelte` or `.svelte.ts`.

- `$svelte-runes`
  - use `$state`, `$derived`, `$effect`, `$props`, `$bindable` correctly.

- `$sveltekit-data-flow`
  - server/client data boundaries, form action patterns, serialization.

- `$sveltekit-patterns`
  - SvelteKit architecture and Sonik conventions.

- `$sveltekit-remote-functions`
  - evaluate only if adding `.remote.ts` command/query/form patterns.

- `$sonik-component-design`
  - schema-driven, JSON/A2UI-renderable, builder-adaptable, agent-readable components;
  - pure renderers; state/actions outside components;
  - Storybook/tests/schema/adapters when extracting new components.

### Quality/testing

- `$ultratest`
  - bounded validation through `$ultragoal`;
  - browser + page context + network + Pipe-B evidence required for PASS;
  - empty/stale Pipe-B is INCONCLUSIVE, not PASS.

- `$sonik-enterprise-ux-elevation`
  - anti-slop / enterprise gates;
  - classify defect ownership;
  - no native tooltips, silent no-ops, dead controls, missing disabled reasons.

- `$impeccable`
  - high-craft UI critique/polish after gates.

### Copy / integration / host lanes

- `$analyze-copy-retrofit`
  - direct-copy manifest first, retrofit second, behavioral parity proof last.

- `$ultragrate`, `$ultragrate-host`, `$ultragrate-platform-host`, `$ultragrate-prep`
  - use only when dealing with provider/package/platform integration seams.
  - Do not start UX before SDK/host seam readiness.

---

## 5. Repo/worktree map

### Agent UI

```text
/Users/danielletterio/Documents/GitHub/sonik-agent-ui
```

Current branch:

```text
feat/analytics-hints-release-gate-20260702
```

Open PR:

```text
PR #5 — https://github.com/SonikFM/sonik-agent-ui/pull/5
```

Important files:

```text
apps/standalone-sveltekit/src/routes/+page.svelte
apps/standalone-sveltekit/src/lib/session/SessionRail.svelte
apps/standalone-sveltekit/src/lib/agent-context/context-sources.ts
apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts
apps/standalone-sveltekit/src/lib/tools/artifact-state.ts
apps/standalone-sveltekit/src/lib/tools/marketplace-workflows.ts
apps/standalone-sveltekit/src/lib/agent-workflows/templates.ts
apps/standalone-sveltekit/src/lib/agent-workflows/suggestions.ts
packages/json-ui-runtime/src/intake.ts
packages/json-ui-runtime/src/renderer/JsonArtifactRenderer.svelte
packages/json-ui-runtime/src/components/QuestionCard.svelte
packages/svelte/src/ElementRenderer.svelte
packages/svelte/src/contexts/ActionProvider.svelte
packages/svelte/src/contexts/StateProvider.svelte
packages/workspace-session/src/index.ts
packages/agent-embed/src/index.ts
packages/tool-contracts/src
```

### Booking service

```text
/Users/danielletterio/Documents/GitHub/sonik-booking-service
```

Current local branch at handoff time:

```text
codex/booking-agent-ui-runtime-bridge
```

Important deploy/runtime files:

```text
packages/service/wrangler.toml
apps/booking/wrangler.toml
packages/dev-observability-worker/wrangler.toml
```

Pipe-B worker names from wrangler config:

```text
sonik-booking-service-pipe-b
sonik-booking-app-pipe-b
sonik-dev-observability-pipe-b
```

Booking app public URL:

```text
https://sonik-booking-app-pipe-b.liam-trampota.workers.dev
```

Booking API/service URL:

```text
https://sonik-booking-service-pipe-b.liam-trampota.workers.dev
```

### Amplify

```text
/Users/danielletterio/Documents/GitHub/sonik-dev/amplify/amplify
```

Current local branch at handoff time:

```text
main
```

Important file:

```text
wrangler.jsonc
```

Staging URL:

```text
https://amplify-staging.liam-trampota.workers.dev
```

---

## 6. Deploy and validation commands

### Agent UI build/test/deploy

From `/Users/danielletterio/Documents/GitHub/sonik-agent-ui`:

```bash
pnpm check-types
pnpm test
pnpm build
cd apps/standalone-sveltekit
pnpm exec wrangler deploy
```

Agent UI Worker config:

```text
apps/standalone-sveltekit/wrangler.jsonc
```

Current Worker name:

```text
sonik-agent-ui
```

Important wrangler vars/service bindings:

```jsonc
"BOOKING_SERVICE" -> "sonik-booking-service-pipe-b"
"PUBLIC_AGENT_UI_ALLOWED_HOST_ORIGINS": "https://*.workers.dev,https://*.sonik.fm"
"SONIK_BOOKING_API_BASE_URL": "https://sonik-booking-service-pipe-b.liam-trampota.workers.dev"
"SONIK_AGENT_UI_PERSISTENCE_MODE": "cloud"
"SONIK_AGENT_UI_ENABLE_SMOKE_HOST_CONTEXT_SIGNER": "true"
```

### Booking service Pipe-B deploy

From `/Users/danielletterio/Documents/GitHub/sonik-booking-service`:

```bash
cd packages/service
pnpm exec wrangler deploy --env pipe_b
```

### Booking app Pipe-B deploy

From `/Users/danielletterio/Documents/GitHub/sonik-booking-service`:

```bash
cd apps/booking
pnpm build
pnpm exec wrangler deploy --env pipe_b
```

### Amplify staging deploy

From `/Users/danielletterio/Documents/GitHub/sonik-dev/amplify/amplify`:

```bash
CLOUDFLARE_ENV='staging' pnpm run build
pnpm exec wrangler deploy --env staging
```

Only do this if the task actually changes Amplify or needs fresh host deploy verification.

---

## 7. Pipe-B logs and evidence requirements

Do not claim backend success without fresh evidence.

Start a local tail before browser actions:

```bash
mkdir -p .omx/artifacts
wrangler tail sonik-dev-observability-pipe-b --format json \
  > .omx/artifacts/pipe-b-tail-$(date +%Y%m%d%H%M%S).jsonl
```

If working in booking-service, first verify Pipe-B deployment/listing:

```bash
export CLOUDFLARE_ACCOUNT_ID=d3a404523f0bca16a181539cd86c9a45
(cd packages/dev-observability-worker && pnpm exec wrangler deployments list --env pipe_b)
(cd packages/service && pnpm exec wrangler deployments list --env pipe_b)
(cd apps/booking && pnpm exec wrangler deployments list --env pipe_b)
```

Expected governance evidence from `$ultratest`:

- browser route and screenshot;
- `window.__sonikAgentUI.getPageContext()` when available;
- auth/org state;
- active page/domain context;
- network responses with `x-sonik-request-id`, `x-sonik-trace-id`, `traceparent` when present;
- Pipe-B events for same time window or request/trace id;
- command receipts for service-backed actions;
- classification: PASS / FAIL / INCONCLUSIVE.

Important: empty/stale Pipe-B logs are **INCONCLUSIVE**, not PASS.

Recent current-session Pipe-B tail attempt captured zero events over a short window:

```text
.omx/artifacts/pipe-b-tail-investigation-20260706012348.jsonl
.omx/artifacts/pipe-b-tail-investigation-20260706012348.stderr.log
```

Do not use that as proof of backend success.

---

## 8. Known test account / manual smoke defaults

Booking app Pipe-B URL:

```text
https://sonik-booking-app-pipe-b.liam-trampota.workers.dev
```

Test login:

```text
test69@gmail.com
test6969
```

Known important workflows:

1. Reservation canonical flow:
   - `searchSkillCatalog`
   - `learnSkill booking.reservation.create`
   - `learnCommand booking.get.availability`
   - `executeCommand booking.get.availability`
   - `learnCommand booking.create.guest`
   - `commitCommand booking.create.guest`
   - `learnCommand booking.create.booking`
   - `commitCommand booking.create.booking`
   - Do **not** call `booking.create.hold` unless explicitly testing holds.

2. Booking context intake:
   - `searchSkillCatalog booking.context.intake`
   - `learnSkill booking.context.intake`
   - render intake artifact;
   - collect question answers;
   - preview command;
   - request trusted approval;
   - commit only through trusted approval.

---

## 9. Open bugs / symptoms to prioritize

From the latest user reports and code inspection:

1. Sidecar opens default/regular chat, then jumps to last session.
2. Missing host context recurs after deployments or host reloads.
3. Context chips/command family behavior is unclear to the user.
4. `Workspace Docs` button is confusing and may be dead/incorrect in sidecar.
5. `Start Over` naming is wrong.
6. Chat-only sidecar does not expose useful chat history.
7. Session rail old chats look like bubbles / one-letter rows.
8. Tool calls and commands are exposed in dev-speak.
9. Intake QuestionCard selector/save sometimes appears to save but does not persist.
10. User cannot easily submit artifact/form data to the agent.
11. Agent cannot reliably patch the same JSON artifact/form state the user edits.
12. Approval button/card flow is unclear and phase-insensitive.
13. Approval card persists as “Ready to create context” too early.
14. JSON renderer action crash / generic `Internal Error` still appears in some manual flows.
15. Need drag/resize of sidecar/canvas split.

---

## 10. Recommended first implementation slice for Fable 5

If Dan asks to execute, start with this tightly scoped slice:

### Objective

Fix embedded Agent UI determinism and intake form reliability without changing booking-service business logic.

### Scope

1. Deterministic embedded session open policy.
2. Host-context request gating + visible reconnect state.
3. QuestionCard save receipts and retryable failures.
4. Intake approval card phase gating.
5. Session rail compact rows.
6. Tool activity projection copy cleanup.

### Tests to add/update

Likely tests:

```text
tests/unit/app-shell-session-rail.test.mjs
tests/unit/question-answer-loop.test.mjs
tests/unit/intake-controller-actions.test.mjs
tests/unit/json-render-state-controller.test.mjs
tests/unit/workspace-runtime-boundary.test.mjs
tests/unit/agent-ui-release-gate.test.mjs
tests/unit/tool-activity-projection.test.mjs
```

Commands:

```bash
pnpm check-types
pnpm test
pnpm build
```

Then deploy Agent UI and run `$ultratest` with Pipe-B tail.

---

## 11. What not to do

- Do not model restaurants or tee sheets as Events.
- Do not let JSON renderer execute backend commands directly.
- Do not treat a user answer as write approval.
- Do not mark generated ORPC/OpenAPI commands as mounted unless the live adapter exists.
- Do not handwrite large command catalogs.
- Do not expose all 72+ booking commands in prompt context up front.
- Do not claim Pipe-B/backend success from screenshots alone.
- Do not create a competing branch/PR unless Dan explicitly wants one.
- Do not deploy Amplify/booking service casually if only Agent UI changed.
- Do not overwrite current uncommitted marketplace/workflow-template work.

---

## 12. Longer-term: agent onboarding skill proposal

After the immediate reliability slice, create a local skill, tentatively:

```text
sonik-agent-onboarding
```

Purpose:

- Quickly orient new agents to Sonik Agent UI, Booking Service, Amplify, Pipe-B, PR/deploy conventions, and critical skills.

Should include:

- repo map;
- current PR discovery commands;
- key skills by task;
- deploy commands;
- Pipe-B logging protocol;
- page context and host context invariants;
- “do not claim verified unless...” checklist;
- common failure cases;
- ultratest evidence template.

Use `$sonik-skill-creation` and `writing-skills` for this. It should be a skill, not just another handoff doc.

