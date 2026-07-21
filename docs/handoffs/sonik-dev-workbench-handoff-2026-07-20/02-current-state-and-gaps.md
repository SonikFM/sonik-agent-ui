# Current State and Gaps

## 1. Executive assessment

The repository contains substantial real implementation, but the work was completed in infrastructure-heavy slices and reported through contract/test/ledger gates that did not consistently prove the intended user journey. The embedded-control regression has been repaired and deployed to Booking production. Standalone Agent UI login and Pipe B signed host-context acceptance are freshly verified; the remaining release gate is an authenticated user confirmation of the refreshed production Booking journey.

The correct description is **functional sandbox terminal with partial embedded developer harness**, not a complete “see what I see, diagnose, fix, and deploy” experience.

## 2. Capability matrix

| Capability | Status | Current truth | Primary evidence |
|---|---|---|---|
| Vercel Sandbox lifecycle | Complete | Create/resume/delete, configured runtime, repository bootstrap, and workspace service exist. Suspension can preserve a live sandbox; deletion does not. | `apps/dev-workbench/src/lib/server/workspace-service.ts` |
| Repository clone/install | Complete | Server-configured repository and setup commands are executed in the sandbox. Arbitrary browser Git URLs are not the contract. | `apps/dev-workbench/src/lib/server/bootstrap-plan.ts` |
| Real Codex terminal | Complete | xterm connects to Vercel interactive PTY and enters a real tmux/Codex environment. | `apps/dev-workbench/src/lib/client/terminal.ts`, Workbench README |
| Tmux workspace | Complete | Named `codex`, `dev`, `shell`, and `logs` windows are bootstrapped. | `apps/dev-workbench/src/lib/server/bootstrap-plan.ts` |
| Frontend hot preview | Complete | A sandbox development server is started and exposed through a provider preview domain. | `apps/dev-workbench/src/lib/server/workspace-service.ts` |
| Standalone layout | Complete in repository | Right/bottom/fullscreen and resize implementation exists, and embedded `surface=terminal` retains compact controls. | `DevWorkbench.svelte`, `DevWorkbench.css`, `DevWorkbench.contract.test.ts`, `embedded-workbench.spec.ts` |
| Embedded Booking Dev launcher | Partial | Current Booking production assets contain the Dev, Canvas, and Chat controls and the Workbench URL. The remaining gate is an authenticated browser reload/click confirmation. | Booking deployment `51f11d0d-0a81-465f-a0fa-934374eba5be`; live asset smoke |
| Verbose workspace startup | Partial | Bootstrap phases exist, but the operator experience does not yet provide the complete step/elapsed/recovery narrative requested. | Workbench route and components |
| Basic Workbench login | Complete | Workbench supports HTTPS Basic Auth and Vercel deployment protection. This is separate from Booking host authority and Codex CLI auth. | `apps/dev-workbench/src/hooks.server.ts`, README |
| Standalone Agent UI login proxy | Complete | Same-account Amplify service binding, membership compatibility, proxy-cookie minting, immutable-request handling, and authenticated cloud session access are deployed and live-smoked. | Agent UI deployment `d9c2307a-a0eb-49eb-a064-472fcb042024`; commit `2c2ec04` |
| Host-origin/message validation | Complete at contract level | Exact-origin/source checks and typed host relay code exist. A valid relay does not prove a valid Booking session attachment. | `packages/agent-embed/src/index.ts`, Workbench bridge |
| Authenticated host-session context | Partial | Pipe B emits a signed context that Agent UI accepts with HTTP 200, and the shared signing secret is synchronized across Agent UI, Booking production, and Pipe B. An authenticated production Booking browser confirmation remains. | Live signed-context smoke; Cloudflare secret/binding audit |
| Page-context mirror | Partial | `.sonik/page-context.json`, sitemap, and environment paths exist. Codex can read them, but context arrival is not a complete automatic tool/instruction workflow. | Workbench context APIs/bootstrap plan |
| OpenAPI/command context | Partial | Contracts and generated command catalogs are extensive; availability and active host authority are still disconnected in the user experience. | `packages/tool-contracts`, Booking host integration |
| Source selector | Complete in repository | Preview/host capability logic and its embedded control are reachable; deployed Booking validation remains a release gate. | `+page.svelte`, `DevWorkbench.svelte`, `DevWorkbench.contract.test.ts`, `embedded-workbench.spec.ts` |
| Semantic element picker | Complete in repository | The picker, adapter, typed relay, and restored embedded trigger are covered; host deployment proof remains outstanding. | `packages/agent-embed/src/vendor/impeccable`, `packages/agent-embed/src/index.ts`, `+page.svelte`, `embedded-workbench.spec.ts` |
| Preview screenshot | Complete in repository | Playwright capture, bounded artifacts, locking/revisions, and a reachable embedded control are implemented and tested. | `playwright-preview-capture.ts`, visual-context APIs/tests, `embedded-workbench.spec.ts` |
| Exact active-tab screenshot | Skeleton/disabled | MV3 extension code and tests exist, but Workbench's pair/capture actions currently return an unavailable reason. It must not be described as shipped. | `apps/dev-workbench-extension`, `+page.svelte` |
| Screenshot-to-Codex handoff | Partial | `SONIK_VISUAL_CONTEXT_PATH` and stable `.sonik` artifact paths exist. Automatic “new context available” signaling and a polished consumption flow are incomplete. | `bootstrap-plan.ts`, visual-context coordinator |
| Element-to-source mapping | Absent | Sitemap/source repository exists, but no reliable DOM/semantic target to source-file/line resolver was found. | No operative mapping path found |
| Preview restart | Skeleton | UI action exists but is explicitly disabled with “wiring is not connected yet.” | `+page.svelte` |
| Changed-files panel | Skeleton | View shape exists; runtime array is empty. | `+page.svelte` |
| Console panel | Skeleton | View shape exists; runtime array is empty. | `+page.svelte` |
| Failed-request panel | Skeleton | View shape exists; runtime array is empty. | `+page.svelte` |
| Pipe B logs | Unavailable by policy | Direct sandbox tailing is disabled so Cloudflare credentials do not cross the credential firewall. A server-side broker is required before this becomes available. | `bootstrap-plan.ts`, runtime credential tests |
| Realtime-egress | Skeleton | Serializable seams/contracts exist and README calls it forthcoming; live transport is not wired. | `workbench.ts`, README |
| Chrome DevTools/CDP | Absent | Screenshot/Playwright support is not a DevTools console/network/DOM/performance integration. | No operative CDP path found |
| MCP | Deferred/absent | Explicitly deferred from the first Workbench slice. | Workbench README |
| Booking tools in Codex | Partial | Catalog/context exists; no complete MCP/authority path makes all appropriate Booking commands executable from the terminal. | tool contracts and host context code |
| Tool availability UX | Partial | Capability contracts exist, but prior user tests exposed selectable-looking commands that could not execute. | runtime/tool catalog code and diagnostics |
| Build/test from terminal | Complete | The sandbox shell can run repository commands. | real terminal/runtime |
| Commit/push/deploy | Absent as product capability | Shell mechanics may work if credentials are manually introduced, but no governed scoped deploy product flow is complete. | no Workbench authority/approval implementation |
| Codex auth after teardown | Absent | Live sandbox state can persist across suspension. Deletion destroys the sandbox filesystem and CLI login. | provider lifecycle/README |
| Durable agent orchestration | Absent | Current execution is raw Codex CLI in tmux, not an AI SDK WorkflowAgent/AgentOS run journal. | runtime architecture vs implementation |

## 3. Why visible features disappeared, and how they were restored

Commit `647ce5d` introduced terminal-first embedding. The route derives:

```ts
const terminalOnly = page.url.searchParams.get("surface") === "terminal";
```

`DevWorkbench.svelte` previously treated terminal-only as fullscreen for layout. CSS removed both relevant control regions:

```css
.dev-workbench[data-terminal-only="true"] .dev-workbench__toolbar,
.dev-workbench[data-terminal-only="true"] .dev-workbench__dock-controls {
  display: none;
}
```

The picker and capture work landed after the terminal-first surface. Their buttons were added to the toolbar, but the Booking embed continued requesting `surface=terminal`. The hidden command surface was repaired by retaining a compact toolbar and dock controls in terminal mode.

This was not a missing xterm feature; it was an integration and acceptance failure between the terminal presentation mode and the later context-control work.

## 4. Why prior completion claims were misleading

Historical OMX goals G009–G013 and associated tests emphasized:

- contract parity;
- exact-origin and revision checks;
- code/test presence;
- capture coordinator safety;
- extension protocol hardening; and
- merge/integration state.

Those are valuable, but the gates did not consistently require the deployed Booking journey to demonstrate that a user could see and activate the controls. Some tests asserted that Booking supplied `surface=terminal`, while other tests proved that picker/capture handlers existed. Both passed even though the combination hid the feature.

The durable lesson is:

> A feature ledger must end in a user-visible, deployed acceptance journey. Static source assertions and isolated component tests cannot be the final product gate.

## 5. What the large changes contained

The merged work was not 50,000 lines of terminal UX. It included several larger programs and a meaningful amount of generated, test, research, and orchestration material.

Approximate pull-request accounting from the historical review:

| PR | Approximate change | Major contents |
|---|---:|---|
| #53 | +60,475 / -114 | Tool/workflow contracts, generated command registry, docs/OMX artifacts, tests, and product integration. One generated registry contributed roughly 40k lines. |
| #56 | +18,713 / -1,354 | Broad fixes and integrations across tests, product, packages, docs, and contracts; many commits. |
| #58 | +7,925 / -64 | Initial Vercel Sandbox Workbench, vendored proof/research sources, architecture HTML, tests, and package metadata. |
| #59 | +9,535 / -397 | Visual context, Workbench UI, extension, picker/embed bridge, scripts, tests, and hardening. |
| #60 | minimal | Environment/login proxy configuration. |

The high line count therefore represents real scaffolding and safety work, but not equivalent user-facing completion.

## 6. Known documentation drift

`apps/dev-workbench/README.md` currently says the first slice uses non-persistent sandboxes, while the inspected implementation/history has also discussed persistent sandbox behavior. Treat runtime code/provider configuration as authoritative and repair the README during Gate 0. In all cases, **persistent** means provider lifecycle persistence, not survival after explicit deletion.

The extension README describes a pairing flow that current Workbench actions disable. It must be labeled experimental/unavailable until the product gate passes.

## 7. Current risk register

| Risk | Impact | Control |
|---|---|---|
| Hidden control regression repeats | User cannot access implemented capability | `DevWorkbench.contract.test.ts` and `embedded-workbench.spec.ts` guard the restored controls; deployed sidebar-width proof remains required. |
| Host context looks connected but lacks authority | Dead tools and confusing failures | Display evidence, authority, and capability as separate states; test real signed attachment. |
| Exact screenshot claims exceed browser privilege | Privacy/security failure | Keep active-tab capture disabled until explicit attestation and redaction E2E pass. |
| Credentials are treated as sandbox durability | Repeated Codex login or secret exposure | Define suspend/delete behavior and use an encrypted restoration design. |
| Shell access is mistaken for governed deploy | Unauthorized or untraceable production changes | Add scoped provider capability and explicit approval before productizing deploy. |
| Large contract/test volume masks journey failure | False confidence and token waste | Gate from user journey backward; stop parallel lanes when one integrated path is failing. |

## 8. Configuration ownership and live state

### Configured by the product owner

- Authenticated the Vercel CLI and selected the `danletterio-5975s-projects` team.
- Created and linked the `dev-workbench` Vercel project from `apps/dev-workbench`.
- Pulled the project's development environment and installed the Vercel Codex/Claude tooling integration.
- Authenticated Codex interactively inside a sandbox session. This login is sandbox-filesystem state and does not survive explicit sandbox deletion.
- Owns future MCP inventory, visual-target/OCR service, Hermes memory pruning, startup-agent profiles, and external provider credentials. These are product inputs, not completed Workbench configuration.

### Configured by the implementation agent

- Pinned the Vercel production repository revision to the tested Agent UI commit and deployed `dev-workbench-sooty.vercel.app`.
- Deployed Agent UI with the Amplify service binding, Booking Pipe B service binding, cloud persistence, login-proxy gate, and current organization/principal compatibility flag.
- Set the canonical Amplify auth base URL and enabled sanitized auth diagnostics for staging operations.
- Rotated and synchronized `SONIK_AGENT_UI_HOST_CONTEXT_SECRET` across Agent UI, Booking production, and Booking Pipe B without exposing the value.
- Deployed Booking production from current `main`; its live client asset contains the Dev launcher and Workbench target.
- Fixed the Cloudflare immutable-header failure by cloning the request before injecting signed host context.

### Still intentionally unconfigured

- Durable Codex credentials after sandbox deletion.
- Governed GitHub/deploy credentials inside the guest sandbox.
- MCP servers and selectable startup profiles such as OMX, OMC, Eve, or AgentOS.
- LocateAnything/OCR, Hermes post-session memory processing, persistent SQLite/vector memory, and realtime-egress consumption in the terminal.
- Exact active-tab capture, Chrome DevTools/CDP, and production deploy approval UI.

### Fresh live evidence

- Agent UI login minted `sonik_agent_ui_login_proxy`; authenticated `/api/sessions` returned HTTP 200.
- Pipe B produced a signed host-context envelope; Agent UI accepted the encoded envelope with HTTP 200.
- Booking production deployment: `51f11d0d-0a81-465f-a0fa-934374eba5be`.
- Agent UI deployment after shared-secret rotation: `d9c2307a-a0eb-49eb-a064-472fcb042024`.
- Agent UI fix is pushed to PR 61 at commit `2c2ec04`; CI/review status remains a separate merge gate.
