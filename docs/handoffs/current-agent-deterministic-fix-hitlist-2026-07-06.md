# Current Agent Deterministic Fix Lane — Do Not Overlap Handoff

Date: 2026-07-06  
Repo: `/Users/danielletterio/Documents/GitHub/sonik-agent-ui`  
Branch: `feat/analytics-hints-release-gate-20260702`  
Open PR: https://github.com/SonikFM/sonik-agent-ui/pull/5

This document marks the deterministic UI/runtime reliability fixes that the current agent should own. Fable/Claude Code should avoid editing these files/behaviors at the same time unless explicitly coordinating, so both agents can commit to the same PR without merge churn.

---

## Lane objective

Make the embedded Agent UI feel deterministic, recoverable, and less dev-facing without changing booking-service business logic.

Success means:

- embedded chat does not flash default state then silently jump;
- workspace calls do not fire without signed host context;
- intake questions show real save/failed/retry state;
- approval affordance only appears when preview is actually ready;
- session rail is readable and not one-letter bubbles;
- obvious dev-speak labels are replaced with operator-facing copy;
- targeted unit tests pass before deploy/smoke.

---

## Current agent ownership — do not overlap

### 1. Deterministic embedded session open

Primary files:

```text
apps/standalone-sveltekit/src/routes/+page.svelte
packages/workspace-session/src/index.ts
```

Tasks:

- Stop auto-switching embedded chat to the most recent session after initial render unless host/URL explicitly requested it.
- Add a loading/skeleton state while session resolution is pending.
- Prefer explicit `New chat` / `Continue last chat` behavior over silent jump.
- Avoid updating `last_accessed` merely because bootstrap read a session.

Likely tests:

```text
tests/unit/app-shell-session-rail.test.mjs
tests/unit/workspace-session.test.mjs
tests/unit/workspace-runtime-boundary.test.mjs
```

---

### 2. Host-context guard and visible recovery state

Primary files:

```text
apps/standalone-sveltekit/src/routes/+page.svelte
packages/agent-embed/src/index.ts
```

Tasks:

- Gate cloud workspace/API calls until signed host context is ready.
- Add visible embedded recovery copy: `Reconnecting to host context…` / `Host context unavailable` with retry path.
- Cache last valid signed host context until expiry, but never past expiry.
- Add telemetry state for missing/expired/recovered host context.

Likely tests:

```text
tests/unit/workspace-runtime-boundary.test.mjs
tests/unit/agent-embed.test.mjs
tests/unit/agent-ui-release-gate.test.mjs
```

---

### 3. QuestionCard save receipts and retryable failures

Primary files:

```text
packages/json-ui-runtime/src/components/QuestionCard.svelte
packages/svelte/src/ElementRenderer.svelte
apps/standalone-sveltekit/src/routes/+page.svelte
apps/standalone-sveltekit/src/lib/tools/artifact-state.ts
```

Tasks:

- QuestionCard should not show saved/sent until persistence succeeds.
- Add states: `idle`, `saving`, `saved`, `failed`.
- Failed persistence should show inline error + retry affordance.
- Preserve answer state; do not advance workflow on failed save.

Likely tests:

```text
tests/unit/question-answer-loop.test.mjs
tests/unit/json-render-state-controller.test.mjs
tests/unit/intake-controller-actions.test.mjs
```

---

### 4. Intake approval card phase gating

Primary files:

```text
apps/standalone-sveltekit/src/routes/+page.svelte
apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts
packages/json-ui-runtime/src/intake.ts
```

Tasks:

- Stop showing persistent `Ready to create context` just because a booking intake artifact is active.
- Show approval affordance only when:
  - required fields are valid;
  - preview command exists;
  - input hash is stable;
  - trusted host can request/approve the command.
- Replace dev-facing copy with operator copy:
  - `Preview setup`
  - `Request approval`
  - `Create context`
  - `Draft needs required fields`
- Do not treat chat text `approve` as trusted approval.

Likely tests:

```text
tests/unit/intake-controller-actions.test.mjs
tests/unit/intake-artifact-persistence.test.mjs
tests/unit/agent-prompt-composition.test.mjs
```

---

### 5. Session rail compact rows and copy polish

Primary files:

```text
apps/standalone-sveltekit/src/lib/session/SessionRail.svelte
apps/standalone-sveltekit/src/routes/+page.svelte
```

Tasks:

- Replace one-letter bubble rail with compact readable rows.
- Remove native `title` tooltip usage.
- Expose accessible labels and disabled reasons.
- Use small readable labels like:
  - `Reservation`
  - `Venue setup`
  - `Policy Q&A`
  - `Canvas draft`
- Spinner only appears on the session being loaded, not every hover.

Likely tests:

```text
tests/unit/app-shell-session-rail.test.mjs
```

---

### 6. Obvious UX label cleanup

Primary files:

```text
apps/standalone-sveltekit/src/routes/+page.svelte
apps/standalone-sveltekit/src/lib/agent-workflows/suggestions.ts
apps/standalone-sveltekit/src/lib/agent.ts
apps/standalone-sveltekit/src/lib/tools/*
```

Tasks:

- `Start Over` → `New chat` or `Clear chat`, depending actual handler.
- `Workspace Docs` → clearer label or hide when unavailable.
- Tool activity labels should show friendly summaries instead of raw command/tool names.
- Stop saying generic `booking created`; use exact domain result:
  - `Context created`
  - `Reservation confirmed`
  - `Draft saved`
  - `Approval requested`

Likely tests:

```text
tests/unit/tool-activity-projection.test.mjs
tests/unit/chat-text.test.mjs
tests/unit/workflow-suggestions.test.mjs
```

---

## Files Fable should avoid unless coordinating

```text
apps/standalone-sveltekit/src/routes/+page.svelte
apps/standalone-sveltekit/src/lib/session/SessionRail.svelte
apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts
apps/standalone-sveltekit/src/lib/tools/artifact-state.ts
packages/json-ui-runtime/src/components/QuestionCard.svelte
packages/json-ui-runtime/src/intake.ts
packages/svelte/src/ElementRenderer.svelte
packages/workspace-session/src/index.ts
packages/agent-embed/src/index.ts
```

If Fable must edit any of these, coordinate by file and slice first.

---

## Work Fable can safely own in parallel

Fable should focus on higher-judgment / architecture lanes that do not conflict with the above implementation files.

Recommended safe lanes:

1. **Agent onboarding skill design**
   - New skill spec and writing-skills RED/GREEN plan.
   - Avoid runtime code until approved.

2. **Marketplace/workflow template architecture**
   - Data model / ORPC contracts / install-grant lifecycle.
   - Docs and PRD work.
   - Avoid current runtime files unless coordinating.

3. **Dev-mode inspector proposal**
   - Design doc for embedded dev panel: host context, Pipe-B tail status, command/skill inspector, artifact state, current deploy/commit.

4. **Enterprise UX audit**
   - Use `$sonik-enterprise-ux-elevation` and `$impeccable` for critique docs.
   - Do not polish the same components being changed in this lane until after this lane lands.

5. **Booking-service / Amplify host review**
   - Read-only checks of host embed vars, wrangler configs, Pipe-B deployments, PR branch state.
   - Do not mutate agent-ui runtime files.

---

## Verification command set for this lane

Run targeted tests first, then broader checks:

```bash
node --experimental-strip-types tests/unit/app-shell-session-rail.test.mjs
node --experimental-strip-types tests/unit/question-answer-loop.test.mjs
node --experimental-strip-types tests/unit/intake-controller-actions.test.mjs
node --experimental-strip-types tests/unit/json-render-state-controller.test.mjs
node --experimental-strip-types tests/unit/workspace-runtime-boundary.test.mjs
node --experimental-strip-types tests/unit/tool-activity-projection.test.mjs
pnpm check-types
pnpm test
pnpm build
```

After implementation and local validation, deploy Agent UI only if authorized/needed:

```bash
cd apps/standalone-sveltekit
pnpm exec wrangler deploy
```

Then run `$ultratest` with Pipe-B tail evidence against:

```text
https://sonik-booking-app-pipe-b.liam-trampota.workers.dev
```

Test account:

```text
test69@gmail.com
test6969
```

---

## Stop condition

This lane is complete when:

- deterministic session open behavior is tested;
- missing host context no longer causes silent cloud calls;
- QuestionCard failed saves are visible/retryable;
- approval CTA is phase-gated;
- session rail is readable;
- label cleanup is covered by tests;
- no broad unrelated marketplace/workflow-template files were disturbed.

