// Phase 4 grant synthesis (consensus plan, "Grant-synthesis sub-step").
//
// Today's live enforcement for booking commands never calls
// evaluateCapabilityAccess — it resolves entirely from toolPermissionModes
// (resolveEffectiveToolPolicy's familyModes/commandModes, absence == allow)
// and, separately, context.approvedCommandIds. Feeding resolveEffectivePinnedCapabilities
// an empty capabilityGrants list would default-deny every capability (see
// capability-pinning.ts), silently turning every currently-allowed booking
// write off. synthesizeCapabilityGrantsFromRuntimeState fixes that landmine
// by granting "allow" to every registered capability as the baseline.
//
// Family/command modes are deliberately NOT encoded into that grants list.
// capabilityGrants flows through evaluateCapabilityAccess's implies graph
// (write-implies-read, for sparse marketplace-package grants) — proven by
// this module's own parity test to leak restriction across unrelated
// capabilities: granting family "booking-holds" -> "ask" as a dense
// {capabilityId: "booking.create.hold", mode: "ask"} grant also drags down
// "booking.get.availability" (a different family, its own grant "allow")
// because booking.create.hold's registry-fixed `implies` edge names it.
// Today's real per-command/per-family enforcement has no such cross-capability
// effect, so routing restriction through the grants layer would silently
// break parity. resolveCapabilityToolPermissionModes instead produces the
// flat, non-implicating per-capability mode map that resolveEffectivePinnedCapabilities's
// own `toolPermissionModes` parameter expects (already-resolved, no implies
// traversal) — this is the layer built for exactly this input.
//
// approvedCommandIds is deliberately NOT synthesized here at all.
// resolveEffectivePinnedCapabilities already layers it in directly as its
// own write-only gate (capability-pinning.ts); synthesizing it into either
// output would double-count that layer.

import { type CapabilityGrant, type CapabilityRegistry } from "./capability-registry.js";

export type CapabilityToolPolicyMode = "off" | "ask" | "allow";

const MODE_RANK: Record<CapabilityToolPolicyMode, number> = { off: 0, ask: 1, allow: 2 };

export interface SynthesizeCapabilityGrantsInput {
  registry: CapabilityRegistry;
}

/**
 * Baseline grant synthesis: "allow" for every registered capability. No
 * policy input means allow (matching resolveEffectiveToolPolicy's default) —
 * this is the whole job of this function. Actual family/command restriction
 * is applied separately via {@link resolveCapabilityToolPermissionModes}.
 */
export function synthesizeCapabilityGrantsFromRuntimeState(input: SynthesizeCapabilityGrantsInput): CapabilityGrant[] {
  return input.registry.capabilities.map((capability) => ({ capabilityId: capability.capabilityId, mode: "allow" as const }));
}

export interface ResolveCapabilityToolPermissionModesInput {
  registry: CapabilityRegistry;
  /** capabilityId -> familyId (capability ids ARE command ids per D013, e.g.
   *  CommandDescriptor.familyId). Explicit input, not hardcoded — the
   *  registry itself carries no family membership. */
  capabilityFamilyIds: Record<string, string>;
  /** Mirrors ToolPolicyInput.familyModes (index.ts) keyed by familyId. */
  familyModes?: Record<string, CapabilityToolPolicyMode>;
  /** Mirrors ToolPolicyInput.commandModes (index.ts) keyed by capabilityId. */
  commandModes?: Record<string, CapabilityToolPolicyMode>;
}

/**
 * Resolves one effective mode per registered capability from family/command
 * modes, most-restrictive-wins — the same combination resolveEffectiveToolPolicy
 * does per command, just precomputed flat so resolveEffectivePinnedCapabilities's
 * non-implicating toolPermissionModes parameter can consume it directly. A
 * capability with no matching family or command mode is omitted (absence ==
 * no contribution, matching resolveEffectivePinnedCapabilities's semantics).
 */
export function resolveCapabilityToolPermissionModes(input: ResolveCapabilityToolPermissionModesInput): Record<string, CapabilityToolPolicyMode> {
  const modes: Record<string, CapabilityToolPolicyMode> = {};
  for (const capability of input.registry.capabilities) {
    const familyId = input.capabilityFamilyIds[capability.capabilityId];
    const candidates: CapabilityToolPolicyMode[] = [];
    const familyMode = familyId ? input.familyModes?.[familyId] : undefined;
    if (familyMode) candidates.push(familyMode);
    const commandMode = input.commandModes?.[capability.capabilityId];
    if (commandMode) candidates.push(commandMode);
    if (candidates.length === 0) continue;
    modes[capability.capabilityId] = candidates.reduce((mostRestrictive, candidate) =>
      (MODE_RANK[candidate] < MODE_RANK[mostRestrictive] ? candidate : mostRestrictive));
  }
  return modes;
}
