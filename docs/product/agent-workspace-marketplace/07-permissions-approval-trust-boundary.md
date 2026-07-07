# 07-permissions-approval-trust-boundary — Permissions, approval, and trust boundary

Status: draft
Audience: security reviewers, backend engineers, UX designers, agent authors
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-06

## Purpose

This doc explains the boundary between user input, renderer state, command preview, trusted approval, and write execution.

## Current state vs target state

| Aspect | Current | Target | Evidence |
| --- | --- | --- | --- |
| Permission grants | Grants encode target, mode, effect, approval policy, host context. | Install previews show these clearly before runtime. | `packages/tool-contracts/src/marketplace.ts:80-109`; `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:87-93` |
| App bindings | Write commit bindings require trusted approval and host context. | Artifact UX can ask for approval but cannot grant it. | `packages/tool-contracts/src/marketplace.ts:111-193`; `tests/unit/marketplace-package-contracts.test.mjs:44-82` |
| Workflow nodes | Tool commit nodes require trusted approval policy. | Workflow.runApproved only runs after approval state exists. | `packages/tool-contracts/src/marketplace.ts:207-222`; `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:76-93` |
| Question cards | Answer receipts must not imply tool approval. | Ask-user flows collect input only. | `tests/unit/tool-contracts.test.mjs:241-285` |

## Approval model

The system has three separate states:

1. **Draft/input state** — user answers, JSON-render state patches, form fields.
2. **Preview state** — non-mutating command/workflow preview with human-readable inputs, effects, required context, and expected receipts.
3. **Trusted approval state** — host-authorized approval for a specific command/workflow preview.

Current contracts enforce this split by rejecting active write/destructive/external grants without `preview_then_trusted_approval` and `requiredHostContext` (`packages/tool-contracts/src/marketplace.ts:98-109`). Command bindings and workflow nodes repeat the same gate (`packages/tool-contracts/src/marketplace.ts:122-129`; `packages/tool-contracts/src/marketplace.ts:215-222`).

## UX implications

- Buttons should be user-friendly, but their technical meaning must be precise.
- “Save draft” updates artifact/app state.
- “Submit to agent” sends state to the agent for interpretation; it is not approval.
- “Request approval” creates a preview/approval request.
- “Approve and run” requires trusted host authorization and must produce receipts.
- “Cancel” clears the pending approval path.

These labels are product recommendations derived from the current trust model; the underlying contract sources are `packages/tool-contracts/src/marketplace.ts:137-193` and `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md:31-38`.

## Non-negotiable invariants

- User text saying “approve” is not sufficient.
- JSON-render state is not trusted approval state.
- Write/destructive/external effects require host context.
- Command receipts are required for completed writes.

## Known blockers and deferred work

- Need production approval records and UI approval card state.
- Need machine-readable active approval state in page context.
- Need clearer UX language for friendly tool activity vs technical receipts.

## What developers must not do

- Do not grant approval from chat text alone.
- Do not let renderer state contain trusted principal credentials or approval tokens.
- Do not hide permission grants inside a bundle install.

## Prove it

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
node --experimental-strip-types tests/unit/tool-contracts.test.mjs
```

Passing proves marketplace contract-level gates for command bindings, host context, trusted approval requirements, and the supported ask-user question non-approval path.

## Sources

- `packages/tool-contracts/src/marketplace.ts`
- `tests/unit/marketplace-package-contracts.test.mjs`
- `tests/unit/tool-contracts.test.mjs`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md`
