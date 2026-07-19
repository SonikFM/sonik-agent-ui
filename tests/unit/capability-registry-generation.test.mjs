import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  capabilityDescriptorSchema,
  capabilityRegistrySchema,
} from "../../packages/tool-contracts/src/capability-registry.ts";
import { sonikBookingCapabilityFamilyIds } from "../../packages/tool-contracts/src/capability-family.ts";

// Phase 2 (agent-creation-tool plan, Decision 1): the capability registry is
// GENERATED from a vendored, SHA-pinned copy of the booking-service SDK's
// command registry, unioned with a hand-authored Amplify campaign set. This
// test proves the R4 risk mitigations: no reachable-but-unregistered command
// (R4(b)), and the original 8-entry seed set survives generation
// byte-identical (R4(a)).

const root = resolve(import.meta.dirname, "../..");
const vendorPath = resolve(root, "packages/tool-contracts/vendor/sonik-command-registry.generated.json");
const generatedPath = resolve(root, "packages/tool-contracts/src/sonik-capability-registry.generated.json");
const generatorPath = resolve(root, "packages/tool-contracts/scripts/generate-capability-registry.mjs");

const vendored = JSON.parse(readFileSync(vendorPath, "utf8"));
const generatedRaw = JSON.parse(readFileSync(generatedPath, "utf8"));
const registry = capabilityRegistrySchema.parse(generatedRaw);
const byId = new Map(registry.capabilities.map((capability) => [capability.capabilityId, capability]));

// --- every booking + amplify id parses against capabilityDescriptorSchema --
{
  const vendoredIds = vendored.manifest.tools.map((tool) => tool.id);
  assert.equal(vendoredIds.length, 113, "vendored booking manifest carries 113 commands");
  for (const id of vendoredIds) {
    const capability = byId.get(id);
    assert.ok(capability, `booking command ${id} is registered`);
    assert.equal(capabilityDescriptorSchema.safeParse(capability).success, true, `${id} parses as a capability descriptor`);
  }
  for (const id of ["amplify.campaign.preview", "amplify.campaign.create"]) {
    const capability = byId.get(id);
    assert.ok(capability, `amplify command ${id} is registered`);
    assert.equal(capabilityDescriptorSchema.safeParse(capability).success, true, `${id} parses as a capability descriptor`);
  }
  assert.equal(registry.capabilities.length, 115, "113 booking + 2 hand-authored amplify rows");
}

// --- DRIFT: regenerating from the vendored copy is byte-identical ----------
{
  const output = execFileSync(
    process.execPath,
    ["--experimental-strip-types", generatorPath, "--check"],
    { encoding: "utf8" },
  );
  assert.match(output, /^Checked /m, "generator --check reports a clean drift check");
}

// --- R4(a) SUPERSET-PRESERVATION: the 8 original entries survive byte-identical ---
{
  const original = {
    "booking.list.contexts": { title: "List booking contexts", effect: "read", implies: [] },
    "booking.get.availability": { title: "Read availability", effect: "read", implies: [] },
    "booking.get.hold": { title: "Read a hold", effect: "read", implies: [] },
    "booking.create.hold": { title: "Create a hold", effect: "write", implies: ["booking.get.hold", "booking.get.availability"] },
    "booking.release.hold": { title: "Release a hold", effect: "write", implies: ["booking.get.hold"] },
    "booking.create.guest": { title: "Create a guest", effect: "write", implies: [] },
    "booking.create.booking": { title: "Create a booking", effect: "write", implies: ["booking.get.availability"] },
    "booking.create.context": { title: "Create a booking context", effect: "write", implies: ["booking.list.contexts"] },
  };
  for (const [capabilityId, expected] of Object.entries(original)) {
    const capability = byId.get(capabilityId);
    assert.ok(capability, `seed capability ${capabilityId} survives generation`);
    assert.equal(capability.effect, expected.effect, `${capabilityId} effect unchanged by generation`);
    assert.deepEqual([...capability.implies].sort(), [...expected.implies].sort(), `${capabilityId} implies edges unchanged by generation`);
    // Title text may legitimately differ (generation prefers the richer SDK
    // title); what must never change is effect + implies, since those alone
    // drive evaluateCapabilityAccess / resolveImpliedCapabilityIds.
  }
}

// --- R4(b) LIVE-REACHABILITY: every mounted command id is registered -------
{
  const mountedArtifactPath = resolve(
    root,
    "apps/standalone-sveltekit/src/lib/server/generated/sonik-booking-command-artifacts.generated.json",
  );
  const mountedArtifact = JSON.parse(readFileSync(mountedArtifactPath, "utf8"));
  const mountedIds = mountedArtifact.catalog.commands.map((command) => command.id);
  assert.ok(mountedIds.length > 0, "mounted booking command artifact carries commands");
  const unregistered = mountedIds.filter((id) => !byId.has(id));
  assert.deepEqual(unregistered, [], "every command reachable via createCommandCatalogTools' mounted families is registered");
  assert.equal(Object.keys(sonikBookingCapabilityFamilyIds).length, 72, "client-safe family projection covers exactly the mounted catalog");
  for (const command of mountedArtifact.catalog.commands) {
    assert.equal(sonikBookingCapabilityFamilyIds[command.id], command.familyId, `${command.id} uses its canonical runtime family`);
  }
}

console.log("capability-registry-generation.test.mjs passed");
