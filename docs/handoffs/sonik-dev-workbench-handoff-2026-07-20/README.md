# Sonik Dev Workbench Handoff

**Snapshot date:** 2026-07-20
**Scope:** the repository-aware Codex sandbox, its embedded Agent UI experience, host page context, visual selection and capture, operational telemetry, tools, and safe deployment.
**Status:** implementation exists, but the end-to-end product promise is **not complete**. The embedded terminal is usable; several important capabilities are hidden, partial, disabled, or only represented by contracts and tests.

This directory is the canonical handoff for the work. A successor should be able to understand the product request, current truth, architecture, remaining sequence, and validation gates without reading the full historical conversation.

## Start here

1. Read [01-product-requirements.md](./01-product-requirements.md) for the complete requested product.
2. Read [02-current-state-and-gaps.md](./02-current-state-and-gaps.md) before trusting a prior completion claim.
3. Use [03-architecture.md](./03-architecture.md) for boundaries, flows, and ownership.
4. Execute [04-delivery-plan-and-acceptance.md](./04-delivery-plan-and-acceptance.md) in order.
5. Use [05-source-index.md](./05-source-index.md) to audit any disputed statement.
6. `handoff-manifest.json` provides a machine-readable package index.

## Target outcome

A developer can open Sonik Agent UI on a real host such as Booking, choose **Dev**, and supervise a real Codex CLI session running in an isolated repository sandbox. The agent can receive explicit, bounded context from the host page; inspect selected elements and screenshots; correlate failures with source, logs, network, and changed files; edit and hot-reload the application; run verification; and, only after explicit approval, publish through Sonik's authority boundary.

The primary interaction is a real terminal. Product controls around the terminal make context, evidence, capabilities, failures, and consequential actions understandable without requiring the developer to reverse-engineer shell state.

## Status vocabulary

| Term | Meaning |
|---|---|
| **Complete** | The capability is implemented, reachable in the intended UI, exercised through the intended integration, and freshly verified. |
| **Partial** | Useful implementation exists, but the intended journey, integration, visibility, durability, or validation is incomplete. |
| **Skeleton** | Types, UI shells, adapters, tests, or seams exist, but no useful end-to-end behavior is available. |
| **Absent** | No operative implementation was found. |
| **Deferred** | Intentionally excluded from the next release gate; it is not complete. |

Code presence, a passing unit test, an OMX ledger entry, or a merged pull request does not independently satisfy **Complete**.

## Non-negotiable product principles

1. **Reachability over code presence.** A hidden toolbar does not count as a shipped control.
2. **One run, multiple surfaces.** Embedded web, standalone Workbench, TUI, voice, and messaging should supervise the same run and history rather than fork backends.
3. **Truthful capability reporting.** Never display a global tool catalog or a static connected state as current runtime availability.
4. **Host authority stays out of the guest sandbox.** Current authority is browser-relayed and server-consumed for the OpenAPI fetch. It never enters public visual manifests, sanitized artifacts, or the guest terminal.
5. **Exactness is labeled.** Controlled Playwright preview and the active host tab are different sources with different fidelity.
6. **Explicit visual capture.** No continuous screenshotting, background tab capture, or silent page recording.
7. **Terminal is not the whole product.** The terminal is the execution surface; Sonik provides the context, evidence, approval, and recovery shell around it.
8. **No completion without the deployed journey.** The release gate includes the real Booking embed, authentication handoff, context selection, capture, Codex consumption, edit, verification, and reconnect path.

## Immediate truth

- Vercel Sandbox, repository bootstrap, `tmux`, raw Codex CLI, direct xterm PTY, and a hot frontend preview exist.
- The current Booking production asset contains the Dev launcher and terminal-only Workbench target; authenticated browser confirmation after reload remains the final deployed acceptance check.
- The terminal-only embed now retains a compact, restored toolbar and dock controls for source selection, element picking, capture, and layout.
- Component contracts, the embedded Playwright journey, and live production asset inspection cover control reachability and layout persistence; the remaining release gate is an authenticated user click-through.
- Exact active-tab extension code exists, but current Workbench code disables pairing/capture because the trust proof is not considered sufficient.
- Realtime egress, live console/network/file streams, Chrome DevTools integration, MCP, deploy authority, and teardown-surviving Codex authentication are not complete.

See [02-current-state-and-gaps.md](./02-current-state-and-gaps.md) for evidence and qualification.

## Definition of done for the package's scope

The package scope is complete only when all **P0** and **P1** gates in [04-delivery-plan-and-acceptance.md](./04-delivery-plan-and-acceptance.md) pass on a deployed Booking integration, remaining P2 work is explicitly accepted as deferred, and the capability matrix is updated with fresh evidence.
