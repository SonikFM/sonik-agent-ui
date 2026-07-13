# Vendored: sonik-command-registry.generated.json

- **Source repo:** `sonik-booking-service` (sibling worktree `payment-testing-vwxjc`, read-only)
- **Source path:** `packages/sonik-sdk/docs/sonik-command-registry.generated.json`
- **Source commit SHA:** `e483044d2047879cda8cc8d28e5e8054895e5a0d`
- **Vendored on:** 2026-07-13
- **Vendored by:** worker-registry (Phase 2, agent-creation-tool plan)

This is a hermetic, committed copy — `packages/tool-contracts/scripts/generate-capability-registry.mjs`
reads only this file, never a live sibling-worktree path (Decision 1 / risk #2 / S1 in
`.omc/plans/agent-creation-tool-plan-2026-07-13.md`). Refreshing this copy is a deliberate,
SHA-bumping commit: re-copy the source file, update the SHA above, then re-run
`node --experimental-strip-types packages/tool-contracts/scripts/generate-capability-registry.mjs`
to regenerate `packages/tool-contracts/src/sonik-capability-registry.generated.json`.
