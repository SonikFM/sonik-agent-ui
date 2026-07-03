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

export function resolveImplicitWorkflowSkillIds(input: { userMessage?: string | null; firstUserMessage?: string | null; pageContext?: AgentPageContext }): string[] {
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
  const reservationExecutionIntent = includesAny(message, [
    "make a reservation",
    "create a reservation",
    "book a table",
    "book tee time",
    "reserve for",
    "reservation for",
  ]);

  if (setupIntent && venueIntakeObject && !reservationExecutionIntent) {
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
