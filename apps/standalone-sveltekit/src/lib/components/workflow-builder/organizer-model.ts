import type { AgentModelOption } from "../../agent-settings.ts";
import type { AgentDefinition, WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
import { isModelIncompatible } from "./builder-model.ts";

export const COLLAPSED_MODEL_ROW_LIMIT = 10;

export type OrganizerParameterType = "text" | "textarea" | "number" | "boolean";

export interface OrganizerParameter {
  path: string;
  kind: string;
  label: string;
  type: OrganizerParameterType;
  value: string | number | boolean;
  description?: string;
}

export interface OrganizerPatchRequest {
  action: "organizer_patch";
  workflowId: string;
  patch: {
    expectedDraftRevision: number;
    edits: Array<{ kind: string; path: string; value: string | number | boolean }>;
  };
}

export type OrganizerAction = "test" | "publish" | "approve";

export interface OperatorHistoryItem {
  id: string;
  type: string;
  label: string;
  status?: string;
  reference?: string;
}

export interface OperatorRunProjection {
  runId: string;
  correlationId: string;
  occurredAt: string;
  status: string;
  events: OperatorHistoryItem[];
  approvals: OperatorHistoryItem[];
  artifacts: OperatorHistoryItem[];
  receipts: OperatorHistoryItem[];
}

export type CatalogModelOption = AgentModelOption & {
  supportsVideo?: boolean;
  task?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  disabledReason?: string;
};

export function createOrganizerPatchRequest(
  workflow: WorkflowDefinition,
  expectedRevision: number,
  parameters: readonly OrganizerParameter[],
  safePatchPaths: readonly string[],
  values: Readonly<Record<string, string | number | boolean>>,
): OrganizerPatchRequest {
  const declared = new Map(parameters.map((parameter) => [parameter.path, parameter]));
  const allowed = new Set(safePatchPaths);
  const edits = Object.entries(values).flatMap(([path, value]) => {
    const parameter = declared.get(path);
    if (!parameter || !allowed.has(path)) return [];
    const valid = parameter.type === "boolean"
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

export function modelDisabledReason(definition: AgentDefinition, model: CatalogModelOption): string | null {
  if (model.disabledReason) return model.disabledReason;
  if (isModelIncompatible(definition, model)) {
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
