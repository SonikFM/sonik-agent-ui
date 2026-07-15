import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import { workflowDependencyPinsSchema, workflowVNextDefinitionSchema, type CapabilityReadiness, type WorkflowVNextDefinition } from "@sonik-agent-ui/tool-contracts/workflow-vnext";
import { type WorkflowDefinitionOwner, type WorkflowDefinitionPin, type WorkflowDefinitionRepository } from "./workflow-definition-repository.ts";

export type WorkflowDefinitionsAction =
  | { action: "create"; definition: unknown }
  | { action: "update"; workflowId: string; expectedRevision: number; definition: unknown }
  | { action: "get"; workflowId: string }
  | { action: "list"; includeArchived?: boolean }
  | { action: "publish"; workflowId: string; expectedRevision: number; workflowVersionId: string; dependencyPins: unknown }
  | { action: "versions"; workflowId: string }
  | { action: "archive"; workflowId: string; expectedRevision: number }
  | { action: "clone"; source: WorkflowDefinitionPin; targetWorkflowId: string }
  | { action: "resolve"; pin: WorkflowDefinitionPin };

export function workflowDefinitionOwnerFromHostSession(hostSession: HostSessionEnvelope | null): WorkflowDefinitionOwner | null {
  const organizationId = hostSession?.organizationId?.trim();
  const userId = (hostSession?.userId ?? hostSession?.principalId)?.trim();
  return hostSession?.authenticated && organizationId && userId ? { organizationId, userId } : null;
}

export async function handleWorkflowDefinitionsAction(action: WorkflowDefinitionsAction, deps: { hostSession: HostSessionEnvelope | null; repository: WorkflowDefinitionRepository; capabilityReadiness?: readonly CapabilityReadiness[] }) {
  const owner = workflowDefinitionOwnerFromHostSession(deps.hostSession);
  if (!owner) return { ok: false as const, reason: "authenticated_workspace_owner_required" };
  const actorId = owner.userId;
  try {
    switch (action.action) {
      case "create": {
        const definition = parseDefinition(action.definition);
        const draft = await deps.repository.createDraft(owner, definition, actorId);
        return draft ? { ok: true as const, draft } : { ok: false as const, reason: "workflow_already_exists" };
      }
      case "update": {
        const definition = parseDefinition(action.definition, action.workflowId);
        const draft = await deps.repository.updateDraft(owner, action.workflowId, revision(action.expectedRevision), definition, actorId);
        return draft ? { ok: true as const, draft } : { ok: false as const, reason: "revision_conflict_or_archived" };
      }
      case "get": return { ok: true as const, draft: await deps.repository.getDraft(owner, required(action.workflowId, "workflowId")) };
      case "list": return { ok: true as const, drafts: await deps.repository.listDrafts(owner, action.includeArchived === true) };
      case "versions": return { ok: true as const, versions: await deps.repository.listPublished(owner, required(action.workflowId, "workflowId")) };
      case "publish": {
        const workflowId = required(action.workflowId, "workflowId");
        const workflowVersionId = required(action.workflowVersionId, "workflowVersionId");
        if (!workflowVersionId.startsWith(`${workflowId}@`)) throw new Error("workflow_version_id_must_pin_workflow");
        const draft = await deps.repository.getDraft(owner, workflowId);
        if (!draft || draft.archivedAt || draft.draftRevision !== revision(action.expectedRevision)) return { ok: false as const, reason: "revision_conflict_or_archived" };
        const dependencyPins = workflowDependencyPinsSchema.parse(action.dependencyPins);
        if (dependencyPins.organizationId !== owner.organizationId || dependencyPins.workflowVersionId !== workflowVersionId || dependencyPins.definitionDigest !== draft.definitionDigest) throw new Error("dependency_pins_mismatch");
        if (deps.capabilityReadiness) assertPublishableCapabilities(draft.definition, deps.capabilityReadiness);
        const version = await deps.repository.publish(owner, { workflowId, expectedRevision: action.expectedRevision, workflowVersionId, definitionDigest: draft.definitionDigest, dependencyPins, actorId });
        return version ? { ok: true as const, version } : { ok: false as const, reason: "revision_conflict_or_version_exists" };
      }
      case "archive": {
        const draft = await deps.repository.archiveDraft(owner, required(action.workflowId, "workflowId"), revision(action.expectedRevision), actorId);
        return draft ? { ok: true as const, draft } : { ok: false as const, reason: "revision_conflict_or_archived" };
      }
      case "resolve": return { ok: true as const, definition: await deps.repository.resolvePin(owner, action.pin) };
      case "clone": {
        const source = await deps.repository.resolvePin(owner, action.source);
        if (!source) return { ok: false as const, reason: "pinned_workflow_not_found" };
        const targetWorkflowId = required(action.targetWorkflowId, "targetWorkflowId");
        const definition = workflowVNextDefinitionSchema.parse({ ...source.definition, workflowId: targetWorkflowId, title: `${source.definition.title} (copy)` });
        const draft = await deps.repository.createDraft(owner, definition, actorId);
        return draft ? { ok: true as const, draft } : { ok: false as const, reason: "workflow_already_exists" };
      }
    }
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message : "invalid_workflow_definition_request" };
  }
}

function parseDefinition(input: unknown, expectedWorkflowId?: string): WorkflowVNextDefinition {
  const definition = workflowVNextDefinitionSchema.parse(input);
  if (expectedWorkflowId && definition.workflowId !== expectedWorkflowId) throw new Error("workflow_id_mismatch");
  return definition;
}
function required(value: string, name: string): string { const normalized = typeof value === "string" ? value.trim() : ""; if (!normalized) throw new Error(`${name}_required`); return normalized; }
function revision(value: number): number { if (!Number.isSafeInteger(value) || value < 0) throw new Error("expected_revision_invalid"); return value; }
function assertPublishableCapabilities(definition: WorkflowVNextDefinition, readiness: readonly CapabilityReadiness[]): void {
  const byId = new Map(readiness.map((entry) => [entry.capabilityId, entry]));
  for (const capabilityId of new Set([...definition.facadeToolIds, ...definition.nodes.flatMap((node) => node.capabilityPins)])) {
    const state = byId.get(capabilityId);
    if (!state?.registered || !state.implemented || !state.authorable || !state.definitionCompatible) {
      throw new Error(`capability_not_publishable:${capabilityId}:${state?.nextAction ?? "not_registered"}`);
    }
  }
}
