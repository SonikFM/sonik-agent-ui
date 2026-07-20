# Delivery Plan and Acceptance

## 1. Delivery rule

Execute one integrated vertical slice at a time. Do not reopen broad parallel implementation until the current slice passes its deployed user journey. Each gate requires:

1. implementation;
2. targeted unit/integration checks;
3. a real embedded browser journey;
4. deployment/configuration evidence; and
5. an updated capability matrix.

## 2. Sequence

### Gate 0 — Restore truth and reachability (P0)

**Goal:** make the current implementation honest and reachable before adding features.

Actions:

- Replace terminal-only “hide all controls” behavior with a compact embedded command strip.
- Preserve terminal focus and usable vertical space.
- Restore right/bottom/fullscreen and resize controls in embedded mode.
- Expose source, sync, pick, and capture based on capability.
- Label exact active-tab extension unavailable/experimental; align README with code.
- Display separate host-evidence, signed-authority, preview, terminal, and logs readiness.
- Update stale persistence wording.

Acceptance:

- Booking's Dev speed-dial opens the Workbench at desktop and sidebar widths.
- The developer can see and keyboard-activate layout, source, sync, pick, and capture controls.
- Fullscreen still exposes a way to exit and access context commands.
- Disabled actions show a specific reason.
- No control advertised as ready routes to a stub handler.

Verification:

- Component/accessibility tests for terminal strip and menus.
- Embedded Booking Playwright test at representative narrow and wide widths.
- Visual regression evidence for right, bottom, and fullscreen.

### Gate 1 — Authenticated Booking context (P0)

**Goal:** prove that the embedded workspace knows the active Booking session without trusting browser hints.

Actions:

- Trace Booking session → host adapter → Agent UI embed → Workbench attachment.
- Ensure allowed origins and embed URL configuration are deployment-safe.
- Write sanitized page context, sitemap, command catalog, and opaque host attachment to documented paths.
- Add expiry/navigation invalidation.
- Show the exact failing layer in UI and logs.

Acceptance:

- In a deployed authenticated Booking session, Workbench reports host evidence current and server authority present.
- Codex reads the active organization/surface/route and documented command context from the sandbox.
- Removing/expiring the authority changes readiness and prevents host tool execution.
- A forged browser page-context payload cannot add scopes.

Verification:

- Contract/integration tests for valid, missing, expired, wrong-origin, and wrong-tenant attachments.
- Deployed Booking smoke with redacted diagnostic artifact.

### Gate 2 — “See what I see” core (P0)

**Goal:** make page context useful to Codex through the intended UI.

Actions:

- Finish source switching and visible invalidation.
- Exercise the real host picker from embedded Booking.
- Exercise controlled-preview Playwright capture.
- Write atomic current/invalidated manifests and hash-matched PNG.
- Add a bounded `context.updated` signal to the Codex/tmux session.
- Keep active-host screenshot disabled with an honest explanation.

Acceptance:

- Booking is the default embedded source; Preview remains selectable.
- The developer selects a real Booking element and sees its bounded semantic descriptor.
- Codex reads the selection from `.sonik/visual-context.json` without receiving private DOM data.
- Preview Capture produces a current PNG and ARIA result; route/source changes invalidate and remove stale stable output.
- Picker Escape, navigation, timeout, unmount, and error clean up overlays/listeners and restore focus.
- Sensitive inputs/routes/ARIA are masked or sanitized.

Verification:

- Existing unit/security/concurrency suites.
- One deployed Booking selector E2E.
- One live Vercel Sandbox Playwright capture smoke.
- Manual inspection of the manifest and screenshot for secret leakage.

### Gate 3 — Operational evidence (P1)

**Goal:** let the operator diagnose without scraping raw tmux output.

Actions:

- Wire normalized realtime-egress events with a resumable cursor.
- Populate changed files/diff, console, failed requests, preview status, and verification views.
- Make Pipe B attachment automatic when authorized and clear when unavailable.
- Implement preview restart and health recovery.

Acceptance:

- Editing a file emits a changed-file event and an inspectable diff.
- A browser console error and failed request appear with timestamps/correlation.
- A targeted test result links to raw command evidence.
- Refresh reconnects from the last event cursor without creating a second run.
- Missing Pipe B credentials show one actionable degraded state, not an empty panel.

Verification:

- Event fixture/replay tests.
- Reconnect and out-of-order event tests.
- Deployed failure-injection smoke.

### Gate 4 — Exact active host capture (optional P1)

**Goal:** capture the actual active host tab safely when product value justifies extension installation.

Actions:

- Complete server-verifiable pairing/attestation or keep the feature disabled.
- Confirm action-granted active tab, exact origin, foreground tab, nonce, workspace/request/revisions, and viewport.
- Hide Sonik capture chrome; mask sensitive and cross-origin regions or fail closed.
- Promote through the same Workbench artifact coordinator.

Acceptance:

- The product never claims exact host capture before a successful pair.
- Navigation, service-worker restart, permission loss, background/wrong tab, replay, stale revisions, or oversized result require re-pair/reject.
- Screenshot dimensions match the active viewport and redactions are declared.
- No history, broad host, storage, or network extension permissions are added.

Verification:

- Existing protocol/unit suite plus live persistent-Chromium E2E.
- Manual security review before enabling the UI.

### Gate 5 — Governed tools and deployment (P1)

**Goal:** convert repository shell access into a trustworthy Sonik development workflow.

Actions:

- Expose current Booking capabilities through typed CLI/MCP adapters.
- Route execution through the Sonik authority gateway.
- Add approval records for effectful tools, migrations, push, and deploy.
- Add scoped Git/deployment provider credentials and provider request IDs.
- Present diff, verification, branch, target, and expiry before publish.

Acceptance:

- Codex can list only tools ready for the active host session.
- A read-only Booking call succeeds with the authenticated organization context.
- Missing scope returns an exact reason and cannot be bypassed from browser context.
- A code change can be tested, proposed, explicitly approved, pushed, and deployed with an audit trail.
- No reusable production credential is exposed inside page context, logs, terminal transcript, or client JavaScript.

Verification:

- Authority and approval contract tests.
- Sandbox-to-gateway integration test.
- Non-production deployment smoke before any production enablement.

### Gate 6 — Durability and second host (P2)

**Goal:** make the architecture reusable rather than Booking-specific.

Actions:

- Adopt the neutral host bridge in Amplify.
- Define encrypted Codex credential restoration or a managed identity flow if teardown persistence is required.
- Attach web/TUI/voice/messaging surfaces to the same run/event history.
- Evaluate durable agent orchestration only against demonstrated gaps in raw Codex/tmux.

Acceptance:

- Booking and Amplify pass the same host-adoption contract suite.
- Reconnection and suspension preserve one run identity.
- Deletion behavior is explicit; credential restoration is auditable and tenant-scoped.
- Adding another client does not create a second history or authority model.

## 3. Required test matrix

| Journey | Standalone | Booking embedded | Amplify embedded | Required gate |
|---|:---:|:---:|:---:|---|
| Create/resume workspace | ✓ | ✓ | later | 0–1 |
| Real tmux/Codex terminal | ✓ | ✓ | later | 0 |
| Right/bottom/fullscreen/resize | ✓ | ✓ | later | 0 |
| Page context + signed authority | n/a | ✓ | later | 1 |
| Source switch/invalidation | Preview | Preview + Booking | later | 2 |
| Semantic element picker | n/a | ✓ | later | 2 |
| Controlled-preview capture | ✓ | ✓ | later | 2 |
| Exact active-tab capture | optional | optional | optional | 4 |
| Changed files/console/network | ✓ | ✓ | later | 3 |
| Read-only host tool | n/a | ✓ | later | 5 |
| Approved deploy | ✓ | ✓ | later | 5 |

Every checked cell requires an interaction test, not only a string/source assertion.

## 4. Global completion gate

Do not call the harness complete until a fresh deployment proves this uninterrupted scenario:

1. Sign into Booking.
2. Open Agent UI and choose Dev from the speed dial.
3. Resume or create the configured repository workspace.
4. Observe explicit repository, terminal, preview, host evidence, and authority readiness.
5. Switch to Booking source and pick a visible element.
6. Send the current page/selection to Codex.
7. Switch to Preview and capture a controlled screenshot.
8. Codex reads the `.sonik` artifacts, locates relevant source, and edits a file.
9. The hot preview updates.
10. A targeted test runs and its raw evidence appears.
11. Refresh/reconnect without losing the workspace/run.
12. If deployment is in scope, inspect the diff and explicitly approve a non-production deploy.

Record the deployed URLs/versions, test artifact, sanitized diagnostics, commit SHA, and known deferrals.

## 5. Suggested effort bands

These are engineering bands, not promises. They assume credentials and host deployment access are available and current code is retained.

| Scope | Focused effort |
|---|---:|
| Gates 0–2: usable embedded visual-context V1 | roughly 2–4 focused days |
| Gate 3: normalized evidence/realtime views | roughly 2–3 focused days |
| Gate 4: secure active-tab extension | roughly 1–2 focused days after trust decision |
| Gate 5: governed MCP/tools/deploy | roughly 2–4 focused days depending on authority provider readiness |
| Gate 6: durability/Amplify/channel adoption | separate follow-on |

The fastest route is not more parallelism. It is a single Booking vertical slice through Gate 2, followed by independent review and deployed evidence.

## 6. Handoff update protocol

At the end of each gate:

1. update the matrix in `02-current-state-and-gaps.md`;
2. add the exact commands and results to the PR description;
3. attach the deployed/manual test artifact;
4. list any unavailable credentials or environment prerequisites;
5. mark deferred behavior explicitly; and
6. never promote a ledger item solely from a worker message or source-code assertion.
