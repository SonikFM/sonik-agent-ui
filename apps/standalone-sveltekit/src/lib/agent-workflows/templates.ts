export type WorkflowTemplateKind = "intake" | "command_workflow" | "artifact_workflow" | "agent_workflow";
export type WorkflowTemplateReadiness = "EXISTS" | "FIXTURE" | "MISSING" | "CANDIDATE-GAP" | "FROZEN" | "UNDECIDED";
export type WorkflowPermissionMode = "off" | "ask" | "allow";
export type MarketplaceItemKind = "agent_template" | "app_template" | "workflow_template" | "skill_template" | "tool_pack" | "artifact_template" | "mcp_addon";
export type MarketplaceVisibility = "private" | "organization" | "public" | "marketplace";
export type MarketplaceInstallScope = "user" | "organization" | "workspace";
export type MarketplaceApprovalPolicy = "none" | "preview" | "preview_then_trusted_approval";

export interface WorkflowNodeDefinition {
  id: string;
  type: "trigger" | "ask_user" | "skill" | "artifact" | "tool_preview" | "approval" | "tool_commit" | "remote_execution" | "evidence";
  title: string;
  description?: string;
  requiredSkillId?: string;
  commandId?: string;
  effect?: "read" | "write" | "destructive" | "external" | "none";
  approval?: MarketplaceApprovalPolicy;
  readiness?: WorkflowTemplateReadiness;
}

export interface WorkflowEdgeDefinition {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface WorkflowTemplateDefinition {
  id: "booking.context.intake" | "booking.context.create" | "booking.event.create" | "booking.reservation.create" | "amplify.campaign.template.create";
  marketplaceItemId: string;
  label: string;
  title: string;
  summary: string;
  description: string;
  familyId: "booking-context-intake" | "booking-context-create" | "booking-event" | "booking-reservation" | "amplify-campaign-template";
  kind: WorkflowTemplateKind;
  version: string;
  triggerPhrases: string[];
  requiredSkills: string[];
  requiredCommands: string[];
  requiredCapabilities: string[];
  requiredHostContext: string[];
  permissionDefaults: Record<string, WorkflowPermissionMode>;
  readiness: WorkflowTemplateReadiness;
  readinessLabel: string;
  suggestionReadiness: "ready" | "needs_context" | "approval_required" | "draft_only";
  launchPrompt: string;
  nodes: WorkflowNodeDefinition[];
  edges: WorkflowEdgeDefinition[];
  contextMatchers: string[];
  objectFamily: MarketplaceItemKind;
}

export interface WorkflowTemplateSuggestionContext {
  route?: string | null;
  surface?: string | null;
  pageType?: string | null;
  title?: string | null;
  activeEntity?: { type?: string | null; id?: string | null; label?: string | null } | null;
  visibleActions?: string[] | null;
  skillFamilies?: string[] | null;
  commandFamilies?: string[] | null;
}

export interface MarketplaceTemplateItem {
  id: string;
  templateId: string;
  kind: MarketplaceItemKind;
  title: string;
  summary: string;
  version: string;
  publisherId: string;
  visibility: MarketplaceVisibility;
  installScope: MarketplaceInstallScope;
  requiredSkills: string[];
  requiredCommands: string[];
  requiredCapabilities: string[];
  requiredHostContext: string[];
  approvalPolicy: MarketplaceApprovalPolicy;
  status: "draft" | "submitted" | "approved" | "published" | "deprecated";
  readiness: WorkflowTemplateReadiness;
  permissionDefaults: Record<string, WorkflowPermissionMode>;
}

export interface MarketplaceInstallPreview {
  item: MarketplaceTemplateItem;
  scope: MarketplaceInstallScope;
  permissionDefaults: Record<string, WorkflowPermissionMode>;
  requiredSkills: string[];
  requiredCommands: string[];
  requiredCapabilities: string[];
  requiredHostContext: string[];
  approvalPolicy: MarketplaceApprovalPolicy;
  canInstall: boolean;
  disabledReasons: string[];
  safetyRules: string[];
  mutatesInstalledState: false;
}

const bookingContextIntakePrompt = [
  "Use searchSkillCatalog to find booking.context.intake, then learnSkill for workflow, policy, context, and commands.",
  "Start a booking context intake for setting up a venue schedule or bookable inventory.",
  "Create or update the intake artifact in the canvas and ask one high-impact question at a time.",
  "Do not execute booking mutations; this is setup/intake until validation, export, and explicit trusted approval.",
].join(" ");

const bookingEventPrompt = [
  "Use searchSkillCatalog to find booking.event.create, then learnSkill for workflow, policy, context, and commands.",
  "Start an event creation intake artifact in the canvas.",
  "Ask one high-impact missing event question at a time, prioritizing title, time, inventory, access, payment, and policy.",
  "Do not publish or mutate booking/event records unless I explicitly approve a trusted command later.",
].join(" ");

const bookingReservationPrompt = [
  "Use searchSkillCatalog to find booking.reservation.create, then learnSkill before using commands.",
  "Use the canonical reservation path: learnCommand booking.get.availability, booking.create.guest, and booking.create.booking.",
  "Use current page context for contextId/resource details when available, and ask for missing guest, party size, date, or time details before committing.",
  "Do not use booking.create.hold unless I explicitly ask for a temporary hold.",
].join(" ");

const amplifyCampaignPrompt = [
  "Use searchSkillCatalog to find amplify.campaign.template.create, then learnSkill for workflow, policy, context, and commands.",
  "Start an Amplify campaign template intake artifact in the canvas.",
  "Ask one high-impact missing campaign question at a time, prioritizing goal, audience, channel, offer, and compliance.",
  "Do not send, publish, or mutate a campaign unless I explicitly approve a trusted command later.",
].join(" ");

export const WORKFLOW_TEMPLATE_DEFINITIONS: Record<WorkflowTemplateDefinition["id"], WorkflowTemplateDefinition> = {
  "booking.context.intake": {
    id: "booking.context.intake",
    marketplaceItemId: "marketplace.workflow.booking-context-intake",
    label: "Set up a venue",
    title: "Booking Context Intake",
    summary: "Guided setup for venue schedules, resources, menus, rules, and booking context manifests.",
    description: "Guided intake for venue schedules, inventory, policies, and manifest drafts.",
    familyId: "booking-context-intake",
    kind: "intake",
    version: "0.1.0",
    triggerPhrases: ["set up a venue", "create a booking context", "bookable inventory", "restaurant setup", "tee sheet setup"],
    requiredSkills: ["booking.context.intake"],
    requiredCommands: [],
    requiredCapabilities: ["json-render.question-card", "artifact.state.save"],
    requiredHostContext: ["page.route", "organization.optional"],
    permissionDefaults: { "booking.create.context": "ask" },
    readiness: "EXISTS",
    readinessLabel: "Draft",
    suggestionReadiness: "draft_only",
    launchPrompt: bookingContextIntakePrompt,
    nodes: [
      { id: "trigger", type: "trigger", title: "Start venue setup", readiness: "EXISTS" },
      { id: "learn", type: "skill", title: "Learn booking.context.intake", requiredSkillId: "booking.context.intake", readiness: "EXISTS" },
      { id: "artifact", type: "artifact", title: "Create intake artifact", readiness: "EXISTS" },
      { id: "ask", type: "ask_user", title: "Ask next high-impact question", readiness: "EXISTS" },
      { id: "preview", type: "tool_preview", title: "Preview booking.create.context later", commandId: "booking.create.context", effect: "write", approval: "preview_then_trusted_approval", readiness: "EXISTS" },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "learn" },
      { id: "e2", source: "learn", target: "artifact" },
      { id: "e3", source: "artifact", target: "ask" },
      { id: "e4", source: "ask", target: "preview", label: "after validation" },
    ],
    contextMatchers: ["booking-context", "venue-schedule", "booking-context-intake", "bookable", "venue", "restaurant", "tee sheet"],
    objectFamily: "workflow_template",
  },
  "booking.context.create": {
    id: "booking.context.create",
    marketplaceItemId: "marketplace.workflow.booking-context-create",
    label: "Approve venue setup",
    title: "Booking Context Create Approval",
    summary: "Preview and commit a validated booking context manifest through trusted host approval.",
    description: "Trusted approval workflow for committing the active booking context intake artifact.",
    familyId: "booking-context-create",
    kind: "command_workflow",
    version: "0.1.0",
    triggerPhrases: ["approve venue setup", "create this booking context", "commit active intake"],
    requiredSkills: ["booking.context.create"],
    requiredCommands: ["booking.create.context"],
    requiredCapabilities: ["artifact.state.read", "command.preview", "trusted-host.approval"],
    requiredHostContext: ["authenticated", "organizationId", "approvedCommandIds", "activeArtifactId"],
    permissionDefaults: { "booking.create.context": "ask" },
    readiness: "EXISTS",
    readinessLabel: "Approval",
    suggestionReadiness: "approval_required",
    launchPrompt: "Use booking.context.create: call readActiveArtifactState, previewActiveIntakeCommand, then request approval. Only call commitActiveIntakeCommand with confirmation=APPROVE_AND_RUN after trusted approval is present.",
    nodes: [
      { id: "read", type: "tool_preview", title: "Read active intake state", commandId: "readActiveArtifactState", effect: "read", approval: "none", readiness: "EXISTS" },
      { id: "preview", type: "tool_preview", title: "Preview booking.create.context", commandId: "previewActiveIntakeCommand", effect: "read", approval: "preview", readiness: "EXISTS" },
      { id: "approval", type: "approval", title: "Request trusted approval", approval: "preview_then_trusted_approval", readiness: "EXISTS" },
      { id: "commit", type: "tool_commit", title: "Commit approved context", commandId: "commitActiveIntakeCommand", effect: "write", approval: "preview_then_trusted_approval", readiness: "EXISTS" },
    ],
    edges: [
      { id: "e1", source: "read", target: "preview" },
      { id: "e2", source: "preview", target: "approval" },
      { id: "e3", source: "approval", target: "commit", label: "trusted approval only" },
    ],
    contextMatchers: ["booking-context-create", "activeArtifactId"],
    objectFamily: "workflow_template",
  },
  "booking.event.create": {
    id: "booking.event.create",
    marketplaceItemId: "marketplace.workflow.booking-event-create",
    label: "Create an event",
    title: "Booking Event Intake",
    summary: "Draft an event manifest with timing, inventory, access, payment, and policy details.",
    description: "Draft event timing, inventory, access, payment, and policy details.",
    familyId: "booking-event",
    kind: "intake",
    version: "0.1.0",
    triggerPhrases: ["create an event", "event setup", "event intake", "tournament", "member dinner"],
    requiredSkills: ["booking.event.create"],
    requiredCommands: [],
    requiredCapabilities: ["json-render.question-card", "artifact.state.save"],
    requiredHostContext: ["page.route"],
    permissionDefaults: { "booking.create.event": "ask" },
    readiness: "EXISTS",
    readinessLabel: "Draft",
    suggestionReadiness: "draft_only",
    launchPrompt: bookingEventPrompt,
    nodes: [
      { id: "trigger", type: "trigger", title: "Start event setup", readiness: "EXISTS" },
      { id: "learn", type: "skill", title: "Learn booking.event.create", requiredSkillId: "booking.event.create", readiness: "EXISTS" },
      { id: "artifact", type: "artifact", title: "Draft event manifest", readiness: "EXISTS" },
      { id: "ask", type: "ask_user", title: "Ask event requirements", readiness: "EXISTS" },
      { id: "preview", type: "tool_preview", title: "Preview booking.create.event later", commandId: "booking.create.event", effect: "write", approval: "preview_then_trusted_approval", readiness: "EXISTS" },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "learn" },
      { id: "e2", source: "learn", target: "artifact" },
      { id: "e3", source: "artifact", target: "ask" },
      { id: "e4", source: "ask", target: "preview", label: "after validation" },
    ],
    contextMatchers: ["event-create", "event-setup", "event-intake", "booking-event", "event-console"],
    objectFamily: "workflow_template",
  },
  "booking.reservation.create": {
    id: "booking.reservation.create",
    marketplaceItemId: "marketplace.workflow.booking-reservation-create",
    label: "Create reservation",
    title: "Booking Reservation Create",
    summary: "Run the canonical availability → guest → booking reservation path with page context and trusted host approval.",
    description: "Run the canonical availability → guest → booking path with host approval.",
    familyId: "booking-reservation",
    kind: "command_workflow",
    version: "0.1.0",
    triggerPhrases: ["create reservation", "book a guest", "make a booking", "reserve a table", "book a tee time"],
    requiredSkills: ["booking.reservation.create"],
    requiredCommands: ["booking.get.availability", "booking.create.guest", "booking.create.booking"],
    requiredCapabilities: ["booking.availability.read", "booking.guest.write", "booking.reservation.write", "trusted-host.approval"],
    requiredHostContext: ["authenticated", "organizationId", "page.activeEntity", "booking:write"],
    permissionDefaults: { "booking.get.availability": "allow", "booking.create.guest": "ask", "booking.create.booking": "ask" },
    readiness: "EXISTS",
    readinessLabel: "Needs page",
    suggestionReadiness: "needs_context",
    launchPrompt: bookingReservationPrompt,
    nodes: [
      { id: "learn", type: "skill", title: "Learn reservation workflow", requiredSkillId: "booking.reservation.create", readiness: "EXISTS" },
      { id: "availability", type: "tool_preview", title: "Check availability", commandId: "booking.get.availability", effect: "read", approval: "none", readiness: "EXISTS" },
      { id: "guest", type: "tool_commit", title: "Create guest", commandId: "booking.create.guest", effect: "write", approval: "preview_then_trusted_approval", readiness: "EXISTS" },
      { id: "booking", type: "tool_commit", title: "Create booking", commandId: "booking.create.booking", effect: "write", approval: "preview_then_trusted_approval", readiness: "EXISTS" },
    ],
    edges: [
      { id: "e1", source: "learn", target: "availability" },
      { id: "e2", source: "availability", target: "guest" },
      { id: "e3", source: "guest", target: "booking" },
    ],
    contextMatchers: ["booking-detail", "event-booking-detail", "booking-reservation", "booking-reservations", "booking-admin", "booking-console"],
    objectFamily: "workflow_template",
  },
  "amplify.campaign.template.create": {
    id: "amplify.campaign.template.create",
    marketplaceItemId: "marketplace.workflow.amplify-campaign-template-create",
    label: "Create campaign template",
    title: "Amplify Campaign Template Intake",
    summary: "Draft an Amplify campaign wizard template with goal, audience, channel, offer, and compliance fields.",
    description: "Draft offer, audience, channel, compliance, and campaign wizard template state.",
    familyId: "amplify-campaign-template",
    kind: "intake",
    version: "0.1.0",
    triggerPhrases: ["create campaign template", "campaign wizard", "amplify campaign", "offer template"],
    requiredSkills: ["amplify.campaign.template.create"],
    requiredCommands: [],
    requiredCapabilities: ["json-render.question-card", "artifact.state.save"],
    requiredHostContext: ["page.route", "amplify.context.optional"],
    permissionDefaults: { "amplify.publish.campaign.template": "ask" },
    readiness: "EXISTS",
    readinessLabel: "Draft",
    suggestionReadiness: "draft_only",
    launchPrompt: amplifyCampaignPrompt,
    nodes: [
      { id: "trigger", type: "trigger", title: "Start campaign template", readiness: "EXISTS" },
      { id: "learn", type: "skill", title: "Learn amplify.campaign.template.create", requiredSkillId: "amplify.campaign.template.create", readiness: "EXISTS" },
      { id: "artifact", type: "artifact", title: "Draft campaign template", readiness: "EXISTS" },
      { id: "ask", type: "ask_user", title: "Ask campaign requirements", readiness: "EXISTS" },
      { id: "preview", type: "tool_preview", title: "Preview campaign template publish later", commandId: "amplify.publish.campaign.template", effect: "write", approval: "preview_then_trusted_approval", readiness: "EXISTS" },
    ],
    edges: [
      { id: "e1", source: "trigger", target: "learn" },
      { id: "e2", source: "learn", target: "artifact" },
      { id: "e3", source: "artifact", target: "ask" },
      { id: "e4", source: "ask", target: "preview", label: "after validation" },
    ],
    contextMatchers: ["amplify", "campaign", "campaign-wizard", "campaign-template"],
    objectFamily: "workflow_template",
  },
};

export const DEFAULT_WORKFLOW_TEMPLATE_ORDER: WorkflowTemplateDefinition["id"][] = [
  "booking.context.intake",
  "booking.event.create",
  "booking.reservation.create",
  "amplify.campaign.template.create",
];

export function listWorkflowTemplateDefinitions(): WorkflowTemplateDefinition[] {
  return Object.values(WORKFLOW_TEMPLATE_DEFINITIONS);
}

export function getWorkflowTemplateDefinition(id: string): WorkflowTemplateDefinition | null {
  return Object.prototype.hasOwnProperty.call(WORKFLOW_TEMPLATE_DEFINITIONS, id)
    ? WORKFLOW_TEMPLATE_DEFINITIONS[id as WorkflowTemplateDefinition["id"]]
    : null;
}

export function collectContextualWorkflowTemplateMatches(context: WorkflowTemplateSuggestionContext | null | undefined): WorkflowTemplateDefinition["id"][] {
  const values = normalizeContextValues(context);
  return listWorkflowTemplateDefinitions()
    .map((template, index) => ({ template, index, score: contextMatchScore(values, template.contextMatchers) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.template.id);
}

export function createMarketplaceItemFromTemplate(template: WorkflowTemplateDefinition): MarketplaceTemplateItem {
  return {
    id: template.marketplaceItemId,
    templateId: template.id,
    kind: template.objectFamily,
    title: template.title,
    summary: template.summary,
    version: template.version,
    publisherId: "sonik",
    visibility: "marketplace",
    installScope: defaultInstallScopeForTemplate(template),
    requiredSkills: [...template.requiredSkills],
    requiredCommands: [...template.requiredCommands],
    requiredCapabilities: [...template.requiredCapabilities],
    requiredHostContext: [...template.requiredHostContext],
    approvalPolicy: strongestApprovalPolicyForTemplate(template),
    status: "published",
    readiness: template.readiness,
    permissionDefaults: { ...template.permissionDefaults },
  };
}

const NON_WORKFLOW_MARKETPLACE_ITEMS: MarketplaceTemplateItem[] = [
  {
    id: "marketplace.skill.booking-context-intake",
    templateId: "skill.booking.context.intake",
    kind: "skill_template",
    title: "Booking Context Intake Skill",
    summary: "Reusable agent skill contract for collecting venue, schedule, inventory, menu, and policy requirements before booking context creation.",
    version: "0.1.0",
    publisherId: "sonik",
    visibility: "marketplace",
    installScope: "workspace",
    requiredSkills: ["booking.context.intake"],
    requiredCommands: [],
    requiredCapabilities: ["runtime.skill-registry", "json-render.question-card"],
    requiredHostContext: [],
    approvalPolicy: "none",
    status: "published",
    readiness: "EXISTS",
    permissionDefaults: {},
  },
  {
    id: "marketplace.artifact.workflow-definition",
    templateId: "artifact.workflow.definition",
    kind: "artifact_template",
    title: "Workflow Definition Artifact",
    summary: "Preview/edit artifact layout for template metadata, required skills, command policies, nodes, edges, and approval boundaries.",
    version: "0.1.0",
    publisherId: "sonik",
    visibility: "marketplace",
    installScope: "workspace",
    requiredSkills: [],
    requiredCommands: [],
    requiredCapabilities: ["json-render.action-rail", "json-render.table", "artifact.state.save"],
    requiredHostContext: [],
    approvalPolicy: "preview",
    status: "published",
    readiness: "EXISTS",
    permissionDefaults: {},
  },
];

export function listMarketplaceTemplateItems(): MarketplaceTemplateItem[] {
  return [...listWorkflowTemplateDefinitions().map(createMarketplaceItemFromTemplate), ...NON_WORKFLOW_MARKETPLACE_ITEMS];
}

export function getMarketplaceTemplateItem(id: string): MarketplaceTemplateItem | null {
  return listMarketplaceTemplateItems().find((item) => item.id === id || item.templateId === id) ?? null;
}

export function searchMarketplaceTemplateItems(query = "", limit = 8, context?: WorkflowTemplateSuggestionContext | null): MarketplaceTemplateItem[] {
  const lower = query.trim().toLowerCase();
  const items = listMarketplaceTemplateItems();
  const matched = lower
    ? items.filter((item) => {
      const template = getWorkflowTemplateDefinition(item.templateId);
      const searchable = [
        item.title,
        item.summary,
        item.templateId,
        item.kind,
        ...item.requiredSkills,
        ...item.requiredCommands,
        ...(template?.triggerPhrases ?? []),
        ...(template?.contextMatchers ?? []),
      ];
      return searchable.some((value) => value.toLowerCase().includes(lower));
    })
    : items;
  const contextualOrder = context ? collectContextualWorkflowTemplateMatches(context) : [];
  const contextualRank = new Map<string, number>(contextualOrder.map((templateId, index) => [templateId, index]));
  const ranked = [...matched].sort((a, b) => {
    const aRank = contextualRank.get(a.templateId) ?? Number.MAX_SAFE_INTEGER;
    const bRank = contextualRank.get(b.templateId) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return items.findIndex((item) => item.id === a.id) - items.findIndex((item) => item.id === b.id);
  });
  return ranked.slice(0, Math.max(1, Math.min(limit, 20)));
}

export function createMarketplaceInstallPreview(input: {
  itemId: string;
  scope?: MarketplaceInstallScope;
  toolPolicy?: Record<string, WorkflowPermissionMode>;
  hostContext?: { authenticated?: boolean; organizationId?: string | null } | null;
  pageContext?: WorkflowTemplateSuggestionContext | null;
}): MarketplaceInstallPreview | null {
  const item = getMarketplaceTemplateItem(input.itemId);
  if (!item) return null;
  const scope = input.scope ?? item.installScope;
  const permissionDefaults = { ...item.permissionDefaults, ...(input.toolPolicy ?? {}) };
  const disabledReasons: string[] = [];
  if (item.requiredHostContext.includes("page.route") && !hasPageRouteContext(input.pageContext)) {
    disabledReasons.push("page_context_required");
  }
  if (item.requiredHostContext.includes("page.activeEntity") && !hasActivePageEntityContext(input.pageContext)) {
    disabledReasons.push("active_page_entity_required");
  }
  if ((scope === "organization" || item.requiredHostContext.includes("organizationId")) && !input.hostContext?.organizationId) {
    disabledReasons.push("organization_context_required");
  }
  if (item.requiredHostContext.includes("authenticated") && input.hostContext?.authenticated !== true) {
    disabledReasons.push("authenticated_host_required");
  }
  return {
    item,
    scope,
    permissionDefaults,
    requiredSkills: [...item.requiredSkills],
    requiredCommands: [...item.requiredCommands],
    requiredCapabilities: [...item.requiredCapabilities],
    requiredHostContext: [...item.requiredHostContext],
    approvalPolicy: item.approvalPolicy,
    canInstall: disabledReasons.length === 0 || item.readiness === "FIXTURE",
    disabledReasons,
    safetyRules: [
      "Install scope controls visibility/configuration only; it never grants write approval.",
      "Permission defaults are preference gates; writes still require trusted host approval and receipts.",
      "workflow.requestApproval opens an approval card/request only; it is not approval itself.",
      "JSON-render, QuestionCard, and install preview cannot execute commands.",
    ],
    mutatesInstalledState: false,
  };
}

export function createWorkflowDefinitionArtifactSpec(templateId: string) {
  const template = getWorkflowTemplateDefinition(templateId);
  if (!template) return null;
  const item = createMarketplaceItemFromTemplate(template);
  return {
    version: 1,
    root: "root",
    state: {
      template: {
        id: template.id,
        title: template.title,
        version: template.version,
        kind: template.kind,
        readiness: template.readiness,
        requiredSkills: template.requiredSkills,
        requiredCommands: template.requiredCommands,
        requiredHostContext: template.requiredHostContext,
        permissionDefaults: template.permissionDefaults,
        nodes: template.nodes,
        edges: template.edges,
      },
      marketplaceItem: item,
      safetyRules: ["workflow.requestApproval opens an approval card/request only; it does not grant approval or commit commands."],
    },
    elements: {
      root: { type: "Stack", props: { direction: "vertical", gap: "md", wrap: null }, children: ["summary", "permissions", "nodes", "actions"] },
      summary: { type: "Card", props: { title: template.title, description: template.summary }, children: ["meta"] },
      meta: {
        type: "Table",
        children: [],
        props: {
          data: [
            { field: "Template", value: template.id },
            { field: "Kind", value: template.kind },
            { field: "Readiness", value: template.readiness },
            { field: "Version", value: template.version },
          ],
          columns: [{ key: "field", label: "Field" }, { key: "value", label: "Value" }],
          emptyMessage: null,
        },
      },
      permissions: {
        type: "ActionRail",
        children: [],
        props: {
          title: "Permissions and approval boundary",
          actions: Object.entries(template.permissionDefaults).map(([commandId, mode]) => ({
            id: `policy-${commandId}`,
            label: `${commandId}: ${mode}`,
            description: mode === "off" ? "Disabled by install policy." : mode === "allow" ? "Allowed preference; writes still require trusted host approval." : "Ask/preview before running.",
            status: mode === "off" ? "blocked" : mode === "allow" ? "ready" : "requires_confirmation",
            commandId,
            effect: template.nodes.find((node) => node.commandId === commandId)?.effect ?? "none",
            approval: template.nodes.find((node) => node.commandId === commandId)?.approval ?? null,
          })),
          emptyMessage: "No command policies.",
        },
      },
      nodes: {
        type: "Table",
        children: [],
        props: {
          data: template.nodes.map((node) => ({ id: node.id, type: node.type, title: node.title, commandId: node.commandId ?? "", readiness: node.readiness ?? "UNDECIDED" })),
          columns: [
            { key: "id", label: "Node" },
            { key: "type", label: "Type" },
            { key: "title", label: "Title" },
            { key: "commandId", label: "Command" },
            { key: "readiness", label: "Readiness" },
          ],
          emptyMessage: "No workflow nodes.",
        },
      },
      actions: {
        type: "ActionRail",
        children: [],
        props: {
          title: "Preview-only workflow actions",
          actions: [
            { id: "install-preview", label: "Install preview", description: "Shows dependencies and permissions. Does not install or execute.", status: "preview", commandId: "marketplace.getInstallPreview", effect: "read", approval: "none" },
            { id: "workflow-preview", label: "Workflow preview", description: "Expands nodes into steps. Does not execute commits.", status: "preview", commandId: "workflow.previewRun", effect: "read", approval: "none" },
            { id: "request-approval", label: "Request approval", description: "Opens/records approval request only. It is not approval.", status: "requires_confirmation", commandId: "workflow.requestApproval", effect: "write", approval: "preview_then_trusted_approval" },
          ],
          emptyMessage: null,
        },
      },
    },
  };
}

export function previewWorkflowRun(templateId: string, toolPolicy: Record<string, WorkflowPermissionMode> = {}) {
  const template = getWorkflowTemplateDefinition(templateId);
  if (!template) return null;
  const policy = { ...template.permissionDefaults, ...toolPolicy };
  const steps = template.nodes.map((node) => {
    const commandMode = node.commandId ? policy[node.commandId] ?? "ask" : null;
    const blocked = commandMode === "off";
    const approvalRequired = node.type === "tool_commit" || node.approval === "preview_then_trusted_approval" || commandMode === "ask";
    return {
      nodeId: node.id,
      title: node.title,
      type: node.type,
      commandId: node.commandId ?? null,
      permissionMode: commandMode,
      status: blocked ? "blocked" : approvalRequired ? "approval_required" : "preview_ready",
      disabledReason: blocked ? "tool_permission_off" : null,
      executesOnPreview: false,
    };
  });
  return {
    templateId: template.id,
    approvalPolicy: strongestApprovalPolicyForTemplate(template),
    steps,
    canRunWithoutTrustedApproval: false,
    requestApprovalSemantics: "workflow.requestApproval opens an approval card/request only; it does not grant approval or commit commands.",
  };
}

function defaultInstallScopeForTemplate(template: WorkflowTemplateDefinition): MarketplaceInstallScope {
  return template.requiredHostContext.includes("organizationId") ? "organization" : "workspace";
}

function contextMatchScore(values: string[], needles: string[]): number {
  let score = 0;
  for (const value of values) {
    for (const needle of needles) {
      if (value.includes(needle)) score += 1;
    }
  }
  return score;
}

function normalizeContextValues(context: WorkflowTemplateSuggestionContext | null | undefined): string[] {
  if (!context) return [];
  const values = [
    context.route,
    context.surface,
    context.pageType,
    context.title,
    ...(context.visibleActions ?? []),
    ...(context.skillFamilies ?? []),
    ...(context.commandFamilies ?? []),
  ];
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.toLowerCase());
}

function hasPageRouteContext(context: WorkflowTemplateSuggestionContext | null | undefined): boolean {
  return Boolean(context?.route || context?.surface || context?.pageType);
}

function hasActivePageEntityContext(context: WorkflowTemplateSuggestionContext | null | undefined): boolean {
  return typeof context?.activeEntity?.id === "string" && context.activeEntity.id.trim().length > 0;
}

function strongestApprovalPolicyForTemplate(template: WorkflowTemplateDefinition): MarketplaceApprovalPolicy {
  if (template.nodes.some((node) => node.type === "tool_commit" || node.approval === "preview_then_trusted_approval")) return "preview_then_trusted_approval";
  if (Object.values(template.permissionDefaults).some((mode) => mode === "ask")) return "preview_then_trusted_approval";
  return template.requiredCommands.length > 0 ? "preview" : "none";
}
