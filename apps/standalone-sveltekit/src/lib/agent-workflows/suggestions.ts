import {
  collectContextualWorkflowTemplateMatches,
  DEFAULT_WORKFLOW_TEMPLATE_ORDER,
  getWorkflowTemplateDefinition,
  type WorkflowTemplateDefinition,
  type WorkflowTemplateSuggestionContext,
} from "./templates.ts";

export interface AgentWorkflowSuggestion {
  label: string;
  prompt: string;
  skillId: WorkflowTemplateDefinition["id"];
  familyId: WorkflowTemplateDefinition["familyId"];
  kind: "intake" | "command-workflow";
  description: string;
  readiness: "ready" | "needs_context" | "approval_required" | "draft_only";
  readinessLabel: string;
  templateId: WorkflowTemplateDefinition["id"];
  marketplaceItemId: string;
  version: string;
  requiredSkills: string[];
  requiredCommands: string[];
  permissionDefaults: WorkflowTemplateDefinition["permissionDefaults"];
  templateReadiness: WorkflowTemplateDefinition["readiness"];
}

export interface AgentWorkflowSuggestionContext extends WorkflowTemplateSuggestionContext {}

export function createWorkflowSuggestions(
  context: AgentWorkflowSuggestionContext | null | undefined,
  input: { limit?: number; mode?: "ranked" | "filtered" } = {},
): AgentWorkflowSuggestion[] {
  const matched = collectContextualWorkflowTemplateMatches(context);
  const ordered = input.mode === "filtered"
    ? matched
    : mergeUniqueWorkflowOrder(matched, DEFAULT_WORKFLOW_TEMPLATE_ORDER);

  return ordered
    .slice(0, input.limit ?? 4)
    .map((templateId) => getWorkflowTemplateDefinition(templateId))
    .filter((template): template is WorkflowTemplateDefinition => template !== null)
    .map(toSuggestion);
}

function toSuggestion(template: WorkflowTemplateDefinition): AgentWorkflowSuggestion {
  return {
    label: template.label,
    prompt: template.launchPrompt,
    skillId: template.id,
    familyId: template.familyId,
    kind: template.kind === "command_workflow" ? "command-workflow" : "intake",
    description: template.description,
    readiness: template.suggestionReadiness,
    readinessLabel: template.readinessLabel,
    templateId: template.id,
    marketplaceItemId: template.marketplaceItemId,
    version: template.version,
    requiredSkills: [...template.requiredSkills],
    requiredCommands: [...template.requiredCommands],
    permissionDefaults: { ...template.permissionDefaults },
    templateReadiness: template.readiness,
  };
}

function mergeUniqueWorkflowOrder(
  primary: WorkflowTemplateDefinition["id"][],
  fallback: readonly WorkflowTemplateDefinition["id"][],
): WorkflowTemplateDefinition["id"][] {
  const ordered = new Set<WorkflowTemplateDefinition["id"]>(primary);
  for (const skillId of fallback) ordered.add(skillId);
  return [...ordered];
}
