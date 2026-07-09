// Pure runtime-skill / command-family mount decision logic, extracted from agent.ts (Slice E,
// 2026-07-08). agent.ts pulls in `ai`, `$env` and other Vite/SvelteKit-only modules, so it can only
// ever be imported for *types* in the plain-node unit chain. Keeping this branch logic in its own
// dependency-free leaf module lets it be unit-tested directly (tests/unit/command-family-mount-stability.test.mjs).

const PREVIEW_ONLY_RUNTIME_SKILL_IDS = new Set([
  "booking.context.intake",
  "booking-context-intake",
  "booking.event.create",
  "booking-event",
  "amplify.campaign.template.create",
  "amplify-campaign-template",
]);
const EXECUTION_RUNTIME_SKILL_IDS = new Set([
  "booking.reservation.create",
  "booking-reservation",
  "booking.context.create",
  "booking-context-create",
]);

function normalizedSkillIds(skillIds: string[] | undefined): string[] {
  return (skillIds ?? []).map((id) => String(id).trim()).filter(Boolean);
}

export function hasPreviewOnlyRuntimeSkill(skillIds: string[] | undefined): boolean {
  const ids = normalizedSkillIds(skillIds);
  if (ids.some((id) => EXECUTION_RUNTIME_SKILL_IDS.has(id))) return false;
  return ids.some((id) => PREVIEW_ONLY_RUNTIME_SKILL_IDS.has(id));
}

export function hasBookingContextIntakeSkill(skillIds: string[] | undefined): boolean {
  const ids = normalizedSkillIds(skillIds);
  if (ids.some((id) => EXECUTION_RUNTIME_SKILL_IDS.has(id))) return false;
  return ids.some((id) => id === "booking.context.intake" || id === "booking-context-intake");
}

export function hasBookingContextCreateSkill(skillIds: string[] | undefined): boolean {
  return normalizedSkillIds(skillIds).some((id) => id === "booking.context.create" || id === "booking-context-create");
}

function previewOnlySkillsAreContinuityOnly(skillIds: string[] | undefined, continuitySkillIds: string[] | undefined): boolean {
  const previewOnlyIds = normalizedSkillIds(skillIds).filter((id) => PREVIEW_ONLY_RUNTIME_SKILL_IDS.has(id));
  if (previewOnlyIds.length === 0) return false;
  const continuitySet = new Set(normalizedSkillIds(continuitySkillIds));
  return previewOnlyIds.every((id) => continuitySet.has(id));
}

export interface CommandFamilyMountDecision {
  /** Whether the booking command-catalog family is actually mounted for this turn. */
  mounted: boolean;
  /** What `mounted` would be if the Slice E continuity stability rule below were absent. */
  wouldMountWithoutStability: boolean;
}

/**
 * Decides whether the booking command-catalog tool family stays mounted this turn (R6/Slice E,
 * 2026-07-08). A preview-only runtime skill (e.g. booking.context.intake) normally suppresses the
 * command catalog while an intake/preview flow is active. But when that skill is present ONLY
 * because of runtime-skill-intent's continuity guard (an active workflow artifact carried it over
 * on an incidental keyword miss, not fresh explicit intent this turn), suppressing commands is the
 * exact churn Dan's transcript reported ("booking commands are gone -> check again -> back"). The
 * family only shrinks on an explicit context change now: fresh explicit preview-only intent, an
 * explicit booking.context.create (approve/commit) turn, or the workflow/artifact clearing (which
 * naturally drops the preview-only skill from skillIds entirely).
 */
export function resolveCommandFamilyMountDecision(context: { skillIds?: string[]; toolsetContinuitySkillIds?: string[] }): CommandFamilyMountDecision {
  const previewOnlyRuntimeActive = hasPreviewOnlyRuntimeSkill(context.skillIds);
  const bookingContextCreateActive = hasBookingContextCreateSkill(context.skillIds);
  const previewSuppressesCommands = previewOnlyRuntimeActive || bookingContextCreateActive;
  const stabilityKeepsMounted = previewOnlyRuntimeActive
    && !bookingContextCreateActive
    && previewOnlySkillsAreContinuityOnly(context.skillIds, context.toolsetContinuitySkillIds);
  return {
    mounted: !previewSuppressesCommands || stabilityKeepsMounted,
    wouldMountWithoutStability: !previewSuppressesCommands,
  };
}
