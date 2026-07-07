# 04-command-backed-apps-json-render — Stateful JSON-render apps

Status: draft
Audience: design agents, app authors, frontend engineers, reviewers
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-06

## Purpose

This doc explains how Sonik can create stateful mini apps without introducing a new runtime engine: JSON-render is the canonical app definition, command bindings add preview/commit seams, and trusted host approval remains external to renderer state.

## Current state vs target state

| Aspect | Current | Target | Evidence |
| --- | --- | --- | --- |
| App definition | `CommandBackedAppDefinition` exists in contracts. | All deterministic marketplace apps use this or a successor schema. | `packages/tool-contracts/src/marketplace.ts:111-203` |
| Renderer actions | Actions include state_update, command_preview_request, approval_request, command_binding_ref, navigate, emit_event. | Apps expose useful controls while commands remain gated. | `packages/tool-contracts/src/marketplace.ts:137-193` |
| Fixture app | Restaurant setup app fixture binds preview and commit for booking.create.context. | Demo apps prove draft → preview → approval → write pattern. | `packages/tool-contracts/src/marketplace-fixtures.ts:45-65` |
| Tests | Tests assert command-backed app commit binding requires trusted approval/host context. | CI prevents unsafe app contracts. | `tests/unit/marketplace-package-contracts.test.mjs:44-82` |

## App model

A command-backed app has identity, display metadata, schema version, renderer format, artifact template, allowed actions, command bindings, state schema, and required permissions. This is modeled in `packages/tool-contracts/src/marketplace.ts:111-203`.

The renderer action rule is intentionally asymmetric: renderer actions may reference state/preview/approval/navigate/event semantics, but direct `command_binding_ref` usage is rejected because the renderer must not become a write executor (`packages/tool-contracts/src/marketplace.ts:181-193`).

## JSON vs HTML

JSON-render is canonical because it gives agents and humans a shared structured state surface. The design handoff points to generative UI as “tool result → component” and recommends separating model-visible structured content from widget-private metadata/state (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md:39-55`). HTML can remain a document/artifact escape hatch, but it should not be the first path for command-backed apps because it is harder to validate, patch, and bind to commands deterministically.

## Non-negotiable invariants

- Renderer state updates are not backend writes.
- Approval requests are not trusted approval grants.
- Commit bindings require `preview_then_trusted_approval` and `requiredHostContext` for write effects.

## Known blockers and deferred work

- Need a renderer component registry contract for command-backed components beyond generic JSON-render elements.
- Need state persistence/update APIs for installed app copies.
- Need UX design for save draft, submit to agent, request approval, approve and run, and receipts.

## What developers must not do

- Do not make artifact button clicks execute `commitCommand` directly.
- Do not store secrets or trusted approval state in JSON-render artifact state.
- Do not use HTML as the default command-backed app runtime unless a sandbox/runtime contract is later approved.

## Prove it

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
node --experimental-strip-types tests/unit/tool-contracts.test.mjs
```

Passing proves current marketplace command-backed app contract gates and the supported tool-contract path for ask-user/question approval behavior.

## Sources

- `packages/tool-contracts/src/marketplace.ts`
- `packages/tool-contracts/src/marketplace-fixtures.ts`
- `tests/unit/marketplace-package-contracts.test.mjs`
- `tests/unit/tool-contracts.test.mjs`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/WORKSPACE-CREATION-DESIGN-BRIEF.md`
