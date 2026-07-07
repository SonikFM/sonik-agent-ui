# 08-telemetry-proof-accessibility-readiness — Proof, telemetry, accessibility, and enterprise readiness

Status: draft
Audience: QA, accessibility reviewers, enterprise UX reviewers, release owners
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-06

## Purpose

This doc defines what must be proven before Agent Workspace + Marketplace work is production-ready.

## Current state vs target state

| Aspect | Current | Target | Evidence |
| --- | --- | --- | --- |
| Contract proof | Marketplace and workflow template tests exist. | Release gate includes all marketplace/app/workflow contract tests. | `tests/unit/marketplace-package-contracts.test.mjs:1-180`; `tests/unit/marketplace-workflow-templates.test.mjs:1-130` |
| Command proof | Tool-contract tests cover approval and command catalog behavior. | Marketplace actions produce preview/approval/receipt telemetry. | `tests/unit/tool-contracts.test.mjs:745-755`; `tests/unit/tool-contracts.test.mjs:1006-1009` |
| Design/accessibility | Handoff requires preserving boundaries and package permission visibility. | Components meet accessibility, keyboard, focus, readable labels, and enterprise UX standards. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md:31-38`; `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/COMPONENT-INVENTORY.md:1-120` |
| Observability | Existing repo has Pipe-B and smoke scripts, but marketplace-specific proof is not implemented. | Marketplace install/run/update emits traceable packageVersionId, installationId, previewId, approvalId, and receiptId. | `package.json` scripts; planned endpoint map in `MARKETPLACE-ORPC-PLANNING.md:52-85` |

## Readiness gates

| Gate | Required proof | Current status |
| --- | --- | --- |
| Contract validity | Marketplace schemas/fixtures parse and reject unsafe variants. | Covered by `tests/unit/marketplace-package-contracts.test.mjs`. |
| Workflow safety | Workflow templates distinguish preview, approval, and commit. | Covered by `tests/unit/marketplace-workflow-templates.test.mjs`. |
| Command approval | Approval-gated commands cannot commit without approval. | Covered by `tests/unit/tool-contracts.test.mjs:745-755`. |
| Accessibility | Buttons/cards/flows are keyboard/focus/screen-reader testable. | Product requirement; needs component-level tests after UI implementation. |
| Enterprise UX | User-facing activity hides dev-speak by default but exposes receipts/details. | Product requirement; partially addressed elsewhere, needs marketplace-specific UX. |
| Telemetry | Install/run/update/approval events include immutable IDs and receipts. | Gap; endpoint implementation pending. |

## Non-negotiable invariants

- Release claims require evidence, not chat transcript confidence.
- Friendly UX labels must not remove technical receipts.
- Accessibility and agent-readability are both first-class readiness gates.

## Known blockers and deferred work

- No marketplace endpoint telemetry exists yet.
- No visual/accessibility QA for marketplace install screens yet.
- No Pipe-B marketplace smoke script yet.

## What developers must not do

- Do not mark marketplace workflows production-ready from unit tests alone.
- Do not hide receipts or host-context requirements for the sake of simpler UX.
- Do not ship inaccessible custom widgets for approvals or command-backed app forms.

## Prove it

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
node --experimental-strip-types tests/unit/marketplace-workflow-templates.test.mjs
node --experimental-strip-types tests/unit/tool-contracts.test.mjs
pnpm test
```

Passing proves broad current unit coverage. It does not prove live marketplace endpoint telemetry.

## Sources

- `tests/unit/marketplace-package-contracts.test.mjs`
- `tests/unit/marketplace-workflow-templates.test.mjs`
- `tests/unit/tool-contracts.test.mjs`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/README.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/COMPONENT-INVENTORY.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md`
- `package.json`
