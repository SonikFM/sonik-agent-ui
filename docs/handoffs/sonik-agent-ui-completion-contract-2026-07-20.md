# Sonik Agent UI completion contract

**Agreement-first baseline · Ultragoal G001**
**Run started:** 2026-07-20T20:03:01Z
**Baseline snapshot:** 2026-07-20T20:08:56Z
**Branch:** `fix/dev-workbench-embedded-context-20260720`
**Head at baseline:** `036f713`
**Pull request:** [SonikFM/sonik-agent-ui#61](https://github.com/SonikFM/sonik-agent-ui/pull/61)
**Existing protected preview:** `https://dev-workbench-80wqt9cpg-danletterio-5975s-projects.vercel.app`

> **Contract, not a completion claim.** This document defines what this Ultragoal run will prove, repair, audit, deploy, and report. Statuses distinguish implemented behavior from deployed, freshly verified behavior. Anything lacking current-run evidence remains partial, skeleton, or missing.

## 1. Outcome and stop gate

The target is a deployable Sonik Agent UI and Dev Workbench slice where an authenticated operator can:

- open Agent UI from Booking and enter Dev mode;
- create or resume one repository workspace and one conversation/run identity;
- keep conversation state across reload and route navigation;
- submit prompts reliably and receive complete streamed model/tool lifecycle output;
- inspect sanitized, correlated telemetry without raw chain-of-thought or secrets;
- receive truthful host evidence, server authority, page context, capabilities, and failure states;
- use the embedded Workbench controls, real Codex/tmux terminal, hot preview, context selector, and bounded screenshot flow; and
- validate the result through tests and a non-production deployment receipt.

The run stops only when all ledger stories are reconciled; targeted checks and the bounded API exercise are green or externally blocked with evidence; independent code-review and architecture gates are clear; the branch and PR are current; test deployment URLs are reported; and the final retrospective separates completed work from remaining gaps.

## 2. Status vocabulary

| Status | Evidence threshold |
|---|---|
| **Complete** | Implemented, reachable in the intended surface, and supported by current repository or CI evidence. A live-host claim still requires the deployment gate. |
| **Partial** | Useful implementation exists, but an integration, reachability, durability, authority, deployment, or current-run verification gap remains. |
| **Skeleton** | Types, UI shells, adapters, fixtures, or disabled seams exist without useful end-to-end product behavior. |
| **Missing** | No operative implementation was found, or the capability is expressly excluded from this slice. |

## 3. Agreement-first capability matrix

| Capability | Baseline status | Evidence and honest boundary | This run's required disposition |
|---|---|---|---|
| Vercel Sandbox lifecycle | **Complete** | Create/resume/delete, persistent provider mode, bounded snapshots, repository bootstrap, and workspace service exist. Deletion still destroys sandbox files and CLI login. | Re-run focused Workbench checks; do not imply teardown durability. |
| Server-configured repository bootstrap | **Complete** | Repository/revision and setup commands are server-owned. Browser input is not the command or Git authority. | Preserve allowlisting and verify no review fix weakens it. |
| Real Codex terminal and tmux | **Complete** | xterm connects to the provider PTY; `codex`, `dev`, `shell`, and `logs` windows exist. Current startup command is raw Codex rather than an OMX profile. | Keep terminal behavior stable; document the profile gap instead of inventing a framework. |
| Hot frontend preview | **Complete** | Development server and provider preview-domain plumbing exist. | Verify health/recovery paths and one deployed preview. |
| Embedded right/bottom/fullscreen controls | **Partial** | Current source keeps a compact toolbar visible under `surface=terminal`; PR E2E asserts it. A fresh deployed Booking journey has not been proved in this run. | Exercise narrow and wide embed paths, resize/layout persistence, focus, and exit from fullscreen. |
| Booking Dev speed-dial entry | **Partial** | Host integration has existed and the Workbench can be launched, but availability depends on Booking deployment/configuration. | Capture live or best-available host evidence and exact deployment prerequisite. |
| Workspace loading narrative | **Partial** | Bootstrap phases exist; step, elapsed-time, recovery, and degraded-state copy are not fully demonstrated. | Verify failure/loading states; make only surgical copy/state fixes. |
| Workbench HTTPS login | **Complete** | Basic Auth and Vercel deployment protection are implemented. This is distinct from Booking authority and Codex CLI authentication. | Preserve the separation and avoid exposing secret values. |
| Session-backed conversation | **Partial** | Session, message, run, and cloud persistence contracts/tests exist, but the non-negotiable deployed reload/navigation journey remains unproved in this run. | Prove one run identity, ordered history, reload, navigation, reconnect, and no duplicate terminal/run. |
| Prompt submission | **Partial** | Composer and route contracts exist; historical reports included short-ended responses and dead tool states. | Prove idempotent submission and actionable recovery for failure/retry. |
| Streamed model/tool lifecycle | **Partial** | Stream taps, safety, dynamic tool projection, and telemetry tests exist. A deployed uninterrupted lifecycle is not yet accepted. | Prove start/delta/tool-call/tool-result/finish or explicit failure, with no silent terminal state. |
| Sanitized correlated telemetry | **Partial** | Observability and run join-key contracts exist. Completeness, redaction, reconnect cursor, and live product visibility require proof. | Validate stable correlation IDs, redaction, ordering, replay, and evidence links. |
| Exact-origin host relay | **Complete** | Typed relay and exact-origin/source validation exist at the contract boundary. | Preserve as a security invariant. |
| Authenticated host-session authority | **Partial** | Transport exists, but current runtime/documentation are inconsistent: authority is described as server-only while guest mirroring remains possible. | Repair the boundary; authority must remain server-side or use a brokered, least-privilege handle. |
| Page context, sitemap, and OpenAPI context | **Partial** | Stable `.sonik` paths and command catalogs exist, but freshness, authority, and automatic consumption are not a proven deployed workflow. | Prove bounded writes, navigation invalidation, agent discoverability, and truthful readiness. |
| Preview/host source selector | **Partial** | Capability logic and visible current toolbar implementation exist. | Verify embedded reachability and disabled reasons at sidebar width. |
| Semantic element picker | **Partial** | Impeccable-derived picker, Sonik adapter, messages, host bridge, and tests exist. | Prove a real embedded selection, Escape/cleanup/focus, sanitized descriptor, and stale-context invalidation. |
| Controlled-preview screenshot | **Partial** | Playwright capture, artifact bounds, locking, hashes, revisions, promotion, and tests exist. | Run bounded preview capture and inspect the stable manifest/PNG for leakage. |
| Exact active-tab screenshot | **Skeleton** | MV3 extension and tests exist; pairing/capture remain intentionally unavailable without sufficient trust proof. | Keep disabled and label honestly. Not a release dependency for this slice. |
| Element-to-source mapping | **Missing** | No reliable semantic target → source file/line resolver is accepted. | Record the seam only; the user owns the visual-target model pipeline. |
| Preview restart | **Skeleton** | A disabled UI action exists without operative recovery wiring. | Do not advertise as ready; fix only if the live-path proof needs a minimal existing seam. |
| Changed files, console, failed-request views | **Skeleton** | View shapes exist; runtime data remains empty or incomplete. | Audit event boundaries; do not claim panels are live without runtime evidence. |
| Pipe B/realtime-egress feed | **Skeleton** | A logs tmux window and serializable seams exist; automatic structured realtime feed is not complete. | Preserve Beacon/RivetKit direction; no bespoke SSE, WebSocket, or polling stack. |
| Chrome DevTools/CDP | **Missing** | Screenshot and Playwright capture are not a full DevTools integration. | Explicitly exclude from this run. |
| MCP tool surface | **Missing** | Intentionally outside the basic terminal/context slice. | User owns MCP implementation; this run protects the future typed/authority boundary. |
| Truthful Booking tool availability | **Partial** | Catalogs are extensive, but historical tests showed selectable-looking commands without executable authority. | Verify availability is tenant/session/provider/scope-derived and disabled states name the missing dependency. |
| Build/test in the sandbox | **Complete** | Real shell and repository commands are available. | Run targeted tests and attach raw command evidence. |
| Governed commit/push/deploy | **Missing** | Shell mechanics are not an approved Sonik provider capability. | Deploy only through available non-production operator tooling; do not productize broad credentials. |
| Codex auth after sandbox deletion | **Missing** | Suspension may preserve state; deletion does not preserve the CLI login. | State the limitation; encrypted restoration is follow-up architecture. |
| JSON-render core runtime | **Complete** | `@json-render/core`, Svelte, devtools, and devtools-svelte are installed; a 33-component registry, `createJsonArtifact` validation, live/complete promotion, and canvas renderer exist. | Prevent regressions and correct the false “Markdown-only” narrative. |
| JSON-render donor/component breadth | **Partial** | The primary runtime exists; `@json-render/shadcn-svelte` and broader donor adoption are not integrated. | Produce the dependency/adoption map; implement only a clearly justified, low-risk fix. |
| Sonik component/theming conformance | **Partial** | DaisyUI 5.5.23 + Tailwind 4 are canonical; copied shadcn-style aliases map into Sonik tokens. Operator Dark is registry default, embedded host theme wins, standalone defaults to system. Full component audit remains open. | Prevent a second runtime design system and inventory concrete violations. |

## 4. PR 61 baseline

At the start of this run, PR 61 is **open**, **merge-blocked**, and marked **changes requested**. Its head is `036f713` on `fix/dev-workbench-embedded-context-20260720`.

- Existing CI at the baseline head reports success for types/tests/build, embedded Agent UI smoke, Playwright E2E, API reliability tripwire, malware guard, and CodeRabbit status.
- Green CI does not clear the review gate: **eight unresolved CodeRabbit threads** remain.
- The unresolved themes are contract defects, not formatting trivia: server-only host authority, sandbox credential brokerage, preview state canonicalization, visual snapshot attestation, discriminated realtime event payloads, release-document truth, and a pinned skills CLI.
- Three handoff documents still describe restored embedded controls as hidden. Source and E2E currently indicate the toolbar is visible, so documentation must be repaired rather than the regression reintroduced.
- No oRPC package is installed. Zod 4.3.6 and the repository's existing schemas are the contract authority; this run will not add oRPC.

## 5. Exactly six proposed TDD/API contract pressure cases

These are the six groups this run will drive red → green. Each begins with the smallest regression test that demonstrates the current defect or guards the already-correct boundary.

| ID | Pressure case | Required invariant | Safe exercise |
|---|---|---|---|
| **TC-01** | Server-only authority | Host authority never enters guest filesystem, client state, screenshot artifacts, terminal transcript, or public telemetry. Browser context cannot mint scopes. | Unit/contract test plus preview request inspection; no production credential. |
| **TC-02** | Sandbox credential denylist and broker | GitHub, Cloudflare, database, host-authority, and visual-grounding control-plane secrets are denied by default. Approved operations use a server broker or short-lived least-privilege token. | Environment-construction tests with sentinel values; no real secret output. |
| **TC-03** | Canonical preview state including stale | One shared preview-state schema covers booting, ready/healthy canonical naming, failed, and stale; UI and events reject unknown/drifted states. | Schema tests and bounded preview health call. |
| **TC-04** | Canonical visual snapshot attestation | Capture requires schema version, source and screenshot metadata, source-context revision, route revision, request sequence, digest, and workspace/request identity; stale or mismatched evidence cannot promote. | Fixture-driven coordinator/API tests with synthetic metadata and image bytes. |
| **TC-05** | Discriminated realtime event payloads | Every event kind has a bounded validated payload, stable correlation/run identifiers, redaction, and replay-safe ordering; `payload: unknown` cannot cross the product boundary. | Parser/replay tests with malformed, reordered, duplicated, and redacted fixtures. |
| **TC-06** | Release-document truth gate | Release docs contain no absolute `/Users` paths, pin the skills CLI version, describe current reachable controls, and never promote skeletons or stale claims. | Repository-native document assertion run in CI. |

The API reliability exercise remains conservative: preview/staging only, observable endpoints only, no production fuzzing, no unsafe writes, and immediate stop on an unexpected 5xx, authority-boundary violation, or evidence of a consequential mutation.

## 6. Acceptance contract

### 6.1 Conversation and run durability

- An authenticated operator opens one workspace and one run.
- A prompt is accepted once, persisted in order, and returns a terminal model/tool state.
- Reload and route navigation reattach to the same run and history without duplicate prompts, duplicate terminal sessions, or missing attachments.
- A transport interruption resumes from an event cursor or presents an explicit recoverable failure.
- File/session records remain scoped to the authenticated tenant and are not exposed through page context.

### 6.2 Streaming and telemetry

- Model and tool lifecycle output has explicit start, progress, completion, and error semantics.
- Tool calls never remain indefinitely selectable/pending after a terminal failure.
- Events carry stable run/request/tool correlation identifiers and ordering data.
- Telemetry excludes credentials, cookies, raw HTML, screenshot bytes, bearer tokens, signed authority, and private chain-of-thought.
- Verification claims link to raw command or deployment evidence.

### 6.3 Embedded Workbench and host context

- Booking Dev opens at sidebar and desktop widths with compact, keyboard-reachable source, context, layout, status, and overflow controls.
- Right, bottom, and fullscreen layouts remain reversible and persist safely.
- Host evidence, signed server authority, page-context freshness, terminal, preview, logs, and tools are distinct readiness states.
- Preview capture writes bounded, hash-matched artifacts. Host semantic selection emits only the allowed descriptor.
- Navigation, source changes, expiry, timeout, cancellation, and unmount invalidate or clean up stale context.
- A missing or expired authority cannot be replaced by browser-provided claims.

### 6.4 Quality and accessibility

- Typecheck, targeted tests, relevant smoke/E2E, build, contract drift checks, and bounded API checks pass at final head.
- Keyboard operation, focus restoration, status announcements, contrast, target size, and reduced motion meet Sonik requirements.
- Disabled actions explain why; no stub appears executable.
- Changed product files pass the anti-slop review and independent code-review/architecture gates.

## 7. Theme and component boundary

### Canonical runtime

- **DaisyUI 5.5.23 and Tailwind 4** remain the production component/token runtime.
- `app.css` may expose copied shadcn-style aliases only when they resolve into Sonik/Daisy tokens. Those aliases do not establish a second theme authority.
- **Operator Dark/gunmetal** is the registry default. An embedded host theme wins; standalone mode follows system unless the existing theme contract says otherwise.
- Hallmark and Impeccable are review lenses for hierarchy, density, copy, interaction, accessibility, and anti-slop quality—not substitute design systems.

### Donor PR consolidation boundary

The referenced SonikFM/sonik-svelte PRs are all open and are inventory inputs, not approved dependencies:

| PR | Baseline state | Contract decision |
|---|---|---|
| #2 · remaining AI elements | Behind; CI failed; scope polluted | Salvage component-by-component only after authority and theme fit are proven. |
| #3 · svelte-streamdown | Unstable; CI failed; not integrated | Evaluate streamed-markdown behavior separately from JSON-render. |
| #4 · Chat + EmojiPicker | Unstable; CI failed; not integrated | Copy only required behavior; remap all styling to Sonik tokens. |
| #5 · FinalChat composer/scroll | Blocked; changes requested; accessibility issue | Fix the accessibility contract before any adoption. |
| #6 · hooks + Kbd/Separator | Unstable; CI failed; only an independent Separator exists here | Inventory hooks; avoid duplicate primitives. |
| #7 · theme toggle/kitchen sink | Blocked; changes requested; conflicts with the stronger current theme runtime | Keep current theme authority; salvage demos only if useful. |
| #8 · Sonik Inbox | Clean but stacked on #2; mock demo; no substantive review | Treat as product exploration, not a production inbox dependency. |

No bulk merge of PRs #2–#8 is in this run. The output is a consolidated keep/adapt/reject/follow-up map and, at most, a surgical conformance fix proven by a targeted check.

## 8. JSON-render architecture contract

### Primary product path

```text
trusted tool / createJsonArtifact
              │
              ▼
     @json-render/core schema
              │ validate + normalize
              ▼
   @json-render/svelte renderer ───► 33-component Sonik registry
              │                           │
              │                    Sonik/Daisy tokens
              ▼                           ▼
       live artifact state ─────► complete/promotion state
              │
              ├──► canvas renderer
              └──► @json-render/devtools + devtools-svelte
```

The primary boundary comprises `@json-render/core`, `@json-render/svelte`, the Sonik component registry, directives/action receipts, live-to-complete promotion, JSONL/YAML intake where already supported, and the devtools surfaces. The runtime is not “just Markdown.” Markdown streaming and structured JSON rendering are separate presentation paths.

The main known primary gap is donor breadth: `@json-render/shadcn-svelte` is not integrated and broader copied components have not passed Sonik authority, accessibility, and token review. A package name alone is not a reason to add it.

### Secondary inventory only

Codegen, Ink/TUI, MCP, image rendering, React Email, React PDF, and React Three Fiber may become producers or specialized renderers, but they are not part of this run's core JSON-render implementation unless repository evidence demonstrates a direct blocker. Their contracts must converge on validated artifact data rather than bypassing the primary schema or introducing a second component authority.

## 9. Ownership split

| Owner | This run / program responsibility |
|---|---|
| **This Ultragoal run** | PR 61 review and contract fixes; tests-first pressure cases; session/prompt/stream/telemetry proof; Workbench startup and host-context proof; component/theme/JSON-render audit; bounded API reliability; verification; non-production test deployment; baseline and final reports. |
| **User / companion programs** | LocateAnything or other visual model serving; Hermes post-session pruning/memory jobs; Little Eve/AgentOS job-agent design; MCP server implementations; secret values and environment assignment; Booking PR merge and production promotion. |
| **Shared boundary** | The user supplies or authorizes environment-specific credentials and production decisions. This run must define exact prerequisites, use only available preview/staging authority, and report external blockers rather than bypass them. |

## 10. Explicit exclusions

- No production load, fuzz, destructive migration, unsafe write, or automatic production deployment.
- No new oRPC dependency and no replacement of existing Zod/schema authority.
- No full MCP implementation, Little Eve/AgentOS orchestration, Hermes memory worker, or LocateAnything inference pipeline.
- No enabling exact active-tab capture before attestation, redaction, pairing, and live security review pass.
- No promise of sandbox files or Codex login surviving explicit sandbox deletion.
- No full Chrome DevTools/CDP product and no claim that Playwright screenshot capture provides it.
- No bulk adoption of open donor PRs and no DaisyUI/shadcn runtime mixing.
- No new realtime transport beside the existing Beacon/RivetKit/realtime-egress direction.
- No broad codegen, Ink, image, React Email/PDF/Three Fiber integration without a measured core-path need.

## 11. Test, deployment, and release gates

| Gate | Evidence required | Stop condition |
|---|---|---|
| Contract red | New tests fail for still-valid review defects or demonstrate the existing invariant. | Do not edit production behavior without a reproducible claim. |
| Surgical green | Targeted tests pass after minimal shared-boundary repair. | Stop expanding once the root contract holds. |
| Repository quality | Relevant typecheck, tests, contract drift checks, static checks, and builds pass. | Any new regression returns the story to implementation. |
| Embedded journey | Narrow/wide Booking or best-available host embed proves controls, session, prompt, stream, context, navigation/reload, and recovery. | Source assertions alone cannot promote a product-facing capability. |
| Bounded API | Preview/staging exercise completes with redacted receipts and no unexpected 5xx/auth/write violation. | Stop immediately on safety tripwire. |
| Review | Changed files pass anti-slop review; independent code reviewer approves and architect clears invariants. | Unresolved material finding blocks final completion. |
| Deployment | Final commit SHA, protected preview URL, deployment receipt, configuration prerequisites, and operator steps are recorded. | Production remains out of scope without explicit authority. |

## 12. Insurance and rollback

- **Small reversible diffs:** fix shared contract boundaries; avoid new dependency and framework migrations.
- **Tests before behavior changes:** retain a runnable regression for each non-trivial fix.
- **Secret sentinels:** test redaction/denylisting with inert markers, never actual values.
- **Preview first:** deploy only to a protected preview or named staging target during the run.
- **Safety tripwire:** stop API activity on unexpected 5xx, authority violation, credential exposure, or consequential mutation.
- **Known-good anchor:** preserve `036f713` and the existing deployment receipt as the pre-run comparison point; rollback is a branch revert or preview promotion reversal, not live patching.
- **Artifact truth:** record exact commands, exit status, SHA, URLs, and external gaps. A worker message, green isolated unit test, or file presence alone is not release evidence.
- **State safety:** preserve one run/workspace identity; make stale context explicit; never trade data-loss protection for a smoother UI.

## 13. Prior-run accounting vs this Ultragoal

### Prior work — excluded from this run's time and token totals

Before 2026-07-20T20:03:01Z, the branch already contained the Sandbox/tmux/Codex foundation, embedded-control repair, visual-context implementation and hardening, extensive contract/test infrastructure, handoff documents, commit `036f713`, and a protected Vercel preview. PR 61's baseline checks were green, while review remained blocked. Those commits and any previous multi-day/token usage are historical inputs, not accomplishments or cost attributed to this Ultragoal.

### Current Ultragoal — accounting starts here

Time begins at **2026-07-20T20:03:01Z**. The final report will record elapsed wall time, available Codex/OMX token accounting, story checkpoints, retries, delegated lanes, verification receipts, and any gaps in measurement. If a metric is unavailable from runtime evidence, it will be labeled unavailable rather than estimated or blended with prior work.

## 14. Checkpoint ledger for the final retrospective

| Checkpoint | Expected artifact |
|---|---|
| G001 · Agreement baseline | This Markdown/HTML/PDF contract, validated and committed without product-source edits. |
| G002 · Contract hardening | Review-thread reconciliation, red/green tests, minimal fixes, targeted verification. |
| G003 · Live-path proof | Session/prompt/stream/telemetry/host-context evidence and any surgical repairs. |
| G004 · UX and rendering audit | Theme/component/PR #2–#8/JSON-render gap map with bounded fixes or explicit follow-ups. |
| G005 · Final assurance | Bounded API evidence, complete verification, independent reviews, deployment receipt, final retrospective PDF, and user test instructions. |

## 15. Source of truth

This baseline was assembled from `.omx/ultragoal/brief.md`, the canonical Dev Workbench handoff package, `docs/architecture/dev-workbench-runtime-ownership-2026-07-20.md`, current repository source and scripts, PR 61 metadata/checks/reviews, and the user's amended requirements. Later evidence may change a status, but it must do so through the acceptance and release gates above.

