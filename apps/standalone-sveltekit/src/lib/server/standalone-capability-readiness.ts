import { sonikBookingCapabilityRegistry } from "@sonik-agent-ui/tool-contracts/capability-registry";
import { resolveCapabilityToolPermissionModes, synthesizeCapabilityGrantsFromRuntimeState } from "@sonik-agent-ui/tool-contracts/grant-synthesis";
import type { CapabilityReadiness } from "@sonik-agent-ui/tool-contracts/workflow-vnext";
import { resolveCapabilityReadiness, type CapabilityVersionPins } from "./capability-readiness.ts";
import { createStandaloneHostCommandRuntimeBundle, type StandaloneHostRuntimeInput } from "./host-command-runtime.ts";

export function resolveStandaloneCapabilityReadiness(input: StandaloneHostRuntimeInput & {
  approvedCommandIds?: string[];
  revokedCapabilityIds?: string[];
  capabilityVersionPins?: CapabilityVersionPins;
  requireVersionPins?: boolean;
  toolPermissionModes?: Record<string, "off" | "ask" | "allow">;
} = {}): CapabilityReadiness[] {
  const bundle = createStandaloneHostCommandRuntimeBundle(input);
  const registry = sonikBookingCapabilityRegistry;
  const familyIds = Object.fromEntries(bundle.catalog.commands.map((command) => [command.id, command.familyId]));
  return resolveCapabilityReadiness({
    catalog: bundle.catalog,
    runtimeAdapters: bundle.runtimeAdapters,
    executionContext: bundle.executionContext,
    registry,
    grants: synthesizeCapabilityGrantsFromRuntimeState({ registry }),
    revokedCapabilityIds: input.revokedCapabilityIds,
    capabilityVersionPins: input.capabilityVersionPins,
    requireVersionPins: input.requireVersionPins,
    approvedCommandIds: input.approvedCommandIds,
    toolPermissionModes: resolveCapabilityToolPermissionModes({ registry, capabilityFamilyIds: familyIds, familyModes: input.toolPermissionModes }),
  });
}
