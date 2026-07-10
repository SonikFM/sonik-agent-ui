import assert from "node:assert/strict";
import { resolveCommandFamilyMountDecision } from "../../apps/standalone-sveltekit/src/lib/command-family-mount.ts";
import { resolveImplicitWorkflowSkillSelection } from "../../apps/standalone-sveltekit/src/lib/runtime-skill-intent.ts";

// Slice E toolset stability (2026-07-08): a preview-only runtime skill normally suppresses the
// booking command catalog. But when it is present ONLY because runtime-skill-intent's continuity
// guard carried it over (no fresh explicit intent this turn), suppressing the family is the exact
// "commands gone -> check again -> back" churn Dan reported. resolveCommandFamilyMountDecision keeps
// the family mounted in that case, and only that case.

// 1. No preview-only skill -> family mounts, no stability involved.
assert.deepEqual(
  resolveCommandFamilyMountDecision({ skillIds: [], toolsetContinuitySkillIds: [] }),
  { mounted: true, wouldMountWithoutStability: true },
  "with no preview-only skill the command family mounts normally",
);

// 2. Fresh explicit preview-only intent (not continuity) -> correctly suppressed.
assert.deepEqual(
  resolveCommandFamilyMountDecision({ skillIds: ["booking.context.intake"], toolsetContinuitySkillIds: [] }),
  { mounted: false, wouldMountWithoutStability: false },
  "a preview-only skill from fresh explicit intent still suppresses the command family",
);

// 3. Preview-only skill carried over by continuity ONLY -> stability keeps it mounted (churn averted).
assert.deepEqual(
  resolveCommandFamilyMountDecision({ skillIds: ["booking.context.intake"], toolsetContinuitySkillIds: ["booking.context.intake"] }),
  { mounted: true, wouldMountWithoutStability: false },
  "a continuity-only preview-only skill must keep the command family mounted (no churn)",
);

// 4. Approve/commit (booking.context.create) turn -> suppressed regardless of continuity.
assert.deepEqual(
  resolveCommandFamilyMountDecision({ skillIds: ["booking.context.create"], toolsetContinuitySkillIds: [] }),
  { mounted: false, wouldMountWithoutStability: false },
  "a booking.context.create turn suppresses the read-only command family and stability does not override it",
);

// resolveImplicitWorkflowSkillSelection must flag continuity-carried intake so (3) can fire.
const bookingPage = {
  surface: "booking-console",
  pageType: "event-booking-detail",
  title: "Main Course Tee Sheet",
  commandFamilies: ["booking", "event"],
  skillFamilies: ["booking-ops"],
  visibleActions: ["createReservation"],
};

// Incidental message (no setup keyword) over an active registered intake artifact:
// intake is kept by continuity only -> reported in continuitySkillIds.
const carried = resolveImplicitWorkflowSkillSelection({
  userMessage: "what's the capacity limit again?",
  pageContext: { ...bookingPage, activeArtifactId: "artifact-1", artifactType: "json-render" },
  activeArtifactIsRegisteredIntake: true,
});
assert.deepEqual(carried.skillIds, ["booking.context.intake"], "active intake artifact keeps intake selected");
assert.deepEqual(carried.continuitySkillIds, ["booking.context.intake"], "carried-over intake must be flagged as continuity-only");

// Explicit venue setup intent: intake is fresh, NOT continuity.
const explicit = resolveImplicitWorkflowSkillSelection({
  firstUserMessage: "I want to set up my venue for bookings.",
  pageContext: bookingPage,
});
assert.deepEqual(explicit.skillIds, ["booking.context.intake"], "venue setup seeds intake");
assert.deepEqual(explicit.continuitySkillIds, [], "fresh explicit intake must not be flagged as continuity");

// End-to-end: the continuity selection feeds a mount decision that averts churn.
assert.deepEqual(
  resolveCommandFamilyMountDecision({ skillIds: carried.skillIds, toolsetContinuitySkillIds: carried.continuitySkillIds }),
  { mounted: true, wouldMountWithoutStability: false },
  "continuity selection must resolve to a mounted family with churn averted",
);


// Product-tour turns suppress the command catalog before normal skill/stability logic.
assert.deepEqual(
  resolveCommandFamilyMountDecision({ skillIds: ["booking.reservation.create"], suppressCommandCatalog: true }),
  { mounted: false, wouldMountWithoutStability: false },
  "product tour suppression must keep command catalog unmounted even if executable booking skills are present",
);

console.log("command-family-mount-stability.test.mjs passed");
