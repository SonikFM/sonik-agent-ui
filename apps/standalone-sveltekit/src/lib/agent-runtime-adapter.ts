// Phase 3 (agent-creation-tool-plan-2026-07-13.md, Option A + O1): closes the
// agent.ts:42 gap -- nothing today resolves a persisted, published
// AgentDefinition into createAgent's AgentRuntimeContext. This module is that
// adapter, plus the registry-live capability pin command-catalog.ts enforces.
//
// O1 (no parallel resolver type): the persisted definition is the DEFAULT
// AgentRuntimeSettings bag; session tweaks (Debug & Preview's per-run
// overrides) merge over it. The output is exactly AgentRuntimeSettings --
// AgentRuntimeContext is assembled from it by the caller exactly as
// api/generate/+server.ts does today (agent.ts is not forked).
//
// Dependency-free leaf module (mirrors command-family-mount.ts /
// runtime-skill-intent.ts): agent.ts pulls in `ai`/$env and can only be
// type-imported from a plain node test, so the pure, unit-testable logic
// lives here instead.

import { sanitizeAgentRuntimeSettings, type AgentRuntimeSettings } from "./agent-settings.ts";
import type { AgentDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
import { sonikBookingCapabilityRegistry, type CapabilityRegistry } from "@sonik-agent-ui/tool-contracts/capability-registry";
import { resolveEffectivePinnedCapabilities, type PinnedCapabilities, type PinnedCapabilityMode } from "@sonik-agent-ui/tool-contracts/capability-pinning";
import { synthesizeCapabilityGrantsFromRuntimeState, resolveCapabilityToolPermissionModes } from "@sonik-agent-ui/tool-contracts/grant-synthesis";
import { normalizeCapabilityFamilyModes, sonikBookingCapabilityFamilyIds } from "@sonik-agent-ui/tool-contracts/capability-family";

export type { PinnedCapabilities, PinnedCapabilityMode };

/**
 * Maps a persisted AgentDefinition into the EXISTING AgentRuntimeSettings
 * shape: `toolPolicy` -> `toolPermissionModes`, `promptModules.overrides` ->
 * `promptModuleOverrides`, `requiredSkills` -> `skillIds`, inline
 * `modelPolicy` -> `modelId`/`requireZdr`. `sessionTweaks` merges over those
 * defaults (record-valued fields merge key-by-key so a session tweak never
 * silently drops the rest of the definition's grants; scalar/array fields
 * replace outright when the tweak supplies them). All validation is
 * delegated to `sanitizeAgentRuntimeSettings` -- this stays a pure mapping,
 * not a second sanitizer.
 *
 * SECURITY NOTE (verify-wave, 2026-07-13): the definition's `toolPolicy` is a
 * DEFAULT overlay, not an authorization ceiling — session tweaks (which on the
 * generate route come from the raw client body) can re-widen a family the
 * definition set "off". That is intended (Debug & Preview needs it) and safe:
 * the real ceiling is structural — command-catalog's draft_only_invariant
 * unconditionally refuses non-read effects, the capability registry pin is
 * default-deny, and writes fire only through host-signed approval. Never treat
 * toolPolicy alone as a security boundary.
 */
export function definitionToRuntimeSettings(
  definition: AgentDefinition,
  sessionTweaks: Partial<AgentRuntimeSettings> = {},
): AgentRuntimeSettings {
  const defaultDeniedFamilyModes = Object.fromEntries(
    Object.values(sonikBookingCapabilityFamilyIds).map((familyId) => [familyId, "off"]),
  );
  const raw: Record<string, unknown> = {
    modelId: sessionTweaks.modelId ?? definition.modelPolicy?.modelId,
    requireZdr: sessionTweaks.requireZdr ?? definition.modelPolicy?.requireZdr,
    skillIds: sessionTweaks.skillIds ?? definition.requiredSkills,
    additionalSystemPrompt: sessionTweaks.additionalSystemPrompt,
    customSkills: sessionTweaks.customSkills,
    toolPermissionModes: {
      ...defaultDeniedFamilyModes,
      ...normalizeCapabilityFamilyModes(definition.toolPolicy),
      ...normalizeCapabilityFamilyModes(sessionTweaks.toolPermissionModes ?? {}),
    },
    promptModuleOverrides: { ...definition.promptModules.overrides, ...sessionTweaks.promptModuleOverrides },
    skillPromptOverrides: sessionTweaks.skillPromptOverrides,
  };
  return sanitizeAgentRuntimeSettings(raw);
}

export interface RunCapabilityPinInput {
  /** capabilityId -> familyId, derived from the mounted command catalog
   *  (capability ids ARE command ids, D013). */
  capabilityFamilyIds: Record<string, string>;
  /** AgentRuntimeSettings.toolPermissionModes, keyed by family id. */
  familyModes?: Record<string, PinnedCapabilityMode>;
  approvedCommandIds?: string[];
  revokedCapabilityIds?: string[];
  registry?: CapabilityRegistry;
}

/**
 * Registry-live enforcement (Phase 3): resolves ONE frozen pin per registered
 * capability for a run via grant synthesis + capability pinning -- default
 * deny, so a capability id the registry has never heard of pins to "off"
 * regardless of family/command tool-policy modes. Call once per run
 * (command-catalog.ts memoizes this per `createCommandCatalogTools` call,
 * i.e. once per turn) and freeze the result; per-turn tool invocation checks
 * this pin, it never re-derives it.
 */
export function resolveRunCapabilityPin(input: RunCapabilityPinInput): PinnedCapabilities {
  const registry = input.registry ?? sonikBookingCapabilityRegistry;
  const grants = synthesizeCapabilityGrantsFromRuntimeState({ registry });
  const toolPermissionModes = resolveCapabilityToolPermissionModes({
    registry,
    capabilityFamilyIds: input.capabilityFamilyIds,
    familyModes: input.familyModes,
  });
  return resolveEffectivePinnedCapabilities({
    registry,
    capabilityGrants: grants,
    toolPermissionModes,
    approvedCommandIds: input.approvedCommandIds,
    revokedCapabilityIds: input.revokedCapabilityIds,
  });
}

/** Default-deny read: an unpinned (unregistered) capability id is "off". */
export function isCapabilityPinned(pinned: PinnedCapabilities, capabilityId: string): boolean {
  return (pinned[capabilityId] ?? "off") !== "off";
}
