// Registered, versioned capability-ID namespace (D013 / DR-5).
//
// `requiredCapabilities` and permission-grant targets must reference a
// registered capability, not a free string. Enforcement is per-call gating
// with implication rules (a write grant covers its declared read
// implications), which makes the per-install kill-switch (D012) and the
// namespace one mechanism: revoking a capability id makes the next call
// evaluate to "off" — no separate revocation machinery.
//
// Capability ids share the dotted command-id namespace already in use
// (`booking.create.booking`), seeded from the amp.pkg command-registry
// capability_id vocabulary (D009).

import { z } from "zod";
import {
  marketplaceCommandEffectSchema,
  marketplacePermissionModeSchema,
  type MarketplaceManifest,
  type MarketplacePermissionGrant,
} from "./marketplace.js";
import generatedCapabilityRegistryJson from "./sonik-capability-registry.generated.json" with { type: "json" };

export const CAPABILITY_REGISTRY_SCHEMA_VERSION = "sonik-agent-ui.capability-registry.v1" as const;

export const capabilityIdSchema = z.string().regex(
  /^[a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9_-]*)+$/,
  "Expected dotted capability id like booking.create.booking",
);
export type CapabilityId = z.infer<typeof capabilityIdSchema>;

export const capabilityStatusSchema = z.enum(["active", "deprecated", "revoked"]);
export type CapabilityStatus = z.infer<typeof capabilityStatusSchema>;

// Danger ordering for implication safety: an implies edge may never point at
// a capability with a MORE dangerous effect, so implication can only lower
// privilege (write implies read), never escalate it.
const CAPABILITY_EFFECT_RANK: Record<z.infer<typeof marketplaceCommandEffectSchema>, number> = {
  none: 0,
  read: 1,
  write: 2,
  external: 3,
  destructive: 3,
};

export const capabilityDescriptorSchema = z.object({
  capabilityId: capabilityIdSchema,
  version: z.number().int().min(1),
  title: z.string().min(1),
  effect: marketplaceCommandEffectSchema,
  status: capabilityStatusSchema.default("active"),
  /** Capability ids this grant also covers (write implies read). Edges must
   *  reference registered, less-or-equally-dangerous capabilities. */
  implies: z.array(capabilityIdSchema).default([]),
  description: z.string().optional(),
}).strict();
export type CapabilityDescriptor = z.infer<typeof capabilityDescriptorSchema>;

export const capabilityRegistrySchema = z.object({
  schemaVersion: z.literal(CAPABILITY_REGISTRY_SCHEMA_VERSION),
  capabilities: z.array(capabilityDescriptorSchema).min(1),
}).strict().superRefine((registry, ctx) => {
  const byId = new Map<string, CapabilityDescriptor>();
  registry.capabilities.forEach((capability, index) => {
    if (byId.has(capability.capabilityId)) {
      ctx.addIssue({ code: "custom", path: ["capabilities", index, "capabilityId"], message: `Duplicate capability id ${capability.capabilityId}` });
    }
    byId.set(capability.capabilityId, capability);
  });
  registry.capabilities.forEach((capability, index) => {
    capability.implies.forEach((impliedId, impliesIndex) => {
      const implied = byId.get(impliedId);
      if (!implied) {
        ctx.addIssue({ code: "custom", path: ["capabilities", index, "implies", impliesIndex], message: `Implied capability ${impliedId} is not registered` });
        return;
      }
      if (CAPABILITY_EFFECT_RANK[implied.effect] > CAPABILITY_EFFECT_RANK[capability.effect]) {
        ctx.addIssue({ code: "custom", path: ["capabilities", index, "implies", impliesIndex], message: `Implication may not escalate privilege: ${capability.capabilityId} (${capability.effect}) -> ${impliedId} (${implied.effect})` });
      }
    });
  });
});
export type CapabilityRegistry = z.infer<typeof capabilityRegistrySchema>;

/** Canonical versioned form used wherever a capability is referenced with an
 *  explicit contract version, e.g. `booking.create.booking@v1`. */
export function versionedCapabilityId(descriptor: Pick<CapabilityDescriptor, "capabilityId" | "version">): string {
  return `${descriptor.capabilityId}@v${descriptor.version}`;
}

export function parseVersionedCapabilityId(value: string): { capabilityId: string; version: number } | null {
  const match = /^([a-z][a-z0-9]*(?:\.[a-z0-9][a-z0-9_-]*)+)@v(\d+)$/.exec(value);
  if (!match?.[1] || !match[2]) return null;
  return { capabilityId: match[1], version: Number(match[2]) };
}

export function findCapability(registry: CapabilityRegistry, capabilityId: string): CapabilityDescriptor | undefined {
  return registry.capabilities.find((capability) => capability.capabilityId === capabilityId);
}

/** Transitive closure of declared implication edges, excluding the root. */
export function resolveImpliedCapabilityIds(registry: CapabilityRegistry, capabilityId: string): string[] {
  const seen = new Set<string>();
  const queue = [...(findCapability(registry, capabilityId)?.implies ?? [])];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    queue.push(...(findCapability(registry, next)?.implies ?? []));
  }
  return [...seen];
}

export const capabilityGrantSchema = z.object({
  capabilityId: capabilityIdSchema,
  mode: marketplacePermissionModeSchema,
}).strict();
export type CapabilityGrant = z.infer<typeof capabilityGrantSchema>;

export type CapabilityAccessReason =
  | "capability_not_registered"
  | "capability_revoked"
  | "kill_switch_revoked"
  | "no_grant"
  | "granted";

export interface CapabilityAccessDecision {
  mode: z.infer<typeof marketplacePermissionModeSchema>;
  reason: CapabilityAccessReason;
  /** The granted capability id that satisfied this call (differs from the
   *  requested id when access flows through an implication edge). */
  grantedVia?: string;
}

const MODE_RESTRICTIVENESS: Record<CapabilityAccessDecision["mode"], number> = { off: 0, ask: 1, allow: 2 };

/**
 * Per-call capability gate. Default-deny: no registration, no grant, a
 * revoked descriptor, or a kill-switched id all evaluate to "off".
 * Multiple matching grants resolve most-restrictive-wins (off > ask > allow),
 * matching resolveEffectiveToolPolicy doctrine. A kill-switched granting
 * capability contributes nothing, so its implications stop flowing too.
 */
export function evaluateCapabilityAccess(input: {
  registry: CapabilityRegistry;
  grants: CapabilityGrant[];
  /** Per-install kill-switch: capability ids the user/host has revoked. */
  revokedCapabilityIds?: string[];
  capabilityId: string;
}): CapabilityAccessDecision {
  const descriptor = findCapability(input.registry, input.capabilityId);
  if (!descriptor) return { mode: "off", reason: "capability_not_registered" };
  if (descriptor.status === "revoked") return { mode: "off", reason: "capability_revoked" };
  const revoked = new Set(input.revokedCapabilityIds ?? []);
  if (revoked.has(input.capabilityId)) return { mode: "off", reason: "kill_switch_revoked" };

  // Direct grants take precedence over implied ones: implication exists to
  // EXPAND sparse grants (a write grant covers its reads), never to narrow a
  // capability that carries its own grant — otherwise a restrictive grant on
  // X bleeds onto everything X implies (Phase 4 review finding).
  const direct: Array<{ mode: CapabilityAccessDecision["mode"]; grantedVia: string }> = [];
  const implied: Array<{ mode: CapabilityAccessDecision["mode"]; grantedVia: string }> = [];
  for (const grant of input.grants) {
    if (revoked.has(grant.capabilityId)) continue;
    const granting = findCapability(input.registry, grant.capabilityId);
    if (!granting || granting.status === "revoked") continue;
    if (grant.capabilityId === input.capabilityId) {
      direct.push({ mode: grant.mode, grantedVia: grant.capabilityId });
    } else if (resolveImpliedCapabilityIds(input.registry, grant.capabilityId).includes(input.capabilityId)) {
      implied.push({ mode: grant.mode, grantedVia: grant.capabilityId });
    }
  }
  const pool = direct.length > 0 ? direct : implied;
  if (pool.length === 0) return { mode: "off", reason: "no_grant" };
  const winner = pool.reduce((current, candidate) =>
    MODE_RESTRICTIVENESS[candidate.mode] < MODE_RESTRICTIVENESS[current.mode] ? candidate : current);
  return { mode: winner.mode, reason: "granted", grantedVia: winner.grantedVia };
}

/** Marketplace adapter: command-targeted permission grants ARE capability
 *  grants — the grant targetId lives in the capability namespace. */
export function capabilityGrantsFromPermissions(permissions: MarketplacePermissionGrant[]): CapabilityGrant[] {
  return permissions
    .filter((permission) => permission.targetKind === "command")
    .map((permission) => ({ capabilityId: permission.targetId, mode: permission.mode }));
}

/** Every permission grant a manifest carries: top-level, dependency items,
 *  and bundle composition items. Input to registry validation at publish /
 *  install-preview time. */
export function collectManifestPermissionGrants(manifest: MarketplaceManifest): MarketplacePermissionGrant[] {
  return [
    ...manifest.permissions,
    ...manifest.dependencies.flatMap((item) => item.permissions),
    ...(manifest.bundle?.contains.flatMap((item) => item.permissions) ?? []),
  ];
}

/** Command-targeted grant ids a manifest references that are not registered
 *  (or are revoked). Non-empty result must fail validateManifest /
 *  getInstallPreview — free-string capability targets are what D013 bans. */
export function findUnregisteredCapabilityIds(grants: MarketplacePermissionGrant[], registry: CapabilityRegistry): string[] {
  const unregistered = new Set<string>();
  for (const grant of capabilityGrantsFromPermissions(grants)) {
    const descriptor = findCapability(registry, grant.capabilityId);
    if (!descriptor || descriptor.status === "revoked") unregistered.add(grant.capabilityId);
  }
  return [...unregistered].sort();
}

// Generated registry (Decision 1, D018): the booking command namespace's 113
// commands generated from the vendored, SHA-pinned booking-service SDK
// command registry (packages/tool-contracts/vendor/, generator at
// packages/tool-contracts/scripts/generate-capability-registry.mjs), unioned
// with the hand-authored Amplify campaign capability set (Decision 1 rider).
// The original 8-entry seed set's effect/family/implies survive
// byte-identical inside the generated output (R4(a) superset-preservation,
// see tests/unit/capability-registry-generation.test.mjs).
export const sonikBookingCapabilityRegistry: CapabilityRegistry = capabilityRegistrySchema.parse(
  generatedCapabilityRegistryJson,
);
