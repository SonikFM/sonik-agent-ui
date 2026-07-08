# Headless workflow harness (P1)

This is **P1** of the high-volume agent harness plan
(`docs/plans/high-volume-agent-harness-testing-2026-07-07.md`): a Node
module + CLI that drives a full `booking-context-intake` workflow against
agent-ui's own HTTP endpoints — no browser, no Playwright — by calling the
same sequence of requests `apps/standalone-sveltekit/src/routes/+page.svelte`
issues from the client (`workspaceFetch`, `/api/generate`, `/api/artifact`,
`/api/artifact/[id]/state`). The page-control semantic actions
(`submitAnswer`, `saveDraft`, `approveAndRun`, …) are thin wrappers over these
same endpoints; this harness assembles them directly.

P1 is **the engine**, not the volume or the signal:

- **P2** (not built here) is the combinatorial scenario generator
  (phrasing/persona × answer-strategy × host-context) and the canned-SSE
  library for bulk mock-stream runs.
- **P3** (not built here) is the full 5-metric scorer read from R2 telemetry
  and a query/rollup layer.

This harness ships a **minimal scorer** (4 of the plan's 5 metrics, computed
from what the driver itself observes over HTTP — no R2/telemetry reads) so
the first runs are already measured, per the plan's decision to bring
scoring forward into P1.

## What it does

1. Create a workspace session (`POST /api/session`).
2. Seed a `booking-context-intake` json-render artifact with three
   unanswered `QuestionCard` elements (`POST /api/artifact`) — see
   "Why the driver authors the artifact itself" below.
3. Loop: find the next unanswered question (`lib/spec-walker.mjs`) → pick an
   answer (`lib/answer-picker.mjs`) → patch artifact state
   (`PATCH /api/artifact/[id]/state`) → send the machine-readable
   question-answer turn to `POST /api/generate` (parsing the SSE response
   with `lib/sse-stream.mjs`) → persist both turn messages
   (`POST /api/session/:id/messages`, matching what the client does after
   every stream) — until the workflow's client-computed phase reaches
   `preview_ready` or the loop stalls/errors.
4. Score the run (`lib/scorer.mjs`) and write a structured JSON result to
   stdout and `.omx/logs/<runId>.json`.

The harness deliberately **stops at `preview_ready`**, the same trust
boundary the app itself enforces: reaching preview is a pure function of
artifact state (readiness = required manifest fields present, no visible
errors — see `getIntakeApprovalReadiness`), but the actual
`commitActiveIntakeCommand` write is a **model tool call gated on a
host-signed `approvedCommandIds` grant**. The harness never fabricates that
call or substring-matches "approve" in a message to trigger a commit — see
the trusted-approval doctrine covered by the `sonik-agent-onboarding` skill.
Driving all the way through a real commit is real-model (`--target
deployed`) territory, not something a mock-stream run can honestly claim.

### Why the driver authors the intake artifact itself

In `--target local`'s mock-stream mode there is no live model: `/api/generate`
always returns the same canned three-bullet text
(`apps/standalone-sveltekit/src/lib/server/dev-smoke-stream.ts`). There is no
tool call that could author `QuestionCard` elements for us. So, exactly like
`scripts/agent-ui-booking-context-pipeb-smoke.mjs` already does for its
pre-filled fixture, the harness POSTs the initial artifact itself
(`lib/scenario.mjs`) and then walks/answers it locally. Against
`--target deployed` the same seeded artifact is a legitimate starting point
too — a real model is asked to continue the intake from it, and the
question-answer loop's `/api/generate` calls carry real weight there.

## Usage

```bash
# Local target (mock stream, in-memory persistence, no live LLM):
node scripts/harness/run-workflow.mjs --target local

# Reuse an already-running dev server instead of spawning one:
AGENT_UI_BASE_URL=http://localhost:5175 \
  node scripts/harness/run-workflow.mjs --target local --no-start-server

# A custom scenario file or inline JSON:
node scripts/harness/run-workflow.mjs --target local --scenario ./my-scenario.json
node scripts/harness/run-workflow.mjs --target local --scenario '{"spec":{"root":"main","elements":{}}}'

# Deployed target (real model, real telemetry — see the blocker note below):
BOOKING_URL=https://sonik-booking-app-pipe-b.liam-trampota.workers.dev \
TEST_EMAIL=... TEST_PASSWORD=... \
  node scripts/harness/run-workflow.mjs --target deployed
```

Flags: `--target local|deployed` (default `local`), `--scenario <spec>`,
`--base-url <url>`, `--json` (print only the structured result),
`--no-start-server` (don't spawn `pnpm dev`), `--max-turns <n>` (question
loop cap, default 12), `--run-id <id>`.

Exit code is `0` when the run status is `PASS` (reached `preview_ready`),
`1` otherwise (`INCOMPLETE` or `FAIL`).

## `--target local` setup

`apps/standalone-sveltekit/wrangler.jsonc` hardcodes
`SONIK_AGENT_UI_PERSISTENCE_MODE=cloud` for the deployed worker. Local
`pnpm dev` (via `@sveltejs/adapter-cloudflare`'s `getPlatformProxy`) reads
that same file, so **without an override it would try to talk to a real
Neon DB and require a signed host session** — exactly the trap the task
asked this harness to investigate rather than shim around.

The supported override is **`apps/standalone-sveltekit/.dev.vars`**
(wrangler's own local-secrets convention — picked up automatically,
never bundled/deployed, gitignored by this change):

```
SONIK_AGENT_UI_PERSISTENCE_MODE=memory
SONIK_AGENT_UI_ALLOW_UNSIGNED_HOST_CONTEXT=true
```

With that in place, `workspace-services.ts`'s existing
`isUnsignedBrowserHostContextAllowed()` accepts an **unsigned**
`x-sonik-agent-ui-host-context` header — the same envelope shape the
embedded booking host signs, just without the HMAC — so the harness can
authenticate itself with no browser and no real Amplify/booking login. This
file was added by this change (see `run-workflow.mjs`'s final report for the
exact diff); it is the one "app change" this harness needed, and it is
config, not source — no `.ts`/`.svelte` file was touched. Delete it and
`pnpm dev` reverts to requiring cloud persistence + a real signed session,
same as deployed.

`run-workflow.mjs --target local` (without `--no-start-server`) spawns
`pnpm dev` itself and waits for it to become reachable, exactly like
`scripts/agent-ui-smoke.mjs` does — reusing an already-running instance if
one answers first.

## `--target deployed` status

The client code path exists (`lib/host-context.mjs`'s
`loginDeployedHostContext`, mirroring
`scripts/agent-ui-booking-context-pipeb-smoke.mjs`'s login + envelope
pattern over plain HTTP instead of Playwright), but **it was not verified
end-to-end in this change**. Two independent blockers, neither worked
around:

1. No `TEST_EMAIL`/`TEST_PASSWORD` (or `AMPLIFY_TEST_EMAIL`/
   `AMPLIFY_TEST_PASSWORD`) credentials were available in this environment.
2. Per `docs/plans/agent-ui-amplify-auth-proxy-retrofit-2026-07-07.md`, the
   deployed worker's own login proxy is currently **flag-gated OFF**
   (`wrangler.jsonc` deliberately left the flag off after that retrofit
   shipped), and the booking-embed envelope-minting endpoint
   (`GET /api/v1/booking/agent-ui/host-context`) lives in the sibling
   `sonik-booking-service` repo, not this one, so its exact response shape
   couldn't be confirmed here.

`--target local` is the end-to-end-verified path for this change. P2/P3
picking up `--target deployed` should start by confirming the envelope
endpoint's shape against `sonik-booking-service` and getting test
credentials provisioned.

## What the minimal scorer measures

Computed by `lib/scorer.mjs` from the turns the driver itself collected
(`{text, toolCalls}` per `/api/generate` call) — no telemetry/R2 reads, that
layer is P3:

| Metric | What it checks |
|---|---|
| `recipeAdherence` | Did the declared tool sequence fire, in order? Off-recipe calls are named, not just counted. |
| `executeVsNarrate` | Is there a tool-call receipt for a claimed mutation (default: `commitActiveIntakeCommand`), or did the assistant narrate success in text without one? |
| `turnEconomy` | Turn count + tool calls per turn. |
| `refusalCorrectness` | For scenarios tagged `expectRefusal`, did a typed refusal pattern actually fire (and not fire when it shouldn't)? |

Phrasing sensitivity (the plan's 5th, and the audit's #1 unpredictability
suspect) needs N phrasings of the same scenario compared against each other
— that's the P2 scenario generator's job, not P1's.

In `--target local` mock-stream mode, `recipeAdherence`/`executeVsNarrate`
will legitimately score "no tool calls" (mock stream never calls tools) —
that's the L1 layer correctly reporting it's exercising endpoint machinery,
not model behavior. Real behavior scoring is `--target deployed` (L3)
territory.

## Files

- `run-workflow.mjs` — the CLI.
- `lib/sse-stream.mjs` — parses the Vercel AI SDK `data: <json>\n\n` /
  `data: [DONE]` protocol `/api/generate` streams back, and reduces chunks
  into `{text, toolCalls, error, finishReason}`.
- `lib/host-context.mjs` — builds the `x-sonik-agent-ui-host-context` header
  for both targets.
- `lib/endpoint-client.mjs` — thin fetch wrappers for every endpoint the
  driver calls.
- `lib/scenario.mjs` — the built-in `booking-context-intake` scenario spec,
  and `resolveScenario()` for file/inline overrides.
- `lib/spec-walker.mjs` — pure port of the client's workflow-state readers
  (`getQuestionCards`, readiness, phase) so the driver can compute
  "what's next" without a Svelte runtime.
- `lib/answer-picker.mjs` — pure port of the state-patch/turn-message shapes
  `createQuestionAnswerStateUpdates` / `createQuestionAnswerTurnPayload`
  produce, plus a deterministic "valid" answer synthesizer.
- `lib/scorer.mjs` — the minimal scorer described above.

`tests/unit/harness-driver.test.mjs` unit-tests all of the above against
fixtures, no network, and is wired into the root `pnpm test` chain.
