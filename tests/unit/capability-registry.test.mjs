import assert from "node:assert/strict";
import {
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
  capabilityGrantsFromPermissions,
  capabilityRegistrySchema,
  collectManifestPermissionGrants,
  evaluateCapabilityAccess,
  findUnregisteredCapabilityIds,
  parseVersionedCapabilityId,
  resolveImpliedCapabilityIds,
  sonikBookingCapabilityRegistry,
  versionedCapabilityId,
} from "../../packages/tool-contracts/dist/capability-registry.js";
import {
  restaurantSetupAppManifest,
  restaurantSetupBundleManifest,
} from "../../packages/tool-contracts/dist/marketplace-fixtures.js";

const registry = sonikBookingCapabilityRegistry;

// Registry shape.
assert.equal(registry.schemaVersion, CAPABILITY_REGISTRY_SCHEMA_VERSION);
assert.equal(capabilityRegistrySchema.safeParse(registry).success, true, "seed registry validates");

// Duplicate ids rejected.
assert.equal(
  capabilityRegistrySchema.safeParse({
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    capabilities: [
      { capabilityId: "booking.get.hold", version: 1, title: "A", effect: "read" },
      { capabilityId: "booking.get.hold", version: 2, title: "B", effect: "read" },
    ],
  }).success,
  false,
  "duplicate capability ids rejected",
);

// Dangling implies edge rejected.
assert.equal(
  capabilityRegistrySchema.safeParse({
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    capabilities: [
      { capabilityId: "booking.create.hold", version: 1, title: "A", effect: "write", implies: ["booking.get.hold"] },
    ],
  }).success,
  false,
  "implies edge to unregistered capability rejected",
);

// Privilege-escalating implication rejected (read must never imply write).
assert.equal(
  capabilityRegistrySchema.safeParse({
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    capabilities: [
      { capabilityId: "booking.get.hold", version: 1, title: "A", effect: "read", implies: ["booking.create.hold"] },
      { capabilityId: "booking.create.hold", version: 1, title: "B", effect: "write" },
    ],
  }).success,
  false,
  "implication may not escalate privilege",
);

// Versioned id round-trip.
assert.equal(versionedCapabilityId({ capabilityId: "booking.create.booking", version: 1 }), "booking.create.booking@v1");
assert.deepEqual(parseVersionedCapabilityId("booking.create.booking@v2"), { capabilityId: "booking.create.booking", version: 2 });
assert.equal(parseVersionedCapabilityId("Booking.Create@v1"), null, "uppercase ids rejected");
assert.equal(parseVersionedCapabilityId("booking.create.booking"), null, "unversioned form is not a versioned id");

// Implication closure is transitive.
assert.deepEqual(
  resolveImpliedCapabilityIds(registry, "booking.create.hold").sort(),
  ["booking.get.availability", "booking.get.hold"],
);

// Default deny: no grant.
assert.deepEqual(
  evaluateCapabilityAccess({ registry, grants: [], capabilityId: "booking.get.hold" }),
  { mode: "off", reason: "no_grant" },
);

// Default deny: unregistered capability.
assert.deepEqual(
  evaluateCapabilityAccess({ registry, grants: [{ capabilityId: "booking.get.hold", mode: "allow" }], capabilityId: "booking.delete.everything" }),
  { mode: "off", reason: "capability_not_registered" },
);

// Direct grant.
assert.deepEqual(
  evaluateCapabilityAccess({ registry, grants: [{ capabilityId: "booking.get.availability", mode: "ask" }], capabilityId: "booking.get.availability" }),
  { mode: "ask", reason: "granted", grantedVia: "booking.get.availability" },
);

// Write grant implies read (D013).
assert.deepEqual(
  evaluateCapabilityAccess({ registry, grants: [{ capabilityId: "booking.create.booking", mode: "allow" }], capabilityId: "booking.get.availability" }),
  { mode: "allow", reason: "granted", grantedVia: "booking.create.booking" },
);

// Most-restrictive-wins across matching grants (off > ask > allow).
assert.equal(
  evaluateCapabilityAccess({
    registry,
    grants: [
      { capabilityId: "booking.get.availability", mode: "off" },
      { capabilityId: "booking.create.booking", mode: "allow" },
    ],
    capabilityId: "booking.get.availability",
  }).mode,
  "off",
);

// Kill-switch blocks the requested capability per call.
assert.deepEqual(
  evaluateCapabilityAccess({
    registry,
    grants: [{ capabilityId: "booking.create.booking", mode: "allow" }],
    revokedCapabilityIds: ["booking.create.booking"],
    capabilityId: "booking.create.booking",
  }),
  { mode: "off", reason: "kill_switch_revoked" },
);

// Kill-switching the granting capability stops its implications flowing.
assert.deepEqual(
  evaluateCapabilityAccess({
    registry,
    grants: [{ capabilityId: "booking.create.booking", mode: "allow" }],
    revokedCapabilityIds: ["booking.create.booking"],
    capabilityId: "booking.get.availability",
  }),
  { mode: "off", reason: "no_grant" },
);

// Revoked descriptor blocks regardless of grants.
const revokedRegistry = capabilityRegistrySchema.parse({
  schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
  capabilities: [{ capabilityId: "booking.get.hold", version: 1, title: "A", effect: "read", status: "revoked" }],
});
assert.deepEqual(
  evaluateCapabilityAccess({ registry: revokedRegistry, grants: [{ capabilityId: "booking.get.hold", mode: "allow" }], capabilityId: "booking.get.hold" }),
  { mode: "off", reason: "capability_revoked" },
);

// Marketplace adapters: fixture manifests reference only registered capabilities.
const appGrants = collectManifestPermissionGrants(restaurantSetupAppManifest);
assert.equal(appGrants.length > 0, true, "app fixture carries permission grants");
assert.deepEqual(findUnregisteredCapabilityIds(appGrants, registry), [], "app fixture grant targets are registered");
const bundleGrants = collectManifestPermissionGrants(restaurantSetupBundleManifest);
assert.equal(bundleGrants.length > appGrants.length, true, "bundle collection includes composition item grants");
assert.deepEqual(findUnregisteredCapabilityIds(bundleGrants, registry), [], "bundle fixture grant targets are registered");

// Free-string grant targets surface as unregistered (the D013 ban).
assert.deepEqual(
  findUnregisteredCapabilityIds(
    [{ targetId: "totally.made.up", targetKind: "command", mode: "ask", effect: "read", approvalPolicy: "none", requiredHostContext: [] }],
    registry,
  ),
  ["totally.made.up"],
);

// Adapter ignores non-command grant targets.
assert.deepEqual(
  capabilityGrantsFromPermissions([
    { targetId: "some.package", targetKind: "app", mode: "ask", effect: "none", approvalPolicy: "none", requiredHostContext: [] },
  ]),
  [],
);

console.log("capability-registry.test.mjs passed");
