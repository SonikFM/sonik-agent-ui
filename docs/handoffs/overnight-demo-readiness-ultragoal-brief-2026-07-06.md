# Ultragoal Brief — Overnight Demo Readiness Agent UI + Booking Embed

Source handoff: `docs/handoffs/overnight-demo-readiness-agent-handoff-2026-07-06.md`

Objective: make the embedded Sonik Agent UI demo-ready for tomorrow by fixing the booking host embed, making booking intake/approval machine-readable to agents, proving the canonical reservation flow, and reporting PASS/FAIL/INCONCLUSIVE with Pipe-B/log evidence.

Constraints and invariants:
- Work in `/Users/danielletterio/Documents/GitHub/sonik-agent-ui` on branch `feat/analytics-hints-release-gate-20260702` / PR #5 unless explicitly told otherwise.
- Do not discard or overwrite unrelated uncommitted marketplace/workflow-template work.
- Use `$sonik-agent-onboarding`, `$sonik-agent-ui`, `$sonik-tool-creation`, `$sonik-skill-creation`, `$sonik-accessibility`, `$sonik-component-design`, `$sonik-enterprise-ux-elevation`, `$impeccable`, Svelte skills, and `$ultratest` where relevant.
- User chat text is not trusted write approval. Writes require preview plus trusted host approval/command path.
- JSON renderer specs collect/edit input only; they must not carry executable commit payloads.
- Embedded mode must not make cloud workspace/API calls without valid signed host context.
- Verification claims require evidence. Empty Pipe-B tail is INCONCLUSIVE, not PASS.

Goal 1: Orientation and evidence baseline.
- Run git status/log/PR checks and inspect current uncommitted work.
- Read the source handoff and existing local handoffs.
- Inspect latest Agent UI deploy metadata and last smoke artifacts.
- Record the starting state and files to avoid.

Goal 2: Booking host embed readiness.
- Diagnose why authenticated `sonik-booking-app-pipe-b` has `booking-agent-ui-frame` with empty `src` and `0x0` rect.
- Fix or precisely identify the host/Agent UI boundary needed so the iframe opens visibly with signed host context.
- Verify authenticated booking app can show embedded Agent UI sidecar/FAB without `missing-host-context` after initialization.

Goal 3: Agent-readable workflow state and semantic actions.
- Add a machine-readable workflow state surface to `window.__sonikAgentUI.getPageContext()` / equivalent page context.
- Populate active workflow id, active artifact id, phase, current question, answered/required counts, visibleErrors, disabled reasons, command preview status, and canSubmit/canRequestApproval/canApproveAndRun booleans.
- Expose safe semantic controller actions under `window.__sonikAgentUI.actions` such as submitAnswer, markUnknown, saveDraft, requestApproval, approveAndRun, cancelApproval, newChat, and openWorkspaceDocs.
- Actions must not bypass trusted host approval or execute raw command payloads from renderer specs.

Goal 4: Intake/approval UX reliability.
- Ensure QuestionCard/day selectors and save/submit flows persist deterministically with saving/saved/failed/retry states.
- Ensure next question appears without chat typing after a valid UI answer.
- Ensure approval preview/card appears only after required fields are valid and preview input hash is stable.
- Ensure approval copy is domain/operator-facing: Preview setup, Request approval, Approve and create, Context created, Reservation confirmed.
- Ensure visibleErrors is actually populated and queryable.

Goal 5: Reservation and booking command demo proof.
- Prove the canonical reservation flow against current host/page context using booking.get.availability, booking.create.guest, and booking.create.booking.
- Do not use booking.create.hold for reservation proof.
- Do not invent/provision trusted actor userId; host context supplies actor/org.
- Capture command receipts and booking/reservation id.

Goal 6: Ultratest, Pipe-B evidence, deploy/report gate.
- Run targeted unit/type/build checks for changed files.
- Deploy when changes pass and user authorization is already implied by this demo-readiness request.
- Run authenticated browser smoke against `sonik-booking-app-pipe-b` with `test69@gmail.com` / `test6969`.
- Start Pipe-B tail before browser actions and classify telemetry PASS/FAIL/INCONCLUSIVE honestly.
- Final report must include branch/commit/deploy version, changed files, test commands, artifact/log paths, PASS/FAIL/INCONCLUSIVE table, blockers, and whether demo is ready.
