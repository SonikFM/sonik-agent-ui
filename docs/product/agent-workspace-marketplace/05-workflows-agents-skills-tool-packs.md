# 05-workflows-agents-skills-tool-packs — Installable capability composition

Status: draft
Audience: agent-platform engineers, skill/tool authors, marketplace reviewers
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-06

## Purpose

This doc defines how workflows, agents, skills, command tool packs, artifact templates, MCP add-ons, and bundles should compose without becoming opaque runtime blobs.

## Current state vs target state

| Capability | Current | Target | Evidence |
| --- | --- | --- | --- |
| Package kind | All major capability kinds are enumerated. | Each kind remains installable and bundle-composable. | `packages/tool-contracts/src/marketplace.ts:8-18`; `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:21-34` |
| Workflow | Workflow definition schema includes nodes, edges, triggers, required packages, safety rules. | Workflow packages can preview/run through typed approval gates. | `packages/tool-contracts/src/marketplace.ts:205-305`; `packages/tool-contracts/src/marketplace-fixtures.ts:90-128` |
| Command tool pack | Fixtures show booking/amplify command permissions inside bundles. | Tool packs can be installed/pinned and permission-reviewed. | `packages/tool-contracts/src/marketplace-fixtures.ts:144-172` |
| Skill/agent | Contracts include skill and agent payload slots. | Skills/agents are installable, searchable, and versioned through the same package envelope. | `packages/tool-contracts/src/marketplace.ts:244-334` |

## Workflow contract

Workflow nodes include trigger, ask_user, skill, artifact, tool_preview, approval, tool_commit, remote_execution, evidence, and branch. Tool commits and write/destructive/external effects are gated by trusted approval and host context (`packages/tool-contracts/src/marketplace.ts:207-222`).

The reservation workflow fixture follows read/preview/write sequencing with booking availability, guest creation, and booking creation (`packages/tool-contracts/src/marketplace-fixtures.ts:90-128`).

## Package composition rule

A workflow may depend on a command tool pack or app, but dependency inclusion must happen through package version refs, version ranges, or embedded definitions in a bundle, not hidden ad-hoc prompts. Bundle composition is validated in `packages/tool-contracts/src/marketplace.ts:347-398`.

## Non-negotiable invariants

- Tool packs must expose permission grants, mode (`off|ask|allow`), effect, approval policy, and host-context requirements.
- Workflows must separate read/preview nodes from commit nodes.
- Skills can guide the agent, but skills are not approval grants or command receipts.

## Known blockers and deferred work

- Need production registry endpoints for skills/agents/tool packs.
- Need authoring guidelines for skill/package metadata and marketplace review.
- Need UX for installing command families without overwhelming users.

## What developers must not do

- Do not hide write-capable commands inside a bundle without permission display.
- Do not treat a skill as executable code authority.
- Do not let workflows call tool_commit nodes without host context and trusted approval.

## Prove it

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node --experimental-strip-types tests/unit/marketplace-workflow-templates.test.mjs
node tests/unit/marketplace-package-contracts.test.mjs
```

Passing proves current workflow template and package composition tests remain valid.

## Sources

- `packages/tool-contracts/src/marketplace.ts`
- `packages/tool-contracts/src/marketplace-fixtures.ts`
- `tests/unit/marketplace-workflow-templates.test.mjs`
- `tests/unit/marketplace-package-contracts.test.mjs`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md`
