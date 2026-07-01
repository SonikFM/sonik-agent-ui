export interface AgentWorkflowSuggestion {
  label: string;
  prompt: string;
  skillId: "booking.context.intake" | "booking.event.create" | "booking.reservation.create" | "amplify.campaign.template.create";
  familyId: "booking-context-intake" | "booking-event" | "booking-reservation" | "amplify-campaign-template";
  kind: "intake" | "command-workflow";
  description: string;
}

export interface AgentWorkflowSuggestionContext {
  route?: string | null;
  surface?: string | null;
  pageType?: string | null;
  title?: string | null;
  visibleActions?: string[] | null;
  skillFamilies?: string[] | null;
  commandFamilies?: string[] | null;
}

const WORKFLOW_SUGGESTIONS: Record<AgentWorkflowSuggestion["skillId"], AgentWorkflowSuggestion> = {
  "booking.context.intake": {
    label: "Set up a venue",
    skillId: "booking.context.intake",
    familyId: "booking-context-intake",
    kind: "intake",
    description: "Create a bookable venue, schedule, or inventory manifest.",
    prompt: [
      "Use searchSkillCatalog to find booking.context.intake, then learnSkill for workflow, policy, context, and commands.",
      "Start a booking context intake for setting up a venue schedule or bookable inventory.",
      "Create or update the intake artifact in the canvas and ask one high-impact question at a time.",
      "Do not execute booking mutations; this is setup/intake until validation, export, and explicit trusted approval.",
    ].join(" "),
  },
  "booking.event.create": {
    label: "Create an event",
    skillId: "booking.event.create",
    familyId: "booking-event",
    kind: "intake",
    description: "Draft an event manifest with tickets, access, timing, and policy details.",
    prompt: [
      "Use searchSkillCatalog to find booking.event.create, then learnSkill for workflow, policy, context, and commands.",
      "Start an event creation intake artifact in the canvas.",
      "Ask one high-impact missing event question at a time, prioritizing title, time, inventory, access, payment, and policy.",
      "Do not publish or mutate booking/event records unless I explicitly approve a trusted command later.",
    ].join(" "),
  },
  "booking.reservation.create": {
    label: "Create reservation",
    skillId: "booking.reservation.create",
    familyId: "booking-reservation",
    kind: "command-workflow",
    description: "Use availability, guest creation, and booking creation commands.",
    prompt: [
      "Use searchSkillCatalog to find booking.reservation.create, then learnSkill before using commands.",
      "Use the canonical reservation path: learnCommand booking.get.availability, booking.create.guest, and booking.create.booking.",
      "Use current page context for contextId/resource details when available, and ask for missing guest, party size, date, or time details before committing.",
      "Do not use booking.create.hold unless I explicitly ask for a temporary hold.",
    ].join(" "),
  },
  "amplify.campaign.template.create": {
    label: "Create campaign template",
    skillId: "amplify.campaign.template.create",
    familyId: "amplify-campaign-template",
    kind: "intake",
    description: "Draft an Amplify campaign wizard template from offer, audience, and channel context.",
    prompt: [
      "Use searchSkillCatalog to find amplify.campaign.template.create, then learnSkill for workflow, policy, context, and commands.",
      "Start an Amplify campaign template intake artifact in the canvas.",
      "Ask one high-impact missing campaign question at a time, prioritizing goal, audience, channel, offer, and compliance.",
      "Do not send, publish, or mutate a campaign unless I explicitly approve a trusted command later.",
    ].join(" "),
  },
};

const DEFAULT_ORDER: AgentWorkflowSuggestion["skillId"][] = [
  "booking.context.intake",
  "booking.event.create",
  "booking.reservation.create",
  "amplify.campaign.template.create",
];

export function createWorkflowSuggestions(
  context: AgentWorkflowSuggestionContext | null | undefined,
  input: { limit?: number; mode?: "ranked" | "filtered" } = {},
): AgentWorkflowSuggestion[] {
  const matched = collectContextualWorkflowMatches(context);
  const ordered = input.mode === "filtered"
    ? matched
    : mergeUniqueWorkflowOrder(matched, DEFAULT_ORDER);

  return ordered
    .slice(0, input.limit ?? 4)
    .map((skillId) => WORKFLOW_SUGGESTIONS[skillId]);
}

function collectContextualWorkflowMatches(context: AgentWorkflowSuggestionContext | null | undefined): AgentWorkflowSuggestion["skillId"][] {
  const suggested = new Set<AgentWorkflowSuggestion["skillId"]>();
  const lower = normalizeContext(context);

  if (matchesAny(lower, ["amplify", "campaign", "campaign-wizard", "campaign-template"])) {
    suggested.add("amplify.campaign.template.create");
  }

  if (matchesAny(lower, ["event-create", "event-setup", "event-intake", "booking-event", "event-console"])) {
    suggested.add("booking.event.create");
  }

  if (matchesAny(lower, ["booking-detail", "event-booking-detail", "booking-reservation", "booking-reservations", "booking-admin", "booking-console"])) {
    suggested.add("booking.reservation.create");
  }

  if (matchesAny(lower, ["booking-context", "venue-schedule", "booking-context-intake", "booking-ops", "bookable", "venue"])) {
    suggested.add("booking.context.intake");
  }

  return [...suggested];
}

function mergeUniqueWorkflowOrder(
  primary: AgentWorkflowSuggestion["skillId"][],
  fallback: AgentWorkflowSuggestion["skillId"][],
): AgentWorkflowSuggestion["skillId"][] {
  const ordered = new Set<AgentWorkflowSuggestion["skillId"]>(primary);
  for (const skillId of fallback) ordered.add(skillId);
  return [...ordered];
}

function normalizeContext(context: AgentWorkflowSuggestionContext | null | undefined): string[] {
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

function matchesAny(values: string[], needles: string[]): boolean {
  return values.some((value) => needles.some((needle) => value.includes(needle)));
}
