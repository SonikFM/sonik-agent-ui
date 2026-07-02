# Quality Gate — AI-Slop Audit (Open Design Retrofit Stack)

Date: 2026-07-02
Reviewer: independent critic agent (reviewer-only, no writes)
Scope: `git diff codex/booking-command-copy-retrofit-20260629150347..feat/analytics-hints-release-gate-20260702` (26 commits, phases G001–G005)
Gate field: `aiSlopCleaner`

## Verdict

**Largely clean, no blockers.** Deletion-first mindset applied across the stack; the speculative shim removed mid-flight (`3aae735`) left nothing similar behind; tests are genuinely strong. Four findings: three concrete deletions plus one pervasive comment trim.

## Findings

### Finding 1 — should-fix (deletion): dead speculative export

`packages/tool-contracts/src/run-context.ts:215` — `selectionHasKind` has zero production consumers; only referenced by its own test (`tests/unit/run-context-selection.test.mjs:42-43`), a test asserting a dead export against itself.

**Fix:** delete the function and those two assertions.
**Orchestrator disposition: ACCEPTED — will apply.**

### Finding 2 — should-fix (deletion): four unused request-store run wrappers

`apps/standalone-sveltekit/src/lib/server/workspace-request-store.ts:146-164` — `createRequestWorkspaceRun`, `getRequestWorkspaceRun`, `updateRequestWorkspaceRun`, `appendRequestWorkspaceRunEvent` have zero consumers. Production writes runs through the `RunPersistencePort` directly (`startRunRecorder`) and reads only through the two `list*` wrappers (`api/session/[id]/+server.ts`). Every pre-existing wrapper in the file has a real consumer, so this is not a house rule of mirroring the adapter surface.

**Fix:** delete the four; keep the two `list*` wrappers.
**Orchestrator disposition: ACCEPTED — will apply.**

### Finding 3 — should-fix (judgment call): `seedWhen` seam is a documented no-op

`agent-prompt.ts:29-54,220-238` plus `resolveAgentPromptComposition` context computation in `agent.ts`. Every module uses `ALWAYS_ON`, so no `seedWhen` predicate ever reads the context; the recording of `moduleIds` per run would be byte-identical without the predicate machinery. Auditor notes this is the one finding where reviewers can differ: it is cheap, pure, and explicitly documented as a deliberate future seam.

**Orchestrator disposition: REJECTED — keeping.** The seam was an explicitly confirmed design decision during G004 (unconditional seeding today; narrowing is a future deliberate one-line behavior change). Removing it would re-create the refactor cost when booking-module narrowing lands, which is already on the follow-up list.

### Finding 4 — should-fix (pervasive comment trim): donor-lineage and change-narration comments

New files run 3–10× the repo's comment density (e.g. `streaming-artifact.ts` ~43%, `agent-prompt.ts` ~28%, `run-context.ts` ~26% vs repo norm ~0–6%). Much is legitimate invariant WHY — keep that. The slop pattern is reviewer-directed narration and donor comparisons that go stale on merge:

- `agent-prompt.ts:4-5,11,19` — "this is a MOVE not a rewrite", "zero behavior change by default", "Dependency-light on purpose"; three "Reserved… unused today" notes.
- `run-context.ts:11-16,57-59,66-67,82` — "Modelled on Open Design's…", "the recurring bug class in Open Design's #4869 commit trail", "Mirrors the donor's…".
- `streaming-artifact.ts:6-30` — 30-line header, roughly half defending the design decision.
- `run-event-log.ts:36,369` — donor-comparison references.

**Fix:** strip donor-lineage / "this is a move" / commit-trail references; compress the streaming-artifact header to what-it-does; retain invariant comments.
**Orchestrator disposition: ACCEPTED — will apply.**

## Inspected and clean (non-findings)

- All `resolveAgentContextSelection` resolution fields consumed in `applyRunContextSelectionToPageContext`.
- Analytics hints fully wired and scoped analytics-only; sanitizer bounds correctly.
- Gate runner composes existing smoke scripts via subprocess — no reimplementation; `.omx/logs` evidence path matches pre-existing convention (not a typo).
- `boundedString` in `run-context.ts` is not duplication of `workspace-route-limits.ts` (dependency-light package boundary + different contract).
- try/catch in `startRunRecorder`/`teeRunEvents`/finalize are deliberate "persistence must never break the stream" guards, not silent-swallow slop.
- Tests strong: `streaming-artifact-sdk.test.mjs` drives the real `ai` SDK; prompt-composition test asserts verbatim monolith fragments; no tautologies or mock-against-self.
- chat-surface components consumed internally; dev-smoke-stream additions are legit dev-gated scripted streams.

## Gate outcome for `aiSlopCleaner`

No blocker-rated findings; nothing converts to a blocker story. Accepted findings (1, 2, 4) will be applied by a cleanup executor and re-verified before the G005 final checkpoint.
