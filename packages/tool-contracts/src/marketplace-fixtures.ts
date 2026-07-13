import type {
  MarketplaceInstallation,
  MarketplaceManifest,
  MarketplacePackage,
  MarketplacePackageVersion,
} from "./marketplace.js";
import {
  marketplaceInstallationSchema,
  marketplaceManifestSchema,
  marketplacePackageSchema,
  marketplacePackageVersionSchema,
} from "./marketplace.js";

const publisher = {
  publisherId: "sonik.first_party",
  displayName: "Sonik",
  type: "sonik" as const,
};

export const restaurantSetupAppManifest = marketplaceManifestSchema.parse({
  marketplaceSchemaVersion: "1",
  packageId: "sonik.restaurant.setup.app",
  packageVersionId: "sonik.restaurant.setup.app@0.1.0",
  packageSemver: "0.1.0",
  kind: "app",
  title: "Restaurant Setup App",
  summary: "JSON-render app for collecting restaurant venue schedule details and previewing booking context creation.",
  publisher,
  visibility: "marketplace",
  installScopes: ["organization", "workspace"],
  runtimeMode: "descriptor_only",
  runtimeEffects: ["frontend_projection", "host_command"],
  proofTier: "scaffolded",
  readiness: "FIXTURE",
  runtimeCapabilities: {
    jsonRenderCanonical: true,
    htmlEscapeHatch: true,
    sandboxRuntime: false,
    commandBackedComponents: true,
    requiresHostContext: true,
    requiresTrustedApproval: true,
  },
  manifestHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  permissions: [
    { targetId: "booking.create.context", targetKind: "command", mode: "ask", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"], reason: "Creates venue schedule after preview." },
  ],
  payload: {
    app: {
      appId: "restaurant-setup-app",
      title: "Restaurant Setup",
      description: "Collect schedule, table, menu, and policy requirements before creating a booking context.",
      jsonRender: {
        componentRegistryRef: "sonik.json-render.registry.v1",
        artifactTemplateRef: "restaurant-setup-intake-artifact@0.1.0",
        stateSchemaRef: "schemas/restaurant-setup-state.v1.json",
        initialState: { manifest: { type: "venue_schedule", status: "draft" } },
      },
      actions: [
        { actionId: "save_draft", label: "Save draft", kind: "state_update", writesTo: ["/manifest"] },
        { actionId: "request_preview", label: "Preview booking context", kind: "command_preview_request", bindingId: "preview_create_context" },
        { actionId: "request_approval", label: "Request approval", kind: "approval_request" },
      ],
      commandBindings: [
        { bindingId: "preview_create_context", commandId: "booking.create.context", mode: "preview", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"], receiptRef: "booking.context.preview.receipt" },
        { bindingId: "commit_create_context", commandId: "booking.create.context", mode: "commit", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"], receiptRef: "booking.context.created.receipt" },
      ],
      htmlPresentation: {
        enabled: true,
        sandbox: "iframe",
        canonicalJsonStateRef: "schemas/restaurant-setup-state.v1.json",
        allowedCapabilities: ["render", "export"],
      },
      requiredHostContext: ["organizationId", "principalId"],
      receipts: [{ receiptId: "booking.context.created.receipt", commandId: "booking.create.context", evidencePath: "receipts/booking-context-created" }],
    },
  },
});

export const bookingReservationWorkflowManifest = marketplaceManifestSchema.parse({
  marketplaceSchemaVersion: "1",
  packageId: "sonik.booking.reservation.workflow",
  packageVersionId: "sonik.booking.reservation.workflow@0.1.0",
  packageSemver: "0.1.0",
  kind: "workflow",
  title: "Booking Reservation Workflow",
  summary: "Canonical availability → guest → booking workflow with no hold creation.",
  publisher,
  visibility: "marketplace",
  runtimeMode: "workflow_graph",
  runtimeEffects: ["host_command"],
  proofTier: "mock-backed",
  readiness: "EXISTS",
  runtimeCapabilities: { jsonRenderCanonical: true, htmlEscapeHatch: false, sandboxRuntime: false, commandBackedComponents: false, requiresHostContext: true, requiresTrustedApproval: true },
  manifestHash: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
  payload: {
    workflow: {
      workflowId: "booking.reservation.create",
      title: "Create a reservation",
      triggerPhrases: ["create a reservation", "book a table", "book a tee time"],
      requiredSkills: ["booking.reservation.create"],
      requiredCommands: ["booking.get.availability", "booking.create.guest", "booking.create.booking"],
      // Phase 3a (consensus plan, 2026-07-10): ONE tool_preview node (previewBookingReservationCommand's
      // existing guest+booking preview semantics, unchanged) followed by ONE compound tool_commit node
      // wrapping the existing two-write commitBookingReservationCommand. The prior four-node split
      // (guest_preview/guest/booking_preview/booking) demanded two independent Approve interactions a
      // literal per-node walker would enforce -- but the shipped path runs both writes behind ONE human
      // Approve click. This shape matches that shipped behavior instead of regressing it.
      version: "0.1.0",
      nodes: [
        { nodeId: "trigger", type: "trigger", title: "Start from current booking context" },
        { nodeId: "availability", type: "tool_preview", title: "Check availability", commandId: "booking.get.availability", effect: "read", approvalPolicy: "none" },
        { nodeId: "reservation_preview", type: "tool_preview", title: "Preview reservation (guest + booking)", commandId: "booking.create.booking", effect: "none", approvalPolicy: "none" },
        { nodeId: "reservation_commit", type: "tool_commit", title: "Create guest and booking", commandId: "booking.create.booking", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] },
      ],
      edges: [
        { edgeId: "e1", from: "trigger", to: "availability" },
        { edgeId: "e2", from: "availability", to: "reservation_preview", condition: "capacity_available" },
        { edgeId: "e3", from: "reservation_preview", to: "reservation_commit" },
      ],
      // Model-facing facade (audit P0: pinned, <=5 tools, no toolset churn). Both tool_preview node
      // commandIds must be listed per the schema's facade superRefine. Approval/cancel stay host-side
      // click handlers, never model-callable tools (Open Question 1's default; command-catalog.ts's
      // draft-only invariant already enforces this at the tool layer).
      facadeToolIds: ["booking.get.availability", "booking.create.booking"],
    },
  },
});

export const amplifyCampaignWorkflowManifest = marketplaceManifestSchema.parse({
  marketplaceSchemaVersion: "1",
  packageId: "sonik.amplify.campaign.workflow",
  packageVersionId: "sonik.amplify.campaign.workflow@0.1.0",
  packageSemver: "0.1.0",
  kind: "workflow",
  title: "Create an Amplify campaign",
  summary: "Brief → generated campaign content preview → human approval → persisted campaign artifact. Phase 7 wow demo: the sole new live controller path (agent-creation-tool-plan-2026-07-13.md).",
  publisher,
  visibility: "marketplace",
  runtimeMode: "workflow_graph",
  runtimeEffects: ["host_command"],
  proofTier: "mock-backed",
  readiness: "EXISTS",
  runtimeCapabilities: { jsonRenderCanonical: true, htmlEscapeHatch: false, sandboxRuntime: false, commandBackedComponents: false, requiresHostContext: true, requiresTrustedApproval: true },
  manifestHash: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
  payload: {
    workflow: {
      workflowId: "amplify.campaign.create",
      title: "Create an Amplify campaign",
      triggerPhrases: ["create a campaign", "launch a campaign", "set up an amplify campaign"],
      requiredSkills: ["amplify.campaign.create"],
      requiredCommands: ["amplify.campaign.create"],
      // Decision 2 (agent-creation-tool-plan-2026-07-13.md): linear graph, no branch/artifact
      // node. The preview and commit nodes share commandId "amplify.campaign.create" (schema's
      // mutating-node-requires-same-command-preview-node rule) -- same shape as the reservation
      // fixture's compound node, generalized to a single write. An explicit approval node
      // precedes tool_commit (unlike the legacy reservation fixture) so this graph also passes
      // the drafting agent's validateDraftedWorkflow gate, proving a drafting-agent-producible
      // workflow runs end to end through the controller.
      version: "0.1.0",
      nodes: [
        { nodeId: "trigger", type: "trigger", title: "Start from a campaign request" },
        { nodeId: "brief", type: "ask_user", title: "Collect the campaign brief" },
        { nodeId: "preview", type: "tool_preview", title: "Generate campaign content preview", commandId: "amplify.campaign.create", effect: "none", approvalPolicy: "none" },
        { nodeId: "confirm", type: "approval", title: "Approve the campaign" },
        { nodeId: "commit", type: "tool_commit", title: "Publish the campaign artifact", commandId: "amplify.campaign.create", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] },
      ],
      edges: [
        { edgeId: "e1", from: "trigger", to: "brief" },
        { edgeId: "e2", from: "brief", to: "preview" },
        { edgeId: "e3", from: "preview", to: "confirm" },
        { edgeId: "e4", from: "confirm", to: "commit" },
      ],
      facadeToolIds: ["amplify.campaign.create"],
    },
  },
});

export const amplifyCampaignWizardManifest = marketplaceManifestSchema.parse({
  marketplaceSchemaVersion: "1",
  packageId: "sonik.amplify.campaign.wizard.bundle",
  packageVersionId: "sonik.amplify.campaign.wizard.bundle@0.1.0",
  packageSemver: "0.1.0",
  kind: "bundle",
  title: "Amplify Campaign Wizard Bundle",
  summary: "Campaign wizard app + workflow + skills + command permissions for Amplify campaign setup.",
  publisher,
  visibility: "marketplace",
  runtimeMode: "bundle_only",
  runtimeEffects: ["installs_dependencies", "configures_installation", "frontend_projection"],
  proofTier: "scaffolded",
  readiness: "FIXTURE",
  runtimeCapabilities: { jsonRenderCanonical: true, htmlEscapeHatch: true, sandboxRuntime: false, commandBackedComponents: true, requiresHostContext: true, requiresTrustedApproval: true },
  manifestHash: "sha256:3333333333333333333333333333333333333333333333333333333333333333",
  bundle: {
    bundleId: "amplify-campaign-wizard-bundle",
    contains: [
      { kind: "app", packageVersionId: "sonik.amplify.campaign.wizard.app@0.1.0", defaultInstallMode: "copied", updatePolicy: "notify", required: true, readiness: "FIXTURE" },
      { kind: "workflow", packageVersionId: "sonik.amplify.campaign.wizard.workflow@0.1.0", defaultInstallMode: "pinned", updatePolicy: "manual", required: true, readiness: "FIXTURE" },
      { kind: "skill", packageVersionId: "sonik.skill.amplify-campaign-template@0.1.0", defaultInstallMode: "pinned", updatePolicy: "notify", required: true, readiness: "EXISTS" },
      { kind: "command_tool_pack", packageVersionId: "sonik.amplify.campaign.commands@0.1.0", defaultInstallMode: "pinned", updatePolicy: "manual", required: true, readiness: "CANDIDATE-GAP", permissions: [{ targetId: "amplify.campaign.create", targetKind: "command", mode: "ask", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] }] },
    ],
    installOrder: ["sonik.skill.amplify-campaign-template@0.1.0", "sonik.amplify.campaign.commands@0.1.0", "sonik.amplify.campaign.wizard.workflow@0.1.0", "sonik.amplify.campaign.wizard.app@0.1.0"],
  },
});

export const restaurantSetupBundleManifest = marketplaceManifestSchema.parse({
  marketplaceSchemaVersion: "1",
  packageId: "sonik.restaurant.setup.bundle",
  packageVersionId: "sonik.restaurant.setup.bundle@0.1.0",
  packageSemver: "0.1.0",
  kind: "bundle",
  title: "Restaurant Setup Bundle",
  summary: "One-click solution bundle for restaurant venue setup: app, workflow, skill, artifact template, and booking commands.",
  publisher,
  visibility: "marketplace",
  runtimeMode: "bundle_only",
  runtimeEffects: ["installs_dependencies", "configures_installation", "frontend_projection"],
  proofTier: "mock-backed",
  readiness: "FIXTURE",
  runtimeCapabilities: { jsonRenderCanonical: true, htmlEscapeHatch: true, sandboxRuntime: false, commandBackedComponents: true, requiresHostContext: true, requiresTrustedApproval: true },
  manifestHash: "sha256:4444444444444444444444444444444444444444444444444444444444444444",
  bundle: {
    bundleId: "restaurant-setup-bundle",
    contains: [
      { kind: "app", packageVersionId: "sonik.restaurant.setup.app@0.1.0", defaultInstallMode: "copied", updatePolicy: "notify", required: true, readiness: "FIXTURE", permissions: [{ targetId: "booking.create.context", targetKind: "command", mode: "ask", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] }] },
      { kind: "workflow", packageVersionId: "sonik.booking.context.intake.workflow@0.1.0", defaultInstallMode: "pinned", updatePolicy: "manual", required: true, readiness: "EXISTS" },
      { kind: "skill", packageVersionId: "sonik.skill.booking-context-intake@0.1.0", defaultInstallMode: "pinned", updatePolicy: "notify", required: true, readiness: "EXISTS" },
      { kind: "command_tool_pack", packageVersionId: "sonik.booking.context.commands@0.1.0", defaultInstallMode: "pinned", updatePolicy: "manual", required: true, readiness: "FIXTURE", permissions: [{ targetId: "booking.create.context", targetKind: "command", mode: "ask", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] }] },
      { kind: "artifact_template", packageVersionId: "sonik.restaurant.setup.artifact@0.1.0", defaultInstallMode: "copied", updatePolicy: "notify", required: true, readiness: "FIXTURE" },
    ],
    installOrder: ["sonik.skill.booking-context-intake@0.1.0", "sonik.booking.context.commands@0.1.0", "sonik.booking.context.intake.workflow@0.1.0", "sonik.restaurant.setup.artifact@0.1.0", "sonik.restaurant.setup.app@0.1.0"],
  },
});

export const marketplaceFixtureManifests = [
  restaurantSetupAppManifest,
  bookingReservationWorkflowManifest,
  amplifyCampaignWorkflowManifest,
  restaurantSetupBundleManifest,
  amplifyCampaignWizardManifest,
] satisfies MarketplaceManifest[];

export const restaurantSetupPackage = marketplacePackageSchema.parse({
  packageId: "sonik.restaurant.setup.app",
  kind: "app",
  title: "Restaurant Setup App",
  summary: restaurantSetupAppManifest.summary,
  publisher,
  currentVersionId: "sonik.restaurant.setup.app@0.1.1",
  visibility: "marketplace",
  tags: ["booking", "restaurant", "setup"],
}) satisfies MarketplacePackage;

export const restaurantSetupPackageVersion = marketplacePackageVersionSchema.parse({
  packageVersionId: "sonik.restaurant.setup.app@0.1.0",
  packageId: "sonik.restaurant.setup.app",
  packageSemver: "0.1.0",
  marketplaceSchemaVersion: "1",
  manifestHash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  manifest: restaurantSetupAppManifest,
  changelog: "Initial restaurant setup app contract fixture.",
  createdAt: "2026-07-06T00:00:00.000Z",
}) satisfies MarketplacePackageVersion;

export const copiedRestaurantSetupInstallation = marketplaceInstallationSchema.parse({
  installationId: "install_restaurant_setup_001",
  organizationId: "org_test_001",
  workspaceId: "workspace_demo_001",
  packageId: "sonik.restaurant.setup.app",
  installedVersionId: "sonik.restaurant.setup.app@0.1.0",
  installedSchemaVersion: "1",
  installMode: "copied",
  updatePolicy: "notify",
  sourcePackageVersionId: "sonik.restaurant.setup.app@0.1.0",
  installedConfig: { title: "Dan's Club Setup" },
  installedState: { manifest: { status: "draft" } },
  permissions: [{ targetId: "booking.create.context", targetKind: "command", mode: "ask", effect: "write", approvalPolicy: "preview_then_trusted_approval", requiredHostContext: ["organizationId", "principalId"] }],
  installedBy: "user_test_001",
  installedAt: "2026-07-06T00:01:00.000Z",
}) satisfies MarketplaceInstallation;
