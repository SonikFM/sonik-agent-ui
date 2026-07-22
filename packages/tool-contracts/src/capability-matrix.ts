import type { HostUiTargetRegistry } from "./target-registry.js";

export type CapabilityMatrixRow = {
  commandId: string;
  enabled: boolean;
  reason?: string;
};

/**
 * Generates capabilities.read's payload straight from the registry — never
 * from prose. One row per registered command id; disabled rows always carry
 * the registry's disabledReason (or policy reason) so the matrix stays
 * legible without a lookup elsewhere.
 */
export function buildCapabilityMatrix(registry: HostUiTargetRegistry): CapabilityMatrixRow[] {
  return registry.targets.map((target) => ({
    commandId: target.targetId,
    enabled: target.enabled,
    reason: target.enabled ? undefined : (target.disabledReason ?? target.policy.reason ?? "disabled"),
  }));
}
