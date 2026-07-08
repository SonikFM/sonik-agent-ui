import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";

const MAX_IMPLICIT_SKILLS = 4;

function normalize(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function contextText(pageContext?: AgentPageContext): string {
  if (!pageContext) return "";
  return [
    pageContext.route,
    pageContext.surface,
    pageContext.pageType,
    pageContext.title,
    pageContext.activeEntity?.type,
    pageContext.activeEntity?.label,
    ...(pageContext.visibleActions ?? []),
    ...(pageContext.skillFamilies ?? []),
    ...(pageContext.commandFamilies ?? []),
  ].map(normalize).filter(Boolean).join(" ");
}

export function resolveImplicitWorkflowSkillIds(input: {
  userMessage?: string | null;
  firstUserMessage?: string | null;
  pageContext?: AgentPageContext;
  /**
   * Whether the active artifact (pageContext.activeArtifactId) is a registered intake artifact
   * (i.e. its spec has at least one QuestionCard question). false narrows the structural guard
   * below so a generic createJsonArtifact canvas never keeps booking.context.intake selected
   * (2026-07-08 pressure-test finding F2). undefined means the caller couldn't determine this
   * (e.g. load failure) and preserves prior any-active-artifact behavior.
   */
  activeArtifactIsRegisteredIntake?: boolean;
}): string[] {
  const message = normalize(input.userMessage ?? input.firstUserMessage);
  if (!message) return [];
  const context = contextText(input.pageContext);
  const skills: string[] = [];

  const setupIntent = includesAny(message, [
    "set up",
    "setup",
    "configure",
    "create",
    "build",
    "start",
    "onboard",
    "intake",
  ]);
  const venueIntakeObject = includesAny(message, [
    "venue",
    "bookable",
    "booking context",
    "inventory",
    "schedule",
    "tee sheet",
    "tables",
    "restaurant",
    "reservations setup",
  ]);
  const bookingContextCommitIntent = includesAny(message, [
    "approve",
    "approved",
    "approve and create",
    "approve & create",
    "approve and run",
    "approve this manifest",
    "commit",
    "run it",
    "create it",
    "create the context",
    "create this context",
    "create booking context",
  ]);

  const reservationExecutionIntent = includesAny(message, [
    "make a reservation",
    "create a reservation",
    "reservation flow",
    "booking reservation",
    "booking.reservation.create",
    "booking.create.booking",
    "create booking",
    "commit booking",
    "book a table",
    "book tee time",
    "reserve for",
    "reservation for",
  ]);

  const hasActiveArtifact = typeof input.pageContext?.activeArtifactId === "string" && input.pageContext.activeArtifactId.trim().length > 0;
  // Narrowed per F2: an active artifact only keeps the intake skill selected when the caller
  // confirms it's a registered intake artifact (activeArtifactIsRegisteredIntake === false rules
  // it out); undefined (caller couldn't tell) preserves the prior any-active-artifact behavior.
  const activeArtifactKeepsIntake = hasActiveArtifact && input.activeArtifactIsRegisteredIntake !== false;
  const commitContext = `${message} ${context}`;
  const canCommitActiveBookingArtifact = !reservationExecutionIntent
    && bookingContextCommitIntent
    && (hasActiveArtifact || includesAny(commitContext, ["manifest", "artifact", "approved intake", "active intake"]));

  if (canCommitActiveBookingArtifact) {
    skills.push("booking.context.create");
  }

  // structural guard specified by Dan (2026-07-08): keep intake skill active while an active intake artifact exists
  if (((setupIntent && venueIntakeObject) || activeArtifactKeepsIntake) && !reservationExecutionIntent && !canCommitActiveBookingArtifact) {
    skills.push("booking.context.intake");
  }

  if (includesAny(message, ["create an event", "set up an event", "event intake", "event setup"])) {
    skills.push("booking.event.create");
  }

  if (includesAny(message, ["campaign template", "campaign wizard", "create campaign", "amplify campaign"])) {
    skills.push("amplify.campaign.template.create");
  }

  if (reservationExecutionIntent && includesAny(`${message} ${context}`, ["booking", "reservation", "tee", "table"])) {
    skills.push("booking.reservation.create");
  }

  return [...new Set(skills)].slice(0, MAX_IMPLICIT_SKILLS);
}
