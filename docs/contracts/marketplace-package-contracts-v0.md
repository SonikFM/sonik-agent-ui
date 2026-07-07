# Marketplace Package + Bundle Contracts v0

Date: 2026-07-06
Source plan: `.omx/plans/prd-marketplace-bundle-contract-model.md`
Code surface: `packages/tool-contracts/src/marketplace.ts`

## Contract decision

Sonik marketplace uses **one installable package envelope** and treats `bundle` as the default composite solution kind.

- Canonical root: `MarketplacePackage` / `MarketplaceManifest`.
- Immutable version: `MarketplacePackageVersion`.
- Installed copy/reference: `MarketplaceInstallation`.
- Composite solution: `MarketplaceBundle` / `BundleManifest` where `kind: "bundle"`.

This preserves first-class individual installs for apps, workflows, skills, command tool packs, agents, artifact templates, MCP add-ons, provider integrations, and managed internal packages while still supporting one-click useful bundles.

## Version/install invariants

1. Users install an immutable `packageVersionId`, never only a mutable package id.
2. `MarketplacePackage.currentVersionId` is an update-discovery pointer.
3. `MarketplaceInstallation.installedVersionId` records the exact installed immutable version.
4. `marketplaceSchemaVersion` is present on every manifest and package version.
5. Future schema changes must route through `upgradeMarketplaceManifest`; unknown versions fail safe with `requires_review` rather than invalidating old uploaded manifests.
6. `manifestHash` is kept for source integrity.
7. Copied/forked installs preserve same-package source lineage through `sourcePackageVersionId`.

## Install modes

| Mode | Meaning | Default use |
| --- | --- | --- |
| `pinned` | Fixed immutable upstream package version. | Workflows, command packs, skills. |
| `copied` | Editable local copy with source provenance. | Apps, artifact templates, campaign/booking setup forms. |
| `forked` | Editable local copy designed for future upstream comparison/pull. | Creator/remix marketplace. |
| `subscribed` | Follows upstream updates. | Low-risk read-only packages only unless policy later permits more. |

## Bundle composition

A bundle composes package-version refs and optional embedded seed definitions. It is **not** a wide nullable object. Exact package refs, version ranges, and embedded ids are mutually exclusive selectors; `packageRef` must match `packageVersionId` when both are present; `installOrder` can only reference contained package versions or embedded definition ids.

```ts
BundleCompositionItem {
  kind: "app" | "workflow" | "skill" | "command_tool_pack" | ...;
  packageVersionId?: string;
  versionRange?: string;
  embeddedDefinitionId?: string;
  defaultInstallMode: "pinned" | "copied" | "forked" | "subscribed";
  updatePolicy: "manual" | "notify" | "auto_patch";
  required: boolean;
  permissions: PermissionGrant[];
  readiness: ReadinessLabel;
}
```

## Command-backed app invariant

`CommandBackedAppDefinition` makes JSON-render apps stateful without a new runtime engine.

Allowed renderer actions:

- state updates;
- command preview requests;
- approval requests;
- navigation/event emissions.

Forbidden renderer actions:

- raw command commits;
- trusted approval grants;
- secret-bearing payloads.

Write/destructive/external commands require `preview_then_trusted_approval`, trusted host context, and a same-command preview path before any commit binding or mutating workflow node can validate.

## Endpoint map v0

These are contract shapes, not production ORPC implementation in this pass.

| Endpoint | Request | Response | Execution | Readiness |
| --- | --- | --- | --- | --- |
| `marketplace.searchPackages` | query, kind filters, scope | package summaries | read | planned |
| `marketplace.getPackage` | packageId | package + current version summary | read | planned |
| `marketplace.getPackageVersion` | packageVersionId | immutable version + manifest | read | planned |
| `marketplace.getInstallPreview` | packageVersionId, scope, installMode | dependency/permission/host requirement preview | preview | planned |
| `marketplace.validateManifest` | manifest envelope | validation result + migration/proof warnings | preview | planned |
| `marketplace.installPackage` | packageVersionId, installMode, permissions | installation receipt | trusted_write | planned |
| `marketplace.updateInstallation` | installationId, targetPackageVersionId | update preview/receipt | trusted_write | planned |
| `workflow.previewRun` | workflow packageVersionId or installed workflow id | non-mutating node preview | preview | planned |
| `workflow.requestApproval` | preview id + reason | approval card/request state | preview | planned |
| `workflow.runApproved` | approval id | command receipts | trusted_write | planned |

## Example fixtures

Defined in `packages/tool-contracts/src/marketplace-fixtures.ts`:

- standalone app: `restaurantSetupAppManifest`;
- standalone workflow: `bookingReservationWorkflowManifest`;
- solution bundle: `restaurantSetupBundleManifest`;
- Amplify bundle: `amplifyCampaignWizardManifest`;
- update fixture: `restaurantSetupPackage.currentVersionId` differs from `copiedRestaurantSetupInstallation.installedVersionId`.

## External model review gates

### amp.pkg gate

Copied/adapted:

- one package envelope with explicit kind and runtime posture;
- bundle as composition, not sole ontology;
- installation as org/workspace-specific configured instance;
- policy/approval/proof as part of package projection.

Rejected/deferred:

- full provider integration authoring in marketplace v0;
- production registry/runtime ownership in this contract-only pass.

### Dify gate

Local recon sources:

- `/Users/danielletterio/Documents/Sonik_Amplify/recon-mission-2026-05-06/01-per-repo/06-dify.md`
- `/Users/danielletterio/Documents/Sonik_Amplify/recon-mission-2026-05-06/summit-corpus/06-dify/`

Dify copy/adapt:

- app/workflow/tool/plugin separation;
- typed node definitions;
- frontend/backend definition split;
- human input/tool workflows;
- plugin marketplace review posture.

Dify reject/defer:

- plugin runtime execution model;
- separate plugin architecture competing with package envelope.

Current docs check: Dify marketplace publishing uses pre-submission/review checks and plugin marketplace release flow; tool plugins bundle provider + tools as a project. See Dify docs: https://docs.dify.ai/en/develop-plugin/publishing/marketplace-listing/release-to-dify-marketplace and https://docs.dify.ai/en/develop-plugin/dev-guides-and-walkthroughs/tool-plugin.

### n8n gate

Local recon sources:

- `/Users/danielletterio/Documents/Sonik_Amplify/recon-mission-2026-05-06/01-per-repo/05-n8n.md`
- `/Users/danielletterio/Documents/Sonik_Amplify/recon-mission-2026-05-06/summit-corpus/05-n8n/`

n8n copy/adapt:

- workflow-as-data portability;
- JSON import/export as a community distribution moat;
- node descriptions + typed parameters;
- sanitized credential refs;
- version/history as first-class concepts.

n8n reject/defer:

- workflow-only marketplace ontology;
- exposing credentials/secrets in package manifests;
- flat node template model as Sonik root contract.

Current docs check: n8n stores workflows as JSON and exported workflow JSON includes credential names/IDs but not secret values; credentials may still leak through names. See n8n docs: https://docs.n8n.io/build/manage-workflows/export-and-import.

### Apps SDK / component bridge gate

Copied/adapted:

- split model-visible structured content from component/private metadata;
- approval-gated tools can mount UI before final input;
- UI component output is a projection of structured tool/app state.

Rejected/deferred:

- direct UI-to-tool execution from renderer-only JSON.

Current docs check: OpenAI Apps SDK describes tool results with `structuredContent`, `content`, and `_meta`, and UI bridge notifications for tool input/result. See https://developers.openai.com/apps-sdk/reference.
