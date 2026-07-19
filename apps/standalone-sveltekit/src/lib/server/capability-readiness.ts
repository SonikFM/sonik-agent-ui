import type { CommandCatalog, CommandExecutionContext } from "@sonik-agent-ui/tool-contracts";
import {
  evaluateCapabilityAccess,
  sonikBookingCapabilityRegistry,
  type CapabilityGrant,
  type CapabilityRegistry,
} from "@sonik-agent-ui/tool-contracts/capability-registry";
import { computeCapabilityReadiness, type CapabilityReadiness } from "@sonik-agent-ui/tool-contracts/workflow-vnext";
import type { HostCommandRuntimeAdapter } from "@sonik-agent-ui/platform-adapters";

export type CapabilityVersionPins = Readonly<Record<string, number>>;

export interface CapabilityReadinessResolverInput {
  catalog: CommandCatalog;
  runtimeAdapters: readonly HostCommandRuntimeAdapter[];
  executionContext: CommandExecutionContext;
  grants: readonly CapabilityGrant[];
  registry?: CapabilityRegistry;
  revokedCapabilityIds?: readonly string[];
  capabilityVersionPins?: CapabilityVersionPins;
  requireVersionPins?: boolean;
  approvedCommandIds?: readonly string[];
  toolPermissionModes?: Readonly<Record<string, "off" | "ask" | "allow">>;
  authorableCapabilityIds?: readonly string[];
  definitionCompatibleCapabilityIds?: readonly string[];
}

/** One pure, default-deny readiness authority for catalog, prompt, UI and dispatch. */
export function resolveCapabilityReadiness(input: CapabilityReadinessResolverInput): CapabilityReadiness[] {
  const registry = input.registry ?? sonikBookingCapabilityRegistry;
  const commands = new Map(input.catalog.commands.map((command) => [command.id, command]));
  const bindings = new Map(input.runtimeAdapters.flatMap((adapter) => adapter.bindings.map((binding) => [binding.commandId, binding] as const)));
  const revoked = new Set(input.revokedCapabilityIds ?? []);
  const approved = new Set(input.approvedCommandIds ?? []);
  const authorable = input.authorableCapabilityIds ? new Set(input.authorableCapabilityIds) : null;
  const compatible = input.definitionCompatibleCapabilityIds ? new Set(input.definitionCompatibleCapabilityIds) : null;

  return registry.capabilities.map((descriptor) => {
    const command = commands.get(descriptor.capabilityId);
    const binding = bindings.get(descriptor.capabilityId);
    const implemented = Boolean(command);
    const write = descriptor.effect === "write" || descriptor.effect === "destructive" || descriptor.effect === "external";
    const mounted = Boolean(command?.transport.runtimeStatus === "mounted"
      && binding
      && (write ? binding.status === "mounted-write" && binding.commit : binding.status === "mounted-read" && binding.execute));
    const contextReady = Boolean(command && hasRequiredContext(command.auth, input.executionContext));
    const access = evaluateCapabilityAccess({
      registry,
      grants: [...input.grants],
      capabilityId: descriptor.capabilityId,
    });
    const policyMode = input.toolPermissionModes?.[descriptor.capabilityId];
    const grantReady = access.mode !== "off" && policyMode !== "off";
    const killSwitched = revoked.has(descriptor.capabilityId);
    const versionPinned = input.requireVersionPins !== true || input.capabilityVersionPins?.[descriptor.capabilityId] === descriptor.version;
    const baseReady = implemented && mounted && contextReady && grantReady && !killSwitched && versionPinned;
    const previewable = baseReady;
    const committable = baseReady && (!write || approved.has(descriptor.capabilityId));
    return computeCapabilityReadiness({
      registry,
      capabilityId: descriptor.capabilityId,
      implementedCapabilityIds: implemented ? [descriptor.capabilityId] : [],
      authorable: authorable?.has(descriptor.capabilityId) ?? implemented,
      definitionCompatible: compatible?.has(descriptor.capabilityId) ?? implemented,
      mounted,
      contextReady,
      grantReady,
      previewable,
      committable,
      killSwitched,
      versionPinned,
      approvalGranted: !write || approved.has(descriptor.capabilityId),
    });
  });
}

export function requireCallableCapability(readiness: readonly CapabilityReadiness[], capabilityId: string): CapabilityReadiness {
  const result = readiness.find((entry) => entry.capabilityId === capabilityId)
    ?? computeCapabilityReadiness({ capabilityId, implementedCapabilityIds: [], authorable: false, definitionCompatible: false, mounted: false, contextReady: false, grantReady: false, previewable: false, committable: false, killSwitched: false, versionPinned: false });
  const reasonCodes = [
    !result.registered && "not_registered",
    !result.implemented && "not_implemented",
    !result.authorable && "not_authorable",
    !result.definitionCompatible && "definition_incompatible",
    !result.mounted && "not_mounted",
    !result.contextReady && "missing_context",
    !result.grantReady && "missing_host_grant",
    result.killSwitched && "kill_switched",
    !result.versionPinned && "version_not_pinned",
    !result.previewable && "preview_required",
    result.effectMode === "write" && result.previewable && !result.committable && "approval_required",
  ].filter(Boolean);
  if (!result.callable || reasonCodes.length) throw new Error(`Capability ${capabilityId} is unavailable: ${reasonCodes.join(",") || result.reasonCodes.join(",")}`);
  return result;
}

export function requireCallableCapabilities(readiness: readonly CapabilityReadiness[], capabilityIds: Iterable<string>): CapabilityReadiness[] {
  return [...new Set(capabilityIds)].sort().map((capabilityId) => requireCallableCapability(readiness, capabilityId));
}

function hasRequiredContext(auth: CommandCatalog["commands"][number]["auth"], context: CommandExecutionContext): boolean {
  if (auth.required && context.authenticated !== true) return false;
  if (auth.orgScoped && !context.organizationId) return false;
  const scopes = new Set(context.scopes ?? []);
  return auth.scopes.every((scope) => scopes.has(scope));
}
