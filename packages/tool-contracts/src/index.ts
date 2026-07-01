import { z } from "zod";

export const toolSourceSchema = z.enum(["orpc", "openapi", "mcp", "sandbox", "local-ui"]);
export const toolEffectSchema = z.enum(["read", "write", "destructive", "environment", "unknown"]);
export const toolApprovalSchema = z.enum(["none", "required", "denied"]);
export const toolUiTargetSchema = z.enum(["none", "chat", "inline-json", "artifact", "canvas", "document", "terminal"]);

export type ToolSource = z.infer<typeof toolSourceSchema>;
export type ToolEffect = z.infer<typeof toolEffectSchema>;
export type ToolApproval = z.infer<typeof toolApprovalSchema>;
export type ToolUiTarget = z.infer<typeof toolUiTargetSchema>;

export const toolSchemaRefSchema = z.object({
  kind: z.enum(["zod", "json-schema", "openapi", "unknown"]),
  ref: z.string().optional(),
  schema: z.unknown().optional(),
});

export const toolContractEntrySchema = z.object({
  id: z.string().min(1),
  source: toolSourceSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  effect: toolEffectSchema,
  approval: toolApprovalSchema.default("none"),
  uiTargets: z.array(toolUiTargetSchema).default(["chat"]),
  capabilities: z.array(z.string()).default([]),
  input: toolSchemaRefSchema.default({ kind: "unknown" }),
  output: toolSchemaRefSchema.default({ kind: "unknown" }),
  auth: z.object({
    required: z.boolean().default(false),
    scopes: z.array(z.string()).default([]),
    orgScoped: z.boolean().default(false),
  }).default({ required: false, scopes: [], orgScoped: false }),
  transport: z.object({
    procedure: z.string().optional(),
    method: z.string().optional(),
    path: z.string().optional(),
    runtimeStatus: z.enum(["mounted", "shadow", "unknown"]).default("unknown"),
  }).default({ runtimeStatus: "unknown" }),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const toolManifestSchema = z.object({
  version: z.literal("sonik-agent-ui.tool-manifest.v1"),
  generatedAt: z.string(),
  provider: z.string().min(1),
  tools: z.array(toolContractEntrySchema),
});

export type ToolSchemaRef = z.infer<typeof toolSchemaRefSchema>;
export type ToolContractEntry = z.infer<typeof toolContractEntrySchema>;
export type ToolManifest = z.infer<typeof toolManifestSchema>;

export type ToolAvailabilityContext = {
  authenticated?: boolean;
  organizationId?: string | null;
  scopes?: string[];
  allowMutations?: boolean;
  allowDestructive?: boolean;
  includeApprovalRequired?: boolean;
  sourceMode?: "all" | "orpc-app-state" | "mcp" | "sandbox" | "local-ui";
};

export type ToolPolicyDecision = {
  decision: "allow" | "approval_required" | "deny";
  reasons: string[];
};

const mutationVerbPattern = /(^|\.)(create|update|patch|delete|remove|cancel|confirm|assign|unassign|reserve|commit|send|upload|open|add|post)(\.|$)/i;
const destructiveVerbPattern = /(^|\.)(delete|remove|destroy|purge|void|revoke|unassign)(\.|$)/i;
const arbitraryEndpointPattern = /(^https?:\/\/)|[\s]|\//i;
const validProcedurePattern = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)+$/i;

export function createToolManifest(provider: string, tools: ToolContractEntry[], generatedAt = new Date().toISOString()): ToolManifest {
  return toolManifestSchema.parse({ version: "sonik-agent-ui.tool-manifest.v1", generatedAt, provider, tools });
}

export function inferEffectFromHttpMethod(method?: string): ToolEffect {
  const normalized = method?.toUpperCase();
  if (!normalized) return "unknown";
  if (["GET", "HEAD", "OPTIONS"].includes(normalized)) return "read";
  if (["POST", "PUT", "PATCH"].includes(normalized)) return "write";
  if (normalized === "DELETE") return "destructive";
  return "unknown";
}

export function inferEffectFromProcedureId(id: string, defaultEffect: ToolEffect = "unknown"): ToolEffect {
  if (destructiveVerbPattern.test(id)) return "destructive";
  if (mutationVerbPattern.test(id)) return "write";
  if (/(^|\.)(get|list|read|search|lookup|preview|learn|catalog|find)(\.|$)/i.test(id)) return "read";
  return defaultEffect;
}

export function isValidOrpcProcedureId(id: string): boolean {
  if (arbitraryEndpointPattern.test(id)) return false;
  return validProcedurePattern.test(id);
}

export function normalizeToolEntry(entry: ToolContractEntry): ToolContractEntry {
  const parsed = toolContractEntrySchema.parse(entry);
  const inferredEffect = parsed.effect === "unknown" ? inferEffectFromProcedureId(parsed.id, parsed.effect) : parsed.effect;
  return {
    ...parsed,
    effect: inferredEffect,
    approval: normalizeApproval(parsed.approval, inferredEffect),
  };
}

export function evaluateToolPolicy(tool: ToolContractEntry, context: ToolAvailabilityContext = {}): ToolPolicyDecision {
  const entry = normalizeToolEntry(tool);
  const reasons: string[] = [];

  if (context.sourceMode === "orpc-app-state" && entry.source !== "orpc" && entry.source !== "openapi") {
    return { decision: "deny", reasons: ["source_not_orpc_app_state"] };
  }
  if (context.sourceMode === "mcp" && entry.source !== "mcp") {
    return { decision: "deny", reasons: ["source_not_mcp"] };
  }
  if (context.sourceMode === "sandbox" && entry.source !== "sandbox") {
    return { decision: "deny", reasons: ["source_not_sandbox"] };
  }
  if (context.sourceMode === "local-ui" && entry.source !== "local-ui") {
    return { decision: "deny", reasons: ["source_not_local_ui"] };
  }

  if (entry.source === "orpc" && !isValidOrpcProcedureId(entry.transport.procedure ?? entry.id)) {
    reasons.push("invalid_orpc_procedure_id");
  }
  if (entry.source === "sandbox" && context.sourceMode === "orpc-app-state") {
    reasons.push("sandbox_not_app_state");
  }
  if (entry.auth.required && context.authenticated !== true) {
    reasons.push("auth_required");
  }
  if (entry.auth.orgScoped && !context.organizationId) {
    reasons.push("organization_required");
  }
  const contextScopes = new Set(context.scopes ?? []);
  const missingScopes = entry.auth.scopes.filter((scope) => !contextScopes.has(scope));
  if (missingScopes.length > 0) {
    reasons.push(`missing_scopes:${missingScopes.join(",")}`);
  }
  if (entry.approval === "denied") {
    reasons.push("tool_denied_by_manifest");
  }
  if (entry.effect === "unknown") {
    reasons.push("unknown_effect_denied");
  }
  if (entry.effect === "environment" && entry.source !== "sandbox") {
    reasons.push("environment_effect_requires_sandbox_source");
  }
  if (entry.effect === "write" && context.allowMutations !== true && entry.approval !== "required") {
    reasons.push("write_requires_approval_or_mutation_context");
  }
  if (entry.effect === "destructive" && context.allowDestructive !== true) {
    reasons.push("destructive_requires_explicit_approval");
  }

  if (reasons.length > 0) {
    const approvalGateOnly = reasons.every((reason) =>
      ["write_requires_approval_or_mutation_context", "destructive_requires_explicit_approval"].includes(reason)
    ) && entry.approval === "required";
    return approvalGateOnly ? { decision: "approval_required", reasons } : { decision: "deny", reasons };
  }

  if (entry.approval === "required") {
    return { decision: "approval_required", reasons: ["manifest_requires_approval"] };
  }

  return { decision: "allow", reasons: ["policy_allowed"] };
}

export function filterAvailableTools(manifest: ToolManifest, context: ToolAvailabilityContext = {}): ToolManifest {
  const tools = manifest.tools
    .map(normalizeToolEntry)
    .map((tool) => ({ tool, policy: evaluateToolPolicy(tool, context) }))
    .filter(({ policy }) => policy.decision === "allow" || (context.includeApprovalRequired === true && policy.decision === "approval_required"))
    .map(({ tool, policy }) => ({
      ...tool,
      approval: policy.decision === "approval_required" ? "required" : tool.approval,
      metadata: { ...tool.metadata, policyDecision: policy.decision, policyReasons: policy.reasons },
    }));

  return createToolManifest(manifest.provider, tools, manifest.generatedAt);
}

export function summarizeToolManifest(manifest: ToolManifest): string {
  const bySource = countBy(manifest.tools.map((tool) => tool.source));
  const byEffect = countBy(manifest.tools.map((tool) => tool.effect));
  const lines = [
    `Tool manifest ${manifest.provider}: ${manifest.tools.length} tools`,
    `sources=${formatCounts(bySource)}`,
    `effects=${formatCounts(byEffect)}`,
  ];
  for (const tool of manifest.tools.slice(0, 20)) {
    lines.push(`- ${tool.id} [${tool.source}/${tool.effect}/${tool.approval}] targets=${tool.uiTargets.join(",")}: ${tool.title}`);
  }
  if (manifest.tools.length > 20) lines.push(`- ...${manifest.tools.length - 20} more`);
  return lines.join("\n");
}

function normalizeApproval(approval: ToolApproval, effect: ToolEffect): ToolApproval {
  if (approval !== "none") return approval;
  if (effect === "write" || effect === "destructive" || effect === "environment") return "required";
  if (effect === "unknown") return "denied";
  return "none";
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts).map(([key, value]) => `${key}:${value}`).join(",") || "none";
}

export const askUserAnswerTypeSchema = z.enum([
  "single_choice",
  "multi_choice",
  "choice_cards",
  "short_text",
  "long_text",
  "textarea",
  "boolean",
  "number",
  "date",
  "datetime",
  "list",
  "structured_list",
  "weekly_schedule",
  "confirmation",
]);

export const interactiveSurfaceKindSchema = z.enum([
  "ask_user_question",
  "question_group",
  "manifest_wizard",
  "command_confirmation",
  "manifest_preview",
  "intake_artifact",
]);

export const interactiveSurfaceStatusSchema = z.enum(["draft", "active", "answered", "skipped", "validated", "exported", "cancelled"]);
export const interactiveSurfaceSourceSchema = z.enum(["agent", "skill", "page-context", "artifact", "host", "system"]);

const askUserQuestionChoiceObjectSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  disabled: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const askUserQuestionChoiceSchema = z.union([
  z.string().min(1).transform((value) => ({ value, label: value, disabled: false, metadata: {} })),
  askUserQuestionChoiceObjectSchema.transform((choice) => ({
    ...choice,
    label: choice.label ?? String(choice.value),
    disabled: choice.disabled ?? false,
    metadata: choice.metadata ?? {},
  })),
]);

function normalizeAskQuestionWireInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;
  return {
    ...raw,
    version: raw.version ?? "sonik-agent-ui.ask-user-question.v1",
    id: raw.id ?? raw.question_id ?? raw.questionId,
    whyThisMatters: raw.whyThisMatters ?? raw.why_this_matters,
    answerType: raw.answerType ?? raw.answer_type,
    defaultValue: raw.defaultValue ?? raw.default,
    allowSkip: raw.allowSkip ?? raw.allow_skip,
    skipValue: raw.skipValue ?? raw.skip_value,
    writesTo: raw.writesTo ?? raw.writes_to,
    maxSelections: raw.maxSelections ?? raw.max_selections,
    minSelections: raw.minSelections ?? raw.min_selections,
    reviewRequired: raw.reviewRequired ?? raw.review_required,
  };
}

export const safeQuestionIdSchema = z.string().min(1).superRefine((id, ctx) => {
  const segments = id.split("/").map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (segments.some((segment) => segment === "__proto__" || segment === "prototype" || segment === "constructor")) {
    ctx.addIssue({ code: "custom", message: "Question ids must not contain prototype-polluting path segments." });
  }
});

export const askUserQuestionSpecSchema = z.preprocess(normalizeAskQuestionWireInput, z.object({
  version: z.literal("sonik-agent-ui.ask-user-question.v1").default("sonik-agent-ui.ask-user-question.v1"),
  id: safeQuestionIdSchema,
  title: z.string().min(1),
  body: z.string().min(1),
  whyThisMatters: z.string().min(1).optional(),
  answerType: askUserAnswerTypeSchema,
  choices: z.array(askUserQuestionChoiceSchema).default([]),
  defaultValue: z.unknown().optional(),
  required: z.boolean().default(false),
  allowSkip: z.boolean().default(true),
  skipValue: z.unknown().default("unknown"),
  writesTo: z.string().min(1).optional(),
  minSelections: z.number().int().nonnegative().default(0),
  maxSelections: z.number().int().positive().optional(),
  source: interactiveSurfaceSourceSchema.default("agent"),
  confidence: z.number().min(0).max(1).optional(),
  reviewRequired: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).superRefine((question, ctx) => {
  const choiceTypes = new Set(["single_choice", "multi_choice", "choice_cards", "confirmation"]);
  if (choiceTypes.has(question.answerType) && question.choices.length === 0) {
    ctx.addIssue({ code: "custom", path: ["choices"], message: `${question.answerType} questions require at least one choice.` });
  }
  if (!choiceTypes.has(question.answerType) && question.choices.length > 0) {
    ctx.addIssue({ code: "custom", path: ["choices"], message: `${question.answerType} questions must not include choices.` });
  }
  if (question.required && question.allowSkip) {
    ctx.addIssue({ code: "custom", path: ["allowSkip"], message: "Required questions must not allow skip." });
  }
  if (question.answerType === "single_choice" && question.maxSelections && question.maxSelections !== 1) {
    ctx.addIssue({ code: "custom", path: ["maxSelections"], message: "single_choice maxSelections must be 1 when provided." });
  }
  if (question.answerType === "multi_choice" && question.maxSelections && question.minSelections > question.maxSelections) {
    ctx.addIssue({ code: "custom", path: ["minSelections"], message: "minSelections cannot exceed maxSelections." });
  }
  const values = question.choices.map((choice) => String(choice.value));
  if (new Set(values).size !== values.length) {
    ctx.addIssue({ code: "custom", path: ["choices"], message: "Question choice values must be unique after normalization." });
  }
}));

export const questionAnswerSubmissionSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const raw = input as Record<string, unknown>;
  return {
    ...raw,
    questionId: raw.questionId ?? raw.question_id,
    artifactId: raw.artifactId ?? raw.artifact_id,
    sessionId: raw.sessionId ?? raw.session_id,
    answeredAt: raw.answeredAt ?? raw.answered_at,
    writesTo: raw.writesTo ?? raw.writes_to,
  };
}, z.object({
  version: z.literal("sonik-agent-ui.question-answer-submission.v1").default("sonik-agent-ui.question-answer-submission.v1"),
  questionId: z.string().min(1),
  value: z.unknown().optional(),
  skipped: z.boolean().default(false),
  writesTo: z.string().min(1).optional(),
  artifactId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  answeredAt: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
}));

const interactiveSurfaceActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["ask_user_question", "submit_answer", "validate_manifest", "export_manifest", "preview_command"]),
  toolRef: z.string().min(1).optional(),
  commandId: z.string().min(1).optional(),
  requiresConfirmation: z.boolean().default(false),
  inputMap: z.record(z.string(), z.unknown()).default({}),
  outputMap: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).superRefine((action, ctx) => {
  if ((action.toolRef || action.commandId) && action.kind !== "preview_command") {
    ctx.addIssue({ code: "custom", path: ["kind"], message: "Interactive surfaces may preview command/tool targets only; execution belongs to command tools." });
  }
});

export const interactiveSurfaceSpecSchema = z.object({
  version: z.literal("sonik-agent-ui.interactive-surface.v1").default("sonik-agent-ui.interactive-surface.v1"),
  id: z.string().min(1),
  kind: interactiveSurfaceKindSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  status: interactiveSurfaceStatusSchema.default("draft"),
  source: interactiveSurfaceSourceSchema.default("agent"),
  skillId: z.string().min(1).optional(),
  artifactId: z.string().min(1).optional(),
  questions: z.array(askUserQuestionSpecSchema).default([]),
  state: z.record(z.string(), z.unknown()).default({}),
  actions: z.array(interactiveSurfaceActionSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).superRefine((surface, ctx) => {
  if ((surface.kind === "ask_user_question" || surface.kind === "question_group") && surface.questions.length === 0) {
    ctx.addIssue({ code: "custom", path: ["questions"], message: `${surface.kind} surfaces require at least one question.` });
  }
  const questionIds = surface.questions.map((question) => question.id);
  if (new Set(questionIds).size !== questionIds.length) {
    ctx.addIssue({ code: "custom", path: ["questions"], message: "Interactive surface question ids must be unique." });
  }
});

export type AskUserAnswerType = z.infer<typeof askUserAnswerTypeSchema>;
export type AskUserQuestionChoice = z.infer<typeof askUserQuestionChoiceSchema>;
export type AskUserQuestionSpec = z.infer<typeof askUserQuestionSpecSchema>;
export type QuestionAnswerSubmission = z.infer<typeof questionAnswerSubmissionSchema>;
export type InteractiveSurfaceKind = z.infer<typeof interactiveSurfaceKindSchema>;
export type InteractiveSurfaceSpec = z.infer<typeof interactiveSurfaceSpecSchema>;

export type QuestionAnswerValidationResult =
  | { ok: true; submission: QuestionAnswerSubmission; writesTo?: string; normalizedValue: unknown }
  | { ok: false; errors: Array<{ code: string; message: string; path: Array<string | number> }> };

export function createAskUserQuestionSpec(input: unknown): AskUserQuestionSpec {
  return askUserQuestionSpecSchema.parse(input);
}

export function createInteractiveSurfaceSpec(input: unknown): InteractiveSurfaceSpec {
  return interactiveSurfaceSpecSchema.parse(input);
}

function normalizeOpenDesignQuestionOptions(options: unknown): AskUserQuestionChoice[] {
  if (!Array.isArray(options)) return [];
  return options.flatMap((option): AskUserQuestionChoice[] => {
    if (typeof option === "string") {
      const label = option.trim();
      return label ? [{ value: label, label, disabled: false, metadata: {} }] : [];
    }
    if (!option || typeof option !== "object" || Array.isArray(option)) return [];
    const raw = option as Record<string, unknown>;
    const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : undefined;
    const rawValue = raw.value;
    const value = typeof rawValue === "string" && rawValue.trim()
      ? rawValue.trim()
      : typeof rawValue === "number" || typeof rawValue === "boolean"
        ? rawValue
        : label;
    if (value === undefined || !label) return [];
    return [{
      value,
      label,
      description: typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : undefined,
      disabled: raw.disabled === true,
      metadata: typeof raw.metadata === "object" && raw.metadata !== null && !Array.isArray(raw.metadata) ? raw.metadata as Record<string, unknown> : {},
    }];
  });
}

export function createAskUserQuestionsFromQuestionForm(formInput: unknown): AskUserQuestionSpec[] {
  if (!formInput || typeof formInput !== "object" || Array.isArray(formInput)) return [];
  const form = formInput as Record<string, unknown>;
  const questions = Array.isArray(form.questions) ? form.questions : [];
  return questions.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const question = raw as Record<string, unknown>;
    const id = typeof question.id === "string" && question.id.trim() ? question.id.trim() : `q${index + 1}`;
    const label = typeof question.label === "string" && question.label.trim() ? question.label.trim() : id;
    const type = typeof question.type === "string" ? question.type.toLowerCase() : "text";
    const choices = normalizeOpenDesignQuestionOptions(question.options);
    const answerType: AskUserAnswerType = type === "direction-cards"
      ? "choice_cards"
      : type === "radio" || type === "select"
        ? "single_choice"
      : type === "checkbox"
        ? "multi_choice"
        : type === "textarea"
          ? "long_text"
          : "short_text";
    return [createAskUserQuestionSpec({
      id,
      title: label,
      body: label,
      whyThisMatters: typeof question.help === "string" && question.help.trim() ? question.help : undefined,
      answerType,
      choices: answerType === "single_choice" || answerType === "multi_choice" || answerType === "choice_cards" ? choices : [],
      defaultValue: question.defaultValue,
      required: question.required === true,
      allowSkip: question.required === true ? false : true,
      maxSelections: typeof question.maxSelections === "number" ? question.maxSelections : undefined,
      source: "agent",
      metadata: {
        questionFormId: typeof form.id === "string" ? form.id : undefined,
        questionFormQuestionType: question.type,
        placeholder: typeof question.placeholder === "string" ? question.placeholder : undefined,
      },
    })];
  });
}

export function validateQuestionAnswer(questionInput: unknown, submissionInput: unknown): QuestionAnswerValidationResult {
  const questionResult = askUserQuestionSpecSchema.safeParse(questionInput);
  const submissionResult = questionAnswerSubmissionSchema.safeParse(submissionInput);
  if (!questionResult.success || !submissionResult.success) {
    return { ok: false, errors: [...zodIssues(questionResult), ...zodIssues(submissionResult)] };
  }
  const question = questionResult.data;
  const submission = submissionResult.data;
  const errors: Array<{ code: string; message: string; path: Array<string | number> }> = [];

  if (submission.questionId !== question.id) {
    errors.push({ code: "question_id_mismatch", message: "Submission questionId must match the question spec id.", path: ["questionId"] });
  }
  const selectedWritesTo = submission.writesTo ?? question.writesTo;
  if (submission.skipped) {
    if (!question.allowSkip) {
      errors.push({ code: "skip_not_allowed", message: "This question cannot be skipped.", path: ["skipped"] });
    }
    const writesToError = validateQuestionWritesToPath(selectedWritesTo);
    if (writesToError) errors.push(writesToError);
    return errors.length > 0 ? { ok: false, errors } : { ok: true, submission, writesTo: selectedWritesTo, normalizedValue: question.skipValue };
  }
  if (question.required && isEffectivelyEmptyAnswer(submission.value)) {
    errors.push({ code: "answer_required", message: "A non-empty value is required for this question.", path: ["value"] });
  }

  const enabledChoiceValues = new Set(question.choices.filter((choice) => !choice.disabled).map((choice) => choice.value));
  const disabledChoiceValues = new Set(question.choices.filter((choice) => choice.disabled).map((choice) => choice.value));
  if (question.answerType === "single_choice" || question.answerType === "choice_cards" || question.answerType === "confirmation") {
    const submittedValue = submission.value as string | number | boolean;
    if (disabledChoiceValues.has(submittedValue)) {
      errors.push({ code: "disabled_choice", message: "Answer must not select a disabled choice.", path: ["value"] });
    } else if (!enabledChoiceValues.has(submittedValue)) {
      errors.push({ code: "invalid_choice", message: "Answer must match one of the declared enabled choices.", path: ["value"] });
    }
  }
  if (question.answerType === "multi_choice") {
    if (!Array.isArray(submission.value)) {
      errors.push({ code: "invalid_multi_choice", message: "Answer must be an array for multi_choice questions.", path: ["value"] });
    } else {
      const selected = submission.value as Array<string | number | boolean>;
      if (new Set(selected).size !== selected.length) {
        errors.push({ code: "duplicate_selection", message: "Multi-choice answers must not contain duplicate selections.", path: ["value"] });
      }
      for (const value of selected) {
        if (disabledChoiceValues.has(value)) {
          errors.push({ code: "disabled_choice", message: `Disabled choice value: ${String(value)}`, path: ["value"] });
        } else if (!enabledChoiceValues.has(value)) {
          errors.push({ code: "invalid_choice", message: `Unknown choice value: ${String(value)}`, path: ["value"] });
        }
      }
      const minimumSelections = question.required ? Math.max(1, question.minSelections) : question.minSelections;
      if (selected.length < minimumSelections) errors.push({ code: "min_selections", message: `Select at least ${minimumSelections} choices.`, path: ["value"] });
      if (question.maxSelections && selected.length > question.maxSelections) errors.push({ code: "max_selections", message: `Select no more than ${question.maxSelections} choices.`, path: ["value"] });
    }
  }
  if (question.answerType === "boolean" && typeof submission.value !== "boolean") {
    errors.push({ code: "invalid_boolean", message: "Answer must be boolean.", path: ["value"] });
  }
  if (question.answerType === "number" && (typeof submission.value !== "number" || !Number.isFinite(submission.value))) {
    errors.push({ code: "invalid_number", message: "Answer must be a finite number.", path: ["value"] });
  }
  if (["short_text", "long_text", "textarea", "date", "datetime", "weekly_schedule"].includes(question.answerType) && typeof submission.value !== "string") {
    errors.push({ code: "invalid_text", message: `${question.answerType} answers must be strings.`, path: ["value"] });
  }
  if ((question.answerType === "list" || question.answerType === "structured_list") && !Array.isArray(submission.value)) {
    errors.push({ code: "invalid_list", message: `${question.answerType} answers must be arrays.`, path: ["value"] });
  }
  const writesToError = validateQuestionWritesToPath(selectedWritesTo);
  if (writesToError) errors.push(writesToError);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, submission, writesTo: selectedWritesTo, normalizedValue: submission.value };
}

function isEffectivelyEmptyAnswer(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "number") return !Number.isFinite(value);
  return false;
}

function zodIssues(result: { success: true } | { success: false; error: { issues: Array<{ code: string; message: string; path: Array<PropertyKey> }> } }): Array<{ code: string; message: string; path: Array<string | number> }> {
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.map((part) => typeof part === "symbol" ? part.toString() : part),
  }));
}


export const questionAnswerLifecycleSchema = z.enum(["draft", "answered", "skipped", "invalid"]);

export type QuestionAnswerStateUpdate = { path: string; value: unknown };
export type QuestionAnswerControllerReceipt = {
  questionId: string;
  lifecycle: z.infer<typeof questionAnswerLifecycleSchema>;
  writesTo?: string;
  authority: "user_answer_only";
  execution: "none";
  approval: "not_granted";
};

export type QuestionAnswerStateUpdateResult =
  | { ok: true; submission: QuestionAnswerSubmission; normalizedValue: unknown; updates: QuestionAnswerStateUpdate[]; receipt: QuestionAnswerControllerReceipt }
  | { ok: false; errors: Array<{ code: string; message: string; path: Array<string | number> }> };

function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function isJsonPointerPath(path: string | undefined): path is string {
  return typeof path === "string" && path.startsWith("/");
}

function validateQuestionWritesToPath(path: string | undefined): { code: string; message: string; path: Array<string | number> } | null {
  if (!isJsonPointerPath(path)) return null;
  if (!path.startsWith("/manifest/")) {
    return { code: "unsafe_writes_to", message: "JSON Pointer writesTo targets must stay inside /manifest/.", path: ["writesTo"] };
  }
  const segments = path.slice(1).split("/").map(decodeJsonPointerSegment);
  if (segments.some((segment) => segment === "__proto__" || segment === "prototype" || segment === "constructor")) {
    return { code: "unsafe_writes_to", message: "JSON Pointer writesTo targets must not contain prototype-polluting segments.", path: ["writesTo"] };
  }
  return null;
}

function nowIso(options?: { now?: string | Date }): string {
  if (typeof options?.now === "string") return options.now;
  if (options?.now instanceof Date) return options.now.toISOString();
  return new Date().toISOString();
}

export function createQuestionAnswerStateUpdates(
  questionInput: unknown,
  submissionInput: unknown,
  options: { now?: string | Date } = {},
): QuestionAnswerStateUpdateResult {
  const validation = validateQuestionAnswer(questionInput, submissionInput);
  if (!validation.ok) return validation;

  const question = createAskUserQuestionSpec(questionInput);
  const questionIdSegment = escapeJsonPointerSegment(question.id);
  const answeredAt = validation.submission.answeredAt ?? nowIso(options);
  const writesTo = validation.writesTo;
  const lifecycle = validation.submission.skipped ? "skipped" : "answered";
  const submission: QuestionAnswerSubmission = {
    ...validation.submission,
    answeredAt,
    writesTo,
    metadata: {
      ...validation.submission.metadata,
      controller: "sonik-agent-ui.question-answer-state.v1",
      execution: "none",
      approval: "not_granted",
    },
  };

  const updates: QuestionAnswerStateUpdate[] = [
    { path: `/answers/${questionIdSegment}`, value: validation.normalizedValue },
    { path: `/questionStates/${questionIdSegment}`, value: lifecycle },
    { path: `/questionSubmissions/${questionIdSegment}`, value: submission },
    {
      path: "/lastQuestionSubmission",
      value: {
        questionId: question.id,
        lifecycle,
        answeredAt,
        writesTo,
      },
    },
  ];

  if (writesTo) {
    updates.push({
      path: `/answerWrites/${questionIdSegment}`,
      value: { questionId: question.id, writesTo, value: validation.normalizedValue, answeredAt },
    });
    if (isJsonPointerPath(writesTo)) {
      updates.push({ path: writesTo, value: validation.normalizedValue });
    }
  }

  return {
    ok: true,
    submission,
    normalizedValue: validation.normalizedValue,
    updates,
    receipt: {
      questionId: question.id,
      lifecycle,
      writesTo,
      authority: "user_answer_only",
      execution: "none",
      approval: "not_granted",
    },
  };
}

export function createQuestionAnswerStateUpdateRecord(
  questionInput: unknown,
  submissionInput: unknown,
  options: { now?: string | Date } = {},
): Record<string, unknown> {
  const result = createQuestionAnswerStateUpdates(questionInput, submissionInput, options);
  if (!result.ok) {
    const message = result.errors.map((error) => `${error.code}: ${error.message}`).join("; ");
    throw new Error(message || "Invalid question answer submission.");
  }
  return Object.fromEntries(result.updates.map((update) => [update.path, update.value]));
}

export const commandShapeSchema = z.enum(["dispatch", "record", "catalog", "media", "local-ui", "composite"]);
export const commandExecutionSourceSchema = z.enum(["cli", "mcp", "agent-ui", "orpc", "sandbox", "surface", "test", "headless"]);
export const commandActionSchema = z.enum(["execute", "commit"]);
export const commandFamilySourceSchema = z.enum(["core", "host", "integration"]);
export const commandLoadModeSchema = z.enum(["eager-summary", "surface-eager", "lazy", "hidden"]);
export const commandPolicyDecisionSchema = z.object({
  decision: z.enum(["allow", "deny", "needs_approval", "approval_required"]),
  reasons: z.array(z.string()),
});

export const commandFamilyDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  parentId: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  source: commandFamilySourceSchema.default("core"),
});

export const commandFamilyRegistrySchema = z.object({
  version: z.literal("sonik-agent-ui.command-family-registry.v1"),
  generatedAt: z.string(),
  provider: z.string().min(1),
  families: z.array(commandFamilyDefinitionSchema),
});

export const commandLoadPolicySchema = z.object({
  mode: commandLoadModeSchema.default("lazy"),
  priority: z.number().default(0),
  profile: z.string().optional(),
});

export const commandContextHintsSchema = z.object({
  routes: z.array(z.string()).default([]),
  surfaces: z.array(z.string()).default([]),
  pageTypes: z.array(z.string()).default([]),
  artifactTypes: z.array(z.string()).default([]),
  skillFamilies: z.array(z.string()).default([]),
  commandFamilies: z.array(z.string()).default([]),
  requiredScopes: z.array(z.string()).default([]),
});

export const commandReceiptSchema = z.object({
  ok: z.boolean(),
  commandId: z.string().min(1),
  summary: z.unknown(),
  handle: z.string().optional(),
  resources: z.array(z.object({ uri: z.string(), title: z.string(), mimeType: z.string().optional() })).optional(),
  nextActions: z.array(z.string()).default([]),
  policy: commandPolicyDecisionSchema,
  trace: z.object({
    requestId: z.string().min(1),
    sessionId: z.string().nullable().optional(),
    durationMs: z.number().nonnegative(),
    provider: z.string().optional(),
    cache: z.enum(["hit", "miss"]).optional(),
    source: commandExecutionSourceSchema,
  }),
  errors: z.array(z.object({ code: z.string(), message: z.string(), retryable: z.boolean().optional() })).optional(),
}).superRefine((receipt, ctx) => {
  if (receipt.resources && receipt.resources.length > 0 && !receipt.handle) {
    ctx.addIssue({ code: "custom", path: ["handle"], message: "Command receipts that return resources must include a stable handle." });
  }
});

export const commandDescriptorSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  familyId: z.string().min(1).default("integration"),
  source: toolSourceSchema,
  effect: toolEffectSchema,
  approval: toolApprovalSchema,
  shape: commandShapeSchema.default("composite"),
  loadPolicy: commandLoadPolicySchema.default({ mode: "lazy", priority: 0 }),
  contextHints: commandContextHintsSchema.default({ routes: [], surfaces: [], pageTypes: [], artifactTypes: [], skillFamilies: [], commandFamilies: [], requiredScopes: [] }),
  capabilities: z.array(z.string()).default([]),
  searchTerms: z.array(z.string()).default([]),
  examples: z.array(z.object({ title: z.string(), input: z.unknown() })).default([]),
  input: toolSchemaRefSchema.default({ kind: "unknown" }),
  inputSchemaJson: z.record(z.string(), z.unknown()).optional(),
  output: z.object({
    summary: z.string(),
    schema: toolSchemaRefSchema.optional(),
    handle: z.string().optional(),
    resources: z.array(z.string()).default([]),
  }),
  auth: z.object({
    required: z.boolean().default(false),
    scopes: z.array(z.string()).default([]),
    orgScoped: z.boolean().default(false),
  }).default({ required: false, scopes: [], orgScoped: false }),
  policy: z.object({
    tags: z.array(z.string()).default([]),
    hostProfiles: z.array(z.string()).default(["local"]),
    readOnly: z.boolean(),
    proofTier: z.string().optional(),
  }),
  transport: z.object({
    procedure: z.string().optional(),
    method: z.string().optional(),
    path: z.string().optional(),
    runtimeStatus: z.enum(["mounted", "shadow", "unknown"]).default("unknown"),
  }).default({ runtimeStatus: "unknown" }),
  surfaces: z.array(z.string()).default([]),
  uiTargets: z.array(toolUiTargetSchema).default(["chat"]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const commandCatalogSchema = z.object({
  version: z.literal("sonik-agent-ui.command-catalog.v1"),
  generatedAt: z.string(),
  provider: z.string().min(1),
  commands: z.array(commandDescriptorSchema),
});

export const commandIndexSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  familyId: z.string(),
  source: toolSourceSchema,
  effect: toolEffectSchema,
  approval: toolApprovalSchema,
  execution: z.object({
    runtimeStatus: z.enum(["mounted", "shadow", "unknown"]).default("unknown"),
    executable: z.literal(false).default(false),
  }),
  shape: commandShapeSchema,
  loadPolicy: commandLoadPolicySchema,
  capabilities: z.array(z.string()),
  surfaces: z.array(z.string()),
  uiTargets: z.array(toolUiTargetSchema),
});

export const commandIndexSchema = z.object({
  version: z.literal("sonik-agent-ui.command-index.v1"),
  provider: z.string(),
  generatedAt: z.string(),
  commands: z.array(commandIndexSummarySchema),
  totalMatches: z.number().int().nonnegative(),
  truncated: z.boolean(),
  limit: z.number().int().positive(),
  families: z.array(commandFamilyDefinitionSchema),
});

export type CommandShape = z.infer<typeof commandShapeSchema>;
export type CommandExecutionSource = z.infer<typeof commandExecutionSourceSchema>;
export type CommandAction = z.infer<typeof commandActionSchema>;
export type CommandFamilySource = z.infer<typeof commandFamilySourceSchema>;
export type CommandLoadMode = z.infer<typeof commandLoadModeSchema>;
export type CommandFamilyDefinition = z.infer<typeof commandFamilyDefinitionSchema>;
export type CommandFamilyRegistry = z.infer<typeof commandFamilyRegistrySchema>;
export type CommandLoadPolicy = z.infer<typeof commandLoadPolicySchema>;
export type CommandContextHints = z.infer<typeof commandContextHintsSchema>;
export type CommandPolicyDecision = z.infer<typeof commandPolicyDecisionSchema>;
export type CommandReceipt = z.infer<typeof commandReceiptSchema>;
export type CommandDescriptor = z.infer<typeof commandDescriptorSchema>;
export type CommandCatalog = z.infer<typeof commandCatalogSchema>;
export type CommandIndexSummary = z.infer<typeof commandIndexSummarySchema>;
export type CommandIndex = z.infer<typeof commandIndexSchema>;

export const commandWorkflowRecipeStepSchema = z.object({
  commandId: z.string().min(1),
  action: commandActionSchema,
  why: z.string().min(1),
  requiredBefore: z.array(z.string()).default([]),
});

export const commandWorkflowRecipeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  familyId: z.string().min(1),
  intentAliases: z.array(z.string().min(1)).default([]),
  canonicalRegressionPrompt: z.string().min(1),
  commandSequence: z.array(z.string().min(1)).min(1),
  steps: z.array(commandWorkflowRecipeStepSchema).min(1),
  forbiddenUnlessExplicit: z.array(z.string().min(1)).default([]),
  actorFields: z.array(z.string().min(1)).default([]),
  guestFields: z.array(z.string().min(1)).default([]),
  trustedActorRules: z.array(z.string().min(1)).default([]),
  pageContextRequirements: z.array(z.string().min(1)).default([]),
  successEvidence: z.array(z.string().min(1)).default([]),
  negativeTranscriptRegression: z.object({
    prompt: z.string().min(1),
    failIfCommandIds: z.array(z.string().min(1)).default([]),
    failIfActorFieldsMutated: z.array(z.string().min(1)).default([]),
    failIfRationalesContain: z.array(z.string().min(1)).default([]),
    expectedCommandPath: z.array(z.string().min(1)).min(1),
  }),
});

export type CommandWorkflowRecipeStep = z.infer<typeof commandWorkflowRecipeStepSchema>;
export type CommandWorkflowRecipe = z.infer<typeof commandWorkflowRecipeSchema>;

export const skillDescriptorSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  familyId: z.string().min(1),
  loadPolicy: commandLoadPolicySchema.default({ mode: "lazy", priority: 0 }),
  contextHints: commandContextHintsSchema.default({ routes: [], surfaces: [], pageTypes: [], artifactTypes: [], skillFamilies: [], commandFamilies: [], requiredScopes: [] }),
  intentAliases: z.array(z.string().min(1)).default([]),
  commandSequence: z.array(z.string().min(1)).default([]),
  requiredCommands: z.array(z.string().min(1)).default([]),
  forbiddenUnlessExplicit: z.array(z.string().min(1)).default([]),
  workflowRecipe: commandWorkflowRecipeSchema.optional(),
  examples: z.array(z.object({
    title: z.string().min(1),
    prompt: z.string().min(1),
    expectedCommandPath: z.array(z.string().min(1)).default([]),
  })).default([]),
  negativeExamples: z.array(z.object({
    title: z.string().min(1),
    prompt: z.string().min(1),
    failIfCommandIds: z.array(z.string().min(1)).default([]),
    expectedCommandPath: z.array(z.string().min(1)).default([]),
  })).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).superRefine((skill, ctx) => {
  if (skill.workflowRecipe && skill.commandSequence.length > 0 && skill.workflowRecipe.commandSequence.join("\u0000") !== skill.commandSequence.join("\u0000")) {
    ctx.addIssue({ code: "custom", path: ["commandSequence"], message: "Skill commandSequence must match workflowRecipe.commandSequence when a workflowRecipe is provided." });
  }
});

export const skillCatalogSchema = z.object({
  version: z.literal("sonik-agent-ui.skill-catalog.v1"),
  generatedAt: z.string(),
  provider: z.string().min(1),
  skills: z.array(skillDescriptorSchema),
});

export const skillIndexSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  familyId: z.string(),
  loadPolicy: commandLoadPolicySchema,
  intentAliases: z.array(z.string()),
  commandSequence: z.array(z.string()),
  requiredCommands: z.array(z.string()),
});

export const skillIndexSchema = z.object({
  version: z.literal("sonik-agent-ui.skill-index.v1"),
  provider: z.string(),
  generatedAt: z.string(),
  skills: z.array(skillIndexSummarySchema),
  totalMatches: z.number().int().nonnegative(),
  truncated: z.boolean(),
  limit: z.number().int().positive(),
});

export type SkillDescriptor = z.infer<typeof skillDescriptorSchema>;
export type SkillCatalog = z.infer<typeof skillCatalogSchema>;
export type SkillIndexSummary = z.infer<typeof skillIndexSummarySchema>;
export type SkillIndex = z.infer<typeof skillIndexSchema>;
export type SkillLearnAspect = "description" | "workflow" | "examples" | "policy" | "context" | "commands";

export type CommandExecutionContext = {
  action?: CommandAction;
  source?: CommandExecutionSource;
  requestId?: string;
  sessionId?: string | null;
  principalId?: string | null;
  hostSessionSource?: string;
  hostSessionExpiresAt?: string | null;
  approved?: boolean;
  allowSandbox?: boolean;
  authenticated?: boolean;
  organizationId?: string | null;
  scopes?: string[];
};

export type CommandLearnAspect = "description" | "schema" | "examples" | "policy" | "output" | "surfaces" | "transport" | "auth";
export type CommandCatalogSearchResult = {
  commands: Array<Pick<CommandDescriptor, "id" | "title" | "description" | "familyId" | "capabilities" | "source" | "effect" | "approval" | "loadPolicy" | "surfaces" | "uiTargets"> & {
    execution: {
      runtimeStatus: CommandDescriptor["transport"]["runtimeStatus"];
      executable: false;
    };
  }>;
  totalMatches: number;
  truncated: boolean;
  limit: number;
};
export type AgentPageContext = {
  route?: string;
  surface?: string;
  pageType?: string;
  title?: string;
  activeEntity?: { type: string; id: string; label?: string };
  activeArtifactId?: string;
  activeDocumentId?: string;
  artifactType?: string;
  visibleActions?: string[];
  skillFamilies?: string[];
  commandFamilies?: string[];
};

export type CommandIndexContext = AgentPageContext & {
  authenticated?: boolean;
  organizationId?: string | null;
  scopes?: string[];
};

const defaultCommandFamilies: CommandFamilyDefinition[] = [
  { id: "artifact", title: "Artifacts", description: "Generated UI artifacts and canvas state.", aliases: [], source: "core" },
  { id: "document", title: "Documents", description: "Documents, editors, imports, exports, and analysis.", aliases: [], source: "core" },
  { id: "ui", title: "UI Commands", description: "Local workspace, shell, layout, and application UI commands.", aliases: [], source: "core" },
  { id: "integration", title: "Integrations", description: "Host, ORPC, OpenAPI, MCP, or client integration commands.", aliases: [], source: "core" },
  { id: "data", title: "Data", description: "Data lookup, retrieval, and analysis commands.", aliases: [], source: "core" },
  { id: "sandbox", title: "Sandbox", description: "Environment and code execution commands.", aliases: [], source: "core" },
];

export function createCommandCatalog(provider: string, commands: CommandDescriptor[], generatedAt = new Date().toISOString()): CommandCatalog {
  return commandCatalogSchema.parse({ version: "sonik-agent-ui.command-catalog.v1", generatedAt, provider, commands });
}

export function createSkillCatalog(provider: string, skills: SkillDescriptor[], generatedAt = new Date().toISOString()): SkillCatalog {
  return skillCatalogSchema.parse({ version: "sonik-agent-ui.skill-catalog.v1", generatedAt, provider, skills });
}

export function createCommandFamilyRegistry(provider: string, families: CommandFamilyDefinition[] = defaultCommandFamilies, generatedAt = new Date().toISOString()): CommandFamilyRegistry {
  return commandFamilyRegistrySchema.parse({ version: "sonik-agent-ui.command-family-registry.v1", generatedAt, provider, families });
}

export function createDefaultCommandFamilyRegistry(generatedAt = new Date().toISOString()): CommandFamilyRegistry {
  return createCommandFamilyRegistry("sonik-agent-ui-core", defaultCommandFamilies, generatedAt);
}

export function validateCommandCatalogFamilies(catalog: CommandCatalog, registry = createDefaultCommandFamilyRegistry(catalog.generatedAt)): { ok: true; unknownFamilyIds: [] } | { ok: false; unknownFamilyIds: string[] } {
  const familyIds = new Set(registry.families.map((family) => family.id));
  const unknownFamilyIds = [...new Set(catalog.commands.map((command) => command.familyId).filter((familyId) => !familyIds.has(familyId)))].sort();
  return unknownFamilyIds.length === 0 ? { ok: true, unknownFamilyIds: [] } : { ok: false, unknownFamilyIds };
}

export function createCommandCatalogFromToolManifest(manifest: ToolManifest): CommandCatalog {
  return createCommandCatalog(manifest.provider, manifest.tools.map(commandDescriptorFromToolEntry), manifest.generatedAt);
}

export function createCommandIndexContextFromPageContext(pageContext: AgentPageContext = {}, trustedContext: Pick<CommandIndexContext, "authenticated" | "organizationId" | "scopes"> = {}): CommandIndexContext {
  return {
    ...pageContext,
    authenticated: trustedContext.authenticated,
    organizationId: trustedContext.organizationId,
    scopes: trustedContext.scopes,
  };
}

export function commandDescriptorFromToolEntry(entry: ToolContractEntry): CommandDescriptor {
  const tool = normalizeToolEntry(entry);
  const examples = Array.isArray(tool.metadata.examples) ? tool.metadata.examples : [];
  const outputResources = Array.isArray(tool.metadata.resources) ? tool.metadata.resources.filter((value): value is string => typeof value === "string") : [];
  return commandDescriptorSchema.parse({
    id: tool.id,
    title: tool.title,
    description: tool.description,
    familyId: inferCommandFamilyId(tool),
    source: tool.source,
    effect: tool.effect,
    approval: tool.approval,
    shape: inferCommandShape(tool),
    loadPolicy: inferCommandLoadPolicy(tool),
    contextHints: inferCommandContextHints(tool),
    capabilities: tool.capabilities,
    searchTerms: [...new Set([tool.id, tool.title, tool.description, ...tool.capabilities].flatMap(tokenizeCommandText))],
    examples,
    input: tool.input,
    inputSchemaJson: schemaJsonFromRef(tool.input),
    output: {
      summary: tool.description || tool.title,
      schema: tool.output,
      resources: outputResources,
    },
    auth: tool.auth,
    policy: {
      tags: [tool.source, tool.effect, tool.approval, tool.transport.runtimeStatus, ...tool.capabilities].filter(Boolean),
      hostProfiles: ["local", "agent-ui"],
      readOnly: tool.effect === "read",
      proofTier: typeof tool.metadata.proofTier === "string" ? tool.metadata.proofTier : undefined,
    },
    transport: tool.transport,
    surfaces: tool.uiTargets.filter((target) => target !== "none"),
    uiTargets: tool.uiTargets,
    metadata: tool.metadata,
  });
}

export function projectCommandToToolEntry(command: CommandDescriptor): ToolContractEntry {
  return normalizeToolEntry({
    id: command.id,
    source: command.source,
    title: command.title,
    description: command.description,
    effect: command.effect,
    approval: command.approval,
    uiTargets: command.uiTargets,
    capabilities: command.capabilities,
    input: command.input,
    output: command.output.schema ?? { kind: "unknown" },
    auth: command.auth,
    transport: command.transport,
    metadata: {
      ...command.metadata,
      familyId: command.familyId,
      loadPolicy: command.loadPolicy,
      contextHints: command.contextHints,
      commandShape: command.shape,
      commandSurfaces: command.surfaces,
      commandPolicy: command.policy,
    },
  });
}

export function searchCommandCatalog(catalog: CommandCatalog, query = "", limit = 20): CommandCatalogSearchResult["commands"] {
  return searchCommandCatalogWithMetadata(catalog, query, limit).commands;
}

export function searchSkillCatalogWithMetadata(catalog: SkillCatalog, query = "", limit = 20, context: CommandIndexContext = {}): SkillIndex {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 50));
  const normalized = query.trim().toLowerCase();
  const tokens = tokenizeCommandText(normalized);
  const matches = catalog.skills
    .filter((skill) => skill.loadPolicy.mode !== "hidden")
    .filter((skill) => skillVisibleInIndexContext(skill, context))
    .filter((skill) => {
      if (tokens.length === 0) return true;
      const haystack = [
        skill.id,
        skill.title,
        skill.description,
        skill.familyId,
        ...skill.intentAliases,
        ...skill.commandSequence,
        ...skill.requiredCommands,
        ...skill.contextHints.routes,
        ...skill.contextHints.surfaces,
        ...skill.contextHints.pageTypes,
        ...skill.contextHints.skillFamilies,
        ...skill.contextHints.commandFamilies,
      ].join(" ").toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .sort((a, b) => Number(skillMatchesIndexContext(b, context)) - Number(skillMatchesIndexContext(a, context)) || b.loadPolicy.priority - a.loadPolicy.priority || a.id.localeCompare(b.id));

  return createSkillIndex(catalog, matches, boundedLimit);
}

export function createStartupSkillIndex(catalog: SkillCatalog, input: { limit?: number; context?: CommandIndexContext } = {}): SkillIndex {
  const context = input.context ?? {};
  const skills = catalog.skills
    .filter((skill) => skill.loadPolicy.mode === "eager-summary" && skillVisibleInIndexContext(skill, context))
    .sort((a, b) => b.loadPolicy.priority - a.loadPolicy.priority || a.id.localeCompare(b.id));
  return createSkillIndex(catalog, skills, input.limit ?? 8);
}

export function createSurfaceSkillIndex(catalog: SkillCatalog, context: CommandIndexContext = {}, input: { limit?: number } = {}): SkillIndex {
  const skills = catalog.skills
    .filter((skill) => skill.loadPolicy.mode !== "hidden")
    .filter((skill) => skillVisibleInIndexContext(skill, context))
    .filter((skill) => skill.loadPolicy.mode === "eager-summary" || (skill.loadPolicy.mode === "surface-eager" && skillMatchesIndexContext(skill, context)))
    .sort((a, b) => Number(skillMatchesIndexContext(b, context)) - Number(skillMatchesIndexContext(a, context)) || b.loadPolicy.priority - a.loadPolicy.priority || a.id.localeCompare(b.id));
  return createSkillIndex(catalog, skills, input.limit ?? 8);
}

export function learnSkillDescriptor(catalog: SkillCatalog, skillId: string, aspects: SkillLearnAspect[] = ["description", "workflow", "examples", "policy", "context", "commands"]): Record<string, unknown> {
  const skill = catalog.skills.find((entry) => entry.id === skillId);
  if (!skill) return { ok: false, error: "UNKNOWN_SKILL", skillId };
  const learned: Record<string, unknown> = { ok: true, skillId: skill.id, title: skill.title, familyId: skill.familyId };
  if (aspects.includes("description")) {
    learned.description = skill.description;
    learned.intentAliases = skill.intentAliases;
  }
  if (aspects.includes("workflow")) learned.workflowRecipe = skill.workflowRecipe;
  if (aspects.includes("examples")) {
    learned.examples = skill.examples;
    learned.negativeExamples = skill.negativeExamples;
  }
  if (aspects.includes("policy")) {
    learned.forbiddenUnlessExplicit = skill.forbiddenUnlessExplicit;
    learned.metadata = skill.metadata;
  }
  if (aspects.includes("context")) {
    learned.contextHints = skill.contextHints;
    learned.loadPolicy = skill.loadPolicy;
  }
  if (aspects.includes("commands")) {
    learned.commandSequence = skill.commandSequence;
    learned.requiredCommands = skill.requiredCommands;
  }
  return learned;
}

export function searchCommandCatalogWithMetadata(catalog: CommandCatalog, query = "", limit = 20): CommandCatalogSearchResult {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 50));
  const normalized = query.trim().toLowerCase();
  const tokens = tokenizeCommandText(normalized);
  const matches = catalog.commands
    .filter((command) => command.loadPolicy.mode !== "hidden")
    .filter((command) => {
      if (tokens.length === 0) return true;
      const haystack = [command.id, command.title, command.description, command.familyId, ...command.capabilities, ...command.searchTerms, ...command.surfaces].join(" ").toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    commands: matches
      .slice(0, boundedLimit)
      .map(({ id, title, description, familyId, capabilities, source, effect, approval, transport, surfaces, uiTargets, loadPolicy }) => ({
        id,
        title,
        description,
        familyId,
        capabilities,
        source,
        effect,
        approval,
        execution: { runtimeStatus: transport.runtimeStatus, executable: false },
        surfaces,
        uiTargets,
        loadPolicy,
      })),
    totalMatches: matches.length,
    truncated: matches.length > boundedLimit,
    limit: boundedLimit,
  };
}

export function createStartupCommandIndex(catalog: CommandCatalog, input: { registry?: CommandFamilyRegistry; limit?: number; context?: CommandIndexContext } = {}): CommandIndex {
  const registry = input.registry ?? createDefaultCommandFamilyRegistry(catalog.generatedAt);
  assertCommandFamiliesKnown(catalog, registry);
  assertExplicitVisibilityMetadata(catalog);
  return createCommandIndex(catalog, registry, catalog.commands.filter((command) => command.loadPolicy.mode === "eager-summary" && commandVisibleInIndexContext(command, input.context ?? {})), input.limit ?? 12);
}

export function createSurfaceCommandIndex(catalog: CommandCatalog, context: CommandIndexContext = {}, input: { registry?: CommandFamilyRegistry; limit?: number } = {}): CommandIndex {
  const registry = input.registry ?? createDefaultCommandFamilyRegistry(catalog.generatedAt);
  assertCommandFamiliesKnown(catalog, registry);
  assertExplicitVisibilityMetadata(catalog);
  const commands = catalog.commands.filter((command) => {
    if (command.loadPolicy.mode === "hidden") return false;
    if (!commandVisibleInIndexContext(command, context)) return false;
    if (command.loadPolicy.mode === "eager-summary") return true;
    if (command.loadPolicy.mode !== "surface-eager") return false;
    return commandMatchesIndexContext(command, context);
  });
  return createCommandIndex(catalog, registry, commands, input.limit ?? 20);
}

export function learnCommandDescriptor(catalog: CommandCatalog, commandId: string, aspects: CommandLearnAspect[] = ["description", "schema", "examples", "policy", "output", "surfaces", "transport", "auth"]): Record<string, unknown> {
  const command = catalog.commands.find((entry) => entry.id === commandId);
  if (!command) return { ok: false, error: "UNKNOWN_COMMAND", commandId };
  const learned: Record<string, unknown> = { ok: true, commandId: command.id, title: command.title, source: command.source, effect: command.effect, approval: command.approval };
  if (aspects.includes("description")) learned.description = command.description;
  if (aspects.includes("schema")) {
    learned.inputSchema = command.inputSchemaJson ?? command.input;
    if (typeof command.metadata.inputConvention === "string") learned.inputConvention = command.metadata.inputConvention;
    if (Array.isArray(command.metadata.hostDerivedFields)) learned.hostDerivedFields = command.metadata.hostDerivedFields;
    if (Array.isArray(command.metadata.forbiddenFields)) learned.forbiddenFields = command.metadata.forbiddenFields;
    if (Array.isArray(command.metadata.commonErrors)) learned.commonErrors = command.metadata.commonErrors;
  }
  if (aspects.includes("examples")) learned.examples = command.examples;
  if (aspects.includes("policy")) learned.policy = command.policy;
  if (aspects.includes("output")) learned.output = command.output;
  if (aspects.includes("surfaces")) learned.surfaces = command.surfaces;
  if (aspects.includes("transport")) learned.transport = command.transport;
  if (aspects.includes("auth")) learned.auth = command.auth;
  return learned;
}

export function evaluateCommandPolicy(command: CommandDescriptor, context: CommandExecutionContext = {}): CommandPolicyDecision {
  const action = context.action ?? "execute";
  const reasons: string[] = [];
  if (command.transport.runtimeStatus !== "mounted") reasons.push(`runtime_not_mounted:${command.transport.runtimeStatus}`);
  if ((command.source === "orpc" || command.source === "openapi") && command.metadata.liveExecution !== true) reasons.push("orpc_execution_adapter_not_mounted");
  if (
    (command.source === "orpc" || command.source === "openapi")
    && command.metadata.liveExecution === true
    && command.transport.runtimeStatus === "mounted"
    && (!context.hostSessionSource || context.hostSessionSource === "anonymous")
  ) reasons.push("trusted_host_session_required");
  if (command.source === "mcp") reasons.push("mcp_projection_not_native_execution");
  if (command.source === "sandbox" && context.allowSandbox !== true) reasons.push("sandbox_execution_not_enabled");
  if (command.auth.required && context.authenticated !== true) reasons.push("auth_required");
  if (command.auth.orgScoped && !context.organizationId) reasons.push("organization_required");
  const contextScopes = new Set(context.scopes ?? []);
  const missingScopes = command.auth.scopes.filter((scope) => !contextScopes.has(scope));
  if (missingScopes.length > 0) reasons.push(`missing_scopes:${missingScopes.join(",")}`);
  if (action === "execute" && !command.policy.readOnly) reasons.push("use_commit_for_mutation_command");
  if (action === "commit" && command.policy.readOnly) reasons.push("read_only_command_uses_execute");
  if (action === "commit" && command.approval === "required" && context.approved !== true) reasons.push("approval_required");
  if (command.approval === "denied") reasons.push("command_denied_by_manifest");
  if (command.effect === "destructive" && context.approved !== true) reasons.push("destructive_requires_explicit_approval");
  if (reasons.length === 0) return { decision: "allow", reasons: ["policy_allowed"] };
  if (reasons.every((reason) => reason === "approval_required" || reason === "use_commit_for_mutation_command")) return { decision: "needs_approval", reasons };
  if (reasons.length === 1 && reasons[0] === "approval_required") return { decision: "needs_approval", reasons };
  return { decision: "deny", reasons };
}

export function executeCatalogCommand(catalog: CommandCatalog, commandId: string, input: unknown = {}, context: CommandExecutionContext = {}): CommandReceipt {
  const startedAt = Date.now();
  const source = context.source ?? "agent-ui";
  const requestId = context.requestId ?? commandReceiptRequestId(commandId, startedAt);
  const command = catalog.commands.find((entry) => entry.id === commandId);
  if (!command) {
    return commandReceiptSchema.parse({
      ok: false,
      commandId,
      summary: { message: "Unknown command" },
      nextActions: ["searchCommandCatalog"],
      policy: { decision: "deny", reasons: ["unknown_command"] },
      trace: { requestId, sessionId: context.sessionId, durationMs: Date.now() - startedAt, source },
      errors: [{ code: "UNKNOWN_COMMAND", message: `No command registered for ${commandId}`, retryable: true }],
    });
  }
  const action = context.action ?? "execute";
  const policy = evaluateCommandPolicy(command, { ...context, action });
  const ok = policy.decision === "allow";
  return commandReceiptSchema.parse({
    ok,
    commandId,
    summary: ok
      ? {
          message: `${action === "commit" ? "Committed" : "Executed"} ${command.title}`,
          command: { id: command.id, source: command.source, effect: command.effect, shape: command.shape },
          input,
          dryRun: command.metadata.liveExecution !== true,
        }
      : { message: `Command ${command.id} was not executed`, reasons: policy.reasons },
    nextActions: ok ? command.output.resources : policy.decision === "needs_approval" ? ["commitCommand"] : ["learnCommand"],
    policy,
    trace: { requestId, sessionId: context.sessionId, durationMs: Date.now() - startedAt, provider: catalog.provider, cache: "miss", source },
    errors: ok ? undefined : policy.reasons.map((reason) => ({ code: reason.toUpperCase().replace(/[^A-Z0-9]+/g, "_"), message: reason, retryable: policy.decision === "needs_approval" })),
  });
}

function createCommandIndex(catalog: CommandCatalog, registry: CommandFamilyRegistry, commands: CommandDescriptor[], limit: number): CommandIndex {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 50));
  const sorted = [...commands].sort((a, b) => (b.loadPolicy.priority - a.loadPolicy.priority) || a.id.localeCompare(b.id));
  const commandFamilyIds = new Set(sorted.slice(0, boundedLimit).map((command) => command.familyId));
  return commandIndexSchema.parse({
    version: "sonik-agent-ui.command-index.v1",
    provider: catalog.provider,
    generatedAt: catalog.generatedAt,
    commands: sorted.slice(0, boundedLimit).map(commandIndexSummary),
    totalMatches: sorted.length,
    truncated: sorted.length > boundedLimit,
    limit: boundedLimit,
    families: registry.families.filter((family) => commandFamilyIds.has(family.id)),
  });
}

function commandIndexSummary(command: CommandDescriptor): CommandIndexSummary {
  return commandIndexSummarySchema.parse({
    id: command.id,
    title: command.title,
    description: command.description,
    familyId: command.familyId,
    source: command.source,
    effect: command.effect,
    approval: command.approval,
    execution: { runtimeStatus: command.transport.runtimeStatus, executable: false },
    shape: command.shape,
    loadPolicy: command.loadPolicy,
    capabilities: command.capabilities,
    surfaces: command.surfaces,
    uiTargets: command.uiTargets,
  });
}

function assertCommandFamiliesKnown(catalog: CommandCatalog, registry: CommandFamilyRegistry): void {
  const validation = validateCommandCatalogFamilies(catalog, registry);
  if (!validation.ok) {
    throw new Error(`Unknown command family ids: ${validation.unknownFamilyIds.join(", ")}`);
  }
}

function assertExplicitVisibilityMetadata(catalog: CommandCatalog): void {
  const implicitVisibleCommands = catalog.commands
    .filter((command) => command.source !== "local-ui")
    .filter((command) => command.loadPolicy.mode === "eager-summary" || command.loadPolicy.mode === "surface-eager")
    .filter((command) => !hasExplicitVisibilityMetadata(command))
    .map((command) => command.id)
    .sort();
  if (implicitVisibleCommands.length > 0) {
    throw new Error(`Visible non-local commands require explicit family/load/context metadata: ${implicitVisibleCommands.join(", ")}`);
  }
}

function hasExplicitVisibilityMetadata(command: CommandDescriptor): boolean {
  return typeof command.metadata.familyId === "string"
    && command.metadata.loadPolicy !== undefined
    && command.metadata.contextHints !== undefined;
}

function commandVisibleInIndexContext(command: CommandDescriptor, context: CommandIndexContext): boolean {
  if (command.auth.required && context.authenticated !== true) return false;
  if (command.auth.orgScoped && !context.organizationId) return false;
  const scopes = new Set(context.scopes ?? []);
  const requiredScopes = [...new Set([...command.contextHints.requiredScopes, ...command.auth.scopes])];
  return requiredScopes.length === 0 || requiredScopes.every((scope) => scopes.has(scope));
}

function commandMatchesIndexContext(command: CommandDescriptor, context: CommandIndexContext): boolean {
  const hints = command.contextHints;
  return Boolean(
    (context.surface && hints.surfaces.includes(context.surface)) ||
    (context.route && hints.routes.includes(context.route)) ||
    (context.pageType && hints.pageTypes.includes(context.pageType)) ||
    (context.artifactType && hints.artifactTypes.includes(context.artifactType)) ||
    context.commandFamilies?.includes(command.familyId) ||
    context.skillFamilies?.some((family) => hints.skillFamilies.includes(family))
  );
}

function createSkillIndex(catalog: SkillCatalog, skills: SkillDescriptor[], limit: number): SkillIndex {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 50));
  return skillIndexSchema.parse({
    version: "sonik-agent-ui.skill-index.v1",
    provider: catalog.provider,
    generatedAt: catalog.generatedAt,
    skills: skills.slice(0, boundedLimit).map((skill) => ({
      id: skill.id,
      title: skill.title,
      description: skill.description,
      familyId: skill.familyId,
      loadPolicy: skill.loadPolicy,
      intentAliases: skill.intentAliases,
      commandSequence: skill.commandSequence,
      requiredCommands: skill.requiredCommands,
    })),
    totalMatches: skills.length,
    truncated: skills.length > boundedLimit,
    limit: boundedLimit,
  });
}

function skillVisibleInIndexContext(skill: SkillDescriptor, context: CommandIndexContext): boolean {
  const scopes = new Set(context.scopes ?? []);
  const requiredScopes = [...new Set(skill.contextHints.requiredScopes)];
  return requiredScopes.length === 0 || requiredScopes.every((scope) => scopes.has(scope));
}

function skillMatchesIndexContext(skill: SkillDescriptor, context: CommandIndexContext): boolean {
  const hints = skill.contextHints;
  return Boolean(
    (context.surface && hints.surfaces.includes(context.surface)) ||
    (context.route && hints.routes.includes(context.route)) ||
    (context.pageType && hints.pageTypes.includes(context.pageType)) ||
    (context.artifactType && hints.artifactTypes.includes(context.artifactType)) ||
    context.commandFamilies?.some((family) => hints.commandFamilies.includes(family)) ||
    context.skillFamilies?.some((family) => hints.skillFamilies.includes(family))
  );
}

function inferCommandShape(tool: ToolContractEntry): CommandShape {
  if (tool.source === "local-ui") return "local-ui";
  const text = `${tool.id} ${tool.title} ${tool.capabilities.join(" ")}`.toLowerCase();
  if (/\b(send|receive|dispatch|inbound|outbound|webhook)\b/.test(text)) return "dispatch";
  if (/\b(list|get|read|search|sync|analytics|insight|availability|preview|learn|catalog)\b/.test(text)) return "record";
  if (/\b(create|update|patch|delete|manage|assign|reserve|commit|confirm)\b/.test(text)) return "catalog";
  if (/\b(media|image|video|audio|file|document)\b/.test(text)) return "media";
  return "composite";
}

function inferCommandFamilyId(tool: ToolContractEntry): string {
  if (typeof tool.metadata.familyId === "string") return tool.metadata.familyId;
  if (tool.source === "sandbox") return "sandbox";
  if (tool.source === "mcp" || tool.source === "orpc" || tool.source === "openapi") return "integration";
  const text = `${tool.id} ${tool.title} ${tool.uiTargets.join(" ")} ${tool.capabilities.join(" ")}`.toLowerCase();
  if (/\b(document|markdown|editor|workspace)\b/.test(text)) return "document";
  if (/\b(artifact|canvas|json-render)\b/.test(text)) return "artifact";
  if (/\b(data|weather|crypto|github|hacker|search)\b/.test(text)) return "data";
  return "ui";
}

function inferCommandLoadPolicy(tool: ToolContractEntry): CommandLoadPolicy {
  const metadataPolicy = tool.metadata.loadPolicy;
  if (metadataPolicy && typeof metadataPolicy === "object" && !Array.isArray(metadataPolicy)) {
    return commandLoadPolicySchema.parse(metadataPolicy);
  }
  const familyId = inferCommandFamilyId(tool);
  if (familyId === "artifact" || familyId === "document" || familyId === "ui") {
    return { mode: "eager-summary", priority: tool.effect === "read" ? 20 : 10, profile: "core-ui" };
  }
  return { mode: "lazy", priority: 0, profile: tool.source === "local-ui" ? "standalone" : tool.source };
}

function inferCommandContextHints(tool: ToolContractEntry): CommandContextHints {
  const metadataHints = tool.metadata.contextHints;
  if (metadataHints && typeof metadataHints === "object" && !Array.isArray(metadataHints)) {
    return commandContextHintsSchema.parse(metadataHints);
  }
  const surfaces = tool.uiTargets.filter((target) => !["none", "chat", "inline-json"].includes(target));
  const familyId = inferCommandFamilyId(tool);
  return commandContextHintsSchema.parse({
    surfaces,
    commandFamilies: [familyId],
    requiredScopes: tool.auth.scopes,
  });
}

function schemaJsonFromRef(ref: ToolSchemaRef): Record<string, unknown> | undefined {
  return ref.kind === "json-schema" && ref.schema && typeof ref.schema === "object" && !Array.isArray(ref.schema)
    ? ref.schema as Record<string, unknown>
    : undefined;
}

function tokenizeCommandText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9:+_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !["and", "the", "for", "with", "from", "into"].includes(token));
}

function commandReceiptRequestId(commandId: string, startedAt: number): string {
  return `cmd_${commandId.replace(/[^a-z0-9]+/gi, "_")}_${startedAt}`;
}

export const intakeManifestTypeSchema = z.enum(["venue_schedule", "event", "amplify_campaign_template"]);
export const intakeManifestStatusSchema = z.enum(["draft", "validated", "exported"]);

const intakeManifestSourceSchema = z.object({
  createdBy: z.string().min(1).optional(),
  created_by: z.string().min(1).optional(),
  skill: z.string().min(1).optional(),
  sourceMaterials: z.array(z.unknown()).optional(),
  source_materials: z.array(z.unknown()).optional(),
}).passthrough().default({});

export const intakeManifestSchema = z.object({
  manifestType: intakeManifestTypeSchema,
  status: intakeManifestStatusSchema.default("draft"),
  source: intakeManifestSourceSchema,
}).passthrough();

export type IntakeManifestType = z.infer<typeof intakeManifestTypeSchema>;
export type IntakeManifestStatus = z.infer<typeof intakeManifestStatusSchema>;
export type IntakeManifest = z.infer<typeof intakeManifestSchema>;

export type IntakeManifestIssue = {
  code: string;
  message: string;
  path: string;
  severity: "blocking" | "warning";
};

export type IntakeManifestCommandPreview = {
  commandId: string;
  familyId: string;
  effect: "write";
  mode: "preview_only";
  approval: "required";
  reason: string;
};

export type IntakeManifestValidationResult = {
  ok: boolean;
  manifestType?: IntakeManifestType;
  status: "valid" | "invalid";
  issues: IntakeManifestIssue[];
  blockingItems: IntakeManifestIssue[];
  warnings: IntakeManifestIssue[];
  commandPreview: IntakeManifestCommandPreview[];
};

export type IntakeManifestExportPayload = {
  version: "sonik-agent-ui.intake-manifest-export.v1";
  exportedAt: string;
  manifest: IntakeManifest;
  validation: IntakeManifestValidationResult;
  commandPreview: IntakeManifestCommandPreview[];
  execution: "none";
  approval: "not_granted";
};

const manifestRequiredFields: Record<IntakeManifestType, Array<{ path: string; message: string }>> = {
  venue_schedule: [
    { path: "/intakeMode", message: "Venue schedule manifests require intakeMode." },
    { path: "/inventory/coreDescription", message: "Venue schedule manifests require core inventory." },
    { path: "/inventory/confirmationMode", message: "Venue schedule manifests require confirmation mode or explicit unknown." },
  ],
  event: [
    { path: "/event/title", message: "Event manifests require an event title." },
    { path: "/event/startsAt", message: "Event manifests require an event start date/time." },
    { path: "/inventory/coreDescription", message: "Event manifests require ticket/reservation/inventory description." },
  ],
  amplify_campaign_template: [
    { path: "/campaign/goal", message: "Campaign template manifests require a campaign goal." },
    { path: "/audience/description", message: "Campaign template manifests require an audience description." },
    { path: "/channels", message: "Campaign template manifests require channels or explicit unknown." },
  ],
};

type IntakeManifestFieldRule = {
  path: string;
  code: string;
  message: string;
  accepts: (value: unknown) => boolean;
};

const manifestFieldRules: Record<IntakeManifestType, IntakeManifestFieldRule[]> = {
  venue_schedule: [
    { path: "/intakeMode", code: "invalid_intake_mode", message: "Venue schedule intakeMode must be venue_schedule or hybrid.", accepts: (value) => value === "venue_schedule" || value === "hybrid" },
    { path: "/inventory/coreDescription", code: "invalid_core_inventory", message: "Venue schedule core inventory must be a non-empty text description.", accepts: isNonEmptyString },
    { path: "/inventory/confirmationMode", code: "invalid_confirmation_mode", message: "Venue schedule confirmation mode must be a non-empty string or explicit unknown.", accepts: isNonEmptyString },
  ],
  event: [
    { path: "/event/title", code: "invalid_event_title", message: "Event title must be a non-empty string.", accepts: isNonEmptyString },
    { path: "/event/startsAt", code: "invalid_event_start", message: "Event start must be a parseable ISO-like date/time string.", accepts: isDateTimeString },
    { path: "/inventory/coreDescription", code: "invalid_event_inventory", message: "Event inventory must be a non-empty text description.", accepts: isNonEmptyString },
  ],
  amplify_campaign_template: [
    { path: "/campaign/goal", code: "invalid_campaign_goal", message: "Campaign goal must be a non-empty string.", accepts: isNonEmptyString },
    { path: "/audience/description", code: "invalid_audience_description", message: "Audience description must be a non-empty string.", accepts: isNonEmptyString },
    { path: "/channels", code: "invalid_campaign_channels", message: "Campaign channels must be a non-empty array or explicit unknown.", accepts: isNonEmptyArrayOrUnknownString },
  ],
};

const manifestCommandPreview: Record<IntakeManifestType, IntakeManifestCommandPreview[]> = {
  venue_schedule: [
    {
      commandId: "booking.create.context",
      familyId: "booking-contexts",
      effect: "write",
      mode: "preview_only",
      approval: "required",
      reason: "A validated venue schedule manifest can later map to trusted booking context creation commands.",
    },
  ],
  event: [
    {
      commandId: "booking.create.event",
      familyId: "booking-events",
      effect: "write",
      mode: "preview_only",
      approval: "required",
      reason: "A validated event manifest can later map to trusted event/context/ticket commands.",
    },
  ],
  amplify_campaign_template: [
    {
      commandId: "amplify.create.campaign.template",
      familyId: "amplify-campaigns",
      effect: "write",
      mode: "preview_only",
      approval: "required",
      reason: "A validated campaign template manifest can later map to trusted Amplify campaign template commands.",
    },
  ],
};

export function validateIntakeManifest(input: unknown): IntakeManifestValidationResult {
  const parsed = intakeManifestSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue): IntakeManifestIssue => ({
      code: issue.code,
      message: issue.message,
      path: `/${issue.path.join("/")}`,
      severity: "blocking",
    }));
    return { ok: false, status: "invalid", issues, blockingItems: issues, warnings: [], commandPreview: [] };
  }

  const manifest = parsed.data;
  const issues: IntakeManifestIssue[] = [];
  for (const required of manifestRequiredFields[manifest.manifestType]) {
    const value = readJsonPointer(manifest, required.path);
    if (isMissingManifestValue(value)) {
      issues.push({ code: "missing_required_field", message: required.message, path: required.path, severity: "blocking" });
    }
  }
  for (const rule of manifestFieldRules[manifest.manifestType]) {
    const value = readJsonPointer(manifest, rule.path);
    if (!isMissingManifestValue(value) && !rule.accepts(value)) {
      issues.push({ code: rule.code, message: rule.message, path: rule.path, severity: "blocking" });
    }
  }

  const policyWarnings = collectPolicyWarnings(manifest);
  const blockingItems = issues.filter((issue) => issue.severity === "blocking");
  const warnings = [...issues.filter((issue) => issue.severity === "warning"), ...policyWarnings];
  return {
    ok: blockingItems.length === 0,
    manifestType: manifest.manifestType,
    status: blockingItems.length === 0 ? "valid" : "invalid",
    issues: [...blockingItems, ...warnings],
    blockingItems,
    warnings,
    commandPreview: manifestCommandPreview[manifest.manifestType].map((preview) => ({ ...preview })),
  };
}

export function exportIntakeManifestPayload(input: unknown, options: { exportedAt?: string | Date } = {}): IntakeManifestExportPayload {
  const manifest = intakeManifestSchema.parse(input);
  const validation = validateIntakeManifest(manifest);
  if (!validation.ok) {
    const message = validation.blockingItems.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Cannot export invalid intake manifest: ${message || "manifest validation failed"}`);
  }
  return {
    version: "sonik-agent-ui.intake-manifest-export.v1",
    exportedAt: options.exportedAt instanceof Date ? options.exportedAt.toISOString() : options.exportedAt ?? new Date().toISOString(),
    manifest: { ...manifest, status: "exported" },
    validation,
    commandPreview: validation.commandPreview,
    execution: "none",
    approval: "not_granted",
  };
}

function readJsonPointer(input: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) return undefined;
  return pointer.slice(1).split("/").reduce((value: unknown, segment) => {
    if (value === undefined || value === null || typeof value !== "object") return undefined;
    const key = decodeJsonPointerSegment(segment);
    return (value as Record<string, unknown>)[key];
  }, input);
}

function isMissingManifestValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isDateTimeString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function isNonEmptyArrayOrUnknownString(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : value === "unknown";
}

function collectPolicyWarnings(manifest: IntakeManifest): IntakeManifestIssue[] {
  const warnings: IntakeManifestIssue[] = [];
  const policyPaths = ["/pricing", "/payment", "/policies", "/eligibility", "/compliance"];
  for (const path of policyPaths) {
    const value = readJsonPointer(manifest, path);
    if (value && typeof value === "object") {
      warnings.push({
        code: "review_policy_field",
        message: `${path} contains operational policy fields and must be human-reviewed before command execution.`,
        path,
        severity: "warning",
      });
    }
  }
  return warnings;
}
