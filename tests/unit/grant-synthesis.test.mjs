import assert from "node:assert/strict";
import { resolveEffectiveToolPolicy } from "../../packages/tool-contracts/dist/index.js";
import { sonikBookingCapabilityRegistry } from "../../packages/tool-contracts/dist/capability-registry.js";
import { resolveEffectivePinnedCapabilities } from "../../packages/tool-contracts/dist/capability-pinning.js";
import { synthesizeCapabilityGrantsFromRuntimeState, resolveCapabilityToolPermissionModes } from "../../packages/tool-contracts/dist/grant-synthesis.js";

// Phase 4 grant-synthesis parity test (consensus plan, "Grant-synthesis
// sub-step, must land first"). Proves synthesizeCapabilityGrantsFromRuntimeState
// + resolveCapabilityToolPermissionModes -> resolveEffectivePinnedCapabilities
// reproduces EXACTLY today's live allow/ask/off outcome -- computed
// independently via resolveEffectiveToolPolicy (the real, currently-shipped
// function) plus the write-only approvedCommandIds gate -- for every
// registered booking capability id, with no capability silently flipping to
// off.

const registry = sonikBookingCapabilityRegistry;

// Representative capabilityId -> familyId mapping (capability ids ARE
// command ids per D013; families mirror AGENT_TOOL_FAMILY_OPTIONS ids).
// booking.create.hold sits in "booking-holds" while the capability it
// implies, booking.get.availability, sits in the separate "booking" family --
// deliberately, to prove restricting one family never bleeds through the
// registry's write-implies-read edges into an unrelated family's capability.
const capabilityFamilyIds = {
  "booking.list.contexts": "booking",
  "booking.get.availability": "booking",
  "booking.get.hold": "booking-holds",
  "booking.create.hold": "booking-holds",
  "booking.release.hold": "booking-holds",
  "booking.create.guest": "booking-guests",
  "booking.create.booking": "bookings",
  "booking.create.context": "booking",
};

const WRITE_EFFECTS = new Set(["write", "destructive", "external"]);

// Ground truth, computed independently of grant-synthesis: today's real
// resolveEffectiveToolPolicy (family/command modes, absence == allow) plus
// the separate write-only approvedCommandIds gate. No implication concept --
// today's live enforcement has none.
function expectedMode(capability, { familyModes, commandModes, approvedCommandIds, revokedCapabilityIds } = {}) {
  if (revokedCapabilityIds?.includes(capability.capabilityId)) return "off";
  const fakeCommand = { id: capability.capabilityId, familyId: capabilityFamilyIds[capability.capabilityId] };
  const toolPolicyMode = resolveEffectiveToolPolicy(fakeCommand, { familyModes, commandModes });
  const modes = [toolPolicyMode];
  if (approvedCommandIds !== undefined && WRITE_EFFECTS.has(capability.effect)) {
    modes.push(approvedCommandIds.includes(capability.capabilityId) ? "allow" : "ask");
  }
  const rank = { off: 0, ask: 1, allow: 2 };
  return modes.reduce((most, mode) => (rank[mode] < rank[most] ? mode : most));
}

function assertParity(label, runtimeState) {
  const grants = synthesizeCapabilityGrantsFromRuntimeState({ registry });
  const toolPermissionModes = resolveCapabilityToolPermissionModes({
    registry,
    capabilityFamilyIds,
    familyModes: runtimeState.familyModes,
    commandModes: runtimeState.commandModes,
  });
  const pinned = resolveEffectivePinnedCapabilities({
    registry,
    capabilityGrants: grants,
    toolPermissionModes,
    approvedCommandIds: runtimeState.approvedCommandIds,
    revokedCapabilityIds: runtimeState.revokedCapabilityIds,
  });
  for (const capability of registry.capabilities) {
    const expected = expectedMode(capability, runtimeState);
    assert.equal(
      pinned[capability.capabilityId],
      expected,
      `${label}: ${capability.capabilityId} expected ${expected}, got ${pinned[capability.capabilityId]}`,
    );
    assert.notEqual(pinned[capability.capabilityId], undefined, `${label}: ${capability.capabilityId} must not be silently dropped`);
  }
}

// 1. No policy input at all: every read allows, unapproved writes ask.
assertParity("no policy input", { approvedCommandIds: [] });

// 2. Family set to ask -- also the implication-bleed adversarial case:
// booking.create.hold's own family goes to ask while the family covering the
// capability it implies (booking.get.availability) stays untouched.
assertParity("family ask", {
  familyModes: { "booking-holds": "ask" },
  approvedCommandIds: ["booking.create.hold"],
});

// 3. Family set to off.
assertParity("family off", {
  familyModes: { bookings: "off" },
  approvedCommandIds: ["booking.create.booking"],
});

// 4. Per-command override more restrictive than family.
assertParity("per-command override", {
  familyModes: { "booking-holds": "allow" },
  commandModes: { "booking.release.hold": "off" },
  approvedCommandIds: [],
});

// 5. Approved vs unapproved write commands.
assertParity("approved vs unapproved writes", {
  approvedCommandIds: ["booking.create.booking"],
});

// 6. Kill-switch layered on top of an otherwise fully-permissive state.
assertParity("kill switch", {
  familyModes: { "booking-holds": "allow" },
  approvedCommandIds: ["booking.create.hold"],
  revokedCapabilityIds: ["booking.create.hold"],
});

// Direct spot-check on the no-policy-input case, per the plan's explicit
// wording: "everything allow except unapproved writes -> ask".
{
  const grants = synthesizeCapabilityGrantsFromRuntimeState({ registry });
  const pinned = resolveEffectivePinnedCapabilities({ registry, capabilityGrants: grants, approvedCommandIds: [] });
  assert.equal(pinned["booking.get.availability"], "allow", "unaffected read allows");
  assert.equal(pinned["booking.create.hold"], "ask", "unapproved write asks");
  assert.equal(pinned["booking.create.guest"], "ask", "unapproved write asks");
  assert.equal(pinned["booking.create.booking"], "ask", "unapproved write asks");
}

// Implication-bleed regression guard: restricting booking-holds must never
// touch booking.get.availability, which lives in a different family and is
// merely implied by booking.create.hold's registry edge.
{
  const grants = synthesizeCapabilityGrantsFromRuntimeState({ registry });
  const toolPermissionModes = resolveCapabilityToolPermissionModes({
    registry,
    capabilityFamilyIds,
    familyModes: { "booking-holds": "off" },
  });
  const pinned = resolveEffectivePinnedCapabilities({ registry, capabilityGrants: grants, toolPermissionModes, approvedCommandIds: [] });
  assert.equal(pinned["booking.create.hold"], "off", "booking-holds family off applies to its own capability");
  assert.equal(pinned["booking.get.availability"], "allow", "unrelated implied capability must not inherit a sibling family's restriction");
}

console.log("grant-synthesis.test.mjs passed");
