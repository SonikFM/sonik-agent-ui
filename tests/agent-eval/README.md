# agent-eval

Deterministic, no-live-model conformance harness for the Sonik page-control
contract (`window.__sonikAgentUI`) and the json-render fork's spec-resolution
APIs. Ported and adapted from open-design's `e2e/lib/playwright/` bundle
(`mock-factory.ts`, `rail.ts`, `fake-agents.ts`) and the json-render
`examples/no-ai` pattern (a static spec fixture with no AI generation).

**These scenarios do NOT run as part of `pnpm test`.** They require a
deployed environment and real test credentials (or a local dev server), so
they are invoked explicitly:

```sh
node scripts/agent-eval-gate.mjs                      # run every scenario
node scripts/agent-eval-gate.mjs page-control-contract  # run one scenario
node scripts/agent-eval-gate.mjs renderer-no-ai
```

## Env

| Var | Default | Used by |
| --- | --- | --- |
| `AGENT_EVAL_BASE_URL` | `https://sonik-booking-app-pipe-b.liam-trampota.workers.dev` | `page-control-contract` — the booking app origin to log into |
| `TEST_EMAIL` | *(required)* | `page-control-contract` — booking app login email |
| `TEST_PASSWORD` | *(required)* | `page-control-contract` — booking app login password |
| `AGENT_EVAL_MODE` | unset (deployed mode) | set to `offline` to apply `lib/mock-factory.mjs` route mocks instead of hitting a live backend |
| `HEADLESS` | `true` | set to `false` to watch the browser locally |
| `AGENT_EVAL_SCENARIO_TIMEOUT_MS` | `120000` | per-scenario timeout budget |

`renderer-no-ai` needs no env — it's a pure node-level conformance check with
no network access at all.

## Modes

**Deployed mode (default, authoritative).** `page-control-contract` logs into
the real deployed booking app with real credentials, opens the real agent
sidecar, and drives the real `window.__sonikAgentUI`. This is the only mode
that can validate the exact `submitPrompt({ prompt: "" })` → `"empty_prompt"`
refusal reason, because that specific reason requires an active,
host-authenticated session (see `getSubmitDisabledReason` precedence in
`apps/standalone-sveltekit/src/routes/+page.svelte`). Run this before trusting
a green result.

**Offline/local mode (`AGENT_EVAL_MODE=offline`).** Intended for running
against a local `pnpm --filter standalone-sveltekit dev` server without a live
LLM. `lib/mock-factory.mjs` replaces `POST /api/generate` with a canned SSE
response so no model is ever invoked. **Limitation:** the trusted
host-context boundary (`createSignedTrustedHostContext`) is signed and
re-validated server-side on every request; a Playwright route mock cannot
forge a header the server will accept downstream. That means session-gated
checks (the exact `empty_prompt` reason, and any action that requires an
active session/artifact) cannot be asserted with full confidence offline —
`page-control-contract` reports `INCONCLUSIVE` rather than `FAIL` for the
session-dependent assertion in that case, with the reason recorded in
`inconclusiveReasons`. Everything else (schemaVersion, the 13 actions
existing and returning typed `{ ok, state }` shapes) is still checked
normally, since it doesn't depend on a live session.

## Scenarios

### `scenarios/page-control-contract.eval.mjs`

Pure contract conformance for `window.__sonikAgentUI`
(`packages/agent-observability/src/index.ts` `AgentUiPageControl`). No prompt
with real content is ever submitted, so no LLM is invoked. Asserts:

- `schemaVersion === "sonik.agent_ui.page_control.v1"` and
  `getAssertions().schemaVersion === "sonik.agent_ui.assertions.v1"`.
- All 13 registered actions (`createSession`, `submitPrompt`, `stop`,
  `clearChat`, `clearArtifact`, `reloadSession`, `openWorkspaceDocument`,
  `submitAnswer`, `markUnknown`, `saveDraft`, `requestApproval`,
  `approveAndRun`, `cancelApproval`) exist and are callable.
- Every action returns the documented `{ ok, state, ... }` shape — never
  throws, never returns an untyped result — and is either accepted
  (`ok: true`) or typed-refused (`ok: false` + a string `disabledReason`).
- `submitPrompt({ prompt: "" })` is refused with `disabledReason ===
  "empty_prompt"` specifically (deployed mode only — see Modes above).
- The six actions that require an active json-render artifact
  (`submitAnswer`, `markUnknown`, `saveDraft`, `requestApproval`,
  `approveAndRun`, `cancelApproval`) are refused with
  `disabledReason === "missing_active_artifact"` when none is open.
- `getAssertions()` returns the documented field shape with correct value
  types.

It also records — as a **diagnostic note, not a pass/fail check** — whether
the sidecar was opened via the documented `window.__sonikAgentHost.openChat()`
seam or via DOM-control fallback. That's a separate contract (the outer
host-embedding integration) from the page-control surface this scenario
exists to verify; see "Contract violations discovered" below.

### `scenarios/renderer-no-ai.eval.mjs`

Node-level conformance check for the json-render fork's spec-resolution APIs
(`packages/core/src/{props,visibility,types}.ts`), in the spirit of
`json-render/examples/no-ai` — a static spec fixture (modeled on that
example's "Registration Form"/"Cascading Selects" patterns) resolved against
hand-authored state, no AI involved.

**Choice made:** this exercises `resolveElementProps` / `resolveBindings` /
`evaluateVisibility` directly rather than mounting `packages/svelte`'s
`Renderer.svelte` in a browser. Browser-mounting a Svelte 5 component tree
standalone (outside the standalone-sveltekit app's own build pipeline) would
require a throwaway Vite/SvelteKit harness just for this eval bundle;
`resolveElementProps` et al. are the actual "no AI" contract surface — what
turns a static JSON spec + state object into resolved props, independent of
any renderer — so exercising them directly is deterministic, fast, and needs
no new dependency.

Covers: `$bindState` resolving the current value and exposing a write-back
path, `$state`-based `visible` conditions flipping as bound state changes,
`$template` interpolating both absolute state paths and bare names (falling
back from repeat-item scope to state), and `$cond`/`$then`/`$else` picking
branches based on nested/initially-null state.

Imports `packages/core/src/*.ts` directly (mirroring the pattern the repo's
own `tests/unit/*.test.mjs` already use for this package) and reuses the
repo's existing `tests/unit/ts-extension-loader.mjs` loader to resolve that
package's extensionless internal imports — `scripts/agent-eval-gate.mjs`
passes it automatically; if you run the scenario file directly, pass it too:

```sh
node --experimental-strip-types --loader ./tests/unit/ts-extension-loader.mjs \
  tests/agent-eval/scenarios/renderer-no-ai.eval.mjs
```

## Lib

- `lib/page-control-driver.mjs` — the "fake agent": login, open-sidecar
  (host-controller-first with DOM fallback), iframe location, and a thin
  remote-invocation client for `window.__sonikAgentUI` that keeps every
  assertion structural (`ok`/`state`/`disabledReason`), never DOM-scraping,
  never screenshots-as-assertions (screenshots are written to `.omx/logs/` as
  artifacts only).
- `lib/mock-factory.mjs` — route-level network mocks for offline mode. See
  the file header for the exact limitation around the trusted host-context
  boundary.

## Contract violations discovered while building this harness

Running `page-control-contract` against the live deployed booking app
(`https://sonik-booking-app-pipe-b.liam-trampota.workers.dev/dashboard`) with
real credentials, `window.__sonikAgentHost` was not present on `window` across
6 polling attempts (~9s) — the harness fell back to DOM controls
(`#booking-agent-ui-open-chat` etc.) to open the sidecar, which succeeded. The
existing, unmodified `scripts/agent-ui-booking-context-pipeb-smoke.mjs` fails
outright on this exact symptom (`"Booking embed did not open through
window.__sonikAgentHost"`) against the same deployment. This is NOT a
regression: the host controller was never implemented on the booking side —
`@sonikfm/sonik-sdk` has zero `__sonikAgentHost` references in its history.
See `docs/handoffs/booking-host-controller-e2e-gap-evidence-2026-07-06.md`
for the root cause and the pending sonik-sdk port that will close it. It does
not affect `window.__sonikAgentUI` itself — every page-control
assertion (schemaVersion, all 13 actions, typed refusals including the exact
`empty_prompt` reason) passed cleanly once the iframe was located by either
path.
