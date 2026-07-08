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
  resolveImplicitWorkflowSkillIds({ userMessage: "commit", pageContext: { ...bookingPage, activeArtifactId: "artifact-1", artifactType: "json-render" } }),
  ["booking.context.create"],
  "short approval/commit turns over an active artifact must seed the trusted context-create workflow",
);

assert.deepEqual(
  resolveImplicitWorkflowSkillIds({ userMessage: "Create a booking context for a restaurant named Smoke Test Cafe with 8 tables", pageContext: bookingPage }),
  ["booking.context.intake"],
  "initial create-context setup without an active artifact must seed intake instead of trusted commit tools",
);

assert.deepEqual(
  resolveImplicitWorkflowSkillIds({ firstUserMessage: "Create a reservation for Dan at 1pm", pageContext: bookingPage }),
  ["booking.reservation.create"],
  "reservation execution intent should still seed reservation workflow, not intake",
);

assert.deepEqual(
  resolveImplicitWorkflowSkillIds({ userMessage: "Use the booking command catalog to prove the reservation flow, check availability, create a guest, and commit booking.create.booking.", pageContext: bookingPage }),
  ["booking.reservation.create"],
  "Pipe-B reservation smoke phrasing must seed the executable reservation workflow so command tools mount",
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

// Structural guard specified by Dan (2026-07-08): keep the intake skill active while an active
// intake artifact exists, so conversational answer turns ("Open Tuesday to Sunday, 9 tables")
// still mount submitIntakeAnswer instead of dropping the skill because the phrasing lacks a
// setup/configure verb.
assert.deepEqual(
  resolveImplicitWorkflowSkillIds({
    userMessage: "Open Tuesday to Sunday, 9 tables",
    pageContext: { ...bookingPage, activeArtifactId: "artifact-1", artifactType: "json-render" },
  }),
  ["booking.context.intake"],
  "answer-turn phrasing over an active intake artifact must keep booking.context.intake selected",
);

assert.deepEqual(
  resolveImplicitWorkflowSkillIds({ userMessage: "Open Tuesday to Sunday, 9 tables", pageContext: bookingPage }),
  [],
  "the same answer-turn phrasing without an active artifact must not select booking.context.intake",
);

// F2 fix (2026-07-08, pressure-test finding): the structural guard above must only keep
// booking.context.intake selected when the active artifact is a REGISTERED intake artifact
// (has QuestionCard questions), not any active artifact (e.g. a generic createJsonArtifact
// canvas), otherwise submitIntakeAnswer mounts and every chat turn fails with unknown_question_id.
assert.deepEqual(
  resolveImplicitWorkflowSkillIds({
    userMessage: "Open Tuesday to Sunday, 9 tables",
    pageContext: { ...bookingPage, activeArtifactId: "artifact-1", artifactType: "json-render" },
    activeArtifactIsRegisteredIntake: false,
  }),
  [],
  "activeArtifactIsRegisteredIntake:false must narrow the guard so a generic active artifact does not keep booking.context.intake selected",
);

assert.deepEqual(
  resolveImplicitWorkflowSkillIds({
    userMessage: "Open Tuesday to Sunday, 9 tables",
    pageContext: { ...bookingPage, activeArtifactId: "artifact-1", artifactType: "json-render" },
    activeArtifactIsRegisteredIntake: true,
  }),
  ["booking.context.intake"],
  "activeArtifactIsRegisteredIntake:true must keep booking.context.intake selected",
);

assert.deepEqual(
  resolveImplicitWorkflowSkillIds({
    userMessage: "Open Tuesday to Sunday, 9 tables",
    pageContext: { ...bookingPage, activeArtifactId: "artifact-1", artifactType: "json-render" },
  }),
  ["booking.context.intake"],
  "activeArtifactIsRegisteredIntake:undefined (caller couldn't tell) must preserve prior any-active-artifact behavior",
);

console.log("runtime-skill-intent tests passed");
