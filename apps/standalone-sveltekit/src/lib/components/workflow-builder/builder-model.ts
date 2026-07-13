// Phase 5 (agent-creation-tool-plan-2026-07-13.md, Decision 3): pure helpers
// for the workflow-builder workspace mode -- schema-validated defaults,
// capability grouping for the tool-scoping drill-down, and parse/validate
// helpers shared by the config panel, canvas, and root shell. No Svelte here
// so this stays a plain node-testable leaf module (repo convention:
// agent-runtime-adapter.ts, command-family-mount.ts).

import {
  agentDefinitionSchema,
  workflowDefinitionSchema,
  type AgentDefinition,
  type WorkflowDefinition,
  type WorkflowNodeType,
} from "@sonik-agent-ui/tool-contracts/marketplace";
import {
  sonikBookingCapabilityRegistry,
  type CapabilityDescriptor,
  type CapabilityRegistry,
} from "@sonik-agent-ui/tool-contracts/capability-registry";

export type BuilderTab = "config" | "canvas" | "preview";
export type WorkflowLockState = "draft" | "locked";
export type KnowledgeRef = AgentDefinition["knowledgeRefs"][number];

export function createEmptyAgentDefinition(agentId: string): AgentDefinition {
  return agentDefinitionSchema.parse({ agentId, title: "Untitled agent" });
}

export function createEmptyWorkflowDefinition(workflowId: string): WorkflowDefinition {
  return workflowDefinitionSchema.parse({
    workflowId,
    title: "Untitled workflow",
    nodes: [{ nodeId: "trigger", type: "trigger", title: "Trigger", effect: "none", approvalPolicy: "none" }],
    version: "0.1.0",
  });
}

export interface CapabilityFamilyGroup {
  familyId: string;
  capabilities: CapabilityDescriptor[];
}

/**
 * Groups the flat capability registry into family rows for the tool-scoping
 * drill-down. `CapabilityDescriptor` has no explicit familyId (D013 keeps
 * capability ids as the single dotted namespace) -- the first two dotted
 * segments (e.g. "booking.create" from "booking.create.booking",
 * "amplify.campaign" from "amplify.campaign.create") is a stable,
 * deterministic grouping key that matches how `toolPolicy`/`toolPermissionModes`
 * are keyed at the family level (see agent-runtime-adapter.ts, command-catalog.ts).
 */
export function groupCapabilitiesByFamily(registry: CapabilityRegistry = sonikBookingCapabilityRegistry): CapabilityFamilyGroup[] {
  const byFamily = new Map<string, CapabilityDescriptor[]>();
  for (const capability of registry.capabilities) {
    const familyId = capability.capabilityId.split(".").slice(0, 2).join(".");
    const bucket = byFamily.get(familyId) ?? [];
    bucket.push(capability);
    byFamily.set(familyId, bucket);
  }
  return [...byFamily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([familyId, capabilities]) => ({
      familyId,
      capabilities: capabilities.slice().sort((a, b) => a.capabilityId.localeCompare(b.capabilityId)),
    }));
}

/** Read-only projection of the definition's toolPolicy for one family --
 *  reflects the grant, never issues it (Onyx drill-down pattern). */
export function effectiveFamilyMode(definition: AgentDefinition, familyId: string): "off" | "ask" | "allow" {
  return definition.toolPolicy[familyId] ?? "off";
}

export const WORKFLOW_NODE_TYPES: WorkflowNodeType[] = [
  "trigger", "ask_user", "tool_preview", "approval", "tool_commit",
  "skill", "artifact", "remote_execution", "evidence", "branch",
];

/** The 5 controller-live node types (consensus plan Phase 4 outcome, Decision 2).
 *  The other 5 parse but return `unsupported_node_type` at the controller --
 *  the drafting agent (Phase 6, a different owner this wave) gates on this
 *  same set; the canvas surfaces it too so a hand-edited draft sees the same
 *  ceiling before it ever reaches the controller. */
export const LIVE_CONTROLLER_NODE_TYPES: ReadonlySet<WorkflowNodeType> = new Set([
  "trigger", "ask_user", "tool_preview", "approval", "tool_commit",
]);

export interface AgentDefinitionValidation {
  ok: boolean;
  definition?: AgentDefinition;
  issues?: string[];
}

/** D016 emit discipline: zod-parse before save/publish, never trust the
 *  working draft object directly. */
export function validateAgentDefinition(candidate: unknown): AgentDefinitionValidation {
  const parsed = agentDefinitionSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, definition: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
}

export interface WorkflowDefinitionValidation {
  ok: boolean;
  workflow?: WorkflowDefinition;
  issues?: string[];
}

export function validateWorkflowDefinition(candidate: unknown): WorkflowDefinitionValidation {
  const parsed = workflowDefinitionSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, workflow: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
}

/** True once any tool family is granted "ask"/"allow" -- an agent with no
 *  grants at all can run on a model with no tool-use support. */
export function agentRequiresToolUse(definition: AgentDefinition): boolean {
  return Object.values(definition.toolPolicy).some((mode) => mode !== "off");
}

/** Dify-bar incompatible-model flag for the config panel's model picker:
 *  only flags an explicit `supportsTools === false` (never `undefined` --
 *  the static fallback catalog doesn't report capability metadata, and an
 *  unknown capability must not read as a false incompatibility). */
export function isModelIncompatible(definition: AgentDefinition, model: { supportsTools?: boolean }): boolean {
  return agentRequiresToolUse(definition) && model.supportsTools === false;
}

export function formatModelContextWindow(value: number | undefined): string {
  if (!value) return "context unknown";
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M context`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K context`;
  return `${value} context`;
}
