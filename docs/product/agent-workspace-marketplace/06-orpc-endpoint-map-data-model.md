# 06-orpc-endpoint-map-data-model — Planned endpoints and data model

Status: draft
Audience: backend engineers, data model owners, reviewers
Verified against: `c9011e4` plus uncommitted marketplace/workspace draft files
Last updated: 2026-07-06

## Purpose

This doc captures the planned typed endpoint and persistence model without claiming production implementation exists.

## Current state vs target state

| Aspect | Current | Target | Evidence |
| --- | --- | --- | --- |
| Endpoint map | Planned endpoint names exist in docs. | Implemented ORPC routes use the same names or doc updates explain changes. | `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:48-85`; `docs/contracts/marketplace-package-contracts-v0.md:74-90` |
| Data model | Contracts define package/version/install shapes. | Database tables mirror contract boundaries and org/user/workspace scope. | `packages/tool-contracts/src/marketplace.ts:420-609` |
| Validation | Zod schemas validate manifests/versions/installations in package. | API handlers validate requests/responses with these schemas. | `packages/tool-contracts/src/marketplace.ts:420-609`; `tests/unit/marketplace-package-contracts.test.mjs:28-82` |

## Planned endpoint map

Read/search endpoints are planned as `marketplace.searchPackages`, `marketplace.getPackage`, `marketplace.getPackageVersion`, `marketplace.listInstallations`, `marketplace.getInstallation`, `marketplace.getInstallPreview`, and `marketplace.validateManifest` (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:52-62`).

Install/manage endpoints are planned as `marketplace.installPackage`, `marketplace.uninstallPackage`, `marketplace.updateInstallation`, `marketplace.setInstallationPermissionPolicy`, `marketplace.pinInstallationVersion`, `marketplace.copyInstallation`, and `marketplace.forkInstallation` (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:64-74`).

Workflow/app preview endpoints are planned as `workflow.previewRun`, `workflow.requestApproval`, `workflow.runApproved`, `app.previewCommandBinding`, `app.requestCommandApproval`, and `app.applyStatePatch` (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:76-85`).

## Proposed persistence tables

| Table | Purpose | Contract source |
| --- | --- | --- |
| marketplace_packages | Mutable index/discovery record with currentVersionId. | `packages/tool-contracts/src/marketplace.ts:496-510` |
| marketplace_package_versions | Immutable packageVersionId + manifest + manifestHash. | `packages/tool-contracts/src/marketplace.ts:544-570` |
| marketplace_installations | Installed version, install mode, scope, permissions, sourcePackageVersionId. | `packages/tool-contracts/src/marketplace.ts:577-609` |
| marketplace_installation_events | Audit log for install/update/copy/fork/approval policy changes. | Proposed; no current schema. |
| workflow_run_previews | Non-mutating preview records tied to package/install/workflow. | Proposed; endpoint names in `MARKETPLACE-ORPC-PLANNING.md:76-85`. |
| workflow_approval_requests | Trusted approval request state. | Proposed; approval invariant in `packages/tool-contracts/src/marketplace.ts:207-222`. |
| command_receipts | Receipts for executed command bindings. | Existing command-catalog tests imply receipts; marketplace table not yet implemented. |

## Non-negotiable invariants

- Endpoint inputs for install/update target packageVersionId or installationId, never mutable package id alone (`docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md:87-93`).
- Manifest validation must fail safe for unknown schema versions or require review, not silently coerce arbitrary payloads (`docs/contracts/marketplace-package-contracts-v0.md:18-27`).
- Copied/forked installs preserve source lineage (`docs/contracts/marketplace-package-contracts-v0.md:24-27`).

## Known blockers and deferred work

- No migrations in this pass.
- No RLS/org context design finalized for marketplace tables.
- No package update migration runner implemented.

## What developers must not do

- Do not create endpoints with names that conflict with this map without updating this corpus.
- Do not persist unvalidated manifests.
- Do not execute workflow.runApproved without a prior approval record and host context.

## Prove it

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node tests/unit/marketplace-package-contracts.test.mjs
```

Passing proves contract shape validation only. It does not prove endpoint or database implementation.

## Sources

- `docs/handoffs/workspace-creation-tool-design-handoff-2026-07-06/MARKETPLACE-ORPC-PLANNING.md`
- `docs/contracts/marketplace-package-contracts-v0.md`
- `packages/tool-contracts/src/marketplace.ts`
- `tests/unit/marketplace-package-contracts.test.mjs`
