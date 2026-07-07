# Marketplace / Workspace Demo Readiness Handoff

Date: 2026-07-06
Repo: `/Users/danielletterio/Documents/GitHub/sonik-agent-ui`
Audience: next implementation/design/planning agent
Status: contract/documentation groundwork exists, but demo-usage docs and runtime endpoints are not ready yet.

## Why this handoff exists

A large PRD/docs corpus was created for Sonik Agent UI marketplace/workspace work. The corpus is useful, but it is currently too architecture-heavy and not yet clear enough for demo readiness or day-to-day implementation.

The user’s concern is correct:

> The docs say a lot, but they do not yet clearly explain how an agent/user actually uses marketplace packages, command-backed apps, workflows, installs, approvals, or demo flows.

Your job is to turn the existing contract direction into practical implementation/demo guidance.

## Current source of truth

Read these first:

- `docs/product/agent-workspace-marketplace/INDEX.md`
- `docs/product/agent-workspace-marketplace/DECISIONS.md`
- `docs/product/agent-workspace-marketplace/SUMMARY.md`
- `docs/contracts/marketplace-package-contracts-v0.md`
- `packages/tool-contracts/src/marketplace.ts`
- `packages/tool-contracts/src/marketplace-fixtures.ts`
- `tests/unit/marketplace-package-contracts.test.mjs`
- `tests/unit/marketplace-workflow-templates.test.mjs`
- `tests/unit/tool-contracts.test.mjs`

Also useful:

- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/`
- `docs/product/agent-workspace-marketplace/06-orpc-endpoint-map-data-model.md`
- `docs/product/agent-workspace-marketplace/07-permissions-approval-trust-boundary.md`
- `docs/product/agent-workspace-marketplace/11-operations-runbook.md`

## What is actually done

### Contract-v0 skeleton exists

The repo now has draft/tested contract coverage for:

- Marketplace package envelope
- Package kinds:
  - `bundle`
  - `app`
  - `workflow`
  - `skill`
  - `command_tool_pack`
  - `agent`
  - `artifact_template`
  - `mcp_addon`
  - `provider_integration`
  - `managed_internal`
- Immutable `packageVersionId`
- `MarketplacePackageVersion`
- `MarketplaceInstallation`
- Bundle composition
- Permission grants: `off / ask / allow`
- Approval policy model
- Command-backed JSON-render app definitions
- HTML escape hatch constraints
- Workflow graph definitions
- Workflow graph validation for:
  - unique node IDs
  - edges referencing declared nodes
  - preview-before-commit
  - trusted host context for write/destructive/external effects

### Verification passed

The final focused gate passed:

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
node --experimental-strip-types tests/unit/marketplace-workflow-templates.test.mjs
node --experimental-strip-types tests/unit/tool-contracts.test.mjs
python3 scripts/check-markdown-trailing-whitespace.py docs/product/agent-workspace-marketplace .omx/ultragoal/quality/prd-docs-architecture-invariant-audit.md .omx/ultragoal/quality/prd-docs-ai-slop-cleaner.md .omx/ultragoal/quality/prd-docs-post-review-ai-slop-cleaner.md docs/contracts/marketplace-package-contracts-v0.md
npx gitnexus status
```

Independent review results:

- code-reviewer: `APPROVE`
- architect: `CLEAR`

## What is not done

Do **not** overclaim these as implemented:

- Production marketplace ORPC endpoints
- Marketplace persistence tables / migrations
- Real install/update/copy/fork runtime
- Marketplace search UI
- Install preview UI
- Agent-facing marketplace tool calls
- Production workflow execution endpoints
- Runtime app state persistence for installed apps
- Marketplace publishing/moderation
- Creator package version upgrade UX
- End-to-end demo flow from package discovery to install to run

The current work is **contract/documentation groundwork**, not a usable marketplace product.

## Current problem

The docs are too abstract for usage.

They answer:

- What is the contract philosophy?
- What must not be violated?
- What are the high-level package types?
- What is the trust boundary?

They do **not** clearly answer:

- How do I create a marketplace package?
- How do I install a package?
- What JSON do I write?
- How does an agent discover packages?
- How does an agent preview and request approval?
- What is the exact demo path?
- What does the user see?
- What should logs show?
- What is ready vs fake vs planned?

## Recommended next slice

Create practical usage-level docs on top of the architecture corpus.

### 1. Create `docs/product/agent-workspace-marketplace/MARKETPLACE-CONTRACT-COOKBOOK.md`

This should include concrete copy-paste examples:

1. Minimal app package
2. Minimal workflow package
3. Minimal command tool pack
4. Minimal bundle
5. Booking context setup app bundle
6. Booking reservation workflow bundle
7. Amplify campaign wizard bundle

Each example should include:

- manifest JSON
- package kind
- package version id
- install mode
- permissions requested
- host context required
- command bindings
- expected validation result
- expected install preview output
- expected user-facing explanation
- expected agent behavior

### 2. Create `docs/product/agent-workspace-marketplace/DEMO-READINESS-RUNBOOK.md`

This should describe what can be shown in a demo and what cannot.

Suggested demo paths:

1. Search/install a booking setup bundle
2. Launch a command-backed restaurant setup app
3. Fill JSON-render state
4. Preview `booking.create.context`
5. Request approval
6. Run approved command
7. Show receipt / logs
8. Search/install reservation workflow
9. Create reservation through canonical command path
10. Show package version / install provenance

For each step include:

- user prompt
- expected UI
- expected agent-visible state
- expected command/tool behavior
- expected telemetry/log proof
- known failure mode
- fallback demo script

### 3. Create `docs/product/agent-workspace-marketplace/ORPC-ENDPOINT-SPEC.md`

Turn the endpoint map into exact implementation contracts.

Minimum endpoint set:

- `marketplace.searchPackages`
- `marketplace.getPackage`
- `marketplace.getPackageVersion`
- `marketplace.getInstallPreview`
- `marketplace.validateManifest`
- `marketplace.installPackage`
- `marketplace.updateInstallation`
- `workflow.previewRun`
- `workflow.requestApproval`
- `workflow.runApproved`
- `app.previewCommandBinding`
- `app.requestCommandApproval`
- `app.applyStatePatch`

For each endpoint define:

- input schema
- output schema
- auth/org context
- RLS requirement
- audit event
- error cases
- whether it is read, preview, or trusted write
- which package contracts it validates against

### 4. Create `docs/product/agent-workspace-marketplace/AGENT-USAGE-CONTRACT.md`

This is the highest-leverage doc for agent behavior.

It should explain:

- how an agent discovers packages
- how an agent learns package contents
- how an agent explains permissions
- how an agent previews a command-backed app action
- how an agent asks for trusted approval
- how an agent handles missing host context
- how an agent avoids calling command commits directly from renderer actions
- what an agent should say to a user
- what an agent must never do

Key rule:

> The agent may guide, preview, and request approval; trusted host approval and command receipts are the source of authority.

## Recommended implementation order

Do not start with backend persistence until the cookbook/runbook clarify what demo path we are actually supporting.

Recommended order:

1. Contract cookbook
2. Demo readiness runbook
3. Agent usage contract
4. ORPC endpoint spec
5. Runtime endpoint implementation
6. Install preview UI
7. App/workflow install persistence
8. Live demo smoke tests

## Demo-readiness definition

For this area to be demo-ready, we need one full scenario that works end to end:

### Scenario A: Booking setup app

User says:

> Help me set up a restaurant booking app.

Expected flow:

1. Agent searches marketplace packages.
2. Agent suggests a booking setup bundle.
3. User installs or launches copied app.
4. JSON-render setup app opens in canvas.
5. User fills restaurant name, hours, tables, menus, confirmation mode.
6. App state is deterministic and visible to agent.
7. Agent previews concrete booking command payload.
8. User sees approval card.
9. User approves.
10. Host-authorized command runs.
11. Receipt appears.
12. Created context appears in booking service.

If any of those steps require manual prompt hacks, it is not demo-ready.

### Scenario B: Reservation workflow

User says:

> Book a table for two tomorrow at 6pm.

Expected flow:

1. Agent discovers reservation workflow.
2. Agent checks current host/page context.
3. Agent calls availability.
4. Agent creates/uses guest.
5. Agent previews booking creation.
6. Approval happens if required.
7. Booking is created.
8. Receipt is shown.

## Important contract stance

Keep these decisions stable unless explicitly revised:

1. Bundle is the default useful installable solution, but not the only installable kind.
2. Individual apps/workflows/skills/tool packs/agents/templates remain first-class.
3. Installs target immutable `packageVersionId`.
4. JSON-render is canonical for command-backed apps.
5. HTML is only an escape hatch.
6. User text saying “approve” is not trusted authorization.
7. Renderer buttons cannot directly commit writes.
8. Trusted host context is required for mutating commands.
9. Production ORPC and persistence are planned, not done.

## Files likely to edit next

New docs:

- `docs/product/agent-workspace-marketplace/MARKETPLACE-CONTRACT-COOKBOOK.md`
- `docs/product/agent-workspace-marketplace/DEMO-READINESS-RUNBOOK.md`
- `docs/product/agent-workspace-marketplace/ORPC-ENDPOINT-SPEC.md`
- `docs/product/agent-workspace-marketplace/AGENT-USAGE-CONTRACT.md`

Possibly update:

- `docs/product/agent-workspace-marketplace/INDEX.md`
- `docs/product/agent-workspace-marketplace/SUMMARY.md`
- `docs/product/agent-workspace-marketplace/11-operations-runbook.md`
- `docs/contracts/marketplace-package-contracts-v0.md`

Possible test additions later:

- `tests/unit/marketplace-package-contracts.test.mjs`
- `tests/unit/marketplace-workflow-templates.test.mjs`
- new endpoint contract tests once ORPC routes exist

## Useful skills / process guidance

Use these skills if available:

- `$sonik-agent-ui`
- `$sonik-tool-creation`
- `$sonik-skill-creation`
- `$sonik-accessibility`
- `$sonik-component-design`
- `$sonik-enterprise-ux-elevation`
- `$analyze-copy-retrofit`
- `$prd-development`
- `$product-strategy-session`
- `$roadmap-planning`
- `$user-story-mapping`
- `$user-story-splitting`
- `$context-engineering-advisor`
- `$ai-shaped-readiness-advisor`
- `$derisk-measurement-advisor`

## Verification commands

Before claiming docs/contracts are coherent, run:

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
node --experimental-strip-types tests/unit/marketplace-workflow-templates.test.mjs
node --experimental-strip-types tests/unit/tool-contracts.test.mjs
python3 scripts/check-markdown-trailing-whitespace.py docs/product/agent-workspace-marketplace docs/contracts/marketplace-package-contracts-v0.md
npx gitnexus status
```

If GitNexus is stale:

```bash
npx gitnexus analyze
```

## Warning for next agent

Do not confuse these three things:

1. **Contract readiness** — mostly yes for v0 skeleton.
2. **Demo readiness** — no, not until cookbook/runbook and at least one working scenario exist.
3. **Production readiness** — no, not until ORPC, persistence, UI, telemetry, approval records, and smoke tests exist.

The next useful move is not more abstract PRD prose. It is concrete examples, exact endpoint contracts, and demo runbooks that turn the marketplace model into something an agent and human can actually use.
