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
  commandSequence: ["readActiveArtifactState", "previewActiveIntakeCommand"],
  requiredCommands: ["booking.create.context"],
  forbiddenUnlessExplicit: ["booking.create.booking", "booking.create.hold", "booking.release.hold"],
  workflowSteps: [
    "If no active intake artifact is selected, ask the user to create/fill one first; do not synthesize a generic artifact and commit in the same turn.",
    "When an active artifact exists and the user says approve/commit/run, call readActiveArtifactState first; never rely on stale chat summaries.",
    "Then call previewActiveIntakeCommand and inspect the concrete booking.create.context input, then show it to the user and stop.",
    "Draft-only: there is no commit tool here. The user's Approve click, not the model, publishes it. Do not claim the context was created; do not repeatedly call searchSkillCatalog.",
  ],
  ontologyRules: [
    "Booking context = the business surface (e.g. Dan's Joint, Main Course Tee Sheet).",
    "Resource/table = inventory inside the context; only a separate context if independently bookable.",
    "Service period = schedule segment (breakfast, lunch, dinner, brunch).",
    "Menu = offer/content metadata on a service period, not a context by default.",
    "Reservation = a customer booking inside an existing context; use booking.reservation.create instead.",
  ],
  trustedActorRules: [
    "Organization and actor come from trusted host session state; never put orgId/organizationId/actorId/principalId/currentUserId in the command input.",
    "User text approval alone is insufficient; the runtime commit must carry trusted host approvedCommandIds.",
  ],
  successEvidence: [
    "readActiveArtifactState returns the latest active artifact state and manifest draft.",
    "previewActiveIntakeCommand returns booking.create.context with concrete input, shown to the user as the approval preview.",
    "commit.human_approved telemetry records the actual publish, fired by the /api/intake/commit endpoint on Approve — never a model tool call.",
  ],
} as const;
