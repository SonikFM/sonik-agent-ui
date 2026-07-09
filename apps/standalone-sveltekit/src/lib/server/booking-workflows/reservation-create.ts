import { commandWorkflowRecipeSchema, type CommandWorkflowRecipe } from "@sonik-agent-ui/tool-contracts";

export const BOOKING_RESERVATION_CREATE_RECIPE = commandWorkflowRecipeSchema.parse({
  id: "booking.reservation.create",
  title: "Create booking reservation",
  description: "Canonical agent workflow for creating a durable booking reservation from page context.",
  familyId: "booking",
  intentAliases: ["create reservation", "make booking", "book tee time", "create booking", "reserve a slot"],
  canonicalRegressionPrompt: "Create a reservation for Dan at 1pm July 1 for 3.",
  commandSequence: ["booking.get.availability", "previewBookingReservationCommand"],
  steps: [
    {
      commandId: "booking.get.availability",
      action: "execute",
      why: "Prove the requested time and party size are available in the current booking context before mutating state.",
      requiredBefore: [],
    },
    {
      commandId: "previewBookingReservationCommand",
      action: "execute",
      why: "Prepare the guest and booking payload as a human approval preview. The user clicks Approve to run /api/reservation/commit; the model never calls booking.create.guest or booking.create.booking.",
      requiredBefore: ["booking.get.availability"],
    },
  ],
  forbiddenUnlessExplicit: ["booking.create.hold"],
  actorFields: ["userId", "principalId", "organizationId"],
  guestFields: ["guestLabel", "guestEmail", "guestId", "customerId"],
  trustedActorRules: [
    "Do not invent, edit, or provision trusted actor fields from model reasoning.",
    "Do not create a guest/customer record to satisfy a trusted host principal or actor userId error.",
    "Use CURRENT_HOST_PRINCIPAL_ID only when the learned schema/example explicitly requires the host principal sentinel; otherwise use resolved guest/customer identity fields exactly as the learned command schema requires.",
  ],
  pageContextRequirements: [
    "activeEntity.id or donated booking contextId",
    "authenticated host session",
    "organizationId from host auth context",
    "booking:read scope",
    "booking:write scope for create.guest/create.booking",
  ],
  successEvidence: [
    "booking.get.availability receipt ok=true for the requested slot",
    "previewBookingReservationCommand receipt ok=true with guest and booking payload",
    "commit.human_approved telemetry contains booking.create.guest and booking.create.booking after user approval",
    "Pipe B telemetry contains availability, preview, and human-approved commit events for the same session/request chain",
  ],
  negativeTranscriptRegression: {
    prompt: "Create a reservation for Dan at 1pm July 1 for 3.",
    failIfCommandIds: ["booking.create.hold"],
    failIfActorFieldsMutated: ["userId", "principalId", "organizationId"],
    failIfRationalesContain: [
      "create a hold",
      "found it! booking.create.hold",
      "principal ID doesn't exist as a user",
      "create a guest for it",
      "use that principal as a guest",
    ],
    expectedCommandPath: ["booking.get.availability", "previewBookingReservationCommand"],
  },
} satisfies CommandWorkflowRecipe);

export const BOOKING_WORKFLOW_RECIPES = [BOOKING_RESERVATION_CREATE_RECIPE] as const;
