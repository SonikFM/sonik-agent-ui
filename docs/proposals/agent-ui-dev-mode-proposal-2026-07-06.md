# Agent UI Dev Mode — One-Page Proposal

Source: `docs/handoffs/fable5-agent-ui-operational-handoff-2026-07-06.md` §3.D

## Problem

`sonik-agent-ui` runs as an iframe sidecar inside the booking host, and iterating on it embedded is slow: to see current deploy state, inspect the signed host context, check Pipe-B tail health, or reproduce a bug, an engineer has to jump between `wrangler tail`, browser devtools, and ad-hoc console logging, none of which is stitched together on the page itself. Dev panels already exist (`ArtifactInspector`, `ThemePicker`) but are gated purely by embed-mode detection — `showCanvasDeveloperPanels = dev || !isEmbeddedHostContextExpected()` (`apps/standalone-sveltekit/src/routes/+page.svelte:332`) — so they vanish in exactly the environment (real embed) where debugging is hardest. Agent UI Dev Mode is an internal harness overlay, gated behind an explicit opt-in, that surfaces deploy identity, host context, Pipe-B status, catalogs, and artifact state directly on the embedded page, and packages that state into a copy-pasteable repro prompt.

## Non-goals

- Not a user-facing console; never shown to end customers or shipped as a support tool.
- No command/tool execution from the panel — inspection only.
- No host-context minting or bypass of the signed-context trust model; the `/api/dev/smoke-host-context` signer path stays env-gated and out of scope.
- Not a replacement for `$ultratest` / Pipe-B evidence gates — it surfaces evidence, it doesn't certify it.

## Activation model

Replace the embed-mode heuristic with an explicit, revocable grant:

- **Signed query flag**: a short-lived signed param (e.g. `?agentUiDevMode=<token>`) minted the same way host context is signed, verified server-side before the panel mounts.
- **Host-granted scope**: alternatively, the host session grants a `agent-ui.dev-mode` capability alongside existing host-context scopes; the page checks for it the same way it checks `isEmbeddedHostContextExpected()`.
- Either path, `dev` (local Vite) continues to always show the panel — no change there.
- Grant is read-only-implying: presence of the scope/token never changes what the app is allowed to do, only what it renders.

## Panel spec

Tabs, each backed by an existing or trivially-added read-only data source:

- **Deploy** — worker version ID, commit SHA, build timestamp. Source: build-time env injection (Cloudflare Workers version ID at deploy, embedded via `wrangler.toml` `[vars]` or a generated `version.json`) surfaced through a small `getDeployInfo()` accessor.
- **Host Context** — current signed host-context payload (org, session, scopes, expiry), plus `host_context_missing` / `host_context_expired` / `host_context_recovered` telemetry state already emitted per handoff §2.C. Source: existing host-context guard state in `+page.svelte`.
- **Pipe-B** — last-known Pipe-B tail status (connected / stale / empty) and most recent evidence timestamp. Source: existing Pipe-B tail client state; read-only summary, no new tailing connection from the panel itself.
- **Catalogs** — command/skill catalog inspector: family, load policy, and last `searchCommandCatalog` / `searchSkillCatalog` / `learnSkill` results. Source: existing catalog registries in `packages/tool-contracts` and runtime skill loader state.
- **Artifact State** — active artifact kind, version, input-hash stability, and last `persistActiveArtifactStatePatch` result (saving/saved/failed). Source: `apps/standalone-sveltekit/src/lib/tools/artifact-state.ts` state already tracked for the approval-gating work in handoff §2.F.
- **Actions log** — recent semantic page-control action results (`createSession`, `submitPrompt`, trusted intake actions) with success/failure and reason codes. Source: `window.__sonikAgentUI` action results, already returned as `AgentUiSemanticActionResult` (`+page.svelte:1453` onward) — just needs a ring buffer.

This tab set is also the natural first mount point for the vendored `json-render` `devtools`/`devtools-svelte` package (`json-render/packages/devtools-svelte`), planned for post-demo adoption — design the tab container so a future "Renderer" tab can drop in without restructuring.

## Copy-repro-prompt spec

One button, one clipboard write, bundling:

1. `window.__sonikAgentUI.getPageContext()` snapshot (already exists).
2. `window.__sonikAgentUI.getAssertions()` snapshot (already exists).
3. Last N (~10) entries from the Actions log tab.
4. Deploy info (version ID, commit, timestamp) from the Deploy tab.

Rendered as a single fenced markdown block an engineer can paste directly into a bug report or agent prompt. A sibling "copy page context" button ships the same thing minus (3)/(4) for lighter-weight use.

## Security notes

- All tabs are read-only views over state the page already computes; the panel introduces no new privileged reads and no new mutation paths.
- Grant tokens/scopes are minted and verified the same way host context already is — no new trust boundary, no new signer surface.
- Dev Mode must fail closed: if the signed flag/scope check errors or is ambiguous, treat as not-granted (matches existing host-context-missing handling).
- No secrets (API keys, session tokens, PII) belong in the Host Context or repro-prompt payloads — redact before display/copy.

## Build estimate

| Tab | Estimate | Notes |
|---|---|---|
| Deploy | S | Version/commit injection + accessor + tiny UI |
| Host Context | S | State already tracked; render existing fields |
| Pipe-B | M | Needs a read-only summary view of tail client state |
| Catalogs | M | Registry data exists; needs a browsable UI |
| Artifact State | S | State already tracked; render existing fields |
| Actions log | M | Needs a ring buffer wrapped around existing action results |
| Copy-repro-prompt | S | Pure aggregation of the above, once tabs exist |
| Activation model (signed flag / scope) | M | New signer/verifier path, mirrors host-context pattern |

## Open questions for Dan

1. Signed query flag vs. host-granted scope — which fits the existing host/session model better, or do we want both (flag for local/manual use, scope for host-mediated grants)?
2. Should Dev Mode be a single global toggle, or per-tab grants (e.g. someone can see Deploy/Pipe-B but not Host Context)?
3. Local/deployed URL switcher — is this purely a convenience link list (preview URLs via `wrangler versions`), or do we want it to actually re-point the iframe host at a different origin at runtime?
4. Timing relative to `json-render` `devtools-svelte` adoption — build our own tab shell now, or wait and adopt theirs as the shell?
