import type { AgentModelOption } from "../../agent-settings.ts";
import type { WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";

export const COLLAPSED_MODEL_ROW_LIMIT = 10;

export type OrganizerParameterType = "text" | "textarea" | "number" | "boolean" | "string_list";
export type OrganizerEditKind = "parameter_edit" | "safe_patch";
export type OrganizerParameterValue = string | number | boolean | string[];

export interface OrganizerParameter {
  path: string;
  kind: OrganizerEditKind;
  label: string;
  type: OrganizerParameterType;
  value: OrganizerParameterValue;
  description?: string;
}

export interface OrganizerPatchRequest {
  action: "organizer_patch";
  workflowId: string;
  patch: {
    expectedDraftRevision: number;
    edits: Array<{ kind: OrganizerEditKind; path: string; value: OrganizerParameterValue }>;
  };
}

export type OrganizerAction = "test" | "publish" | "approve";

export interface WorkflowHistoryQuery {
  sessionId?: string;
  conversationRunId?: string;
  workflowRunId?: string;
  nodeId?: string;
  toolCallId?: string;
  approvalId?: string;
  artifactId?: string;
  receiptId?: string;
  requestId?: string;
  traceId?: string;
}

export interface WorkflowHistoryProjection {
  query: WorkflowHistoryQuery;
  conversations: Array<{ conversationRunId: string; sessionId: string; messageId?: string; requestId?: string; traceId?: string; startedAt: string; endedAt?: string; status?: string }>;
  workflows: Array<{ workflowRunId: string; workflowId: string; workflowVersionId: string; sessionId: string; createdAt: string; updatedAt: string; status?: string }>;
  nodes: Array<{ workflowRunId: string; nodeId: string; status?: string }>;
  toolCalls: Array<{ toolCallId: string; sessionId: string; messageId?: string; requestId?: string; artifactId?: string; createdAt: string; completedAt?: string; status?: string }>;
  approvals: Array<{ approvalId: string; workflowRunId: string; nodeId: string; status?: string; timestamp?: string }>;
  artifacts: Array<{ artifactId: string; workflowRunId: string; nodeId: string; status?: string; timestamp?: string }>;
  receipts: Array<{ receiptId: string; workflowRunId: string; nodeId: string; semanticStatus: string; timestamp?: string }>;
  events: Array<{ eventId: string; source: string; timestamp: string; status?: string; workflowRunId?: string; nodeId?: string; approvalId?: string; artifactId?: string }>;
}

export function workflowHistoryItemKey(workflowRunId: string, identifier: string): string {
  return JSON.stringify([workflowRunId, identifier]);
}

export type CatalogModelOption = AgentModelOption & {
  supportsVideo?: boolean;
  task?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  disabledReason?: string;
};

export function filterCatalogModels(models: readonly CatalogModelOption[], query: string): CatalogModelOption[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...models];
  return models.filter((model) =>
    [model.label, model.id, model.provider, model.description]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

export function createOrganizerPatchRequest(
  workflow: WorkflowDefinition,
  expectedRevision: number,
  parameters: readonly OrganizerParameter[],
  safePatchPaths: readonly string[],
  values: Readonly<Record<string, OrganizerParameterValue>>,
): OrganizerPatchRequest {
  const declared = new Map(parameters.map((parameter) => [parameter.path, parameter]));
  const allowed = new Set(safePatchPaths);
  const edits = Object.entries(values).flatMap(([path, value]) => {
    const parameter = declared.get(path);
    if (!parameter || !allowed.has(path)) return [];
    if (parameter.kind === "parameter_edit" && !/^parameters\.[^.]+\..+/.test(path)) return [];
    if (parameter.kind === "safe_patch" && !/^nodes\.[^.]+\.config\..+/.test(path)) return [];
    const valid = parameter.type === "string_list"
      ? Array.isArray(value) && value.every((entry) => typeof entry === "string")
      : parameter.type === "boolean"
      ? typeof value === "boolean"
      : parameter.type === "number"
        ? typeof value === "number" && Number.isFinite(value)
        : typeof value === "string";
    return valid ? [{ kind: parameter.kind, path, value }] : [];
  });
  return {
    action: "organizer_patch",
    workflowId: workflow.workflowId,
    patch: { expectedDraftRevision: expectedRevision, edits },
  };
}

export function modelDisabledReason(incompatible: boolean, model: CatalogModelOption): string | null {
  if (model.disabledReason) return model.disabledReason;
  if (incompatible) {
    return "This agent grants tools, but the catalog reports that this model does not support tool use.";
  }
  return null;
}

export function modelCapabilityBadges(model: CatalogModelOption): string[] {
  const badges = new Set<string>();
  if (model.supportsTools) badges.add("Tools");
  if (model.supportsImages) badges.add("Image");
  if (model.supportsReasoning) badges.add("Reasoning");
  if (model.supportsVideo) badges.add("Video");
  if (model.task?.trim()) badges.add(model.task.trim());
  for (const modality of [...(model.inputModalities ?? []), ...(model.outputModalities ?? [])]) {
    const normalized = modality.trim().toLowerCase();
    if (normalized) badges.add(normalized.charAt(0).toUpperCase() + normalized.slice(1));
  }
  return [...badges];
}
