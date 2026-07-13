import assert from "node:assert/strict";
import { resolveEffectivePinnedCapabilities } from "../../packages/tool-contracts/dist/capability-pinning.js";
import { sonikBookingCapabilityRegistry } from "../../packages/tool-contracts/dist/capability-registry.js";

const registry = sonikBookingCapabilityRegistry;
const allowAll = registry.capabilities.map((capability) => ({ capabilityId: capability.capabilityId, mode: "allow" }));

// Baseline: allow grants everywhere, no other layer → everything allow.
const baseline = resolveEffectivePinnedCapabilities({ registry, capabilityGrants: allowAll });
for (const capability of registry.capabilities) {
  assert.equal(baseline[capability.capabilityId], "allow", `${capability.capabilityId} allow at baseline`);
}

// Output is frozen — the pin cannot drift mid-run.
assert.throws(() => { baseline["booking.get.hold"] = "off"; }, /read only|not extensible|Cannot assign/i);

// Most-restrictive-wins disagreement (pre-mortem #2): registry says allow,
// permission modes say ask → ask.
const disagree = resolveEffectivePinnedCapabilities({
  registry,
  capabilityGrants: allowAll,
  toolPermissionModes: { "booking.create.booking": "ask" },
});
assert.equal(disagree["booking.create.booking"], "ask");
assert.equal(disagree["booking.get.availability"], "allow", "other capabilities unaffected");

// Reverse disagreement: permission mode allow cannot resurrect a missing grant.
const noGrant = resolveEffectivePinnedCapabilities({
  registry,
  capabilityGrants: allowAll.filter((grant) => grant.capabilityId !== "booking.release.hold"),
  toolPermissionModes: { "booking.release.hold": "allow" },
});
assert.equal(noGrant["booking.release.hold"], "off", "no grant → off regardless of permissive mode layer");

// approvedCommandIds gates WRITE capabilities only: unapproved write → ask,
// approved write → allow, reads never consult the approval list.
const approvals = resolveEffectivePinnedCapabilities({
  registry,
  capabilityGrants: allowAll,
  approvedCommandIds: ["booking.create.booking"],
});
assert.equal(approvals["booking.create.booking"], "allow", "approved write commits");
assert.equal(approvals["booking.create.guest"], "ask", "unapproved write must still preview/ask");
assert.equal(approvals["booking.get.availability"], "allow", "reads ignore the commit allow-list");

// Three-way disagreement resolves to the most restrictive contribution.
const threeWay = resolveEffectivePinnedCapabilities({
  registry,
  capabilityGrants: allowAll,
  toolPermissionModes: { "booking.create.booking": "off" },
  approvedCommandIds: ["booking.create.booking"],
});
assert.equal(threeWay["booking.create.booking"], "off");

// Kill-switch pins to off even with every other layer permissive.
const killed = resolveEffectivePinnedCapabilities({
  registry,
  capabilityGrants: allowAll,
  toolPermissionModes: { "booking.create.hold": "allow" },
  approvedCommandIds: ["booking.create.hold"],
  revokedCapabilityIds: ["booking.create.hold"],
});
assert.equal(killed["booking.create.hold"], "off");

// Documented Phase 4 landmine: an EMPTY grants list is default-deny for every
// capability. Live wiring must go through grant synthesis first.
const emptyGrants = resolveEffectivePinnedCapabilities({ registry, capabilityGrants: [] });
for (const capability of registry.capabilities) {
  assert.equal(emptyGrants[capability.capabilityId], "off", `${capability.capabilityId} off with no grants`);
}

console.log("capability-pinning.test.mjs passed");
