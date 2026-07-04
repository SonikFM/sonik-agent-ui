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
    "Read the active JSON-render intake artifact state; never rely on stale chat summaries.",
    "Validate the latest persisted manifest and produce the booking.create.context command input preview.",
    "Only commit after the user explicitly asks to approve/run and the trusted host session grants booking.create.context.",
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
    "commitActiveIntakeCommand or commitCommand returns an approved command receipt from the mounted booking runtime.",
  ],
} as const;
