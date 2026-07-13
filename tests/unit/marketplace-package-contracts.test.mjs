import assert from "node:assert/strict";
import {
  agentDefinitionSchema,
  commandBackedAppDefinitionSchema,
  isUpdateAvailable,
  marketplaceInstallationSchema,
  marketplaceManifestSchema,
  marketplacePackageSchema,
  marketplacePackageVersionSchema,
  normalizeMarketplacePackageKind,
  parseMarketplaceManifest,
  upgradeMarketplaceManifest,
} from "../../packages/tool-contracts/dist/marketplace.js";
import {
  amplifyCampaignWizardManifest,
  bookingReservationWorkflowManifest,
  copiedRestaurantSetupInstallation,
  marketplaceFixtureManifests,
  restaurantSetupAppManifest,
  restaurantSetupBundleManifest,
  restaurantSetupPackage,
  restaurantSetupPackageVersion,
} from "../../packages/tool-contracts/dist/marketplace-fixtures.js";

assert.equal(normalizeMarketplacePackageKind("tool_pack"), "command_tool_pack", "legacy tool_pack normalizes to command_tool_pack");
assert.equal(normalizeMarketplacePackageKind("workflow_template"), "workflow", "legacy workflow_template normalizes to workflow");

// Phase 1 (agent-creation-tool-plan-2026-07-13.md): agentDefinitionSchema's
// additive extensions (promptModules, knowledgeRefs, modelPolicy) must not
// break a pre-existing minimal agent definition — every new field defaults.
assert.equal(agentDefinitionSchema.safeParse({ agentId: "sonik.agent.legacy", title: "Legacy Agent" }).success, true, "pre-existing minimal agent definitions still parse after the additive extension");

for (const manifest of marketplaceFixtureManifests) {
  assert.equal(marketplaceManifestSchema.safeParse(manifest).success, true, `${manifest.packageId} validates`);
  assert.equal(manifest.marketplaceSchemaVersion, "1");
  assert.equal(manifest.packageVersionId.startsWith(`${manifest.packageId}@`), true, "package version id is immutable and package-scoped");
}

assert.equal(restaurantSetupAppManifest.kind, "app", "standalone app package is first class, not forced into bundle");
assert.ok(restaurantSetupAppManifest.payload.app, "app package carries app payload");
assert.equal(bookingReservationWorkflowManifest.kind, "workflow", "standalone workflow package is first class, not forced into bundle");
assert.ok(bookingReservationWorkflowManifest.payload.workflow, "workflow package carries workflow payload");
assert.equal(restaurantSetupBundleManifest.kind, "bundle");
assert.ok(restaurantSetupBundleManifest.bundle.contains.some((item) => item.kind === "app" && item.defaultInstallMode === "copied"), "bundle composes app package with copy install semantics");
assert.ok(restaurantSetupBundleManifest.bundle.contains.some((item) => item.kind === "command_tool_pack" && item.permissions.some((permission) => permission.mode === "ask")), "bundle carries command pack permissions");
assert.equal(amplifyCampaignWizardManifest.bundle.contains.some((item) => item.kind === "skill"), true, "Amplify bundle includes skill dependency");

const app = restaurantSetupAppManifest.payload.app;
assert.ok(app.commandBindings.some((binding) => binding.mode === "preview" && binding.commandId === "booking.create.context"), "app exposes command preview binding");
assert.ok(app.commandBindings.some((binding) => binding.mode === "commit" && binding.approvalPolicy === "preview_then_trusted_approval"), "app commit binding is trusted approval gated");
assert.equal(app.actions.some((action) => action.kind === "command_binding_ref"), false, "renderer actions never bind directly to executable command bindings");
assert.equal(app.htmlPresentation.enabled, true, "HTML can exist as escape hatch");
assert.ok(app.htmlPresentation.canonicalJsonStateRef, "HTML escape hatch carries canonical JSON state boundary");

assert.throws(() => commandBackedAppDefinitionSchema.parse({
  appId: "bad-app",
  title: "Bad app",
  jsonRender: { componentRegistryRef: "registry", stateSchemaRef: "schema" },
  actions: [{ actionId: "run", label: "Run", kind: "command_binding_ref", bindingId: "commit" }],
  commandBindings: [{ bindingId: "commit", commandId: "booking.create.context", mode: "commit", effect: "write", approvalPolicy: "preview_then_trusted_approval" }],
}), /Renderer actions must request preview\/approval/, "renderer direct command action is rejected");
assert.throws(() => commandBackedAppDefinitionSchema.parse({
  appId: "bad-preview-app",
  title: "Bad preview app",
  jsonRender: { componentRegistryRef: "registry", stateSchemaRef: "schema" },
  actions: [{ actionId: "preview", label: "Preview", kind: "command_preview_request", bindingId: "commit" }],
  commandBindings: [{ bindingId: "commit", commandId: "booking.create.context", mode: "commit", effect: "write", approvalPolicy: "preview_then_trusted_approval" }],
}), /preview bindings/, "preview actions cannot target commit bindings");
assert.throws(() => commandBackedAppDefinitionSchema.parse({
  appId: "bad-approval-app",
  title: "Bad approval app",
  jsonRender: { componentRegistryRef: "registry", stateSchemaRef: "schema" },
  actions: [{ actionId: "approve", label: "Approve", kind: "approval_request", bindingId: "preview" }],
  commandBindings: [{ bindingId: "preview", commandId: "booking.create.context", mode: "preview", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] }],
}), /Approval actions may only target commit bindings/, "approval actions cannot target preview bindings");
assert.throws(() => commandBackedAppDefinitionSchema.parse({
  appId: "bad-host-context-app",
  title: "Bad host context app",
  jsonRender: { componentRegistryRef: "registry", stateSchemaRef: "schema" },
  actions: [],
  commandBindings: [{ bindingId: "preview", commandId: "booking.create.context", mode: "preview", effect: "write", approvalPolicy: "preview_then_trusted_approval" }],
}), /trusted host context/, "write command bindings require trusted host context");
assert.throws(() => commandBackedAppDefinitionSchema.parse({
  appId: "bad-commit-only-app",
  title: "Bad commit-only app",
  jsonRender: { componentRegistryRef: "registry", stateSchemaRef: "schema" },
  actions: [{ actionId: "approve", label: "Approve", kind: "approval_request", bindingId: "commit" }],
  commandBindings: [{ bindingId: "commit", commandId: "booking.create.context", mode: "commit", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] }],
}), /same-command preview binding/, "commit bindings require a preview binding for the same command");

assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  payload: { app: { ...restaurantSetupAppManifest.payload.app, htmlPresentation: { enabled: true, sandbox: "iframe" } } },
}), /canonical JSON state boundary/, "HTML escape hatch cannot omit canonical JSON boundary");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  payload: { app: { ...restaurantSetupAppManifest.payload.app, htmlPresentation: { enabled: true, sandbox: "shadow_dom", canonicalJsonStateRef: "schema" } } },
}), /iframe sandbox/, "enabled HTML escape hatch must use iframe sandbox");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  packageId: "sonik.bad.artifact",
  packageVersionId: "sonik.bad.artifact@0.1.0",
  kind: "artifact_template",
  payload: { artifactTemplate: { artifactTemplateId: "bad-html", title: "Bad HTML", mode: "html_escape_hatch", htmlPresentation: { enabled: false, sandbox: "iframe" } } },
}), /HTML artifact templates require/, "HTML artifact template mode must keep the sandboxed JSON-state boundary enabled");

assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  permissions: [{ targetId: "booking.create.context", targetKind: "command", mode: "allow", effect: "write", approvalPolicy: "preview" }],
}), /preview_then_trusted_approval/, "write permissions cannot be active without trusted approval");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  permissions: [{ targetId: "booking.create.context", targetKind: "command", mode: "ask", effect: "write", approvalPolicy: "none" }],
}), /preview_then_trusted_approval/, "write ask permissions still require trusted approval policy");

assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  payload: { apiToken: "secret" },
}), /Unrecognized key/, "marketplace manifests reject untyped payload extension fields");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  apiToken: "secret",
}), /Unrecognized key/, "marketplace manifests reject untyped top-level extension fields");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  payload: { credentials: { value: "sk-live-example" } },
}), /Unrecognized key/, "marketplace manifests reject credential-shaped extension fields");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  payload: { innocuousName: "sk-live-example123456" },
}), /Unrecognized key/, "marketplace manifests reject untyped payload fields before value inspection");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  payload: { innocuousName: "ghp_abcdefghijklmnopqrstuvwxyz123456" },
}), /Unrecognized key/, "marketplace manifests reject untyped payload fields before GitHub-token inspection");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  payload: { innocuousName: "AKIAIOSFODNN7EXAMPLE" },
}), /Unrecognized key/, "marketplace manifests reject untyped payload fields before AWS-key inspection");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  payload: { innocuousName: "-----BEGIN PRIVATE KEY----- abc -----END PRIVATE KEY-----" },
}), /Unrecognized key/, "marketplace manifests reject untyped payload fields before private-key inspection");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  payload: { executableCode: "console.log('not allowed')" },
}), /Unrecognized key/, "marketplace manifests reject executable code extension fields");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  payload: { script: "console.log('not allowed')" },
}), /Unrecognized key/, "marketplace manifests reject script extension fields");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  payload: { innocuousName: "function run(){ return fetch('https://example.com') }" },
}), /Unrecognized key/, "marketplace manifests reject untyped payload fields before executable-code value inspection");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  payload: { app: { ...restaurantSetupAppManifest.payload.app, apiToken: "secret" } },
}), /Unrecognized key/, "typed app payloads reject nested extension fields");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  payload: { app: { ...restaurantSetupAppManifest.payload.app, jsonRender: { ...restaurantSetupAppManifest.payload.app.jsonRender, script: "console.log('not allowed')" } } },
}), /Unrecognized key/, "typed app jsonRender contracts reject nested executable extension fields");
assert.throws(() => marketplaceManifestSchema.parse({
  ...bookingReservationWorkflowManifest,
  payload: { workflow: { ...bookingReservationWorkflowManifest.payload.workflow, nodes: [{ ...bookingReservationWorkflowManifest.payload.workflow.nodes[0], script: "console.log('not allowed')" }] } },
}), /Unrecognized key/, "workflow nodes reject nested executable extension fields");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  bundle: { ...restaurantSetupBundleManifest.bundle, script: "console.log('not allowed')" },
}), /Unrecognized key/, "bundle manifests reject nested executable extension fields");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  bundle: { ...restaurantSetupBundleManifest.bundle, contains: [{ ...restaurantSetupBundleManifest.bundle.contains[0], apiToken: "secret" }] },
}), /Unrecognized key/, "bundle composition items reject nested credential extension fields");

assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  packageId: "sonik.provider.restaurant.pos",
  packageVersionId: "sonik.provider.restaurant.pos@0.1.0",
  kind: "provider_integration",
  payload: {},
}), /providerIntegration payload/, "provider integrations require typed providerIntegration payload");
assert.throws(() => marketplaceManifestSchema.parse({
  marketplaceSchemaVersion: "1",
  packageId: "sonik.bad.commands",
  packageVersionId: "sonik.bad.commands@0.1.0",
  packageSemver: "0.1.0",
  kind: "command_tool_pack",
  title: "Bad commands",
  publisher: { publisherId: "sonik.first_party", displayName: "Sonik", type: "sonik" },
  manifestHash: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
  payload: {
    commandToolPack: {
      toolPackId: "bad-commands",
      title: "Bad commands",
      commandIds: ["booking.create.context"],
      commandBindings: [{ bindingId: "commit", commandId: "booking.create.context", mode: "commit", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] }],
    },
  },
}), /same-command preview binding/, "command tool pack commit bindings require a preview binding for the same command");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  payload: {
    ...restaurantSetupAppManifest.payload,
    workflow: {
      workflowId: "wrong-kind-workflow",
      title: "Wrong kind workflow",
      nodes: [{ nodeId: "trigger", type: "trigger", title: "Trigger" }],
      version: "0.1.0",
    },
  },
}), /cannot include workflow payload/, "package kind can only include its matching typed payload");
assert.throws(() => marketplaceManifestSchema.parse({
  ...bookingReservationWorkflowManifest,
  payload: { workflow: { ...bookingReservationWorkflowManifest.payload.workflow, nodes: [{ nodeId: "unsafe", type: "remote_execution", title: "Unsafe write", commandId: "booking.create.context", effect: "write", approvalPolicy: "none" }] } },
}), /workflow nodes require/, "write workflow nodes require trusted approval even outside tool_commit type");
assert.throws(() => marketplaceManifestSchema.parse({
  ...bookingReservationWorkflowManifest,
  payload: { workflow: { ...bookingReservationWorkflowManifest.payload.workflow, nodes: [{ nodeId: "commit-only", type: "tool_commit", title: "Commit only", commandId: "booking.create.booking", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] }], edges: [] } },
}), /same-command preview node/, "workflow commit nodes require a preview node for the same command");
assert.throws(() => marketplaceManifestSchema.parse({
  ...bookingReservationWorkflowManifest,
  payload: {
    workflow: {
      ...bookingReservationWorkflowManifest.payload.workflow,
      edges: [{ edgeId: "dangling", from: "trigger", to: "missing-node" }],
    },
  },
}), /Workflow edge to must reference an existing nodeId/, "workflow edges must reference declared nodes");
assert.throws(() => marketplaceManifestSchema.parse({
  ...bookingReservationWorkflowManifest,
  payload: {
    workflow: {
      ...bookingReservationWorkflowManifest.payload.workflow,
      nodes: [
        { nodeId: "duplicate", type: "trigger", title: "Trigger" },
        { nodeId: "duplicate", type: "ask_user", title: "Ask" },
      ],
    },
  },
}), /Workflow nodeIds must be unique/, "workflow node ids must be unique");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  bundle: { ...restaurantSetupBundleManifest.bundle, installOrder: ["sonik.unknown.package@0.1.0"] },
}), /installOrder entries must reference/, "bundle installOrder cannot reference packages outside contains");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  bundle: { ...restaurantSetupBundleManifest.bundle, installOrder: [restaurantSetupBundleManifest.bundle.contains[0].packageVersionId, restaurantSetupBundleManifest.bundle.contains[0].packageVersionId] },
}), /installOrder entries must be unique/, "bundle installOrder cannot duplicate entries");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  bundle: { ...restaurantSetupBundleManifest.bundle, contains: [restaurantSetupBundleManifest.bundle.contains[0], { ...restaurantSetupBundleManifest.bundle.contains[0], permissions: [] }] },
}), /contains entries must reference unique/, "bundle contains cannot duplicate package versions or embedded definition ids");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  bundle: { ...restaurantSetupBundleManifest.bundle, contains: [{ ...restaurantSetupBundleManifest.bundle.contains[0], packageRef: "sonik.other.package" }] },
}), /packageRef must match/, "bundle packageRef must match exact packageVersionId");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  bundle: { ...restaurantSetupBundleManifest.bundle, contains: [{ kind: "app", packageRef: "sonik.restaurant.setup.app", packageVersionId: "sonik.restaurant.setup.app@0.1.0", versionRange: "^0.1.0" }] },
}), /exactly one/, "bundle entries cannot mix exact versions and version ranges");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  bundle: { ...restaurantSetupBundleManifest.bundle, contains: [{ kind: "app", packageRef: "sonik.restaurant.setup.app", versionRange: "^0.1.0", defaultInstallMode: "subscribed", updatePolicy: "auto_patch", permissions: [{ targetId: "booking.create.context", targetKind: "command", mode: "ask", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] }] }] },
}), /read-only permissions/, "subscribed or auto-patch bundle entries cannot carry write permissions");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  bundle: { ...restaurantSetupBundleManifest.bundle, contains: [{ kind: "app", packageRef: "sonik.restaurant.setup.app", versionRange: "^0.1.0", defaultInstallMode: "subscribed", updatePolicy: "auto_patch", permissions: [] }] },
}), /explicit read-only permissions/, "subscribed or auto-patch bundle entries need explicit permissions");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupBundleManifest,
  bundle: {
    bundleId: "bad-embedded-kind",
    contains: [{ kind: "app", embeddedDefinitionId: "booking.reservation.create", defaultInstallMode: "pinned", updatePolicy: "manual" }],
    embeddedDefinitions: {
      workflow: { workflowId: "booking.reservation.create", title: "Create reservation", version: "0.1.0", nodes: [{ nodeId: "trigger", type: "trigger", title: "Trigger" }] },
    },
    installOrder: ["booking.reservation.create"],
  },
}), /kind must match/, "bundle embeddedDefinitionId must resolve to the same package kind as the composition item");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  installedConfig: { values: { apiToken: "secret" } },
}), /installations must not embed secrets/, "installation config/state cannot embed secret-like fields");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  installedConfig: { values: { innocuousName: "sk-live-example123456" } },
}), /installations must not embed secrets/, "installation config/state cannot embed secret-like string values");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  installedConfig: { values: { innocuousName: "ghp_abcdefghijklmnopqrstuvwxyz123456" } },
}), /installations must not embed secrets/, "installation config/state cannot embed GitHub-token-like string values");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  installedConfig: { values: { innocuousName: "AKIAIOSFODNN7EXAMPLE" } },
}), /installations must not embed secrets/, "installation config/state cannot embed AWS-key-like string values");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  installedConfig: { values: { innocuousName: "-----BEGIN PRIVATE KEY----- abc -----END PRIVATE KEY-----" } },
}), /installations must not embed secrets/, "installation config/state cannot embed private-key-like string values");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  installedState: { draft: { runtimeCode: "console.log('not allowed')" } },
}), /installations must not embed executable source code/, "installation config/state cannot embed executable source fields");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  installedState: { draft: { innocuousName: "function run(){ return fetch('https://example.com') }" } },
}), /installations must not embed executable source code/, "installation config/state cannot embed executable-code-like string values");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  installedConfig: { arbitraryUnknownPassthrough: "accepted" },
}), /Unrecognized key/, "installation config rejects unknown top-level passthrough keys");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  installedState: { arbitraryUnknownPassthrough: "accepted" },
}), /Unrecognized key/, "installation state rejects unknown top-level passthrough keys");
assert.equal(marketplaceInstallationSchema.safeParse({
  ...copiedRestaurantSetupInstallation,
  installedConfig: { title: "Dan's Club Setup", values: { theme: "sonik-operator-dark" }, featureFlags: { demo: true } },
  installedState: { status: "draft", manifest: { status: "draft" }, answers: { q1: "venue_schedule" } },
}).success, true, "installation config/state allow named deterministic extension slots");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  sourcePackageVersionId: "sonik.other.package@0.1.0",
}), /same package lineage/, "copied or forked installation provenance must point to the same package lineage");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  installMode: "subscribed",
  updatePolicy: "auto_patch",
  permissions: [{ targetId: "booking.create.context", targetKind: "command", mode: "ask", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] }],
}), /explicit read-only permissions/, "subscribed or auto-patch installations cannot carry write permissions");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  runtimeCapabilities: { ...restaurantSetupAppManifest.runtimeCapabilities, jsonRenderCanonical: false },
}), /canonical JSON-render/, "app packages cannot disable canonical JSON-render state");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  manifestHash: "sha256:aaaaaaaaaaaaaaaa",
}), /64 hex/, "manifest hashes require full sha256 length");

assert.equal(marketplaceManifestSchema.safeParse({
  ...restaurantSetupAppManifest,
  packageId: "sonik.provider.restaurant.pos",
  packageVersionId: "sonik.provider.restaurant.pos@0.1.0",
  kind: "provider_integration",
  runtimeMode: "adapter",
  runtimeEffects: ["none"],
  payload: { providerIntegration: { providerIntegrationId: "restaurant-pos", title: "Restaurant POS", providerKey: "restaurant_pos", credentialRefKind: "host_managed", supportedOperations: ["sync_menus"] } },
}).success, true, "provider integrations carry typed providerIntegration payload");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  runtimeMode: "managed_code",
}), /managed_code runtime mode is reserved/, "managed_code runtime is not available to normal marketplace packages in v0");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  runtimeCapabilities: { ...restaurantSetupAppManifest.runtimeCapabilities, sandboxRuntime: true },
}), /sandboxRuntime capability is reserved/, "sandbox runtime is reserved for managed internal packages in v0");

assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  runtimeEffects: ["record_write"],
  runtimeCapabilities: { ...restaurantSetupAppManifest.runtimeCapabilities, requiresHostContext: false, requiresTrustedApproval: false },
}), /Runtime write\/external effects require trusted approval/, "manifest-level runtime write effects require trusted approval and host context");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  runtimeEffects: ["external_call"],
  runtimeCapabilities: { ...restaurantSetupAppManifest.runtimeCapabilities, requiresHostContext: false, requiresTrustedApproval: true },
}), /Runtime write\/external effects require trusted host context/, "manifest-level runtime external effects require trusted host context");
assert.equal(marketplaceManifestSchema.safeParse({
  ...restaurantSetupAppManifest,
  runtimeEffects: ["record_write"],
  runtimeCapabilities: { ...restaurantSetupAppManifest.runtimeCapabilities, requiresHostContext: true, requiresTrustedApproval: true },
}).success, true, "manifest-level runtime write effects pass with trusted approval and host context");

const legacyToolPackManifest = {
  marketplaceSchemaVersion: "1",
  packageId: "sonik.booking.context.commands",
  packageVersionId: "sonik.booking.context.commands@0.1.0",
  packageSemver: "0.1.0",
  kind: "tool_pack",
  title: "Booking context commands",
  publisher: { publisherId: "sonik.first_party", displayName: "Sonik", type: "sonik" },
  manifestHash: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
  payload: {
    tool_pack: {
      toolPackId: "booking-context-commands",
      title: "Booking context commands",
      commandIds: ["booking.create.context"],
      defaultPermissions: { "booking.create.context": "ask" },
      commandBindings: [{ bindingId: "preview", commandId: "booking.create.context", mode: "preview", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] }],
      readiness: "FIXTURE",
    },
  },
};
const normalizedLegacy = parseMarketplaceManifest(legacyToolPackManifest);
assert.equal(normalizedLegacy.kind, "command_tool_pack");
assert.ok(normalizedLegacy.payload.commandToolPack, "tool_pack alias normalizes into commandToolPack payload");

assert.equal(marketplacePackageSchema.safeParse(restaurantSetupPackage).success, true, "package summary validates");
assert.equal(marketplacePackageVersionSchema.safeParse(restaurantSetupPackageVersion).success, true, "immutable package version validates");
assert.throws(() => marketplaceManifestSchema.parse({
  ...restaurantSetupAppManifest,
  packageVersionId: "sonik.restaurant.setup.app@0.2.0",
  packageSemver: "0.1.0",
}), /packageSemver must match/, "manifest semver must match packageVersionId semver");
assert.throws(() => marketplacePackageVersionSchema.parse({
  ...restaurantSetupPackageVersion,
  packageSemver: "9.9.9",
  manifest: { ...restaurantSetupPackageVersion.manifest, packageSemver: "9.9.9" },
}), /Version semver must match/, "version envelope semver must match packageVersionId semver");
assert.throws(() => marketplacePackageVersionSchema.parse({
  ...restaurantSetupPackageVersion,
  manifestHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
}), /manifestHash must match/, "package version hash matches manifest hash when manifest carries one");
assert.equal(marketplaceInstallationSchema.safeParse(copiedRestaurantSetupInstallation).success, true, "copied installation preserves provenance");
assert.equal(isUpdateAvailable({ pkg: restaurantSetupPackage, installation: copiedRestaurantSetupInstallation }), true, "currentVersionId differing from installedVersionId flags update availability");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  installedVersionId: "latest",
}), /Expected <packageId>@<semver>|immutable version/, "installations must target immutable package version ids");
assert.throws(() => marketplaceInstallationSchema.parse({
  ...copiedRestaurantSetupInstallation,
  installMode: "forked",
  sourcePackageVersionId: undefined,
}), /source provenance/, "copied/forked installs preserve source provenance");

const upgrade = upgradeMarketplaceManifest(restaurantSetupAppManifest);
assert.equal(upgrade.ok, true, "v1 manifests upgrade through identity upgrader seam");
assert.equal(upgrade.ok && upgrade.upgradedSchemaVersion, "1");
const unsupportedUpgrade = upgradeMarketplaceManifest({ marketplaceSchemaVersion: "2", kind: "app" });
assert.equal(unsupportedUpgrade.ok, false, "unknown future schema fails safe");
assert.equal(unsupportedUpgrade.requiresReview, true, "unknown future schema requires review");

console.log("marketplace package contract tests passed");
