# Marketplace + ORPC Planning Notes

Status: **contract-only v0 planning handoff**  
Canonical contract source: `packages/tool-contracts/src/marketplace.ts`  
Contract docs: `docs/contracts/marketplace-package-contracts-v0.md`

## Canonical model

Agents and users should be able to search, preview, install, configure, run, share, and eventually publish agents/apps/workflows/skills/tool packs through a **single package/version/install contract**.

Canonical installable envelope:

```ts
MarketplacePackage          // mutable summary/index record
MarketplacePackageVersion   // immutable version users install by packageVersionId
MarketplaceManifest         // typed manifest embedded in a package version
MarketplaceInstallation     // org/workspace/user installed instance
BundleManifest              // composition payload when manifest.kind === "bundle"
```

Canonical package kinds:

```txt
bundle
app
workflow
skill
command_tool_pack
agent
artifact_template
mcp_addon
provider_integration
managed_internal
```

Compatibility aliases are input-only and must normalize before persistence or display in agent-facing contracts:

```txt
agent_template   -> agent
app_template     -> app
workflow_template -> workflow
skill_template   -> skill
tool_pack        -> command_tool_pack
```

Design implication: UI cards can say “App”, “Workflow”, “Skill”, or “Bundle”, but every install/preview/update screen must expose the underlying immutable `packageVersionId`, install mode, update policy, permission grants, trusted approval requirements, and host context requirements.

## Canonical ORPC endpoint map v0

These are **planned typed contract names only**. This pass does not implement production ORPC routes, persistence, publishing, runtime execution, or visual builders.

Read/search:

```txt
marketplace.searchPackages
marketplace.getPackage
marketplace.getPackageVersion
marketplace.listInstallations
marketplace.getInstallation
marketplace.getInstallPreview
marketplace.validateManifest
```

Install/manage:

```txt
marketplace.installPackage
marketplace.uninstallPackage
marketplace.updateInstallation
marketplace.setInstallationPermissionPolicy
marketplace.pinInstallationVersion
marketplace.copyInstallation
marketplace.forkInstallation
```

Workflow/app preview and approval seams:

```txt
workflow.previewRun
workflow.requestApproval
workflow.runApproved
app.previewCommandBinding
app.requestCommandApproval
app.applyStatePatch
```

Endpoint invariants:

- install/update inputs target `packageVersionId` or `installationId`, never a mutable marketplace item id alone;
- write execution is split into preview → trusted approval → receipt;
- renderer-originated JSON-render actions can request preview/approval but cannot directly execute commands;
- command writes require host context and command receipts;
- install previews must show package dependencies, requested permissions, update policy, and whether the package is copied/forked/pinned/subscribed.

## Canonical shape sketches

### Package summary/index projection

```ts
interface MarketplacePackageSummary {
  packageId: string;
  currentVersionId: string;
  kind:
    | "bundle"
    | "app"
    | "workflow"
    | "skill"
    | "command_tool_pack"
    | "agent"
    | "artifact_template"
    | "mcp_addon"
    | "provider_integration"
    | "managed_internal";
  title: string;
  summary: string;
  publisher: { publisherId: string; displayName: string; type: string };
  visibility: "private" | "organization" | "public" | "marketplace" | "managed_internal";
  tags: string[];
}
```

### Immutable package version

```ts
interface MarketplacePackageVersion {
  packageVersionId: `${string}@${string}`;
  packageId: string;
  packageSemver: string;
  marketplaceSchemaVersion: "1";
  manifestHash: `sha256:${string}`;
  manifest: MarketplaceManifest;
  changelog: string;
  createdAt?: string;
}
```

### Installation

```ts
interface MarketplaceInstallation {
  installationId: string;
  organizationId: string;
  workspaceId?: string;
  packageId: string;
  installedVersionId: `${string}@${string}`;
  installedSchemaVersion: "1";
  installMode: "pinned" | "copied" | "forked" | "subscribed";
  updatePolicy: "manual" | "notify" | "auto_patch";
  sourcePackageVersionId?: `${string}@${string}`;
  installedConfig: MarketplaceInstalledConfig;
  installedState: MarketplaceInstalledState;
  permissions: PermissionGrant[];
  installedBy: string;
  installedAt: string;
}
```

Installation config/state are strict envelopes. Top-level arbitrary passthrough is rejected; deterministic extension lives under named slots such as `values`, `manifest`, `draft`, `answers`, `review`, and `receipts`, with recursive secret/code scanning.

### Bundle manifest

```ts
interface BundleManifest {
  bundleId: string;
  contains: BundleCompositionItem[];
  embeddedDefinitions?: {
    app?: CommandBackedAppDefinition;
    workflow?: WorkflowDefinition;
    skill?: SkillDefinitionRef;
    commandToolPack?: CommandToolPackDefinition;
    agent?: AgentDefinition;
    artifactTemplate?: ArtifactTemplateDefinition;
    mcpAddon?: McpAddonDefinition;
    providerIntegration?: ProviderIntegrationDefinition;
  };
  installOrder?: string[];
}
```

Bundle rules:

- bundle is a package kind, not the only marketplace object;
- apps/workflows/skills/tool packs/agents/templates/MCP add-ons/provider integrations remain individually installable;
- `contains[]` selectors are mutually exclusive among `packageVersionId`, `versionRange`, and `embeddedDefinitionId`;
- `packageRef` must match the package id inside `packageVersionId` when both are present;
- `installOrder` can reference only contained package versions or embedded definition ids and cannot duplicate refs;
- embedded definition kind must match its composition item kind;
- subscribed/auto_patch entries are read-only/low-risk in v0.

## Command-backed app contract

A command-backed app is a JSON-render artifact plus typed command bindings. It is how Sonik creates stateful mini-apps without a new runtime engine.

Required safety model:

- JSON-render state is canonical;
- HTML is only an iframe sandbox escape hatch with a canonical JSON state boundary;
- state updates are local draft patches;
- preview actions can target preview bindings only;
- approval actions can target commit bindings only;
- commit bindings require same-command preview bindings;
- write/destructive/external commands require `preview_then_trusted_approval`, trusted host context, and receipts;
- user input and renderer clicks are never trusted approval grants by themselves.

## Follow-on / explicitly out of scope for this contract pass

These are important later, but **not implementation scope here**:

Author/publish lifecycle:

```txt
marketplace.createDraft
marketplace.updateDraft
marketplace.validateDraft
marketplace.submitForReview
marketplace.publish
marketplace.deprecate
```

Runtime execution/platform hosting:

```txt
workflow.executionHistory
workflow.cancelRun
workflow.retryRun
app.liveRuntimeSession
marketplace.creatorPayouts
marketplace.reviewQueue
```

Database/RLS, live install storage, deployment, visual workflow builder, creator marketplace payouts, and production integration authoring are follow-on plans.

## Sonik accessibility rules

- SDK consumers use public/client-safe/business-safe surfaces only.
- Do not expose service internals, database clients, generated private files, or secrets.
- Capability ids are registry-resolved and aliasable, not hardcoded enums in host apps.
- Use honest readiness labels: `EXISTS`, `FIXTURE`, `MISSING`, `CANDIDATE-GAP`, `FROZEN`, `UNDECIDED`.
- Non-event verticals anchor to `venue_schedule`/`resource`, not fake event rows.
- Writes require preview, trusted approval, and receipts.

## Agent UI rules

- Marketplace install pages expose machine-readable `getPageContext()` with package/version/install ids.
- Semantic actions include disabled reasons.
- Tool permission changes use normal UI handlers.
- JSON-render/ask-user-question surfaces do not call ORPC/command APIs directly.
- UltraTest must prove page context, visible UI, command receipts, and no secret leakage.

## Current implementation note

The v0 shared contract implementation lives in `packages/tool-contracts/src/marketplace.ts` and is exported through `@sonik-agent-ui/tool-contracts/marketplace`. Fixture manifests live in `packages/tool-contracts/src/marketplace-fixtures.ts`.

Existing app-local fixture files are seed evidence/projections only and are not canonical marketplace contract ownership:

- `apps/standalone-sveltekit/src/lib/agent-workflows/templates.ts`
- `apps/standalone-sveltekit/src/lib/tools/marketplace-workflows.ts`
- `tests/unit/marketplace-workflow-templates.test.mjs`
