import generatedCapabilityFamilyIds from "./sonik-booking-capability-families.generated.json" with { type: "json" };

export type CapabilityFamilyMode = "off" | "ask" | "allow";

/** Client-safe projection generated from the same 72-command catalog mounted by the server. */
export const sonikBookingCapabilityFamilyIds: Readonly<Record<string, string>> = Object.freeze(generatedCapabilityFamilyIds);

const canonicalFamilyIds = new Set(Object.values(sonikBookingCapabilityFamilyIds));
const legacyFamilyIds = new Map<string, Set<string>>();
for (const [capabilityId, familyId] of Object.entries(sonikBookingCapabilityFamilyIds)) {
  const legacyId = capabilityId.split(".").slice(0, 2).join(".");
  const families = legacyFamilyIds.get(legacyId) ?? new Set<string>();
  families.add(familyId);
  legacyFamilyIds.set(legacyId, families);
}

/**
 * Keeps canonical keys. Every known legacy dotted key restricts all families
 * it once grouped to Off: translating Ask/Allow would widen authority because
 * dotted groups and runtime families are many-to-many.
 */
export function normalizeCapabilityFamilyModes(modes: Record<string, CapabilityFamilyMode>): Record<string, CapabilityFamilyMode> {
  const normalized: Record<string, CapabilityFamilyMode> = {};
  for (const [key, mode] of Object.entries(modes)) {
    if (canonicalFamilyIds.has(key)) normalized[key] = mode;
  }
  for (const key of Object.keys(modes)) {
    for (const familyId of legacyFamilyIds.get(key) ?? []) normalized[familyId] = "off";
  }
  return normalized;
}
