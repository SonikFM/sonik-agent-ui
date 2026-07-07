# Agent UI Host Action Channel — Demo Readiness Handoff

Date: 2026-07-07
Repo: `sonik-agent-ui`
Related booking-service worktree: `/Users/danielletterio/emdash/worktrees/sonik-booking-service/emdash/major-schools-raise-3zsc2`
Interview source: `$deep-interview` rounds on 2026-07-07

## Executive summary

The next demo-readiness priority is **Agent action channel first**: build a generic, versioned, allowlisted host-action channel between the remote Agent UI iframe and the host SDK. This is not a Driver.js feature. Driver.js/tours are only the first visible use case that exposed the missing seam.

The core gap is architectural:

- The remote Agent UI can read sanitized host page context.
- The remote Agent UI can render chat/canvas content inside its own iframe.
- The remote Agent UI **cannot ask the host to perform a host action** today, except through ad hoc same-window test surfaces or user/manual clicks.
- Dynamic tours, canvas-open requests, approval UI, and agent-visible host activity all need one typed request/result channel.

## User decisions captured

1. **Primary win:** `agent_action_channel_first`.
   - Do not spend the next pass primarily on booking-service deploy backlog unless needed to verify.
   - PRs #57/#62/#64/#65/#66 are still relevant demo value, but they are not the primary implementation lane.

2. **Minimum channel shape:** `generic_allowlisted_actions`.
   - Do not build a canvas-open-only one-off.
   - Build a reusable `action-request` / `action-result` seam that can carry canvas-open, tour primitives, approval requests, and later host actions.

3. **Command/approval actions are in scope**, but not as uncontrolled model authority.
   - User wants policy modes like `block`, `ask`, `allow`, `require`.
   - Some actions may be soft-gated; some may be hard-gated.
   - The implementation must draw from the existing tool policy / approval documentation, not invent a loose bypass.

4. **Driver.js relationship:** Driver.js is not the product boundary.
   - Driver.js-level tours are a use case of the action channel.
   - The missing channel is broader: remote agent-to-host action invocation.
   - Driver.js should not drive policy design; policy design should support all host actions.

## Why this has nothing inherently to do with Driver.js

Driver.js is just one possible rendering/spotlight library for guided tours. The load-bearing product issue is that the iframe app cannot call host-owned behaviors. A generic action channel should eventually support:

- `canvas.open` / `canvas.close`
- `tour.highlight`
- `tour.annotate`
- `tour.focusTarget`
- `activity.receipt`
- `approval.requestPreview`
- `approval.confirmTrustedAction`
- future host UX actions

Cross-route navigation/resume, including a possible `tour.navigateAndResume`, is intentionally deferred until the base channel, route capability reporting, and target registry are proven.

Driver.js/spotlight is downstream of `tour.highlight` and `tour.annotate`. The channel should work even if the visual tour renderer is GSAP-native, Driver.js-inspired, or replaced later.

## Existing source references

### Booking-service PRDs written in the other worktree

- `/Users/danielletterio/emdash/worktrees/sonik-booking-service/emdash/major-schools-raise-3zsc2/PRD-AGENT-TOUR-DRIVERJS.md`
- `/Users/danielletterio/emdash/worktrees/sonik-booking-service/emdash/major-schools-raise-3zsc2/PRD-AGENT-CANVAS-EMBED.md`

Key findings from those PRDs:

- The only inbound SDK message in booking-service is page-context request.
- `window.__sonikAgentUI` is same-window only and cannot be reached by the cross-origin iframe.
- The SDK already has `open("chat")`, `open("canvas")`, `close`, `getMode`, `postContext` primitives.
- The new seam should be versioned postMessage.
- Tour/canvas action requests must validate origin/source and return receipts.

### Agent UI repo references

- `packages/agent-embed/src/index.ts`
  - Existing iframe mounting, host context sanitization, `openCanvas` element binding, `postMessage` host-context send.
  - Contains `SIGNED_HOST_CONTEXT_COMMAND_METADATA_KEYS = new Set(["approvedCommandIds"])`.
- `apps/standalone-sveltekit/src/routes/+page.svelte`
  - Current failure path: `No trusted host action handler is registered for this action.`
- `packages/tool-contracts/src/index.ts`
  - Current tool approval schema: `none | required | denied`.
  - Current policy outcome: `allow | approval_required | deny`.
- `docs/product/sonik-agent-ui-prd-2026-07-06.md`
  - States user text is not authorization.
  - Lists semantic action registry and planned `toolPolicy` enforcement.
- `docs/plans/toolpolicy-enforcement-plan-2026-07-07.md` if present.
- `docs/product/agent-workspace-marketplace/07-permissions-approval-trust-boundary.md`
  - Marketplace approval/trust split: preview → trusted approval → receipt.
- `docs/product/agent-workspace-marketplace/DECISIONS.md`
  - Decisions around trusted approval, command-backed apps, and descriptors-only JSON apps.

## Required design doctrine

### Channel policy modes

The handoff recommendation is to normalize policy mode language before implementation:

| Mode | Meaning | Can execute immediately? | Typical use |
|---|---|---:|---|
| `block` | Not available in this host/session. | No | Missing capability, disabled feature, unsafe action. |
| `ask` | Agent may request user approval UI. | No, until trusted approval event. | Writes, sensitive host actions, unclear scope. |
| `allow` | Agent may request execution directly. | Yes, after host allowlist validation. | Non-mutating UX actions like canvas-open, highlight, focus. |
| `require` | The action requires a prerequisite before it can run. | No, until requirement satisfied. | Missing selected context, missing org, needs preview first. |

Do **not** use chat text alone as approval. If future product wants chat text to approve, that must be a separate explicit trust decision, not accidental behavior.

### Approval semantics for v0

Recommended v0 behavior:

1. Remote Agent UI sends a typed action request.
2. Host SDK validates:
   - message source and origin;
   - protocol version;
   - action key is allowlisted;
   - payload schema;
   - current host policy mode.
3. If `allow`, host executes and returns a receipt.
4. If `ask`, host renders or triggers an approval UI/preview and returns `approval_required` receipt.
5. If trusted user approves via host-rendered UI, host may execute the same planned action and return an execution receipt.
6. If `block`/`require`, return honest disabled/requirement reason.

This preserves existing doctrine: model request is not authority; host controller executes.

## Proposed contract v0

### Message types

```ts
type AgentHostActionRequestMessage = {
  source: "sonik-agent-ui";
  type: "sonik:agent-ui:action-request";
  version: "sonik.agent_ui.host_action.v1";
  requestId: string;
  actionKey: string;
  input?: unknown;
  intentLabel?: string;
  requiresReceipt?: boolean;
};

type AgentHostActionResultMessage = {
  source: "sonik-agent-host";
  type: "sonik:agent-ui:action-result";
  version: "sonik.agent_ui.host_action.v1";
  requestId: string;
  actionKey: string;
  ok: boolean;
  status:
    | "executed"
    | "approval_required"
    | "blocked"
    | "requires_prerequisite"
    | "invalid_request"
    | "unavailable";
  policyMode: "allow" | "ask" | "block" | "require";
  message?: string;
  disabledReason?: string;
  receipt?: {
    traceId?: string;
    commandId?: string;
    actionKey?: string;
    effect?: "read" | "write" | "destructive" | "environment" | "ui";
  };
};
```

### Initial allowlisted action keys

For the demo slice, start small but generic:

- `canvas.open`
- `canvas.close`
- `tour.highlight`
- `tour.annotate`
- `tour.focusTarget`
- `tour.clear`
- `approval.requestPreview`
- `approval.confirmTrustedAction` only if the host already has a trusted approval UI path and can prove no chat-text bypass.

Defer cross-route navigation/resume actions until the base request/result channel, target registry, and per-route capability reporting are proven.

If approval execution is too risky for demo, ship `approval.requestPreview` and return `approval_required` receipts for anything write-like.

## Svelte implementation guidance

Use `$svelte-code-writer` and `$svelte-runes` before editing `.svelte` or `.svelte.ts` files.

Relevant Svelte 5 rules from installed skills:

- Use `$state` for mutable UI state.
- Use `const x = $derived(...)` for read-only derived values.
- Use `$effect` for side effects like attaching/removing `message` listeners.
- Do not mix Svelte 4 `on:click` syntax into Svelte 5 files; use `onclick`.
- Run `npx @sveltejs/mcp svelte-autofixer <file> --svelte-version 5` before finalizing Svelte component changes.

For the host-action channel specifically:

- Message listener setup belongs in an effect/lifecycle boundary and must clean up.
- Action registry should be pure/typed and testable outside Svelte where possible.
- UI receipts/approval cards should be state-driven, not DOM-scraped.
- Avoid adding arbitrary callbacks directly into renderer specs; renderer may request, trusted host decides.

## Implementation work split

### In `sonik-agent-ui`

1. Define action request/result types and a small client helper for the remote app to emit action requests.
2. Add a runtime action dispatcher abstraction that can:
   - request host action;
   - await result by `requestId`;
   - time out honestly;
   - surface result to chat/canvas UI.
3. Teach agent tools/skills to call the action dispatcher instead of claiming host action success.
4. Add user-facing receipts that hide dev-speak but preserve trace details in inspector/logs.
5. Tests:
   - valid request receives result;
   - timeout returns honest unavailable;
   - blocked/ask/require modes render clear UI;
   - chat text cannot become trusted approval by itself.

### In booking-service / SDK

1. Add inbound message listener beside page-context request handler.
2. Validate origin/source/version/requestId/actionKey/payload.
3. Add action registry and policy resolver.
4. Implement initial actions:
   - canvas open/close;
   - tour/focus no-ops or visible primitives if ready;
   - approval preview request.
5. Return receipts for all paths.
6. Add page context fields/capabilities:
   - `hostActionCapabilities` or `actionCapabilities`;
   - `hostActionPolicyModes` if needed;
   - schema version bump.

## Verification gates

Minimum gates before claiming demo readiness:

1. Unit tests for schema validation and policy modes.
2. Browser smoke: iframe sends `canvas.open`; host opens canvas and returns `ok:true` receipt.
3. Browser smoke: blocked action returns `blocked` receipt and does not mutate host state.
4. Browser smoke: `approval.requestPreview` renders a trusted approval card/preview but does not execute until trusted host action.
5. Pipe-B logs include requestId/traceId for any write/action that claims success.
6. Existing booking command approval tests still pass; no regression where chat text bypasses `approvedCommandIds`.


## Deployment parity checklist

Before any hosted claim, capture these values in the test report or handoff:

- Agent UI branch, commit SHA, deployed Worker URL, and confirmation that the build contains `sonik.agent_ui.host_action.v1`.
- Booking-service / SDK branch, commit SHA, deployed Worker URL, and consumed Agent UI SDK/package version.
- Allowed origins and page-context source for the exact embedded host under test.
- Wrangler vars/secrets required for telemetry/model/runtime; never paste secret values.
- Auth/session/org used for the smoke and whether page context came from the trusted host session.
- Smoke action prompt or button, `requestId`, `actionKey`, expected UI state, expected backend effect, and expected Pipe-B/telemetry event.
- Negative-path receipts for blocked action, unknown action, and missing target.

## Booking-service deployment backlog still known

Merged but reportedly undeployed PRs:

- #57 — My Spaces gallery reveal fix.
- #62 — booking history route + topbar org context.
- #64 — demo control room seed cockpit.
- #65 — team + organization settings.
- #66 — create flows + Create menu.

Demo seed still requires:

- `DEMO_SEED_ENABLED=true`
- `DEMO_SEED_TOKEN` on both service/booking worker surfaces as applicable.

DR-009 Ultratest-leak remains a demo-blocking unknown, but it is separate from the action-channel implementation unless it affects verification.

## Suggested next agent prompt

```text
Use $sonik-agent-ui $sonik-accessibility $sonik-tool-creation $svelte-code-writer $svelte-runes $sveltekit-data-flow.
Implement the Agent UI host action channel v0 from docs/handoffs/agent-action-channel-demo-readiness-handoff-2026-07-07.md.
Start with contract/types and tests. Preserve the trust invariant: chat text is not approval; model requests are not authority; host policy modes block/ask/allow/require decide execution.
First prove canvas.open over the generic action-request/action-result channel, then add approval.requestPreview as a non-executing write preview path.
Do not turn Driver.js into the architecture; tours are just consumers of this channel.
```

## Stop condition for next pass

Stop only when either:

- generic channel types + tests + one working canvas-open smoke are proven, or
- a concrete cross-repo blocker is documented with exact missing file/host capability and next patch location.

## SvelteKit boundary addendum

Added after reviewing `$sveltekit-data-flow`, `$sveltekit-remote-functions`, and `$sveltekit-patterns`.

### Data-flow rules for this channel

- Browser `postMessage` is a **client UX/request channel**, not an auth or persistence source of truth.
- Anything involving secrets, host auth, org authority, policy grants, demo seed tokens, or command execution receipts must resolve server-side or through an already-trusted host controller.
- Use `+server.ts` for API-style endpoints and host-context status probes.
- Use `+page.server.ts` / form actions only for real SvelteKit page form submissions; the iframe action channel itself should not be modeled as a normal page form unless the UX is genuinely a server form.
- Return JSON-serializable values only. No functions/classes in load output, host context, action payloads, or receipts.
- Use `fail()`/`redirect()`/`error()` patterns only inside SvelteKit action/load routes. Do not mirror those directly into the iframe action protocol; action results should use explicit `status`, `ok`, `policyMode`, and `disabledReason` fields.

### Remote-functions stance

SvelteKit remote functions (`*.remote.ts`, `command()`, `query()`, `form()`) are a good fit for **server-owned Agent UI operations** inside the Agent UI app, but they are not a substitute for the cross-origin host action seam.

Use remote functions when:

- Agent UI needs to persist an Agent UI-owned setting/session/workspace artifact.
- Agent UI needs a server-side query against its own backend.
- The call does not require reaching into the booking-service host DOM.

Do not use remote functions as the host-action bridge when:

- The target behavior is host DOM/UI (`canvas.open`, tour highlight, focus token).
- The host must enforce current page capability or origin/source checks.
- The operation needs booking-service host context or a live iframe parent receipt.

The host action channel still needs postMessage because the action target is the parent host window, not the Agent UI server.

### Component/state patterns

- Reusable UI for receipts, approval cards, and action-status panels should live in the design-system layer where applicable, not scattered under generic `components/` folders.
- Svelte 5 runes only:
  - `$state` for mutable local UI action state.
  - `$derived` for computed policy/status labels.
  - `$effect` for postMessage listener setup/cleanup and timeout cleanup.
- Avoid direct DOM manipulation for Agent UI components. Host-side tour primitives may resolve DOM targets, but that resolution belongs in the host controller layer, not in renderer-authored JSON artifacts.
- Do not use `localStorage` as the authority for action grants. Local storage may store non-authoritative UI preferences like tour cursor or auto-open preference, but policy must come from trusted host/session context.

### Recommended file-shape for implementation

In `sonik-agent-ui`:

- `packages/agent-embed` or equivalent shared package:
  - `host-action-protocol.ts` — message schemas/types, version constants, validators.
  - `host-action-client.ts` — request/result dispatcher with timeout and receipt handling.
- `apps/standalone-sveltekit/src/lib/...`:
  - Agent-facing wrapper/tool that calls the dispatcher.
  - UI receipt/approval state components, runes-based and testable.
- Tests:
  - schema tests for valid/invalid messages;
  - dispatcher tests for success/timeout/blocked;
  - Svelte component tests for ask/allow/block/require rendering.

In booking-service / SDK:

- SDK inbound message handler near existing page-context request handling.
- Pure action registry/policy resolver that can be unit tested without Svelte.
- Svelte host components should only render state derived from action receipts/policy decisions.

### Implementation anti-patterns to reject

- No page-context donated value can become trusted approval.
- No chat text can become trusted approval without a separate explicit product/security decision.
- No command payloads hidden inside JSON-render component props.
- No arbitrary action keys; all keys are registry-backed and schema-validated.
- No raw CSS theme overrides or one-off UI chrome for receipts/approval cards.
- No unbounded postMessage listener; always validate `origin`, `source`, `version`, `requestId`, and `actionKey`.

## Contract update — implemented target/action seam

The first contract implementation now lives in `packages/tool-contracts/src/target-registry.ts` and is documented at `docs/contracts/target-registry-and-action-channel-v0.md`. Use that contract for host action channel work: semantic `targetId`, optional business `entityRef`, host-owned `data-sonik-target`/bounds resolution, policy modes `block | ask | allow | require`, and typed action receipts.

