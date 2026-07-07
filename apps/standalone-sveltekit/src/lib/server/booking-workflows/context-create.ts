export const BOOKING_CONTEXT_CREATE_RECIPE = {
  id: "booking.context.create",
  title: "Create booking context from approved intake",
  description:
    "Convert the active validated booking context intake artifact into a trusted booking.create.context command preview, then commit only through host-approved command execution.",
  intentAliases: [
    "approve booking context",
    "commit booking context",
    "create booking context from intake",
    "approve and create context",
    "approve this manifest",
    "approve this manifest and create the context",
    "create approved manifest",
    "create this booking context",
  ],
  commandSequence: ["readActiveArtifactState", "previewActiveIntakeCommand", "commitActiveIntakeCommand"],
  requiredCommands: ["booking.create.context"],
  forbiddenUnlessExplicit: ["booking.create.booking", "booking.create.hold", "booking.release.hold"],
  workflowSteps: [
    "If no active JSON-render intake artifact is selected, stop and ask the user to create/fill the intake artifact first; do not synthesize a new generic artifact and then commit in the same turn.",
    "When an active artifact exists and the user says approve/commit/run it, call readActiveArtifactState first; never rely on stale chat summaries.",
    "Then call previewActiveIntakeCommand and show/inspect the concrete booking.create.context input.",
    "Only after preview succeeds and the user explicitly asked to approve/run, call commitActiveIntakeCommand with confirmation=APPROVE_AND_RUN. Do not call searchSkillCatalog repeatedly and do not use generic commitCommand for this path.",
    "After commit, report the created booking context id/name and any schedule/resource follow-up still required.",
  ],
  ontologyRules: [
    "Booking context = the business surface, e.g. Dan's Joint or Main Course Tee Sheet.",
    "Resource/table = inventory inside the context, not a separate context unless the resource itself is independently bookable.",
    "Service period = schedule segment such as breakfast, lunch, dinner, or brunch.",
    "Menu = offer/content metadata attached to a service period, not a context by default.",
    "Reservation = a customer booking inside an existing context; use booking.reservation.create, not this skill.",
  ],
  trustedActorRules: [
    "The owning organization and actor/principal come from trusted host session state; never put orgId, organizationId, actorId, principalId, or currentUserId in the command input.",
    "User text approval is not sufficient. The runtime commit must be approved by trusted host approvedCommandIds.",
  ],
  successEvidence: [
    "readActiveArtifactState returns the latest active artifact state and manifest draft.",
    "previewActiveIntakeCommand returns booking.create.context with concrete input.",
    "commitActiveIntakeCommand returns an approved command receipt from the mounted booking runtime.",
  ],
} as const;
