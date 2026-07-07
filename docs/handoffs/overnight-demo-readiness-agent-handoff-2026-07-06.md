# Overnight Demo Readiness Handoff — Agent UI + Booking Embed

Date: 2026-07-06  
Repo: `/Users/danielletterio/Documents/GitHub/sonik-agent-ui`  
Branch: `feat/analytics-hints-release-gate-20260702`  
Open PR: https://github.com/SonikFM/sonik-agent-ui/pull/5  
Primary demo target: embedded Agent UI inside `sonik-booking-app-pipe-b` with booking/reservation workflows demo-ready tomorrow.

This is the pickup brief for a long-running Claude/Fable/Codex agent. Work in this same branch/PR unless the user explicitly says otherwise. Do not create a competing branch. Do not discard local uncommitted work.

---

## 0. First 10 minutes — required orientation

Run these before editing anything:

```bash
git status --short --branch
git log --oneline --decorate -20
gh pr view --json number,title,headRefName,baseRefName,url,state
rg -n "booking.context.intake|QuestionCard|submitAnswer|requestApproval|approveAndRun|commitActiveIntake|previewActiveIntake|visibleErrors|getPageContext|__sonikAgentUI|missing-host-context|approvedCommandIds|SessionRail|New chat|Workspace Docs" apps packages tests docs
```

Then load these skills as needed:

- `$sonik-agent-onboarding` first.
- `$sonik-agent-ui` for page context, semantic UI actions, embedded app behavior.
- `$sonik-tool-creation` for command registry, `commitCommand`, approval doctrine, no inline executable payloads.
- `$sonik-skill-creation` for workflow/skill recipes and runtime skill affordances.
- `$sonik-accessibility`, `$sonik-component-design`, `$sonik-enterprise-ux-elevation`, `$impeccable` for UX/accessibility quality gates.
- `$svelte-code-writer`, `$svelte-runes`, `$sveltekit-data-flow`, `$sveltekit-patterns`, `$sveltekit-remote-functions` for Svelte/SvelteKit work.
- `$ultratest` for browser + Pipe-B evidence.
- `$analyze-copy-retrofit` if borrowing UI/workflow patterns from Amplify, booking service, Dify, n8n, Open Design, etc.
- GitNexus skills for repo exploration/impact analysis.

---

## 1. Current committed/deployed baseline

The current deterministic Agent UI fix was committed and deployed:

- Commit: `97d90ae Fix embedded agent determinism`
- Branch pushed: `origin/feat/analytics-hints-release-gate-20260702`
- Agent UI Worker: `sonik-agent-ui`
- Deployed URL: `https://sonik-agent-ui.liam-trampota.workers.dev`
- Deployed Worker version: `a2b50794-1628-44d5-9d7c-96c59c69c8e1`
- Deploy output reported Tail Worker events routed to: `sonik-dev-observability-pipe-b`

Committed changes in `97d90ae`:

- Added signed host-context authority helper:
  - `apps/standalone-sveltekit/src/lib/host-context-authority.ts`
- Added QuestionCard state pointer helper:
  - `apps/standalone-sveltekit/src/lib/render/question-card-state.ts`
- Hardened QuestionCard save/error lifecycle:
  - `apps/standalone-sveltekit/src/lib/render/components/QuestionCard.svelte`
  - `apps/standalone-sveltekit/src/lib/render/component-prop-safety.ts`
  - `apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts`
- Reduced session rail noise / renamed Start Over:
  - `apps/standalone-sveltekit/src/lib/session/SessionRail.svelte`
  - `apps/standalone-sveltekit/src/routes/+page.svelte`
- Chat surface copy/behavior:
  - `packages/chat-surface/src/components/AgentConversation.svelte`
- Tests updated:
  - `tests/unit/app-shell-session-rail.test.mjs`
  - `tests/unit/h3-choicecards-validation.test.mjs`

Verification before commit:

```bash
pnpm --filter @sonik-agent-ui/chat-surface build
pnpm --filter svelte-chat check-types
node --experimental-strip-types tests/unit/h3-choicecards-validation.test.mjs
node --experimental-strip-types tests/unit/question-answer-loop.test.mjs
node --experimental-strip-types tests/unit/intake-command-execution-seam.test.mjs
node --experimental-strip-types tests/unit/enterprise-agent-ux-foundation.test.mjs
node tests/unit/app-shell-session-rail.test.mjs
node --experimental-strip-types tests/unit/runtime-skill-registry.test.mjs
node --experimental-strip-types tests/unit/tool-contracts.test.mjs
pnpm --filter svelte-chat build
```

Independent review status before commit:

- Architect: CLEAR.
- Code-reviewer: initial REQUEST_CHANGES for stale host-context cache and source-only tests; fixed and re-reviewed APPROVE.

---

## 2. Current uncommitted local work — do not overwrite

At the time this handoff was written, the tree still had unrelated marketplace/workflow-template work:

```text
 M apps/standalone-sveltekit/src/lib/agent-workflows/suggestions.ts
 M apps/standalone-sveltekit/src/lib/agent.ts
 M docs/handoffs/workspace-creation-tool-design-agent-handoff-2026-07-05.md
 M package.json
?? apps/standalone-sveltekit/src/lib/agent-workflows/templates.ts
?? apps/standalone-sveltekit/src/lib/tools/marketplace-workflows.ts
?? docs/handoffs/current-agent-deterministic-fix-hitlist-2026-07-06.md
?? docs/handoffs/fable5-agent-ui-operational-handoff-2026-07-06.md
?? docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/
?? docs/skills/
?? tests/unit/marketplace-workflow-templates.test.mjs
```

These appear to be the marketplace/workflow-template lane. Inspect before touching. If your task does not require them, leave them alone.

Useful handoffs already present:

- `docs/handoffs/fable5-agent-ui-operational-handoff-2026-07-06.md`
- `docs/handoffs/current-agent-deterministic-fix-hitlist-2026-07-06.md`
- `docs/handoffs/workspace-creation-tool-design-agent-handoff-2026-07-05.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/`

---

## 3. Last live smoke result — important

A bounded post-deploy smoke was run after `97d90ae` deploy. Verdict: **not demo-ready yet**.

### 3.1 Agent UI deploy metadata

`wrangler deployments list` showed latest Agent UI deploy:

- Created: `2026-07-06T07:25:28.821Z`
- Version: `a2b50794-1628-44d5-9d7c-96c59c69c8e1`

### 3.2 Pipe-B telemetry

A local tail was started:

```bash
wrangler tail sonik-dev-observability-pipe-b --format json > .omx/artifacts/pipe-b-tail-agent-ui-20260706032703.jsonl
```

Result: **0 captured lines** during the smoke window.

Interpretation: Pipe-B is configured in deploy output, but this run had no fresh tail evidence. Treat backend/log proof as **INCONCLUSIVE**, not PASS.

Tail Worker deployment list was accessible and saved to:

- `.omx/logs/pipe-b-deployments-20260706.json`

### 3.3 Deployed fake host smoke

Artifacts:

- JSON: `.omx/logs/agent-ui-postdeploy-agent-ui-postdeploy-1783322959477.json`
- Screenshot: `.omx/logs/agent-ui-postdeploy-agent-ui-postdeploy-1783322959477.png`

Result:

- Agent UI iframe visible: yes.
- Missing-host-context visible: no.
- Context chip visible: yes.
- `/api/dev/smoke-host-context` returned `404`.

Curl confirmed deployed fake host cannot use the dev signer:

```text
404 {"message":"Smoke host context signer is local-dev only."}
```

Interpretation: the deployed fake host is not a valid signed-production embed smoke. It can check UI shape, but it cannot validate signed host runtime.

### 3.4 Real booking app smoke

Artifacts:

- JSON: `.omx/logs/booking-embed-smoke-booking-embed-1783323112252.json`
- Screenshot: `.omx/logs/booking-embed-smoke-booking-embed-1783323112252.png`
- DOM discovery: `.omx/logs/booking-embed-dom-discovery.json`

Authenticated with:

- email: `test69@gmail.com`
- password: `test6969`

Result:

- Landed on `https://sonik-booking-app-pipe-b.liam-trampota.workers.dev/dashboard`.
- API failures: 0.
- Severe console errors: 0.
- Visible missing-host-context: false.
- Agent UI iframe visible: false.
- Iframe was present but blank/zero-size:

```json
{
  "id": "booking-agent-ui-frame",
  "title": "Sonik Agent UI",
  "src": "",
  "className": "booking-agent-frame svelte-1n3mee",
  "hidden": false,
  "rect": { "x": 0, "y": 0, "w": 0, "h": 0 }
}
```

Interpretation: booking app is authenticated and has an embed shell/global, but the iframe is `about:blank`/empty `src` and `0x0`. This is probably a booking host embed mounting/configuration issue, not an Agent UI Worker deployment issue.

---

## 4. Latest audit finding from cut-off agent

The agent-readability audit found the most strategically important gap:

> The product's core workflow is invisible to agents. The intake/approval actions (`submitAnswer`, `requestApproval`, `approveAndRun`, etc.) are only reachable through in-artifact UI clicks — none are in `window.__sonikAgentUI.actions`, no intake question or approval phase appears in `getPageContext()`, and `visibleErrors` is declared but never populated. The tell: smoke tests scrape `document.body.innerText` to verify intake progress because the machine-readable contract cannot express it.

One audit remained: architecture/boundaries.

Treat this as the top architectural issue for the next session.

---

## 5. Recommended overnight mission

### Mission title

**Make embedded Agent UI demo-readable and agent-readable for booking intake + reservation flows.**

### Stop condition

Stop only when either:

1. Embedded booking app smoke passes with visible Agent UI iframe, signed host context, agent-readable workflow state, and a working booking/reservation command receipt; or
2. A hard blocker is proven with exact repo/commit/log evidence and a minimal PR-ready fix list.

### Primary outcomes for tomorrow's demo

1. Booking app opens Agent UI reliably after login.
2. Agent UI does not lose host context or silently call cloud APIs without signed host context.
3. Venue setup/intake is both human-friendly and machine-readable.
4. Reservation creation uses canonical commands:
   - `booking.get.availability`
   - `booking.create.guest`
   - `booking.create.booking`
5. Approval flow is not chat-text magic; it uses a visible trusted approval affordance/card/button and command receipt.
6. Pipe-B or equivalent backend logs are available, or the log gap is explicitly documented as INCONCLUSIVE.

---

## 6. Highest-priority work packages

### A. Fix booking host embed readiness first

Symptoms:

- Real booking app has `booking-agent-ui-frame`, but iframe `src` is empty and `rect` is `0x0`.
- No visible launcher found in headless smoke.

Likely repos/paths:

- Booking service/app repo: `/Users/danielletterio/Documents/GitHub/sonik-booking-service`
- Agent UI embed package in this repo:
  - `packages/agent-embed/src/index.ts`
- Booking SDK embed integration likely under booking service package paths (verify with GitNexus/rg):
  - `sonik-sdk/src/agent-ui`
  - booking app layout/root shell/components

Acceptance gate:

- In authenticated booking app, iframe has non-empty `src` to deployed Agent UI, non-zero rect, visible FAB/sidecar, and signed host context donated.
- `missing-host-context` does not appear after initialization.

### B. Add agent-readable workflow contract

Problem:

- Human UI can click QuestionCards, but agents/tests cannot see workflow state except by scraping text.

Implement a first-class machine-readable state seam, likely under `window.__sonikAgentUI` and page context.

Suggested contract:

```ts
window.__sonikAgentUI.getPageContext() => {
  ...existing,
  workflow?: {
    activeWorkflowId: string | null;
    activeArtifactId: string | null;
    phase: "idle" | "intake" | "saving" | "preview_ready" | "approval_requested" | "approved" | "committing" | "committed" | "error";
    currentQuestion?: {
      id: string;
      title: string;
      required: boolean;
      answerType: string;
      choices?: Array<{ value: string; label: string; disabled?: boolean }>;
    } | null;
    answeredCount: number;
    requiredCount: number;
    unansweredRequiredIds: string[];
    visibleErrors: Array<{ field?: string; code: string; message: string }>;
    canSubmitAnswer: boolean;
    canRequestApproval: boolean;
    canApproveAndRun: boolean;
    disabledReasons: string[];
    commandPreview?: {
      commandId: string;
      stableInputHash: string;
      effect: "read" | "write" | "destructive";
      approvalRequired: boolean;
    } | null;
  };
}
```

Also expose semantic actions:

```ts
window.__sonikAgentUI.actions.submitAnswer({ questionId, value })
window.__sonikAgentUI.actions.markUnknown({ questionId })
window.__sonikAgentUI.actions.saveDraft({ artifactId })
window.__sonikAgentUI.actions.requestApproval({ workflowId })
window.__sonikAgentUI.actions.approveAndRun({ workflowId, previewHash })
window.__sonikAgentUI.actions.cancelApproval({ workflowId })
window.__sonikAgentUI.actions.newChat()
window.__sonikAgentUI.actions.openWorkspaceDocs()
```

Rules:

- Actions should be semantic UI/controller calls, not raw command execution bypasses.
- `approveAndRun` must still honor trusted host/session command grants.
- `visibleErrors` must actually be populated from QuestionCard/save/validation/preview failures.

Likely files:

- `apps/standalone-sveltekit/src/routes/+page.svelte`
- `packages/tool-contracts/src/index.ts`
- `apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts`
- `apps/standalone-sveltekit/src/lib/render/components/QuestionCard.svelte`
- `apps/standalone-sveltekit/src/lib/render/question-card-state.ts`
- tests under `tests/unit/*question*`, `tests/unit/*intake*`, `tests/unit/*agent*`, `tests/unit/*runtime*`

Acceptance gate:

- Playwright/manual smoke can test intake progress through `window.__sonikAgentUI.getPageContext()` and `window.__sonikAgentUI.actions`, without scraping `document.body.innerText`.

### C. Approval card UX + trusted command receipt

Problem:

- Current demos still make approval feel like chat text or dev-speak.
- Need an explicit card/button path for preview → approval → commit.

Expected UX:

1. User completes required intake fields.
2. UI shows `Preview setup` / `Request approval`.
3. Preview card summarizes domain object, fields, command id, and irreversible/write effect.
4. `Approve and create` button is shown only when host/runtime can request trusted approval.
5. Commit returns receipt:
   - `Context created` with context id/name, or
   - `Reservation confirmed` with booking id, not generic `booking created`.

Rules:

- User typing “approve” may route to the approval UI, but must not itself grant trust.
- No executable command payloads inside JSON-render specs.
- Trusted host context supplies actor/user/org; model must not invent/provision actor user IDs.

### D. Replace brittle ultratest assertions

Tests should prove machine-readable state:

- No more core workflow success checks based only on `document.body.innerText`.
- Use:
  - `window.__sonikAgentUI.getPageContext()`
  - `window.__sonikAgentUI.actions`
  - backend command receipts
  - Pipe-B events/correlation IDs

Acceptance gate:

- A test can start intake, answer a question, request preview, see visible error state, and assert the current question/phase through the contract.

### E. Finish architecture/boundary audit

The cut-off agent said one audit remained: architecture/boundaries.

Suggested scope:

- Confirm separation between:
  - renderer/input collection;
  - workflow/controller state;
  - command registry/preview;
  - trusted approval/commit;
  - host context/auth;
  - persistence/logging.
- Identify any current violations where renderer specs can carry executable commit behavior.
- Identify where contracts should live:
  - `packages/tool-contracts`: command/result/approval/workflow contracts.
  - `packages/json-ui-runtime`: renderable JSON/component schemas only.
  - Agent UI app: runtime adapters, host donation, UI orchestration.
  - Booking service: business ORPC/OpenAPI contracts and policy enforcement.
  - Amplify: campaign/customer/message workflow contracts.
  - Marketplace/platform host: template install/search/grant/audit endpoints.

---

## 7. Demo script acceptance gates

Tomorrow demo should be considered ready only if these pass:

1. Login to booking app as `test69@gmail.com` / `test6969`.
2. Open Agent UI from booking app; iframe visible, non-zero, non-empty src.
3. `window.__sonikAgentUI.getPageContext()` reports:
   - authenticated host context;
   - organization/page identity;
   - active context chips;
   - workflow state if intake active;
   - visible errors if any;
   - enabled/disabled actions with reasons.
4. Start venue setup with natural prompt, not prompt-engineering jargon:
   - “Help me set up a restaurant for bookings.”
5. QuestionCard appears; choice/day controls work; save shows success or retryable error.
6. Next question appears without typing when a UI answer is submitted.
7. Approval preview/card appears only when required fields are valid.
8. Approve/create uses trusted command path and returns a domain receipt.
9. Reservation demo works with canonical path:
   - availability;
   - create guest;
   - create booking;
   - receipt includes booking id.
10. Fresh Pipe-B or backend log evidence is captured, or explicitly marked INCONCLUSIVE.

---

## 8. Known non-demo-critical but high-value UX follow-ups

- Tool-call display should be friendly summaries, not raw `searchCommandCatalog`/`learnSkill` spam.
- Session rail should be rows/labels, not one-letter bubbles.
- `Workspace Docs` label and behavior needs clearer naming or hidden disabled state.
- `New chat` should replace confusing `Start Over` language everywhere.
- Workflow launchers/templates should become installable/searchable marketplace items, but do not let marketplace work block tomorrow's core booking demo.
- Future workflow builder can borrow from:
  - Dify: `/Users/danielletterio/Documents/Sonik_Amplify/recon-mission-2026-05-06/summit-corpus/06-dify`
  - n8n: `/Users/danielletterio/Documents/Sonik_Amplify/recon-mission-2026-05-06/summit-corpus/05-n8n`
  - Amplify campaign wizard / xy-flow / svelte-flow patterns.

---

## 9. Reporting format for the overnight agent

When reporting back, include:

1. Branch/commit/deploy version tested.
2. Whether local tree had pre-existing uncommitted work and which files were avoided.
3. PASS/FAIL/INCONCLUSIVE table:
   - booking embed visible;
   - signed host context;
   - machine-readable workflow state;
   - QuestionCard submit/save;
   - approval preview/card;
   - reservation flow;
   - Pipe-B evidence.
4. Exact artifact/log paths.
5. New commits and files changed.
6. Any blocker with minimal repro and next command to run.

Do not claim “verified” from a screenshot alone. Backend success needs command receipt + fresh Pipe-B/log evidence; if the tail is empty, say INCONCLUSIVE.
