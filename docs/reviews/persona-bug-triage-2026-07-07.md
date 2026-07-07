# Persona bug triage — 2026-07-07

Root-cause triage for two demo-threatening bugs surfaced by the 12-record persona
conversation dataset (`.omx/logs/persona-dataset-2026-07-07T22-49-51Z.jsonl`, read from
worktree `agent-a27a881e8f8f5116e`). Read-only diagnosis; no code changed.

## Bug #1 — state-continuity: natural-language answers never reach the existing intake artifact

### Root cause

The model has **no tool that can write a question answer into an existing intake
artifact.** The only path that patches artifact state (`updateIntakeArtifactState`,
`apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts:145`) is wired exclusively to
the QuestionCard's UI `submit`/`skip` actions in
`apps/standalone-sveltekit/src/routes/+page.svelte` — it is never exposed as an AI SDK tool.
The model-callable tool set for an active `booking.context.intake` skill is:

- `createBookingIntakeArtifact` (`apps/standalone-sveltekit/src/lib/tools/intake-artifact.ts:39`)
  — its `inputSchema` accepts only an optional `title` (line 42-44). It cannot take an
  `artifactId` or answer values. Every call rebuilds a brand-new, blank canvas from
  `BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE`.
- `readActiveArtifactState`, `previewActiveIntakeCommand`, optionally
  `commitActiveIntakeCommand` (`apps/standalone-sveltekit/src/lib/tools/artifact-state.ts:241-407`)
  — read/preview/commit only, no write.

Compounding this, each `createBookingIntakeArtifact` call is assigned a **new artifact id**
by the client: `json-render-tool:${messageId}:${toolCallId}`
(`apps/standalone-sveltekit/src/lib/artifacts/tool-artifact-extraction.ts:59`). There is no
id-reuse or existing-artifact merge logic in this path at all (contrast with
`createIntakeArtifact` in `server/intake-artifacts.ts:84-117`, which does check for an
existing artifact by id and patches — but that function is never called from this tool).

So when a user answers conversationally instead of clicking a QuestionCard, the model:
1. Cannot call anything that writes the answer into the real artifact's `state.draftAnswers`/`state.manifest`.
2. Its only artifact-producing tool structurally cannot accept the answer values anyway.
3. It resorts to either calling `createBookingIntakeArtifact` again (a second, still-blank
   canvas with a new id) or falling back to the generic `createJsonArtifact` tool and
   free-handing a lookalike form — which has no `state.surface.skillId` /
   `state.manifest.source.skill` marker concept at all
   (`apps/standalone-sveltekit/src/lib/tools/artifact.ts`, generic `specSchema`, no forced
   marker fields). `resolveWorkflowId`
   (`apps/standalone-sveltekit/src/lib/agent-workflows/page-control-workflow.ts:148-153`)
   requires `state.surface.skillId`, `state.surface.id`, or `state.manifest.source.skill` to
   resolve a non-null workflow id; without it, `createAgentWorkflowSnapshot` returns
   `emptyWorkflowSnapshot()` and `phase` stays `"idle"` forever (line 45,122-138).

Note: the canonical recreate path (`createInteractiveSurfaceJsonRenderSpec`,
`packages/json-ui-runtime/src/intake.ts:227-233`) *does* set the marker correctly — so a
same-shape recreation alone would not idle the workflow. The dataset shows the actual failure
mode is worse: the model eventually drifts to non-canonical question ids and the marker-less
generic tool once repeated recreation doesn't produce visible progress.

### Reproduction (2/2)

- **Record 3 / persona `hotel-fb-director`** (`outcome.status: "blocked_schema_drift"`,
  `finalPhase: "idle"`): called `createBookingIntakeArtifact` twice, `readActiveArtifactState`
  twice, then `createJsonArtifact`. Per the harness's own notes: the model "narrated the
  answers as 'filled in' with checkmarks both times but never patched the ORIGINAL artifact's
  `/answers` state — instead it recreated a fresh, differently-shaped artifact each time
  (second recreation used non-canonical question ids `intake_mode`/`bookable_inventory`
  instead of `q_intake_mode`/`q_inventory_core`, and dropped the `booking.context.intake`
  surface/manifest marker entirely)."
- **Record 10 / persona `restaurant-gm-terse`** (opener: *"Set up a venue for dinner
  reservations. Trattoria, 46 seats."*), same `blocked_schema_drift` / `idle` outcome: the
  model called `readActiveArtifactState` with a self-invented artifact id that didn't match
  the real one, got nothing back, and rebuilt from scratch — "in the rebuild it marked the
  two actually-required fields (intake mode, core inventory) as still-pending while marking
  non-required fields (business name, seat count) as done — inverted from what was actually
  said."

This matches the independently-written predictability audit
(`docs/product/agent-context-inventory-2026-07-07.md:17`): *"Conditional:
`createBookingIntakeArtifact` ⟷ `createJsonArtifact` (mutually exclusive on intake-skill
activity, :119)."* — confirming the fallback to the marker-less generic tool is a designed
consequence of that mutual exclusivity, not a one-off.

### Severity for the demo

**High.** Any viewer who answers a QuestionCard question in the chat box instead of clicking
the card — a completely natural interaction — permanently strands the intake flow at
`preview: idle`, even though the assistant's own text falsely claims the answers were saved.
Reproduced 2/2 on first natural-language answer turn, independent of persona tone (terse and
detail-oriented personas both hit it).

### Fix options (ranked)

1. **Add a model-callable "submit intake answer" tool that patches the existing artifact.**
   Wrap the existing, already-correct `updateIntakeArtifactState`
   (`server/intake-artifacts.ts:145`) as an AI SDK tool (mirroring how the QuestionCard UI
   calls it), taking `artifactId`, `questionId`, `value`/`skipped`. This directly closes the
   gap: the model gets a real patch path instead of only "recreate blank." Touches:
   `apps/standalone-sveltekit/src/lib/tools/intake-artifact.ts` (new tool),
   `apps/standalone-sveltekit/src/lib/agent.ts` (wire into `bookingContextIntakeActive` tool
   set), `apps/standalone-sveltekit/src/lib/server/booking-workflows/context-intake.ts`
   (`requiredTools` list, workflow steps). This is agent-ui product code, not prompt-only.
2. **Make `createBookingIntakeArtifact` idempotent/marker-preserving and reuse the caller's
   active artifact id when one exists**, and accept optional answer values in its input
   schema so a natural-language turn can be applied in one call. Touches:
   `apps/standalone-sveltekit/src/lib/tools/intake-artifact.ts`,
   `apps/standalone-sveltekit/src/lib/artifacts/tool-artifact-extraction.ts` (id assignment
   logic at line 59 would need to key off `pageContext.activeArtifactId` instead of always
   minting `json-render-tool:${messageId}:${toolCallId}`). More invasive; changes a tool
   contract the QuestionCard UI also depends on.
3. **Prompt/skill steering only** — add an explicit instruction in
   `context-intake.ts`'s `workflowSteps`/`negativeRules` ("never call
   `createBookingIntakeArtifact` a second time while an intake artifact is active; ask the
   user to use the form") and reinforce in `agent-prompt.ts`. Cheapest, agent-ui-prompt-only,
   but does not fix the underlying capability gap — it only tells the model to refuse
   natural-language answers, which degrades UX and is not reliably followed (the model in
   record 3 already "narrated" success it didn't achieve, i.e. it isn't self-aware of the
   failure mode).

Recommend **1**, done together with **3** as an immediate stopgap disclaimer in the intake
skill's system prompt until 1 ships.

## Bug #2 — RUNTIME_UNAVAILABLE and the "generic dashboard" fallback

### Root cause

This is two mechanisms stacked, not a single bug, and static analysis plus the dataset's own
telemetry (10 of 12 persona runs) settle the classification without needing a fresh live call:

**Mechanism A — command tools are unconditionally removed when a preview-only/context-create
skill is active.** `apps/standalone-sveltekit/src/lib/agent.ts:103-104`:
```
const commandCatalogTools = previewOnlyRuntimeActive || bookingContextCreateActive
  ? {}
  : createCommandCatalogTools({ ... });
```
When phrasing matches `booking.context.intake`'s `intentAliases` (e.g. "set up a venue",
`context-intake.ts:148-155`), the entire `searchCommandCatalog`/`learnCommand`/
`executeCommand`/`commitCommand` tool set is withheld — the model literally cannot attempt a
booking command and so can never see `RUNTIME_UNAVAILABLE` on that path. This is legitimate,
intentional gating (also documented independently in
`docs/product/agent-context-inventory-2026-07-07.md:17`: *"commandCatalogTools entirely
removed when preview-only or context-create active"*).

**Mechanism B — the generated booking OpenAPI runtime is genuinely unmounted/uncredentialed
in this deployment, for every command, regardless of phrasing.**
`createGeneratedBookingRuntimeAdapter`
(`apps/standalone-sveltekit/src/lib/server/host-command-runtime.ts:177-191`) computes
`canExecute = Boolean(baseUrl && fetcher && hasBookingRuntimeCredential(authContext))` and
marks **every** binding `status: canExecute ? binding.status : "unavailable"` when false.
`executeHostCatalogCommand` (`packages/platform-adapters/src/index.ts:296-313`) returns the
`runtime_unavailable` policy reason (surfaced to callers as `RUNTIME_UNAVAILABLE`) whenever no
runtime binding is found, or a found binding's `status === "unavailable"`. This check is
identical for every command id and every prompt — it is not phrasing-conditioned in the code.

**Why the two look correlated in testing:** phrasing that matches the intake skill's
`intentAliases` routes around Mechanism B via Mechanism A (no command tools offered, so B is
never exercised and its brokenness is invisible). Phrasing that does *not* match those
aliases leaves `commandCatalogTools` mounted, the model tries real booking commands, and hits
the always-broken Mechanism B.

### Evidence (already-collected, no fresh live call needed)

The 12-record dataset already constitutes 12 real `/api/generate` calls against the deployed
worker (`hostAuthenticated: "true"`, `hostOrg: "present"` on every record — ruling out session
auth as the cause). Correlating opener phrasing against outcome:

| # | Persona | Opener (first words) | Hit RUNTIME_UNAVAILABLE? |
|---|---|---|---|
| 0 | restaurant-gm-terse | "Need online reservations live..." | Yes |
| 1 | golf-pro-detail | "I want to set up tee time booking..." | Yes ("Booking runtime consistently unmounted") |
| 2 | yoga-owner-nervous | "I need to get class bookings working..." | Yes |
| 3 | hotel-fb-director | "We need to bring our hotel's three dining outlets onto a unified booking setup..." | No — routed to intake skill (bug #1 instead) |
| 4 | events-manager-private | "I need this system set up to handle full-venue bookings..." | Yes |
| 5 | boutique-hotel-gm | "I need room reservations set up..." | Yes |
| 6 | fitness-franchise-ops | "I'm setting up class and personal-training bookings..." | Yes |
| 7 | spa-wellness-manager | "I'd like to configure booking for our spa..." | Stalled turn (separate anomaly) |
| 8 | catering-owner-hustling | "Trying to get bookings set up..." | Stalled turn (separate anomaly) |
| 9 | tennis-club-coordinator | "I need to set up court booking..." | Yes |
| 10 | restaurant-gm-terse | **"Set up a venue** for dinner reservations..." | No — routed to intake skill (bug #1 instead) |
| 11 | spa-wellness-manager | **"I want to set up a venue** for spa treatment bookings..." | No — routed to intake skill |

10 of 12 organic phrasings hit `RUNTIME_UNAVAILABLE` or an equivalent unmounted-runtime
message; only the three records whose opener contains the literal "set up a venue" /
booking-context intent-alias phrase avoid it, by skipping the command runtime entirely. This
is exactly what Mechanisms A+B predict, and it means the booking command runtime (real reads,
availability, holds — as opposed to the preview-only intake artifact) **does not work at all
in this deployment**, for any prompt. The "working" demo path never actually exercises live
command execution.

### Severity for the demo

**High, and arguably the more fundamental of the two bugs.** It means only one exact family
of scripted phrasing ("set up a venue...") avoids visible breakage, and it avoids breakage by
routing around real functionality rather than by the functionality working. Any unscripted
prompt about booking setup — which is the overwhelming majority of natural phrasings, per the
table above — falls through to `RUNTIME_UNAVAILABLE` and a fabricated "generic dashboard" or
document artifact that isn't backed by real data.

### Fix options (ranked)

1. **Fix the runtime credential/mounting gap itself** — determine why
   `createBookingRuntimeAuthContextFromTrustedHostHeader` /
   `createBookingRuntimeAuthContextFromEnv`
   (`host-command-runtime.ts:729-756`) isn't resolving a usable bearer/service-token/
   signed-host-context for the deployed agent-ui worker, or why `SONIK_BOOKING_API_BASE_URL`
   isn't set. This is the actual bug: booking-service integration/config, or the
   `sonik-agent-ui` worker's env/secrets wiring — **not** agent-ui prompt code. Fastest
   confirmation without more live calls: check the `bookingRuntimeCredentialed` telemetry
   field already emitted at `apps/standalone-sveltekit/src/routes/api/generate/+server.ts:524`
   for a production/staging request — if it's `false`, this is confirmed. (Do not touch
   `sonik-booking-service` per scope; this is a config/secrets check, not a code change
   there.)
2. **If credentials are intentionally absent in this environment** (e.g., a scoped demo host
   session without `booking:read`/`booking:write`), make the failure legible instead of
   silent: today the model just gets `runtime_unavailable` and free-hands a dashboard with no
   signal to the user that the data is fabricated. Add an explicit "no live booking data
   available" acknowledgment path (agent-prompt/skill guidance in
   `apps/standalone-sveltekit/src/lib/agent-prompt.ts` and the relevant skill body) so the
   fallback is honest rather than presented as a real dashboard.
3. **Do not treat Mechanism A as the fix** — routing more phrasings into the preview-only
   intake skill would hide more of Mechanism B rather than fix it, and would multiply
   exposure to bug #1's state-continuity failure. Not recommended.

## Demo-safety verdict

The demo **can be shared safely only if scripted to the exact "set up a venue..." opener and
the operator answers exclusively by clicking QuestionCards, never by typing an answer in
chat.** That narrow path avoids both bugs simultaneously — but only because it avoids real
command execution (bug #2) and avoids ever requiring a state patch (bug #1), not because
either underlying capability works.

Any unscripted viewer will hit one of two dead ends within 1-2 turns: typing an answer instead
of clicking a card (bug #1 — intake silently stalls at `idle` while the assistant claims
success), or opening with any booking-setup phrasing that doesn't literally match the intake
skill's intent aliases (bug #2 — real booking commands are unconditionally unavailable and the
agent fabricates a dashboard).

**Minimum fix to make the demo robust to an unscripted viewer:** ship Bug #1 fix option 1 (a
real model-callable answer-patch tool) — this is the one most likely to be hit by a live
audience member typing instead of clicking. Bug #2 fix option 1 (restore real booking runtime
credentials/mounting) is higher effort and may be outside agent-ui's own repo, but is more
important long-term since it means *no* prompt currently exercises live booking command
execution — the demo's "it's really calling the booking service" narrative is not true today
for any phrasing that reaches the command catalog.
