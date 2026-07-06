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

`renderer-no-ai` needs no env — it serves itself over a local-only Vite dev
server (no external network access at all).

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

It also records — as **evidence, not a pass/fail check** — which path opened
the sidecar (`diagnostics.sidecarOpenPath.openPath`, one of `"dom-control"` /
`"host-controller"`). See "Sidecar open path" below for why that's not a
contract check here.

### `scenarios/renderer-no-ai.eval.mjs`

Browser-mounted conformance check for `packages/svelte`'s actual renderer, in
the spirit of `json-render/examples/no-ai` — a static spec fixture (modeled
on that example's "Registration Form"/"Cascading Selects" patterns) resolved
against hand-authored state, driven by real DOM input events, no AI involved.

This mounts the real `RendererWithProvider.test.svelte` (the same
`StateProvider → VisibilityProvider → ValidationProvider → ActionProvider →
Renderer` stack `packages/svelte/src/renderer.test.ts` itself uses) inside an
actual Chromium page via Playwright. `lib/svelte-mount-harness.mjs` boots a
Vite dev server programmatically, rooted at a fresh directory under
`tests/agent-eval/.tmp/` (removed after each run), and serves a small entry
module that imports `packages/svelte/dist` directly by relative filesystem
path — no reimplementation of prop/visibility resolution; the rendered DOM is
whatever the shipped renderer actually produces. `vite` and
`@sveltejs/vite-plugin-svelte` aren't declared as new dependencies — they're
resolved from where the workspace already has them installed
(`apps/standalone-sveltekit`), the same way that app's own `vite dev` would
find them.

Drives real `<input>` elements and reads real rendered DOM (no reaching into
internal state) to prove:

- **`$bindState`**: typing into an input round-trips through the real state
  store and back into a `$template`-bound preview.
- **`$cond` as a `visible` gate**: a section only renders once a bound field
  matches a condition (business-only fields staying absent from the DOM
  entirely until `accountType` is set to `"business"`).
- **`$cond`/`$then`/`$else` in a prop value**: two elements bound to
  different, independently-seeded state paths render their `then` vs. `else`
  branch correctly.

Run directly:

```sh
node --experimental-strip-types tests/agent-eval/scenarios/renderer-no-ai.eval.mjs
```

## Lib

- `lib/page-control-driver.mjs` — the "fake agent": login, open-sidecar
  (DOM controls, with a forward-compat host-controller probe — see "Sidecar
  open path" below), iframe location, and a thin remote-invocation client for
  `window.__sonikAgentUI` that keeps every assertion structural
  (`ok`/`state`/`disabledReason`), never DOM-scraping, never
  screenshots-as-assertions (screenshots are written to `.omx/logs/` as
  artifacts only).
- `lib/mock-factory.mjs` — route-level network mocks for offline mode. See
  the file header for the exact limitation around the trusted host-context
  boundary.
- `lib/svelte-mount-harness.mjs` — the programmatic Vite dev server used by
  `renderer-no-ai` to browser-mount `packages/svelte`'s real renderer. See its
  file header for how it resolves `svelte`/`@json-render/core` without adding
  dependencies or symlink-guessing subpath exports.

## Sidecar open path

`window.__sonikAgentHost` does not exist on the deployed booking app today —
it was added to `packages/agent-embed` during the Jul 5 determinism
hardening but was never ported into `@sonikfm/sonik-sdk`'s embed code, which
is what the booking app actually uses to mount the sidecar (confirmed via
`git log -S "__sonikAgentHost"` against `sonik-booking-service`: zero hits,
any branch, any time — this was never built, not a regression). Full
evidence and timeline:
`docs/handoffs/booking-host-controller-e2e-gap-evidence-2026-07-06.md`.

Given that, `lib/page-control-driver.mjs`'s `openAgentSidecar` treats the
open-chat **DOM controls** (the same selector list
`scripts/agent-ui-booking-context-pipeb-smoke.mjs` uses) as the one
first-class open path, with a single explicit forward-compat check ahead of
it: if `window.__sonikAgentHost?.openChat` exists (e.g. once the sonik-sdk
port lands), it's used instead. Either way, `findAgentFrame` returns which
path was actually taken (`"dom-control"` or `"host-controller"`), and
`page-control-contract` records it as `diagnostics.sidecarOpenPath` evidence
rather than folding it into pass/fail — the DOM path is expected and correct
today, and even a currently-missing host controller must never mask whether
`window.__sonikAgentUI` itself is conformant underneath it.
