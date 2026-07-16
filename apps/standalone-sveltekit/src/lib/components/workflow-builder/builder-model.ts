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
import {
  normalizeCapabilityFamilyModes,
  sonikBookingCapabilityFamilyIds,
} from "@sonik-agent-ui/tool-contracts/capability-family";
import type { WorkflowRunState } from "@sonik-agent-ui/tool-contracts/workflow-run-state";
import {
  WORKFLOW_VNEXT_SCHEMA_VERSION,
  workflowVNextDefinitionSchema,
  type WorkflowVNextDefinition,
} from "@sonik-agent-ui/tool-contracts/workflow-vnext";
import type { AgentUiApprovalStateSnapshot, AgentUiWorkflowPhase } from "@sonik-agent-ui/agent-observability";

export type BuilderTab = "config" | "canvas" | "preview";
export type WorkflowLockState = "draft" | "locked";
export type WorkflowDraftLifecycle = "new" | "dirty" | "saving" | "saved" | "publishing" | "published" | "conflicted" | "outdated" | "invalid" | "failed";
export type KnowledgeRef = AgentDefinition["knowledgeRefs"][number];
export type ActiveWorkflowRunSelection = { workflowId: string; run: WorkflowRunState };
export type WorkflowRunAction = "preview" | "approve" | "commit";
export type WorkflowRunActionDisabledCode =
  | "workflow_action_busy"
  | "workflow_run_not_started"
  | "workflow_preview_node_missing"
  | "workflow_commit_node_missing"
  | "workflow_preview_not_ready"
  | "trusted_host_approval_required"
  | "workflow_run_already_approved"
  | "run_approval_required"
  | "run_approval_does_not_cover_command"
  | "workflow_run_committed";

export interface WorkflowRunActionDisabledState {
  code: WorkflowRunActionDisabledCode;
  message: string;
}

const WORKFLOW_RUN_ACTION_DISABLED_MESSAGES: Record<WorkflowRunActionDisabledCode, string> = {
  workflow_action_busy: "Wait for the current workflow action to finish.",
  workflow_run_not_started: "Start this workflow run before using this action.",
  workflow_preview_node_missing: "This workflow has no preview step to run.",
  workflow_commit_node_missing: "This workflow has no trusted commit step.",
  workflow_preview_not_ready: "Create a workflow preview before approving this run.",
  trusted_host_approval_required: "Reconnect with a trusted host grant for this command before approving or committing.",
  workflow_run_already_approved: "This workflow run is already approved.",
  run_approval_required: "Approve this workflow run before committing it.",
  run_approval_does_not_cover_command: "The run approval does not cover this commit command. Preview and approve it again.",
  workflow_run_committed: "This workflow run is already committed.",
};

export function resolveWorkflowRunBusyDisabledState(busy: boolean): WorkflowRunActionDisabledState | null {
  return busy
    ? { code: "workflow_action_busy", message: WORKFLOW_RUN_ACTION_DISABLED_MESSAGES.workflow_action_busy }
    : null;
}

/** One typed source for the actual Preview/Approve/Commit button state and its
 * human/AT-readable explanation. Authority checks intentionally precede
 * lifecycle checks on approve/commit: a stale approved run never masks that
 * the currently signed host context no longer grants the command. */
export function resolveWorkflowRunActionDisabledState(input: {
  action: WorkflowRunAction;
  busy: boolean;
  hasRun: boolean;
  hasPreviewNode: boolean;
  hasCommitNode: boolean;
  phase: WorkflowRunState["phase"] | null;
  approvalStatus: WorkflowRunState["approvalState"]["status"] | null;
  signedHostGrantCoversCommit: boolean;
  runApprovalCoversCommit: boolean;
}): WorkflowRunActionDisabledState | null {
  const disabled = (code: WorkflowRunActionDisabledCode): WorkflowRunActionDisabledState => ({
    code,
    message: WORKFLOW_RUN_ACTION_DISABLED_MESSAGES[code],
  });
  if (input.busy) return resolveWorkflowRunBusyDisabledState(true);
  if (!input.hasRun) return disabled("workflow_run_not_started");

  if (input.action === "preview") {
    return input.hasPreviewNode ? null : disabled("workflow_preview_node_missing");
  }

  if (!input.hasCommitNode) return disabled("workflow_commit_node_missing");
  if (!input.signedHostGrantCoversCommit) return disabled("trusted_host_approval_required");

  if (input.action === "approve") {
    if (input.approvalStatus === "approved") return disabled("workflow_run_already_approved");
    if (input.phase !== "preview_ready") return disabled("workflow_preview_not_ready");
    return null;
  }

  if (input.phase === "committed") return disabled("workflow_run_committed");
  if (input.approvalStatus !== "approved") return disabled("run_approval_required");
  if (!input.runApprovalCoversCommit) return disabled("run_approval_does_not_cover_command");
  return null;
}

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
  familyId: string | null;
  displayId: string;
  capabilities: CapabilityDescriptor[];
}

/**
 * Groups the flat capability registry into family rows for the tool-scoping
 * drill-down using the client-safe projection generated from the same mounted
 * command catalog as the server. Registry-only capabilities stay visible but
 * have no runnable family id and therefore cannot create policy authority.
 */
export function groupCapabilitiesByFamily(registry: CapabilityRegistry = sonikBookingCapabilityRegistry): CapabilityFamilyGroup[] {
  const byFamily = new Map<string, CapabilityFamilyGroup>();
  for (const capability of registry.capabilities) {
    const familyId = sonikBookingCapabilityFamilyIds[capability.capabilityId] ?? null;
    const displayId = familyId ?? capability.capabilityId.split(".").slice(0, 2).join(".");
    const key = familyId ?? `unavailable:${displayId}`;
    const bucket = byFamily.get(key) ?? { familyId, displayId, capabilities: [] };
    bucket.capabilities.push(capability);
    byFamily.set(key, bucket);
  }
  return [...byFamily.values()]
    .sort((a, b) => a.displayId.localeCompare(b.displayId))
    .map((family) => ({ ...family, capabilities: family.capabilities.slice().sort((a, b) => a.capabilityId.localeCompare(b.capabilityId)) }));
}

/** Read-only projection of the definition's toolPolicy for one family --
 *  reflects the grant, never issues it (Onyx drill-down pattern). */
export function effectiveFamilyMode(definition: AgentDefinition, familyId: string | null): "off" | "ask" | "allow" {
  return familyId ? normalizeCapabilityFamilyModes(definition.toolPolicy)[familyId] ?? "off" : "off";
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

export function resolveWorkflowDraftLifecycle(input: {
  valid: boolean;
  saving: boolean;
  publishing: boolean;
  conflicted: boolean;
  failed: boolean;
  dirty: boolean;
  draftRevision: number | null;
  publishedRevision: number | null;
}): WorkflowDraftLifecycle {
  if (!input.valid) return "invalid";
  if (input.publishing) return "publishing";
  if (input.saving) return "saving";
  if (input.conflicted) return "conflicted";
  if (input.failed) return "failed";
  if (input.dirty) return "dirty";
  if (input.draftRevision === null) return "new";
  if (input.publishedRevision !== null) {
    return input.publishedRevision === input.draftRevision ? "published" : "outdated";
  }
  return "saved";
}

export function hasUnsavedWorkflowChanges(input: { dirty: boolean; saving: boolean; publishing: boolean }): boolean {
  return input.dirty || input.saving;
}

/** Minimal explicit bridge while the canvas still edits the deprecated marketplace shape. */
export function workflowDefinitionToVNext(workflow: WorkflowDefinition): WorkflowVNextDefinition {
  return workflowVNextDefinitionSchema.parse({
    schemaVersion: WORKFLOW_VNEXT_SCHEMA_VERSION,
    workflowId: workflow.workflowId,
    definitionVersion: 1,
    title: workflow.title,
    entryNodeId: workflow.nodes[0]?.nodeId,
    nodes: workflow.nodes.map((node) => ({
      nodeId: node.nodeId,
      nodeType: node.type,
      typeVersion: 1,
      config: { title: node.title, effect: node.effect, approvalPolicy: node.approvalPolicy },
      bindings: {},
      requiredHostContext: node.requiredHostContext ?? [],
      capabilityPins: node.commandId ? [node.commandId] : [],
      output: { inlineByteLimit: 64 * 1024 },
    })),
    edges: workflow.edges.map((edge) => ({ edgeId: edge.edgeId, from: edge.from, to: edge.to, default: !edge.condition })),
    facadeToolIds: workflow.facadeToolIds ?? [],
  });
}

export function workflowVNextToDefinition(workflow: WorkflowVNextDefinition): WorkflowDefinition {
  return workflowDefinitionSchema.parse({
    workflowId: workflow.workflowId,
    title: workflow.title,
    version: `0.${workflow.definitionVersion}.0`,
    nodes: workflow.nodes.map((node) => {
      const config = node.config && typeof node.config === "object" && !Array.isArray(node.config) ? node.config : {};
      return {
        nodeId: node.nodeId,
        type: node.nodeType,
        title: typeof config.title === "string" ? config.title : node.nodeId,
        effect: typeof config.effect === "string" ? config.effect : "none",
        approvalPolicy: typeof config.approvalPolicy === "string" ? config.approvalPolicy : "none",
        requiredHostContext: node.requiredHostContext,
        commandId: node.capabilityPins[0],
      };
    }),
    edges: workflow.edges.map((edge) => ({ edgeId: edge.edgeId, from: edge.from, to: edge.to })),
    facadeToolIds: workflow.facadeToolIds,
  });
}

export function validateWorkflowDefinition(candidate: unknown): WorkflowDefinitionValidation {
  const parsed = workflowDefinitionSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, workflow: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`) };
}

/** True once any tool family is granted "ask"/"allow" -- an agent with no
 *  grants at all can run on a model with no tool-use support. */
export function agentRequiresToolUse(definition: AgentDefinition): boolean {
  return Object.values(normalizeCapabilityFamilyModes(definition.toolPolicy)).some((mode) => mode !== "off");
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

function workflowRunPhaseForApprovalState(phase: WorkflowRunState["phase"]): AgentUiWorkflowPhase {
  return phase === "cancelled" ? "idle" : phase;
}

/**
 * Projects the active builder run into the existing page-control approval API.
 * Approval readiness comes from the controller run, while authority comes only
 * from command ids carried by the currently signed host context. Chat text and
 * standalone mode never manufacture a grant.
 */
export function createWorkflowBuilderApprovalState(
  run: WorkflowRunState | null,
  signedHostApprovedCommandIds: readonly string[],
): AgentUiApprovalStateSnapshot {
  if (!run) {
    return {
      schemaVersion: "sonik.agent_ui.approval_state.v1",
      phase: "idle",
      activeArtifactId: null,
      canRequestApproval: false,
      canApproveAndRun: false,
      disabledReasons: ["workflow_run_not_started"],
      commandPreview: null,
    };
  }

  const previewNode = Object.values(run.nodeStates).find((node) => node.type === "tool_preview");
  const commitNode = Object.values(run.nodeStates).find((node) => node.type === "tool_commit");
  const commandId = commitNode?.commandId ?? previewNode?.commandId ?? null;
  const signedGrantCoversCommand = Boolean(commandId && signedHostApprovedCommandIds.includes(commandId));
  const runApprovalCoversCommand = Boolean(
    commandId
      && run.approvalState.status === "approved"
      && run.approvalState.hostSigned
      && run.approvalState.approvedCommandIds.includes(commandId),
  );
  const canRequestApproval = run.phase === "preview_ready";
  const disabledReasons: string[] = [];

  if (run.phase === "cancelled") disabledReasons.push("workflow_run_cancelled");
  else if (run.phase === "error") disabledReasons.push(previewNode?.error?.code ?? "workflow_run_error");
  else if (run.phase === "committed") disabledReasons.push("workflow_run_committed");
  else if (!previewNode?.preview) disabledReasons.push("workflow_preview_not_ready");
  else if (!commandId) disabledReasons.push("workflow_commit_command_missing");
  else if (!signedGrantCoversCommand) disabledReasons.push("trusted_host_approval_required");
  else if (run.approvalState.status === "approved" && !runApprovalCoversCommand) {
    disabledReasons.push("run_approval_does_not_cover_command");
  }

  return {
    schemaVersion: "sonik.agent_ui.approval_state.v1",
    phase: workflowRunPhaseForApprovalState(run.phase),
    activeArtifactId: run.artifactId,
    canRequestApproval,
    canApproveAndRun: canRequestApproval && signedGrantCoversCommand,
    disabledReasons,
    commandPreview: previewNode?.preview
      ? {
          commandId: previewNode.preview.commandId,
          stableInputHash: previewNode.preview.stableInputHash,
          effect: previewNode.preview.effect === "read" || previewNode.preview.effect === "write" || previewNode.preview.effect === "destructive"
            ? previewNode.preview.effect
            : "write",
          approvalRequired: previewNode.preview.approvalRequired,
        }
      : null,
  };
}

/** Last-interacted panel wins. Reset only clears the run owned by that panel,
 * so resetting an inactive example cannot erase the active approval card. */
export function selectActiveWorkflowRun(
  current: ActiveWorkflowRunSelection | null,
  workflowId: string,
  run: WorkflowRunState | null,
): ActiveWorkflowRunSelection | null {
  if (run) return { workflowId, run };
  return current?.workflowId === workflowId ? null : current;
}
