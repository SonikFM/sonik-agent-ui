import assert from "node:assert/strict";

const [templatesModule, suggestionsModule, marketplaceToolsModule, renderCatalogModule] = await Promise.all([
  import("../../apps/standalone-sveltekit/src/lib/agent-workflows/templates.ts"),
  import("../../apps/standalone-sveltekit/src/lib/agent-workflows/suggestions.ts"),
  import("../../apps/standalone-sveltekit/src/lib/tools/marketplace-workflows.ts"),
  import("../../apps/standalone-sveltekit/src/lib/render/catalog.ts"),
]);

const {
  WORKFLOW_TEMPLATE_DEFINITIONS,
  createMarketplaceInstallPreview,
  createWorkflowDefinitionArtifactSpec,
  getWorkflowTemplateDefinition,
  listMarketplaceTemplateItems,
  previewWorkflowRun,
  searchMarketplaceTemplateItems,
} = templatesModule;
const { createWorkflowSuggestions } = suggestionsModule;
const { createMarketplaceWorkflowTools, resetMarketplaceWorkflowFixtureInstallsForTest } = marketplaceToolsModule;
const { explorerCatalog } = renderCatalogModule;

const allMarketplaceItems = listMarketplaceTemplateItems();
assert.ok(allMarketplaceItems.some((item) => item.kind === "workflow_template"), "marketplace has workflow template fixtures");
assert.ok(allMarketplaceItems.some((item) => item.kind === "skill_template"), "marketplace has skill template fixtures");
assert.ok(allMarketplaceItems.some((item) => item.kind === "artifact_template"), "marketplace has artifact template fixtures");

const templateIds = Object.keys(WORKFLOW_TEMPLATE_DEFINITIONS);
assert.deepEqual(templateIds, [
  "booking.context.intake",
  "booking.context.create",
  "booking.event.create",
  "booking.reservation.create",
  "amplify.campaign.template.create",
]);

for (const templateId of templateIds) {
  const template = getWorkflowTemplateDefinition(templateId);
  assert.ok(template, `${templateId} resolves`);
  assert.equal(template.version, "0.1.0");
  assert.ok(["EXISTS", "FIXTURE", "MISSING", "CANDIDATE-GAP", "FROZEN", "UNDECIDED"].includes(template.readiness));
  assert.ok(template.requiredSkills.length >= 1, `${templateId} has required skills`);
  assert.ok(template.nodes.length >= 1, `${templateId} has workflow nodes`);
  const nodeCommandIds = new Set(template.nodes.map((node) => node.commandId).filter(Boolean));
  const requiredCommandIds = new Set(template.requiredCommands);
  for (const [commandId, mode] of Object.entries(template.permissionDefaults)) {
    assert.ok(["off", "ask", "allow"].includes(mode), `${templateId} permission mode is bounded`);
    assert.ok(nodeCommandIds.has(commandId) || requiredCommandIds.has(commandId), `${templateId} permission default ${commandId} maps to a node or required command`);
  }
}

const defaultSuggestions = createWorkflowSuggestions(null);
assert.deepEqual(defaultSuggestions.map((entry) => entry.label), [
  "Set up a venue",
  "Create an event",
  "Create reservation",
  "Create campaign template",
]);
assert.ok(defaultSuggestions.every((entry) => entry.templateId === entry.skillId), "suggestions are template-backed");
assert.ok(defaultSuggestions.every((entry) => entry.marketplaceItemId.startsWith("marketplace.workflow.")), "suggestions carry marketplace ids");
assert.match(defaultSuggestions[0].prompt, /searchSkillCatalog/);
assert.equal(defaultSuggestions[0].templateReadiness, "EXISTS");

const bookingDetailSuggestions = createWorkflowSuggestions({
  surface: "booking-console",
  pageType: "event-booking-detail",
  skillFamilies: ["booking-reservation"],
  commandFamilies: ["booking-reservations"],
});
assert.equal(bookingDetailSuggestions[0].skillId, "booking.reservation.create");
assert.deepEqual(bookingDetailSuggestions[0].requiredCommands, ["booking.get.availability", "previewBookingReservationCommand", "booking.create.guest", "booking.create.booking"]);
assert.equal(bookingDetailSuggestions[0].permissionDefaults["booking.create.booking"], "ask");

const campaignSuggestions = createWorkflowSuggestions({ surface: "amplify-campaign-wizard", pageType: "campaign-template", skillFamilies: ["amplify-campaign-template"] });
assert.equal(campaignSuggestions[0].skillId, "amplify.campaign.template.create");

const marketplaceSearch = searchMarketplaceTemplateItems("restaurant", 10);
assert.ok(marketplaceSearch.some((item) => item.templateId === "booking.context.intake"), "restaurant query finds venue setup template");
const bookingPageMarketplaceSearch = searchMarketplaceTemplateItems("", 10, {
  surface: "booking-console",
  pageType: "event-booking-detail",
  skillFamilies: ["booking-reservation"],
  commandFamilies: ["booking-reservations"],
});
assert.equal(bookingPageMarketplaceSearch[0].templateId, "booking.reservation.create", "marketplace search ranks by page context before default order");

const unauthPreview = createMarketplaceInstallPreview({ itemId: "marketplace.workflow.booking-reservation-create", hostContext: { authenticated: false, organizationId: null } });
assert.ok(unauthPreview, "install preview resolves");
assert.equal(unauthPreview.mutatesInstalledState, false, "install preview advertises non-mutation");
assert.equal(unauthPreview.canInstall, false, "authenticated booking command workflow blocks without host context");
assert.ok(unauthPreview.disabledReasons.includes("organization_context_required"));
assert.ok(unauthPreview.disabledReasons.includes("authenticated_host_required"));
assert.ok(unauthPreview.disabledReasons.includes("active_page_entity_required"));
const missingActiveEntityPreview = createMarketplaceInstallPreview({
  itemId: "booking.reservation.create",
  hostContext: { authenticated: true, organizationId: "org_1" },
  pageContext: { surface: "booking-console", pageType: "event-booking-detail", title: "Detail without active entity" },
});
assert.ok(missingActiveEntityPreview.disabledReasons.includes("active_page_entity_required"), "page.activeEntity requires an actual active entity id");
const missingPageContextPreview = createMarketplaceInstallPreview({ itemId: "booking.context.intake", hostContext: { authenticated: true, organizationId: "org_1" } });
assert.ok(missingPageContextPreview.disabledReasons.includes("page_context_required"), "page-route requirements are enforced in install preview");
assert.ok(unauthPreview.safetyRules.some((rule) => /never grants write approval/i.test(rule)));
assert.ok(unauthPreview.safetyRules.some((rule) => /workflow\.requestApproval opens an approval card/i.test(rule)));

const authPreview = createMarketplaceInstallPreview({
  itemId: "booking.reservation.create",
  hostContext: { authenticated: true, organizationId: "org_1" },
  pageContext: { surface: "booking-console", pageType: "event-booking-detail", title: "Main Course Tee Sheet", activeEntity: { type: "booking_context", id: "ctx_1", label: "Main Course Tee Sheet" } },
});
assert.equal(authPreview.canInstall, true);
assert.equal(authPreview.permissionDefaults["booking.create.booking"], "ask");

const artifactSpec = createWorkflowDefinitionArtifactSpec("booking.reservation.create");
assert.ok(artifactSpec, "workflow definition artifact spec exists");
assert.equal(artifactSpec.state.template.id, "booking.reservation.create");
assert.ok(JSON.stringify(artifactSpec).includes("workflow.requestApproval opens an approval card/request only"));
assert.equal(JSON.stringify(artifactSpec).includes("commitCommand"), false, "artifact spec must not contain raw commitCommand escape hatch");
const validation = explorerCatalog.validate(artifactSpec);
assert.equal(validation.success, true, validation.success ? "" : JSON.stringify(validation.errors, null, 2));

const runPreview = previewWorkflowRun("booking.reservation.create", { "booking.create.booking": "off" });
assert.ok(runPreview);
assert.equal(runPreview.canRunWithoutTrustedApproval, false);
assert.ok(runPreview.steps.some((step) => step.commandId === "booking.create.booking" && step.status === "blocked" && step.disabledReason === "tool_permission_off"));
assert.ok(runPreview.steps.some((step) => step.commandId === "previewBookingReservationCommand" && step.status === "approval_required"));
assert.ok(runPreview.steps.every((step) => step.executesOnPreview === false), "preview never executes workflow nodes");
assert.match(runPreview.requestApprovalSemantics, /does not grant approval/i);

const intakeTemplate = getWorkflowTemplateDefinition("booking.context.intake");
assert.equal(intakeTemplate.nodes.some((node) => node.commandId === "booking.create.context" && node.type === "tool_preview"), true, "intake can preview context creation later");
assert.equal(intakeTemplate.nodes.some((node) => node.type === "tool_commit"), false, "intake workflow itself must not commit booking contexts");
assert.match(intakeTemplate.summary, /venue schedules/i, "non-event setup stays venue_schedule/resource oriented");
assert.equal(JSON.stringify(intakeTemplate).includes("Event rows"), false, "non-event template must not imply fake Event rows");

const toolsSession = `marketplace-test-${Date.now()}`;
resetMarketplaceWorkflowFixtureInstallsForTest(toolsSession);
const tools = createMarketplaceWorkflowTools({
  sessionId: toolsSession,
  pageContext: { surface: "booking-console", pageType: "event-booking-detail", title: "Main Course Tee Sheet", activeEntity: { type: "booking_context", id: "ctx_1", label: "Main Course Tee Sheet" }, skillFamilies: ["booking-reservation"], commandFamilies: ["booking-reservations"] },
  hostSession: { authenticated: true, organizationId: "org_1", scopes: ["booking:read", "booking:write"], source: "test", sessionId: toolsSession, userId: "user_1", principalId: "user_1", expiresAt: null, metadata: {} },
});

const beforeList = await tools.listInstalledMarketplaceTemplates.execute({});
assert.deepEqual(beforeList.installed, []);
const previewToolResult = await tools.getMarketplaceInstallPreview.execute({ itemId: "booking.reservation.create" });
assert.equal(previewToolResult.ok, true);
const contextualToolSearch = await tools.searchMarketplaceTemplates.execute({ query: "", limit: 5 });
assert.equal(contextualToolSearch.items[0].templateId, "booking.reservation.create", "agent tool search inherits page-context ranking");
const skillDetail = await tools.getMarketplaceTemplate.execute({ itemId: "marketplace.skill.booking-context-intake" });
assert.equal(skillDetail.ok, true);
assert.equal(skillDetail.item.kind, "skill_template");
const afterPreviewList = await tools.listInstalledMarketplaceTemplates.execute({});
assert.deepEqual(afterPreviewList.installed, [], "preview must not mutate installed templates");

const installResult = await tools.installMarketplaceTemplate.execute({ itemId: "booking.reservation.create", scope: "organization", toolPolicy: { "booking.create.booking": "ask" } });
assert.equal(installResult.ok, true);
assert.match(installResult.safety, /does not grant trusted command approval/i);
const afterInstallList = await tools.listInstalledMarketplaceTemplates.execute({});
assert.equal(afterInstallList.installed.length, 1);
assert.equal(afterInstallList.installed[0].toolPolicy["booking.create.booking"], "ask");

const approvalRequest = await tools.requestWorkflowApproval.execute({ templateId: "booking.reservation.create", reason: "smoke" });
assert.equal(approvalRequest.ok, true);
assert.equal(approvalRequest.approvalGranted, false);
assert.equal(approvalRequest.canCommit, false);
assert.match(approvalRequest.message, /Trusted host approval is still required/i);

console.log("marketplace workflow template tests passed");
