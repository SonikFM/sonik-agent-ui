# 03-marketplace-package-bundle-contracts — Package, version, install, and bundle contracts

Status: draft
Audience: backend engineers, SDK authors, reviewers
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-06

## Purpose

This doc defines the marketplace package model this product corpus expects later endpoints and UI to implement.

## Current state vs target state

| Aspect | Current | Target | Evidence |
| --- | --- | --- | --- |
| Package kinds | Zod enum includes bundle, app, workflow, skill, command_tool_pack, agent, artifact_template, mcp_addon, provider_integration, managed_internal. | These remain first-class installable kinds. | `packages/tool-contracts/src/marketplace.ts:8-18` |
| Legacy aliases | Compatibility aliases normalize before persistence/display. | Agents can accept older terms without storing drift. | `packages/tool-contracts/src/marketplace.ts:20-36`; `packages/tool-contracts/src/marketplace.ts:622-633` |
| Version id | `packageVersionId` is validated as `<packageId>@<semver>`. | Install/update flows target immutable versions. | `packages/tool-contracts/src/marketplace.ts:74-76`; `packages/tool-contracts/src/marketplace.ts:420-570` |
| Bundle composition | Bundle entries require exactly one selector among packageVersionId, versionRange, embeddedDefinitionId. | Bundles are compositional, not nullable mega-objects. | `packages/tool-contracts/src/marketplace.ts:347-398` |
| Installation | Installation records carry installedVersionId, installMode, scope, permissions, and optional sourcePackageVersionId. | Installed packages support pinned/copied/forked/subscribed semantics. | `packages/tool-contracts/src/marketplace.ts:577-609`; `docs/contracts/marketplace-package-contracts-v0.md:28-35` |

## Contract narrative

`MarketplacePackage` is a mutable summary/index record, while `MarketplacePackageVersion` is the immutable install target. `MarketplaceInstallation` records a user/org/workspace-installed instance. This split is documented in `MARKETPLACE-ORPC-PLANNING.md:11-19` and enforced in `packages/tool-contracts/src/marketplace.ts:420-609`.

Bundles are the default useful solution package because they can compose apps, workflows, skills, command tool packs, agents, artifact templates, and add-ons. They are not the only installable type (`docs/contracts/marketplace-package-contracts-v0.md:9-16`).

## Install modes

| Mode | Product meaning | Evidence |
| --- | --- | --- |
| pinned | Fixed immutable upstream version. | `docs/contracts/marketplace-package-contracts-v0.md:28-35` |
| copied | Editable local copy with provenance. | `docs/contracts/marketplace-package-contracts-v0.md:28-35`; `packages/tool-contracts/src/marketplace.ts:577-609` |
| forked | Editable copy designed for future upstream comparison. | `docs/contracts/marketplace-package-contracts-v0.md:28-35` |
| subscribed | Follows upstream updates for low-risk package types. | `docs/contracts/marketplace-package-contracts-v0.md:28-35` |

## Non-negotiable invariants

- `packageVersionId` must start with `packageId@` and semver must match manifest/package version (`packages/tool-contracts/src/marketplace.ts:446-564`).
- Bundle selectors must be mutually exclusive and installOrder must reference contained entries (`packages/tool-contracts/src/marketplace.ts:356-398`).
- Active write/destructive/external permission grants require trusted approval and trusted host context (`packages/tool-contracts/src/marketplace.ts:98-109`).

## Known blockers and deferred work

- No production database schema for packages, versions, installations, reviews, or publish metadata yet.
- No migration policy implementation beyond contract helper/planned upgrade mention.
- No public creator publish flow.

## What developers must not do

- Do not install by mutable package id alone.
- Do not allow bundle entries with multiple selectors.
- Do not collapse copied/forked/pinned/subscribed into one unversioned install state.

## Prove it

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
```

Passing proves package, version, bundle, permission, and install fixture invariants currently hold.

## Sources

- `packages/tool-contracts/src/marketplace.ts`
- `tests/unit/marketplace-package-contracts.test.mjs`
- `docs/contracts/marketplace-package-contracts-v0.md`
- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md`
