# Source and Audit Index

## 1. Source precedence

When sources conflict, use this order:

1. The user's explicit product intent consolidated in this package.
2. The acceptance gates in this package.
3. Fresh behavior observed in the deployed product.
4. Current implementation and tests at the referenced commit.
5. Approved PRD/test specifications.
6. Historical OMX goal/ledger claims and worker messages.
7. Research/concept documents.

An older completion claim never overrides current code or observed behavior.

## 2. Primary repository sources

| Source | Purpose |
|---|---|
| `apps/dev-workbench/README.md` | Current documented Workbench runtime and setup. Contains known persistence drift. |
| `apps/dev-workbench/src/routes/+page.svelte` | Workbench runtime view state, source/capture actions, and explicit stubs. |
| `apps/dev-workbench/src/design-system/patterns/DevWorkbench/DevWorkbench.svelte` | Workbench controls, panels, terminal dock, and layout. |
| `apps/dev-workbench/src/design-system/patterns/DevWorkbench/DevWorkbench.css` | Terminal-only hiding and responsive layout behavior. |
| `apps/dev-workbench/src/lib/server/bootstrap-plan.ts` | tmux windows, context paths, preview and Pipe B bootstrap. |
| `apps/dev-workbench/src/lib/server/workspace-service.ts` | Sandbox lifecycle and workspace orchestration. |
| `apps/dev-workbench/src/lib/server/playwright-preview-capture.ts` | Controlled-preview capture. |
| `apps/dev-workbench/src/lib/contracts/workbench.ts` | Workbench snapshots and the realtime seam. |
| `apps/dev-workbench/src/lib/client/host-context-bridge.ts` | Embedded host message flow and active-host limitations. |
| `apps/dev-workbench-extension/` | Optional MV3 exact active-tab capture implementation/tests. |
| `packages/agent-embed/src/index.ts` | Agent UI embed and visual-context host bridge. |
| `packages/agent-embed/src/vendor/impeccable/visual-context-picker/` | Pinned picker donor island. |
| `packages/tool-contracts/src/visual-context.ts` | Product-neutral visual-context public contract. |

## 3. Planning and research sources

| Source | Role |
|---|---|
| `.omx/plans/prd-visual-page-context.md` | Approved detailed visual-context requirements, decision record, trains, and security boundaries. |
| `.omx/plans/test-spec-visual-page-context.md` | Detailed unit/integration/E2E test specification. |
| `.omx/context/visual-page-context-20260717T181951Z.md` | Planning context. |
| `.omx/state/visual-page-context-ralplan-handoff.json` | RALPLAN handoff state. |
| `.omx/ultragoal/goals.json` | Historical goals, including visual-context program. |
| `.omx/ultragoal/ledger.jsonl` | Historical execution claims; audit evidence only, not product truth. |
| `docs/architecture/sonik-agent-runtime-architecture-2026-07-16.html` | Runtime landscape, Live Workbench concept, capability boundaries, and sequencing. |
| `docs/backlog/ui-ux-backlog-2026-07-13.md` | Earlier Agent UI UX backlog. |
| `docs/backlog/ultragoal-sheet-2026-07-14.md` | Earlier ultragoal ledger source. |

## 4. Historical conversation source

The full conversation is preserved outside the repository under redacted session identifier:

```text
019f605d-f105-75f0-a4d4-1f24a04333ea
```

At audit time it was approximately 161 MB and 56,720 lines. It is intentionally **not copied** into this handoff. This package consolidates operative requirements while keeping the transcript as provenance.

Important requirement checkpoints in that transcript:

| Approximate timestamp (2026) | Intent captured |
|---|---|
| Jul 16 18:35 | Own Workbench app; repository/source/build/sitemap/live edit; real Codex terminal; tmux; snapshots; embedded right rail. |
| Jul 16 18:35–18:36 | MCP required eventually, deferred until the basic path works. |
| Jul 16 19:10 | Vercel Sandbox selected; full process must not run in a Cloudflare Worker. |
| Jul 16 21:34–21:37 | More explicit startup progress; Codex worked; layout compressed; host context/auth proxy unresolved. |
| Jul 16 23:29 | Asked for Codex login durability after teardown. |
| Jul 16 23:35 | Right/bottom/fullscreen/resizing; compact header and fewer visible buttons. |
| Jul 16 23:47 | Booking/Amplify-level integration, third speed-dial action, and host auth/session state. |
| Jul 17 01:32 | Replace chat with terminal; canvas side rail; full Agent UI context; Pipe B logs; startup OpenAPI/host authorization. |
| Jul 17 17:25 | Source switching; OpenDesign-style element selector; one-click screenshot. |
| Jul 17 18:12 | RALPLAN based on Playwright, OpenDesign, and Impeccable extension research. |
| Jul 19 12:51–16:56 | Pressure-test on authenticated Agent UI; hot reload/source tracing; screenshot-to-context; Chrome DevTools question; realtime-egress. |

## 5. Relevant commits and pull requests

| Reference | Meaning |
|---|---|
| PR #58 / merge `1adf566` | Initial Vercel Sandbox Dev Workbench. |
| `a932a29` | Initial isolated Workbench. |
| `645f04d` | Host-platform integration. |
| `647ce5d` | Terminal-first embedded mode; source of hidden toolbar/dock regression. |
| PR #59 / merge `85c5ecc` | Embedded terminal and visual-context program. |
| `4abf636`, `2df1701` | Visual-context integration/reconciliation. |
| `7b15376` | Visual-context sandbox smoke. |
| `10b708c`, `a824f16` | Exact active-tab extension hardening/tests. |
| `fb9cd1e`, `3c85bcd`, `934437a` | Ordering, contract, and concurrency hardening. |

PRs #53 and #56 contain much of the larger tool/workflow/Agent UI foundation. PR #60 was a small environment/login-proxy promotion. Verify the hosting repositories and deployed commit SHAs before relying on PR merge alone.

## 6. Deep-interview clarification

No completed, harness-specific `deep-interview-state.json` was found during the audit. The strongest formal source is the approved RALPLAN PRD and test specification above, plus the preserved conversation transcript. This handoff is the first single contained requirements package for the full harness vision.

## 7. Known external dependencies

- Vercel Sandbox and interactive PTY.
- Codex CLI authentication inside the sandbox.
- Booking host deployment/configuration and allowed Workbench origin.
- Sonik Agent UI/embed package version consumed by Booking.
- Pipe B/Cloudflare access token if raw logs are enabled.
- Realtime-egress service for normalized event transport.
- A future server authority/MCP/deploy provider for governed production actions.

These dependencies must be reported as runtime readiness, not assumed from code installation.
