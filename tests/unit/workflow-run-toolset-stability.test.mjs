import assert from "node:assert/strict";
import { resolveCommandFamilyMountDecision } from "../../apps/standalone-sveltekit/src/lib/command-family-mount.ts";
import { isActiveWorkflowRunPhase, resolveImplicitWorkflowSkillSelection } from "../../apps/standalone-sveltekit/src/lib/runtime-skill-intent.ts";

// Consensus plan Phase 3a (.omc/plans/workflow-state-machine-consensus-2026-07-10.md), pre-mortem #3:
// generalizes command-family-mount-stability.test.mjs's Slice E guard up to the workflow layer.
// While a WorkflowRunState is active, runtime-skill-intent must short-circuit keyword re-derivation
// and reuse the run's pinned facade, regardless of what the user types -- so an active run's tools
// never churn mid-workflow even across many turns of keyword drift. Sibling file; does not modify
// tests/unit/command-family-mount-stability.test.mjs.

const bookingPage = {
  surface: "booking-console",
  pageType: "event-booking-detail",
  title: "Main Course Tee Sheet",
  commandFamilies: ["booking", "event"],
  skillFamilies: ["booking-ops"],
  visibleActions: ["createReservation"],
};

// isActiveWorkflowRunPhase: the reducer's terminal/idle phases are NOT active; everything else is.
for (const inactive of ["idle", "committed", "cancelled", "error", undefined, null]) {
  assert.equal(isActiveWorkflowRunPhase(inactive), false, `${inactive} must not read as an active run phase`);
}
for (const active of ["intake", "preview_ready", "approval_requested", "approved", "committing"]) {
  assert.equal(isActiveWorkflowRunPhase(active), true, `${active} must read as an active run phase`);
}

// Drifting keywords across N turns of an active run must never change the resolved skillIds --
// the whole point of the short-circuit is that keyword content stops mattering once a run is active.
const driftingMessages = [
  "what's the capacity limit again?",
  "actually can we talk about something else, like weather",
  "set up my venue please", // would normally seed booking.context.intake -- must NOT while a reservation run is active
  "nevermind, cancel that other thing",
];
const activeRun = { phase: "preview_ready", skillIds: ["booking.reservation.create"] };

for (const [turnIndex, userMessage] of driftingMessages.entries()) {
  const selection = resolveImplicitWorkflowSkillSelection({
    userMessage,
    pageContext: bookingPage,
    activeWorkflowRun: activeRun,
  });
  assert.deepEqual(selection.skillIds, ["booking.reservation.create"], `turn ${turnIndex}: active run facade must be reused verbatim regardless of keyword drift`);
  assert.deepEqual(selection.continuitySkillIds, ["booking.reservation.create"], `turn ${turnIndex}: pinned facade reuse must report as continuity, not fresh intent`);
}

// Once the run reaches a terminal phase, keyword derivation resumes normally.
const afterCommit = resolveImplicitWorkflowSkillSelection({
  userMessage: "set up my venue please",
  pageContext: bookingPage,
  activeWorkflowRun: { phase: "committed", skillIds: ["booking.reservation.create"] },
});
assert.deepEqual(afterCommit.skillIds, ["booking.context.intake"], "a terminal run must not keep short-circuiting keyword derivation");
assert.deepEqual(afterCommit.continuitySkillIds, [], "fresh explicit intent after a terminal run is not continuity");

// End-to-end: the short-circuited selection resolves to a mounted, churn-free command family across
// the same drifting turns (mirrors command-family-mount-stability.test.mjs's mount-decision checks).
for (const userMessage of driftingMessages) {
  const selection = resolveImplicitWorkflowSkillSelection({ userMessage, pageContext: bookingPage, activeWorkflowRun: activeRun });
  const decision = resolveCommandFamilyMountDecision({ skillIds: selection.skillIds, toolsetContinuitySkillIds: selection.continuitySkillIds });
  assert.deepEqual(decision, { mounted: true, wouldMountWithoutStability: true }, "an active reservation-execution run must keep the command family mounted with no churn");
}

console.log("workflow-run-toolset-stability.test.mjs passed");
