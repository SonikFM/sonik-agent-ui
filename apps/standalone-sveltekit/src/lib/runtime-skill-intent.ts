import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";

const MAX_IMPLICIT_SKILLS = 4;

const PRODUCT_TOUR_PHRASES = [
  "product tour",
  "platform tour",
  "show me around",
  "guide me through the platform",
  "onboarding tour",
  "tour of the product",
  "tour of the platform",
];

function normalize(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function isProductTourIntent(value: unknown): boolean {
  const text = normalize(value);
  return Boolean(text) && includesAny(text, PRODUCT_TOUR_PHRASES);
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

export interface ImplicitWorkflowSkillSelection {
  skillIds: string[];
  /**
   * The subset of skillIds that were selected ONLY because of a structural continuity guard
   * (e.g. activeArtifactKeepsIntake below) rather than fresh explicit keyword intent this turn.
   * Command-family mounting (agent.ts's resolveCommandFamilyMountDecision) uses this so an
   * incidental keyword miss mid-workflow doesn't drop tools the user was already using -- the
   * transcript's "booking commands are gone -> check again -> back" churn (Slice E, 2026-07-08).
   */
  continuitySkillIds: string[];
}

/**
 * Phases the workflow-run-state reducer (packages/tool-contracts/src/workflow-run-state.ts)
 * treats as "nothing actionable remains" -- outside this set, a WorkflowRunState is active.
 */
const INACTIVE_WORKFLOW_RUN_PHASES = new Set(["idle", "committed", "cancelled", "error"]);

export interface ActiveWorkflowRunFacade {
  phase: string;
  /** The pinned skill selection for this run, reused as-is while the run stays active. */
  skillIds: string[];
}

export function isActiveWorkflowRunPhase(phase: string | undefined | null): boolean {
  return Boolean(phase) && !INACTIVE_WORKFLOW_RUN_PHASES.has(phase as string);
}

export function resolveImplicitWorkflowSkillSelection(input: {
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
  /**
   * Consensus plan Phase 3a, pre-mortem #3: while a controller-driven WorkflowRunState is active,
   * re-deriving skill ids from this turn's keywords every message is the same toolset-churn bug
   * Slice E fixed one layer down (command-family-mount-stability) -- just moved up to the workflow
   * layer. When the caller has an active run, this short-circuits keyword derivation entirely and
   * reuses the run's pinned facade, reporting it all as continuity (not fresh intent this turn) so
   * resolveCommandFamilyMountDecision's stability rule keeps tools mounted regardless of drift.
   */
  activeWorkflowRun?: ActiveWorkflowRunFacade | null;
}): ImplicitWorkflowSkillSelection {
  if (input.activeWorkflowRun && isActiveWorkflowRunPhase(input.activeWorkflowRun.phase)) {
    const pinned = [...new Set(input.activeWorkflowRun.skillIds)].slice(0, MAX_IMPLICIT_SKILLS);
    return { skillIds: pinned, continuitySkillIds: pinned };
  }
  const message = normalize(input.userMessage ?? input.firstUserMessage);
  if (!message) return { skillIds: [], continuitySkillIds: [] };
  if (isProductTourIntent(message)) return { skillIds: [], continuitySkillIds: [] };
  const context = contextText(input.pageContext);
  const skills: string[] = [];
  const continuitySkills: string[] = [];

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
    "creating a reservation",
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
  const explicitIntakeIntent = setupIntent && venueIntakeObject;
  if ((explicitIntakeIntent || activeArtifactKeepsIntake) && !reservationExecutionIntent && !canCommitActiveBookingArtifact) {
    skills.push("booking.context.intake");
    // Selected only via the continuity guard (no fresh explicit intent this turn) -- record it
    // so command-family mounting can tell "carried over on a keyword miss" apart from "the user
    // just explicitly started intake" (Slice E stability rule).
    if (!explicitIntakeIntent) continuitySkills.push("booking.context.intake");
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

  const skillIds = [...new Set(skills)].slice(0, MAX_IMPLICIT_SKILLS);
  return {
    skillIds,
    continuitySkillIds: continuitySkills.filter((id) => skillIds.includes(id)),
  };
}

/**
 * Backward-compatible accessor: most callers only need the resolved skill ids, not the
 * continuity metadata (used by agent.ts's command-family stability rule). Kept as a thin
 * wrapper so existing call sites and tests are unaffected.
 */
export function resolveImplicitWorkflowSkillIds(input: Parameters<typeof resolveImplicitWorkflowSkillSelection>[0]): string[] {
  return resolveImplicitWorkflowSkillSelection(input).skillIds;
}
