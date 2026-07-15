import type { AgentModelOption } from "$lib/agent-settings";
import type { AgentDefinition, WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
import { isModelIncompatible } from "./builder-model";

export const COLLAPSED_MODEL_ROW_LIMIT = 10;

export type OrganizerParameterType = "text" | "textarea" | "number" | "boolean";

export interface OrganizerParameter {
  path: string;
  label: string;
  type: OrganizerParameterType;
  value: string | number | boolean;
  description?: string;
}

export interface OrganizerPatchRequest {
  workflowId: string;
  expectedRevision: number;
  patch: Record<string, string | number | boolean>;
}

export type OrganizerAction = "test" | "publish" | "approve";

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
  const declared = new Set(parameters.map((parameter) => parameter.path));
  const allowed = new Set(safePatchPaths);
  return {
    workflowId: workflow.workflowId,
    expectedRevision,
    patch: Object.fromEntries(Object.entries(values).filter(([path]) => declared.has(path) && allowed.has(path))),
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
