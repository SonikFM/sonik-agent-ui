# Remaining Slices — Handoff (2026-07-08)

Owner-agnostic handoff for the work still open after the experience-seams pass. Every merged
slice was verified against the **full `pnpm test` chain gated on the real exit code**. Read the
"Ground rules" section before touching anything — a few non-obvious traps here have already burned
one merge.

---

## 0. Where things stand

### Merged (do not redo)
| Slice | PR | Notes |
|-------|----|-------|
| A — draft-only invariant | #39 | `executeCommand` is read-only; publish only via `POST /api/intake/commit`. No model-callable commit tool exists. |
| B — alive streaming (scroll follow) | #41 | MutationObserver on content children. |
| C — friendly tool failures | #42 | recoverable-failure presentation in chat-surface. |
| E — toolset stability | #44 | keep booking command family mounted mid-workflow; pure logic in `command-family-mount.ts`. |
| G — e2e lane + test-chain-integrity guard | #38 | Playwright lane; guard fails if a `tests/unit/*.test.mjs` isn't wired into `pnpm test`. |
| chat-as-dynamic-modal | #43 | `ChatWindow` draggable/resizable floating chat, embedded-safe. |
| **A2 reservation-commit (BACKEND ONLY)** | #45 | `POST /api/reservation/commit` + `commitBookingReservationCommand`. **UI half not done — see §1.** |

### Deploy status — HELD
Live worker stays on `50d95c26`. Slice A removed every model-callable write tool, so reservations
cannot be committed by the agent. A2's backend restores a human-only commit path, but **nothing in
the UI calls it yet**. Do not deploy until **§1 (A2 UI half)** lands. See memory
`a2-reservation-commit-deploy-gate.md`.

### Open slices, by priority
1. **§1 — A2 UI half** (deploy unblocker; demo-critical) — HIGH
2. **§2 — Slice D** (inline ask-user + reservation "where first" + #15 guest contact) — MEDIUM
3. **§3 — Slice H** (org-scoped agent profiles, #11) — MEDIUM
4. **§4 — Slice F** (turn-timeline telemetry) — LOW

---

## Ground rules (read first)

- **Work in a git worktree on latest `origin/main`, not the primary checkout.** The primary
  checkout (`/Users/.../sonik-agent-ui`) is stale (`f0890e4`) with pre-existing uncommitted changes;
  running tests there gives false results because its source predates Slices A/E. Reuse the worktree
  at `.claude/worktrees/agent-a01410fced7464f15` (deps already installed) or make a fresh one.
- **`pnpm test` builds 12 workspace packages first, then runs ~95 unit files.** A test that imports
  `@sonik-agent-ui/*` needs those `dist/` builds; running a single file without the build fails with
  `Cannot find module .../tool-contracts/dist/index.js`. Run the whole `pnpm test` once, or build the
  packages, before single-file runs.
- **Never gate on a tail-piped exit code.** `pnpm test | tail -40` reports the *tail's* exit (0),
  masking a real failure. Write the real code to a sentinel: `( pnpm test >out 2>&1; echo "EXIT=$?" >done )`.
  This already produced one false "green" this session.
- **`agent.ts` can only be *type*-imported in the plain-node unit chain** (it pulls in `ai` + `$env`).
  Route `+server.ts` files can't be imported at all. Unit tests therefore **source-pin** routes
  (read the file as a string, assert on it) and import pure logic from dependency-free leaf modules.
  If you add testable logic, put it in a leaf module (see `command-family-mount.ts`).
- **Source-string assertions are brittle.** `app-shell-session-rail.test.mjs:169` pins the exact
  `createAgent({...})` argument string; `intake-command-execution-seam.test.mjs` pins route strings.
  If you change a wired call, update those pins (and prefer replacing new pins with behavioral
  assertions against a leaf module).
- **Every new `tests/unit/*.test.mjs` MUST be added to the `test` script in `package.json`** or
  `test-chain-integrity.test.mjs` fails. Add it next to a thematically-related test.
- **Merge discipline:** protected `main`. `gh pr create` → poll `gh pr view <n> --json mergeable,mergeStateStatus`
  until `MERGEABLE` → `gh pr merge <n> --merge --delete-branch`. Only checks are CodeRabbit + "Scan for
  injected loader" (no CI test gate — local `pnpm test` is the real gate, so run it).
- **Design taste (binding):** no gradients, no emoji, no left-stripe cards, no Inter/Roboto. See memory
  `dan-design-taste-rules.md`.
- **No Fable-tier subagents** — pin sonnet/haiku on any Agent spawn (memory `no-fable-subagents`).

---

## §1 — A2 UI half (HIGH — deploy unblocker)

**Goal:** make a reservation reachable end-to-end from the UI: the agent gathers params + runs
`booking.get.availability` (a read it *can* do), presents a reservation **preview/approval card**, and
a human **Approve** click POSTs to the already-merged `POST /api/reservation/commit`. No model turn
runs on approval — identical shape to the intake flow.

### The template to mirror (intake draft→approve→commit)
- Preview tool: `previewActiveIntakeCommand` in `apps/standalone-sveltekit/src/lib/tools/artifact-state.ts:264`
  — validates the draft, returns the command preview, tells the model "stop; a human must Approve."
- Approval card: `AgentConversation.svelte` exposes a first-class `approvalAffordance` prop
  (`packages/chat-surface/src/components/AgentConversation.svelte:65`, status
  `"approval_required"`, `onApprove`).
- Client wiring: `+page.svelte:3522-3524` (`onApprove` → `handleTrustedIntakeControllerAction("approveAndRun", …)`)
  and `runIntakeCommitEndpoint` at `+page.svelte:3193` which POSTs `{ artifactId, sessionId }` to
  `/api/intake/commit` and appends a synthetic tool-output message via
  `appendIntakeCommitReceiptMessage` (`+page.svelte:3242`).

### Backend contract already merged (call this)
`POST /api/reservation/commit` body:
```jsonc
{
  "sessionId": "…",
  "guest":   { "name": "Dan", "email": "dan@example.test" /* + any guest fields */ },
  "booking": { "contextId": "…", "startsAt": "…ISO", "endsAt": "…ISO",
               "partySize": 3, "source": "admin", "clientRequestId": "…" }
  // NOTE: do NOT send booking.userId — the endpoint strips it and resolves the
  // guest id server-side (booking.create.guest → receipt.confirmation.id → booking.userId).
}
```
Returns `{ ok, kind:"reservation-commit", guestId, steps:[{commandId,receipt}, …], error?, message? }`.
401 if no trusted host session. Implementation:
`apps/standalone-sveltekit/src/lib/server/booking-workflows/reservation-commit.ts`.

### Recommended build (leanest that makes it work)
Decision from Dan: build only as far as the agent actually needs to perform well. Reservations
**cannot complete at all today** (the `draft_only_invariant` refusal in `command-catalog.ts:104-119`
even points the agent at a card that doesn't exist), so the loop *is* required.

1. **Reservation preview tool** — new tool (mount in `agent.ts` alongside the command catalog tools).
   It takes the gathered reservation params, echoes them back as a structured preview, and returns
   guidance: *"Show this as the approval preview and stop. Publishing is a human Approve click."*
   Model this on `previewActiveIntakeCommand`'s return shape and guidance text.
2. **Reservation approval card** — reuse `AgentConversation`'s `approvalAffordance` (add a
   `kind: "reservation"` discriminator, or a parallel affordance) so you don't build a second card
   surface. Render the guest + slot + party summary; primary action = Approve.
3. **Client handler** — `runReservationCommitEndpoint(payload)` in `+page.svelte` mirroring
   `runIntakeCommitEndpoint` (POST, append synthetic receipt message, log
   `reservation.commit_endpoint.completed|error` telemetry).
4. **Agent-prompt guidance** — teach the model: gather params → run `booking.get.availability` →
   call the reservation preview tool → stop. It must NOT attempt `booking.create.*` writes (they
   refuse). Put this in the reservation runtime skill body / prompt module.
5. **Tests** — source-pin the route wiring (`+page.svelte` POSTs to `/api/reservation/commit`) in a
   unit test; add an e2e spec under `tests/e2e/` (see `chat-modal.spec.ts` for the harness) that drives
   a reservation to the approval card and asserts the card renders. Backend is already covered by
   `reservation-commit-endpoint.test.mjs`.

### Gotchas
- **Guest-id redaction:** `host-command-runtime.ts` `redactSecretValue` splits response bodies on the
  auth-token string. A short test token (e.g. `"t"`) corrupts any id containing it. Use a multi-char
  token that isn't a substring of the fixture ids. The real guest id is at
  `receipt.summary.receipt.confirmation.id` (canonical) / `receipt.summary.body.id`; `extractCreatedGuestId`
  already handles both.
- **Command ids are literal:** the mounted catalog uses `booking.create.guest` / `booking.create.booking`
  (not generated aliases) — confirmed against `sonik-booking-command-artifacts.generated.json`.
- **Ground-truth flow:** `tests/fixtures/sonik-booking/reservation-workflow-regression.json`
  `goodTranscript.toolCalls` shows exact inputs: availability `{contextId,from,to,partySize}` →
  guest `{name,email}` → booking `{contextId,userId,startsAt,endsAt,partySize,source,clientRequestId}`.

### Done when
Reservation flow completes end-to-end from the embedded UI (availability → preview card → Approve →
booking receipt), the reservation Pipe-B smoke gate
(`scripts/agent-ui-booking-reservation-pipeb-smoke.mjs`) passes against a live worker, and full
`pnpm test` is green. **This is the last gate before deploy off `50d95c26`.** Note: that smoke script
asserts `tool.commitCommand` events for guest/booking — those events no longer exist post-Slice-A, so
the smoke's success predicate (`toolTelemetryComplete`, lines ~357-362) must be updated to accept the
`commit.human_approved` endpoint path instead.

---

## §2 — Slice D (MEDIUM)

Three independent sub-items. They share `runtime-skill-intent.ts` and `+page.svelte`, so serialize
against §1 (which also touches `+page.svelte`).

### 2a. Inline ask-user (wire the dead renderer)
The agent's `askUserQuestion` spec exists (`packages/tool-contracts/src/index.ts`
`askUserQuestionSpecSchema`) and question artifacts render as full-canvas QuestionCards, but the
**inline** ask-user affordance in the chat stream is not wired. Chat rendering happens in
`packages/chat-surface/src/components/ChatText.svelte` (`renderInline`, block renderer). Task: render a
compact inline question (choice chips / short-answer) directly in the assistant message when the
model asks a single clarifying question, instead of only via the canvas card. Confirm whether the
existing `JsonInlineRenderer`/inline path is dead or partially wired before building — grep
`renderInline` and the question-answer loop (`tests/unit/question-answer-loop.test.mjs`,
`intake-answer-tool.test.mjs`) for the current contract.

### 2b. Reservation "where first"
Today the reservation recipe (`apps/standalone-sveltekit/src/lib/server/booking-workflows/reservation-create.ts`)
requires `activeEntity.id or donated booking contextId` (line 40) but the agent doesn't proactively
ask **which venue/context** when it's ambiguous — it can dive into availability against the wrong
context. Task: script the reservation flow to resolve/confirm the booking **location/context first**
(ask "which venue?" when `pageContext.activeEntity` is absent/ambiguous) before availability. This is
prompt/skill-body work in the reservation runtime skill + possibly a guard in
`runtime-skill-intent.ts` (`contextText` uses `activeEntity` at lines 20-21).

### 2c. #15 — guest email/phone required (per-resource-type)
**Real gap.** `reservation-create.ts:33` `guestFields: ["guestLabel","guestEmail","guestId","customerId"]`
— no phone, nothing *required*, no resource-type granularity. The recipe schema
(`commandWorkflowRecipeSchema`, `packages/tool-contracts/src/index.ts:873`) has **no** required-field
or resource-type concept — you must add schema surface (e.g. `requiredGuestFields` keyed by
resource type) + validation before `booking.create.guest`, and prompt guidance so the agent collects
the required contact channel.

**Blocked on Dan's input:** he chose **per-resource-type** granularity but has not yet supplied the
mapping. Get the tee-time / restaurant / hotel (etc.) → required-field mapping before building 2c.
Everything else in Slice D can proceed without it.

---

## §3 — Slice H — org-scoped agent profiles (#11) (MEDIUM)

**Reality:** agent profiles are **not persisted per org today.** Dan's note "tell me how we're doing
that" = we're NOT. `AgentRuntimeSettings` (`apps/standalone-sveltekit/src/lib/agent-settings.ts:46`,
sanitized at `:261`, summarized at `:296`) is per-request only; the client builds a snapshot via
`createAgentSettingsSnapshot()` (`+page.svelte:311`) and the settings UI region lives around
`+page.svelte:2730` / `:3586` (`agentSettingsToolFamilies`, `toolFamilies` prop).

**Task:** persist agent settings/profile scoped to the host `organizationId` (from the trusted host
session — never client-provided; see `amplify-org-context` doctrine and
`host-command-runtime.ts`). Load the org's saved profile on session bootstrap; save on change.
Storage: reuse the workspace persistence adapter (`getRequestWorkspacePersistence`) with an
org-scoped key, mirroring how other org-scoped state is stored. Fail closed if no org context.

**Serialize after §1** — shares the `+page.svelte` settings region.

---

## §4 — Slice F — turn-timeline telemetry (LOW)

Backend/analytics only; no user-facing surface. There is no `turn-timeline` telemetry today. Emit a
per-turn timeline (tool calls, stream start/first-token/complete, approval events) onto the existing
`writeAgentTelemetry` pipeline (`apps/standalone-sveltekit/src/lib/server/agent-telemetry.ts`) so a
run's shape is queryable in Pipe-B. Stamp onto the existing `api.generate.*` events' payloads rather
than inventing a new sink (that's how Slice E's churn signal was added — see
`api.generate.command_index_context` payload). Langfuse/PostHog are the eventual consumers (future,
not this slice). Lowest priority — do after the demo-critical work.

---

## Appendix — verification recipe

```bash
# from a worktree on latest origin/main, deps installed:
rm -f /tmp/chain.done
( pnpm test >/tmp/chain.out 2>&1; echo "EXIT=$?" >/tmp/chain.done ) &
# wait for /tmp/chain.done, then:
cat /tmp/chain.done            # must be EXIT=0 (NOT the tail's exit)
grep -iE "AssertionError|ELIFECYCLE|Test failed" /tmp/chain.out   # must be empty
tail -1 /tmp/chain.out         # "test chain integrity: all tests/unit/*.test.mjs files are wired"
```

Single-file iteration (after `pnpm test` has built the packages once):
`node --experimental-strip-types tests/unit/<file>.test.mjs`
(add `--loader ./tests/unit/ts-extension-loader.mjs` only if the module chain uses extensionless
relative imports, e.g. anything importing `agent.ts`).
