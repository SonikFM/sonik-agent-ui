// Capability pinning (consensus plan Phase 1, pre-mortem #2). Resolves ONE
// effective mode per registered capability by intersecting the three live
// authority inputs most-restrictive-wins (off > ask > allow), so two
// enforcement paths can never disagree mid-run. The controller calls this
// once at run start and freezes the result for the run's lifetime.
//
// Absence semantics differ per input, deliberately preserved:
// - capability grants are default-deny (no grant → off, per capability-registry);
// - toolPermissionModes are default-allow (absent key → no contribution,
//   matching resolveEffectiveToolPolicy doctrine);
// - approvedCommandIds is a host-signed commit allow-list: it only gates
//   write/destructive/external capabilities, and only when provided —
//   an unapproved write is "ask" (preview allowed, commit needs approval).
//
// NOTE (Phase 4 gate): feeding this an empty grants list turns every
// capability off — live wiring MUST go through grant synthesis first
// (synthesizeCapabilityGrantsFromRuntimeState, Phase 4), never an empty list.

import {
  evaluateCapabilityAccess,
  type CapabilityGrant,
  type CapabilityRegistry,
} from "./capability-registry.js";

export type PinnedCapabilityMode = "off" | "ask" | "allow";

const MODE_RANK: Record<PinnedCapabilityMode, number> = { off: 0, ask: 1, allow: 2 };
const WRITE_EFFECTS = new Set(["write", "destructive", "external"]);

export interface ResolvePinnedCapabilitiesInput {
  registry: CapabilityRegistry;
  capabilityGrants: CapabilityGrant[];
  /** Per-capability-id modes, already resolved from family/command layers by the caller. */
  toolPermissionModes?: Record<string, PinnedCapabilityMode>;
  /** Host-signed commit allow-list; only consulted for write-effect capabilities. */
  approvedCommandIds?: string[];
  /** Per-install kill-switch (D012): revoked ids pin to off. */
  revokedCapabilityIds?: string[];
}

export type PinnedCapabilities = Readonly<Record<string, PinnedCapabilityMode>>;

export function resolveEffectivePinnedCapabilities(input: ResolvePinnedCapabilitiesInput): PinnedCapabilities {
  const approved = input.approvedCommandIds ? new Set(input.approvedCommandIds) : null;
  const pinned: Record<string, PinnedCapabilityMode> = {};
  for (const capability of input.registry.capabilities) {
    const contributions: PinnedCapabilityMode[] = [];
    contributions.push(
      evaluateCapabilityAccess({
        registry: input.registry,
        grants: input.capabilityGrants,
        revokedCapabilityIds: input.revokedCapabilityIds,
        capabilityId: capability.capabilityId,
      }).mode,
    );
    const explicitMode = input.toolPermissionModes?.[capability.capabilityId];
    if (explicitMode) contributions.push(explicitMode);
    if (approved && WRITE_EFFECTS.has(capability.effect)) {
      contributions.push(approved.has(capability.capabilityId) ? "allow" : "ask");
    }
    pinned[capability.capabilityId] = contributions.reduce((most, mode) =>
      MODE_RANK[mode] < MODE_RANK[most] ? mode : most);
  }
  return Object.freeze(pinned);
}
