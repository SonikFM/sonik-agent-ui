import { logArtifactTelemetry } from "../artifacts/artifact-telemetry.ts";

export type ChoiceValue = string | number | boolean;
export type Choice = { value: ChoiceValue; label?: string | null; description?: string | null; disabled?: boolean | null };
export type ChoiceCardsProps = {
  label?: string | null;
  value?: ChoiceValue | ChoiceValue[] | null;
  options: Choice[];
  mode?: "single" | "multiple" | null;
  helperText?: string | null;
};

export type QuestionCardProps = {
  questionId: string;
  title: string;
  body: string;
  whyThisMatters?: string | null;
  answerType: string;
  choices?: Choice[] | null;
  value?: ChoiceValue | ChoiceValue[] | null;
  lifecycleState?: string | null;
  errorMessage?: string | null;
  required?: boolean | null;
  allowSkip?: boolean | null;
  skipValue?: unknown;
  writesTo?: string | null;
  minSelections?: number | null;
  maxSelections?: number | null;
  confidence?: number | null;
  reviewRequired?: boolean | null;
  submitLabel?: string | null;
  skipLabel?: string | null;
};

export type ComponentPropValidationTelemetry = {
  component: "ChoiceCards" | "QuestionCard";
  reason: string;
  issuePaths: string[];
  fallback: "single_select";
};

const VALID_ANSWER_TYPES = new Set([
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
const SINGLE_SELECT_ANSWER_TYPES = new Set(["single_choice", "choice_cards", "confirmation"]);

export function sanitizeChoiceCardsProps(input: Partial<ChoiceCardsProps> | Record<string, unknown> | null | undefined): {
  props: ChoiceCardsProps;
  telemetry: ComponentPropValidationTelemetry | null;
} {
  const issues: string[] = [];
  const raw = isRecord(input) ? input : {};
  if (!isRecord(input)) issues.push("props");

  const choices = sanitizeChoices(raw.options, issues, "options");
  const mode = raw.mode === "multiple" || raw.mode === "single" ? raw.mode : "single";
  if (raw.mode !== undefined && raw.mode !== null && raw.mode !== "multiple" && raw.mode !== "single") issues.push("mode");

  const degraded = issues.length > 0;
  return {
    props: {
      label: typeof raw.label === "string" ? raw.label : null,
      value: sanitizeChoiceValue(raw.value, degraded ? "single" : mode),
      options: choices,
      mode: degraded ? "single" : mode,
      helperText: typeof raw.helperText === "string" ? raw.helperText : null,
    },
    telemetry: degraded ? createTelemetry("ChoiceCards", issues) : null,
  };
}

export function sanitizeQuestionCardProps(input: Partial<QuestionCardProps> | Record<string, unknown> | null | undefined): {
  props: QuestionCardProps;
  telemetry: ComponentPropValidationTelemetry | null;
} {
  const issues: string[] = [];
  const raw = isRecord(input) ? input : {};
  if (!isRecord(input)) issues.push("props");

  const answerType = typeof raw.answerType === "string" && VALID_ANSWER_TYPES.has(raw.answerType) ? raw.answerType : "single_choice";
  if (raw.answerType !== undefined && answerType !== raw.answerType) issues.push("answerType");

  const choiceQuestion = SINGLE_SELECT_ANSWER_TYPES.has(answerType) || answerType === "multi_choice";
  const choices = choiceQuestion || raw.choices !== undefined && raw.choices !== null
    ? sanitizeChoices(raw.choices, choiceQuestion ? issues : [], "choices")
    : [];
  const minSelections = normalizeNonnegativeInteger(raw.minSelections, "minSelections", issues);
  const maxSelections = normalizeMaxSelections(answerType, raw.maxSelections, minSelections, issues);
  const degraded = issues.length > 0;
  const effectiveAnswerType = degraded && (SINGLE_SELECT_ANSWER_TYPES.has(answerType) || answerType === "multi_choice") ? "single_choice" : answerType;

  return {
    props: {
      questionId: typeof raw.questionId === "string" && raw.questionId.trim() ? raw.questionId : "question",
      title: typeof raw.title === "string" && raw.title.trim() ? raw.title : "Question",
      body: typeof raw.body === "string" && raw.body.trim() ? raw.body : "Choose an answer.",
      whyThisMatters: typeof raw.whyThisMatters === "string" ? raw.whyThisMatters : null,
      answerType: effectiveAnswerType,
      choices,
      value: sanitizeChoiceValue(raw.value, effectiveAnswerType === "multi_choice" ? "multiple" : "single"),
      lifecycleState: normalizeLifecycleState(raw.lifecycleState),
      errorMessage: typeof raw.errorMessage === "string" && raw.errorMessage.trim() ? raw.errorMessage : null,
      required: raw.required === true,
      allowSkip: raw.allowSkip === false ? false : true,
      skipValue: raw.skipValue ?? "unknown",
      writesTo: typeof raw.writesTo === "string" && raw.writesTo.trim() ? raw.writesTo : null,
      minSelections: degraded ? 0 : minSelections,
      maxSelections: degraded ? undefined : maxSelections,
      confidence: typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : null,
      reviewRequired: raw.reviewRequired === true,
      submitLabel: typeof raw.submitLabel === "string" && raw.submitLabel.trim() ? raw.submitLabel : "Save answer",
      skipLabel: typeof raw.skipLabel === "string" && raw.skipLabel.trim() ? raw.skipLabel : "Mark unknown",
    },
    telemetry: degraded ? createTelemetry("QuestionCard", issues) : null,
  };
}

export function formatQuestionSubmitError(error: unknown): { message: string; telemetry: ComponentPropValidationTelemetry | null } {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (looksLikeRawValidationJson(message)) {
    return {
      message: "Answer could not be saved. Please review the selected answer.",
      telemetry: createTelemetry("QuestionCard", ["submit.validation"]),
    };
  }
  return { message: message || "Answer could not be saved.", telemetry: null };
}

export function emitComponentPropValidationTelemetry(event: ComponentPropValidationTelemetry | null): void {
  if (!event) return;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("sonik-agent-ui:renderer-prop-validation", { detail: event }));
  }
  logArtifactTelemetry({
    source: "client",
    event: "json_render.component_props_invalid",
    surface: event.component,
    reason: event.reason,
    ok: false,
    error: `Invalid ${event.component} props; applied ${event.fallback} fallback.`,
  });
}

function sanitizeChoices(value: unknown, issues: string[], path: string): Choice[] {
  if (!Array.isArray(value)) {
    issues.push(path);
    return [];
  }
  return value.flatMap((choice, index): Choice[] => {
    if (!isRecord(choice) || !isChoiceValue(choice.value)) {
      issues.push(`${path}.${index}.value`);
      return [];
    }
    return [{
      value: choice.value,
      label: typeof choice.label === "string" ? choice.label : null,
      description: typeof choice.description === "string" ? choice.description : null,
      disabled: choice.disabled === true,
    }];
  });
}

function sanitizeChoiceValue(value: unknown, mode: "single" | "multiple"): ChoiceValue | ChoiceValue[] | null {
  if (mode === "multiple") return Array.isArray(value) ? value.filter(isChoiceValue) : [];
  if (Array.isArray(value)) return value.find(isChoiceValue) ?? null;
  return isChoiceValue(value) ? value : null;
}

function normalizeLifecycleState(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return ["draft", "saving", "answered", "skipped", "invalid", "error", "errored"].includes(normalized) ? normalized : null;
}

function normalizeNonnegativeInteger(value: unknown, path: string, issues: string[]): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  issues.push(path);
  return 0;
}

function normalizeMaxSelections(answerType: string, value: unknown, minSelections: number, issues: string[]): number | undefined {
  if (SINGLE_SELECT_ANSWER_TYPES.has(answerType)) {
    if (value === undefined || value === null || value === 1) return undefined;
    issues.push("maxSelections");
    return undefined;
  }
  if (answerType !== "multi_choice") return undefined;
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return Math.max(value, minSelections);
  issues.push("maxSelections");
  return minSelections > 0 ? minSelections : undefined;
}

function createTelemetry(component: ComponentPropValidationTelemetry["component"], issuePaths: string[]): ComponentPropValidationTelemetry {
  return {
    component,
    reason: "invalid_props",
    issuePaths: [...new Set(issuePaths)],
    fallback: "single_select",
  };
}

function looksLikeRawValidationJson(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || (trimmed[0] !== "[" && trimmed[0] !== "{")) return false;
  return /"(code|path|message)"\s*:/.test(trimmed) || trimmed.includes("too_small");
}

function isChoiceValue(value: unknown): value is ChoiceValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
