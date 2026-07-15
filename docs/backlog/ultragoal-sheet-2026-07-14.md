# Ultragoal Sheet — 2026-07-14

Four bounded goals authored for pickup by another agent, one `$ultragoal` per
goal. Companion to [`ui-ux-backlog-2026-07-13.md`](./ui-ux-backlog-2026-07-13.md)
(16 UX defects; UX-001 workflow-approval-in-embed is the P1 opener and pairs
naturally with G1 here).

## Global constraints (apply to every goal)

- **Trust doctrine:** no model-callable writes. The agent's ceiling is a
  submitted draft/preview; publishing is a human Approve backed by a
  host-signed session. `hostSigned` derives only from the authenticated host
  session, never the request body. Do not weaken `draft_only_invariant`,
  the approval reducers, or `stableInputHash`.
- **Pinned tests:** the three source-pinned reservation tests stay
  byte-identical (`reservation-commit-endpoint.test.mjs` among them).
- **Design bans:** no gradients, no emoji in product surfaces, no left-stripe
  cards, no Inter/Roboto. Run both design gates
  (`scripts/design-gates/check-design-metrics.py`,
  `check-enterprise-ux.py`) on touched UI files; disabled controls carry
  typed `disabledReason`s surfaced through `window.__sonikAgentUI`.
- **Svelte edits:** load `svelte-code-writer` first; run `svelte-autofixer`
  on every touched component.
- **Verification before claiming:** `pnpm --filter svelte-chat check-types`
  (0 errors), touched unit suites, relevant `pnpm test:e2e -g <pattern>`,
  full `pnpm build` exit 0. Known local flake: `message-survives-mode-switch`
  (fails locally, green in CI).
- **Deploys are Dan-gated.** Build/verify freely; `wrangler deploy` only on
  Dan's explicit go. Never deploy or write against the booking service.
- **PR discipline:** branch off `main`, push to `SonikFM/sonik-agent-ui`,
  open a PR with verification evidence in the body.

---

## G1 — Workflow Builder in the embed

**Priority:** P1 (with UX-001) · **Size:** ~2 days · **Mutation policy:**
draft-only; runs commit only through host-signed approval.

**Context.** The builder (`WorkflowBuilderRoot.svelte`: describe → draft →
canvas → run panel) is standalone-only — the toggle in
`apps/standalone-sveltekit/src/routes/+page.svelte` is wrapped in
`{#if !isEmbeddedHostContextExpected()}`. Meanwhile the embed is now the
authoritative surface: signed host context, real approvals, migrated Neon
stores. Organizers can't reach the builder where they actually work.

**In scope:** expose the builder inside the embedded workspace (entry from
the chat header actions row and/or canvas); make draft → canvas → run panel
work with the embed's signed host context; the run panel's
preview → Approve → commit walk must render the approval affordance in the
embed (this IS UX-001 — use `createApprovalAffordanceFromWorkflowRun`, the
single card producer, D011). Narrow-width behavior must pass the cramped-card
check (UX-002 overlaps; fix the card layout if touched).

**Out of scope:** publish/marketplace UX changes, new node types, knowledge,
channels.

**Acceptance criteria:**
1. In the embedded booking host, an operator can open the Workflow Builder
   without leaving the embed, and "Back to chat" returns cleanly (no iframe
   reload, no lost conversation state).
2. Describe → draft produces a validated workflow on the canvas in the embed
   (drafting agent path works with embed settings).
3. The runnable campaign workflow started from the embed reaches
   preview → **visible Approve card** → commit, with commit refusing unless
   the session is host-signed (verify refusal by asserting the affordance is
   absent/disabled in a context-less standalone run).
4. Approval state is exposed through `__sonikAgentUI.getApprovalState()` and
   the card carries typed `disabledReason`s when not committable.
5. e2e: extend `workflow-builder.spec.ts` + a new embed-mode spec (dev-smoke
   rig) covering entry, draft-to-canvas, and the approve-gated run panel.
6. Both design gates PASS on touched files; svelte-autofixer clean;
   check-types 0 errors; full build exit 0.

**Evidence:** e2e output, gate output, screenshots at 1467/1100/480 widths.

---

## G2 — Commit idempotency ledger table

**Priority:** P2 · **Size:** ~0.5–1 day · **Mutation policy:** schema-additive
migration only; no data backfill.

**Context.** `/api/reservation/commit` dedupes repeated human approvals via a
ledger keyed on `previewToolCallId` — currently a `ponytail:` expedient riding
the workspace **artifact store** (`reservation-commit-ledger-*` ids, kind
`json-render`, content cast through `unknown`). See
`apps/standalone-sveltekit/src/routes/api/reservation/commit/+server.ts`.
`/api/intake/commit` has **no** idempotency at all.

**In scope:** migration `0012_commit_ledger` in
`packages/workspace-session/migrations/postgres/` (idempotent,
version-tracked like 0001–0007); a typed store method pair
(get/record) threaded through the same per-request `platform.env` resolver
pattern as the other stores (in-memory fallback keeps no-DB tests green);
switch the reservation endpoint to it; add the same guard to
`/api/intake/commit`.

**Out of scope:** UI changes; retroactive migration of artifact-store ledger
entries (leave them; they expire with the sessions).

**Acceptance criteria:**
1. `pnpm db:migrate` applies `0012` idempotently (safe to re-run) and
   `db:migrate:dry-run` lists it.
2. Repeat POST with the same `previewToolCallId` returns the stored receipt
   with `replayed: true` and performs **zero** booking-service calls
   (assert via the runtime fetcher mock in tests).
3. Failed commits are NOT recorded (retry stays possible); ledger write
   failures never mask a completed booking (receipt still returns; telemetry
   `ledger_write_failed` fires).
4. Intake commit gains the same replay behavior, tested.
5. Artifact-store ledger code path removed; no `as unknown as Spec` casts
   remain in the endpoint.
6. Pinned reservation tests byte-identical and passing; new unit tests cover
   replay, failure-not-recorded, and ledger-write-failure; check-types 0.

**Evidence:** unit test output, migration dry-run output.

---

## G3 — Channels/Triggers UX pre-work (WhatsApp + Slack)

**Priority:** P2 · **Size:** ~2–3 days · **Mutation policy:** fixtures only —
**no external API integration** (no Meta/Twilio/Slack calls, no webhooks, no
number provisioning against real providers). This is the contract-and-surface
slice that integration later plugs into.

**Context.** Dan's product direction: half the value is meeting customers
where they are — a **Channels** surface where an org connects WhatsApp (with
agent-ownable phone numbers later) and Slack, and binds workflow **triggers**
to channel events. The `trigger` node already exists in the 5-node controller
set; nothing upstream defines what fires it.

**In scope:**
- **Contracts** (`packages/tool-contracts`): zod schemas for
  `ChannelDefinition` (kind: `whatsapp | slack`; identity/provisioning state:
  `unconfigured | pending | connected | error`; org-scoped),
  `TriggerBinding` (channel event → workflow id + input mapping), and wire
  normalizers following the ask-user-question pattern (derive-don't-footgun
  defaults). Fixture data for both channels.
- **Surface**: a Channels view (standalone + embed-reachable) listing
  channels with honest states — connect actions render as **disabled with
  typed `disabledReason: "integration_not_yet_available"`**, never silent
  no-ops; trigger bindings listed per workflow with the same honesty.
- **Page control**: `__sonikAgentUI` exposes channels/triggers state and
  assertions.
- **Doc**: `docs/product/channels-triggers-prework.md` recording the contract
  decisions and the integration seams left open (provisioning flow, webhook
  ingress, Slack app scopes) — one page, decisions-and-seams, not an essay.

**Out of scope:** any provider SDK, OAuth, webhook ingress, message sending,
number purchase. Amplify send-flows stay untouched.

**Acceptance criteria:**
1. Contracts parse fixtures for both channels; invalid states refuse with
   typed issues; unit tests cover both directions (incl. omitted-field
   defaulting, per the allowSkip lesson).
2. Channels surface renders both channels in all four states from fixtures;
   every non-functional control carries a typed disabledReason surfaced via
   `__sonikAgentUI` (enterprise-ux gate G2.x passes — this is the gate's
   exact contract).
3. A trigger binding can be created against a fixture workflow and appears in
   the workflow's page-context `workflow.triggers` — persisted to the
   workspace store (session-scoped is acceptable for pre-work).
4. e2e spec covers the surface at wide + sidecar widths; both design gates
   PASS; no emoji/gradients; check-types 0; full build exit 0.
5. The pre-work doc exists and names every integration seam deliberately left
   open.

**Evidence:** contract test output, e2e output, gate output, screenshots.

---

## G4 — OTel adoption (`@ai-sdk/otel`)

**Priority:** P3 · **Size:** ~1 day · **Mutation policy:** observability only;
no behavior change to agent runs.

**Context.** AI SDK 7 moved OpenTelemetry out of core: install `@ai-sdk/otel`,
call `registerTelemetry(new OpenTelemetry(...))` at startup, after which
telemetry is enabled by default per call. Deferred in the v7 assessment
(`docs/research/ai-sdk-7-assessment-2026-07-13.md`). The app already threads
`x-sonik-request-id` / `x-sonik-trace-id` / `traceparent` per turn and tails
to `sonik-dev-observability-pipe-b`.

**In scope:** register the integration in the SvelteKit server runtime
(Workers-compatible exporter — evaluate `@microlabs/otel-cf-workers` or a
fetch exporter into the existing observability worker; pick one, document
why); correlate spans with the existing `traceId`/`traceparent` so a Pipe-B
query by trace id surfaces both the app telemetry events AND the AI SDK spans.

**Out of scope:** dashboards, sampling policy tuning, client-side spans.

**Acceptance criteria:**
1. `generateText`/`agent.stream` turns emit spans; span trace ids match the
   turn's existing `x-sonik-trace-id` (or the mapping is recorded in the
   span attributes) — proven by one captured trace correlating a live turn
   across app telemetry and SDK spans.
2. **Privacy defaults hold:** request/response bodies and prompt text are NOT
   recorded (v7 excludes bodies by default — do not opt in); ZDR-flagged
   turns carry no content attributes. Assert via captured span inspection.
3. Telemetry can be disabled per call (`telemetry: { isEnabled: false }`)
   and globally (no registration) — no-registration path byte-identical to
   today (unit-test the wiring seam).
4. No measurable regression to turn latency in the dev-smoke e2e suite
   (existing specs stay green); bundle/worker size delta reported in the PR.
5. check-types 0; full build exit 0; the v7 assessment doc updated from
   "defer" to "adopted" with the exporter decision.

**Evidence:** captured trace (redacted), unit output, e2e output.

---

## Suggested sequencing

G2 (small, hardens money paths) → G1 (+UX-001, unlocks organizer workflows
end-to-end) → G3 (pre-work unblocks the channels roadmap) → G4 (independent,
any time). G1 and G3 touch disjoint surfaces and can run as parallel lanes if
staffed separately.
