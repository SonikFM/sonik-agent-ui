import assert from "node:assert/strict";
import { resolveImplicitWorkflowSkillIds } from "../../apps/standalone-sveltekit/src/lib/runtime-skill-intent.ts";

const bookingPage = {
  surface: "booking-console",
  pageType: "event-booking-detail",
  title: "Main Course Tee Sheet",
  commandFamilies: ["booking", "event"],
  skillFamilies: ["booking-ops"],
  visibleActions: ["createReservation"],
};

assert.deepEqual(
  resolveImplicitWorkflowSkillIds({ firstUserMessage: "I want to set up my venue for bookings.", pageContext: bookingPage }),
  ["booking.context.intake"],
  "venue setup must seed booking.context.intake rather than leaving the model to drift into command reads",
);


assert.deepEqual(
  resolveImplicitWorkflowSkillIds({ userMessage: "approve this manifest and create the context", pageContext: { ...bookingPage, activeArtifactId: "artifact-1", artifactType: "json-render" } }),
  ["booking.context.create"],
  "approval/commit turns over an active artifact should seed the trusted booking context create workflow",
);

assert.deepEqual(
  resolveImplicitWorkflowSkillIds({ firstUserMessage: "Create a reservation for Dan at 1pm", pageContext: bookingPage }),
  ["booking.reservation.create"],
  "reservation execution intent should still seed reservation workflow, not intake",
);

assert.deepEqual(
  resolveImplicitWorkflowSkillIds({
    firstUserMessage: "I want to set up my venue for bookings.",
    userMessage: "Create a reservation for Dan at 1pm",
    pageContext: bookingPage,
  }),
  ["booking.reservation.create"],
  "latest user turn must override an earlier setup/intake turn so reservation commands stay available",
);

assert.deepEqual(
  resolveImplicitWorkflowSkillIds({ firstUserMessage: "Help me create a campaign wizard template", pageContext: { surface: "amplify" } }),
  ["amplify.campaign.template.create"],
);

assert.deepEqual(
  resolveImplicitWorkflowSkillIds({ firstUserMessage: "What can you see about this page?", pageContext: bookingPage }),
  [],
  "ordinary page questions must not inject workflow skills",
);

console.log("runtime-skill-intent tests passed");
