# AI SDK Dev Workbench upstream proof

## Provenance

- Upstream: `https://github.com/vercel/ai.git`
- Revision: `91a3d6e9f1e2e948dcffc5bec1b38b1c96d0b373`
- License: Apache-2.0; copied at `upstream/LICENSE`
- Copy manifest: `manifests/copy-retrofit/ai-sdk-dev-workbench-upstream-proofs.json`
- Classification: command-capable embedded-host reference
- Copied island: immutable; `allowedLocalModifications` is empty

The island is evidence, not a buildable package. Production code must install the published AI SDK packages and adapt them outside `upstream/`. The TUI example's repository-bootstrap helper is byte-identical to the copied Next.js helper, so the duplicate was omitted.

## Behavior parity map

### `codex-coding-agent-bootstrap`

- donor behavior id: `codex-coding-agent-bootstrap`
- upstream file/test/source evidence: `examples/harness-e2e-next/agent/harness/ai-sdk-coding-repo.ts`, `examples/harness-e2e-next/agent/harness/codex/ai-sdk-coding-agent.ts`, and `packages/harness-codex/src/codex-harness.test.ts`
- copied destination: matching paths under `upstream/`
- Sonik adapter/contract: `apps/dev-workbench/src/lib/contracts/workbench.ts` and the concrete Vercel bootstrap; Codex receives the mutable checkout as its working directory
- state owner and persistence seam: Sonik owns repository/ref/workspace identity; Vercel Sandbox owns the live filesystem; Git remains the change record
- telemetry event(s): planned `sandbox.attached`, `process.started`, `process.exited`, `file.changed`
- host test / ultratest / manual prompt: `tests/unit/dev-workbench-server.test.mjs` proves the pinned revision/bootstrap/tmux contract; a credentialed live edit-and-diff smoke remains deployment evidence
- deployed host URL or local route: standalone Dev Workbench `/`; lifecycle API `/api/workspaces`
- known gaps or deferred scope: public HTTPS repositories and pinned revisions are implemented; scoped private-Git credentials and a live cleanup audit remain deferred

### `vercel-sandbox-resume-and-ports`

- donor behavior id: `vercel-sandbox-resume-and-ports`
- upstream file/test/source evidence: `examples/harness-e2e-next/app/api/harness/codex/ai-sdk-coding/route.ts`, `examples/harness-e2e-next/util/harness-resume-store.ts`, and `packages/sandbox-vercel/src/vercel-sandbox.test.ts`
- copied destination: matching paths under `upstream/`
- Sonik adapter/contract: the request-scoped Workbench session record stores the Vercel sandbox name/id and preview descriptor; `Sandbox.openInteractive()` issues a fresh provider-native terminal token on each attach
- state owner and persistence seam: the first slice uses an HttpOnly opaque session cookie plus `.sonik/workspace.json` in a non-persistent sandbox; Vercel owns the active lifecycle and tmux owns live terminal continuity; snapshot resume waits for tenant-scoped durable storage and cleanup
- telemetry event(s): planned `sandbox.attached`, `sandbox.suspended`, `sandbox.destroyed`, `preview.ready`
- host test / ultratest / manual prompt: protocol tests prove WSS token construction and official start/resize/exit frames; a credentialed Vercel run is still required to prove provider attachment end to end
- deployed host URL or local route: standalone Dev Workbench `/`; lifecycle API `/api/workspaces`
- known gaps or deferred scope: Vercel Deployment Protection is required; tenant authorization, durable attachment storage, and stale-sandbox reconciliation remain Sonik responsibilities

### `workflow-slice-continuation`

- donor behavior id: `workflow-slice-continuation`
- upstream file/test/source evidence: `examples/harness-e2e-next/app/api/harness/codex/workflow/run-slice-step.ts`, `examples/harness-e2e-next/app/api/harness/codex/workflow/workflow.ts`, and `packages/workflow-harness/src/run-harness-agent-slice.test.ts`
- copied destination: matching paths under `upstream/`
- Sonik adapter/contract: existing workflow run journal, leases, approvals, and resume cursor; provider state is an execution attachment rather than workflow truth
- state owner and persistence seam: Sonik workflow storage owns run state and approval; the harness session may remain warm or reattach by serialized resume state
- telemetry event(s): existing run events plus planned `sandbox.attached` and normalized process/file events
- host test / ultratest / manual prompt: planned parity test covers first-turn finish, mid-turn timeout, continuation without resending the prompt, approval pause/resume, destroy-on-finish, and ordered event replay
- deployed host URL or local route: deferred background/governed-run route; not required for the first raw tmux Workbench slice
- known gaps or deferred scope: Workflow Harness is intentionally deferred until a real run exceeds one request; workflow modules must remain AI-free and dynamically import the agent inside a `use step` function

### `tui-session-lifecycle`

- donor behavior id: `tui-session-lifecycle`
- upstream file/test/source evidence: `examples/harness-e2e-tui/agents/codex/ai-sdk-coding-agent.ts`, `examples/harness-e2e-tui/harness/codex/ai-sdk-coding.ts`, and `examples/harness-e2e-tui/lib/run-tui.ts`
- copied destination: matching paths under `upstream/`
- Sonik adapter/contract: reference-only for a future AI SDK TUI client using the same Sonik run/session transport
- state owner and persistence seam: Sonik remains the session owner; the donor helper creates one harness session, injects it into generate/stream calls, and destroys it on exit
- telemetry event(s): same normalized run events as the browser surface; no separate TUI event vocabulary
- host test / ultratest / manual prompt: future parity test opens web and TUI clients on one run, observes the same ordered events, completes an approval from one surface, and observes it from the other
- deployed host URL or local route: terminal executable, deferred
- known gaps or deferred scope: the first Dev Workbench embeds a real Codex CLI through xterm.js, Vercel's native interactive PTY, and tmux; AI SDK TUI is a style/protocol reference and is not the first production terminal implementation

## Runtime and dependency risks

- The inspected AI SDK checkout expects a current Node.js 22+ toolchain.
- Codex Harness would require a distinct exposed bridge port if adopted later. The first slice does not use it: terminal bytes stay on Vercel's native interactive PTY and only the preview port is exposed.
- The Codex adapter rejects non-`allow-all` builtin permission modes and builtin tool filters; Sonik authorization and approval must remain outside that adapter.
- Vercel Sandbox credentials, private Git credentials, model credentials, and reconnect grants are trust-boundary inputs and require redaction plus expiry.
- The copied donor tests cannot run from this documentary island because package implementations and their workspace dependencies are intentionally not vendored. Sonik must run focused host tests against installed packages and the production route.
- Vite/HMR, tmux, provider-native PTY streaming, page snapshots, and cross-origin preview instrumentation are Sonik production seams; none are proven by these donor files.

## Drift and parity commands

```sh
node scripts/copy-from-manifest.mjs manifests/copy-retrofit/ai-sdk-dev-workbench-upstream-proofs.json
COPY_RETROFIT_REQUIRE_SOURCE=1 node scripts/verify-source-drift.mjs manifests/copy-retrofit/ai-sdk-dev-workbench-upstream-proofs.json --write-integrity
node scripts/verify-source-drift.mjs manifests/copy-retrofit/ai-sdk-dev-workbench-upstream-proofs.json
```
