// Generates the capability registry (Decision 1, agent-creation-tool plan
// Phase 2) from the vendored, SHA-pinned booking-service SDK command
// registry. Hermetic: reads only the committed vendor/ copy, never a live
// sibling worktree. Run with:
//   node --experimental-strip-types packages/tool-contracts/scripts/generate-capability-registry.mjs [--check]

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilityRegistrySchema, CAPABILITY_REGISTRY_SCHEMA_VERSION } from "../src/capability-registry.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendorPath = resolve(root, "vendor/sonik-command-registry.generated.json");
const outputPath = resolve(root, "src/sonik-capability-registry.generated.json");
const checkMode = process.argv.includes("--check");

// The registered booking capability namespace already carried these
// write-implies-read edges (D013) before generation existed. Generation
// preserves them byte-identical (R4(a) superset-preservation) rather than
// re-deriving them.
//
// ponytail: no heuristic noun-matching implies edges for the other ~100
// booking commands -- the vendored manifest carries no `implies`/`dependsOn`
// field, and guessing cross-command grants from id-name patterns risks
// over-granting read access on a wrong guess. Add real edges here (or from a
// future SDK-side `implies` field) once confirmed; until then those
// commands generate with no implies, which is the safe (never over-grant)
// default.
const KNOWN_BOOKING_IMPLIES = {
  "booking.create.hold": ["booking.get.hold", "booking.get.availability"],
  "booking.release.hold": ["booking.get.hold"],
  "booking.create.booking": ["booking.get.availability"],
  "booking.create.context": ["booking.list.contexts"],
};

// Hand-authored Amplify campaign capability set (Decision 1 rider, Decision
// 2) -- no generator source exists for these yet. Provenance is recorded in
// the description (not a schema field, per capabilityDescriptorSchema being
// `.strict()`) so a future Amplify SDK generator can detect and avoid
// double-registering them (O2).
const AMPLIFY_HAND_AUTHORED_CAPABILITIES = [
  {
    capabilityId: "amplify.campaign.preview",
    version: 1,
    title: "Preview an Amplify campaign",
    effect: "none",
    description:
      "Generate a preview of campaign content and audience segments for human review before commit. [source: hand-authored]",
  },
  {
    capabilityId: "amplify.campaign.create",
    version: 1,
    title: "Create an Amplify campaign",
    effect: "write",
    implies: ["amplify.campaign.preview"],
    description:
      "Persist a reviewed campaign artifact to the Knowledge v1 store, host-signed and receipted. [source: hand-authored]",
  },
];

function byCapabilityId(a, b) {
  // Locale-independent (verify-wave P2): localeCompare varies by runtime
  // locale/ICU and would break the byte-identical drift gate across machines.
  return a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0;
}

async function buildRegistry() {
  const vendored = JSON.parse(await readFile(vendorPath, "utf8"));
  const bookingCapabilities = vendored.manifest.tools
    .map((tool) => ({
      capabilityId: tool.id,
      version: 1,
      title: tool.title,
      effect: tool.effect,
      description: tool.description,
      implies: KNOWN_BOOKING_IMPLIES[tool.id] ?? [],
    }))
    .sort(byCapabilityId);

  return capabilityRegistrySchema.parse({
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    capabilities: [...bookingCapabilities, ...AMPLIFY_HAND_AUTHORED_CAPABILITIES].sort(byCapabilityId),
  });
}

const registry = await buildRegistry();
const serialized = `${JSON.stringify(registry, null, 2)}\n`;

if (checkMode) {
  let existing = "";
  try {
    existing = await readFile(outputPath, "utf8");
  } catch (error) {
    console.error(`Capability registry artifact is missing: ${outputPath}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  if (existing !== serialized) {
    console.error(`Capability registry artifact is stale: ${outputPath}`);
    console.error(
      "Run: node --experimental-strip-types packages/tool-contracts/scripts/generate-capability-registry.mjs and commit the updated artifact.",
    );
    process.exit(1);
  }
  console.log(`Checked ${outputPath}`);
} else {
  await writeFile(outputPath, serialized);
  console.log(`Wrote ${outputPath}`);
}
console.log(JSON.stringify({ capabilityCount: registry.capabilities.length }));
