import type { Spec } from "@json-render/svelte";
import {
  createAskUserQuestionSpec,
  createQuestionAnswerStateUpdateRecord,
  type AskUserQuestionSpec,
} from "@sonik-agent-ui/tool-contracts";
import type { AgentUiWorkflowSnapshot, AgentUiWorkflowVisibleError } from "@sonik-agent-ui/agent-observability";

export type ActiveWorkflowArtifact = {
  id: string;
  title?: string | null;
  kind: string;
  version: number;
  content: Spec;
};

export type IntakeApprovalReadiness = {
  ready: boolean;
  visible: boolean;
  reason: string | null;
};

export type CreateAgentWorkflowSnapshotInput = {
  activeArtifact: ActiveWorkflowArtifact | null;
  pendingChangeCount?: number;
  isStreaming?: boolean;
  approvalReadiness?: IntakeApprovalReadiness;
};

export type CreateQuestionAnswerStateChangesInput = {
  artifact: ActiveWorkflowArtifact;
  questionId: string;
  value?: unknown;
  skipped?: boolean;
  sessionId?: string | null;
};

export type QuestionAnswerStateChanges = {
  changes: Array<{ path: string; value: unknown }>;
  actionParams: Record<string, unknown>;
};

export function createAgentWorkflowSnapshot(input: CreateAgentWorkflowSnapshotInput): AgentUiWorkflowSnapshot {
  const artifact = input.activeArtifact;
  if (!artifact || artifact.kind !== "json-render") return emptyWorkflowSnapshot();

  const state = isRecord(artifact.content.state) ? artifact.content.state : {};
  const workflowId = resolveWorkflowId(state);
  const questionCards = getQuestionCards(artifact.content);
  const questionStates = isRecord(state.questionStates) ? state.questionStates : {};
  const questionErrors = isRecord(state.questionErrors) ? state.questionErrors : {};
  const answers = isRecord(state.answers) ? state.answers : {};
  const visibleErrors = collectWorkflowErrors(questionStates, questionErrors);
  const answeredIds = new Set<string>();
  for (const question of questionCards) {
    const status = String(questionStates[question.id] ?? "draft").toLowerCase();
    if (status === "answered" || status === "skipped" || Object.hasOwn(answers, question.id)) answeredIds.add(question.id);
  }
  const requiredQuestions = questionCards.filter((question) => question.required);
  const unansweredRequiredIds = requiredQuestions.filter((question) => !answeredIds.has(question.id)).map((question) => question.id);
  const currentQuestion = questionCards.find((question) => !answeredIds.has(question.id)) ?? null;
  const pendingChangeCount = Math.max(0, Math.floor(input.pendingChangeCount ?? 0));
  const disabledReasons = new Set<string>();
  if (input.isStreaming) disabledReasons.add("Wait for the current assistant response to finish.");
  if (pendingChangeCount > 0) disabledReasons.add("Save the current artifact edits before continuing.");
  if (visibleErrors.length > 0) disabledReasons.add("Fix visible intake errors before previewing.");
  if (input.approvalReadiness?.reason) disabledReasons.add(input.approvalReadiness.reason);
  if (!currentQuestion && questionCards.length > 0 && unansweredRequiredIds.length === 0) disabledReasons.add("All visible intake questions are answered; request a preview next.");

  const canSubmitAnswer = Boolean(currentQuestion) && !input.isStreaming && pendingChangeCount === 0;
  const canRequestApproval = Boolean(input.approvalReadiness?.ready) && !input.isStreaming && pendingChangeCount === 0 && visibleErrors.length === 0;
  const canApproveAndRun = canRequestApproval;
  const phase = resolveWorkflowPhase({ pendingChangeCount, visibleErrors, canRequestApproval, workflowId });

  return {
    activeWorkflowId: workflowId,
    activeArtifactId: artifact.id,
    phase,
    currentQuestion,
    answeredCount: answeredIds.size,
    requiredCount: requiredQuestions.length,
    unansweredRequiredIds,
    visibleErrors,
    canSubmitAnswer,
    canRequestApproval,
    canApproveAndRun,
    disabledReasons: [...disabledReasons],
    commandPreview: canRequestApproval
      ? {
          commandId: "booking.create.context",
          stableInputHash: createStableManifestHash(state.manifest),
          effect: "write",
          approvalRequired: true,
        }
      : null,
  };
}

export function createQuestionAnswerStateChanges(input: CreateQuestionAnswerStateChangesInput): QuestionAnswerStateChanges {
  const question = getQuestionSpec(input.artifact.content, input.questionId);
  const record = createQuestionAnswerStateUpdateRecord(question, {
    questionId: question.id,
    value: input.value,
    skipped: input.skipped === true,
    writesTo: question.writesTo,
    artifactId: input.artifact.id,
    sessionId: input.sessionId ?? undefined,
  });
  const changes = Object.entries(record).map(([path, value]) => ({ path, value }));
  return {
    changes,
    actionParams: {
      questionId: question.id,
      value: input.skipped ? question.skipValue ?? "unknown" : input.value,
      skipped: input.skipped === true,
      writesTo: question.writesTo,
      submission: record[`/questionSubmissions/${escapeJsonPointerSegment(question.id)}`],
    },
  };
}

function emptyWorkflowSnapshot(): AgentUiWorkflowSnapshot {
  return {
    activeWorkflowId: null,
    activeArtifactId: null,
    phase: "idle",
    currentQuestion: null,
    answeredCount: 0,
    requiredCount: 0,
    unansweredRequiredIds: [],
    visibleErrors: [],
    canSubmitAnswer: false,
    canRequestApproval: false,
    canApproveAndRun: false,
    disabledReasons: ["Open a workflow artifact first."],
    commandPreview: null,
  };
}

function resolveWorkflowPhase(input: { pendingChangeCount: number; visibleErrors: AgentUiWorkflowVisibleError[]; canRequestApproval: boolean; workflowId: string | null }): AgentUiWorkflowSnapshot["phase"] {
  if (!input.workflowId) return "idle";
  if (input.pendingChangeCount > 0) return "saving";
  if (input.visibleErrors.length > 0) return "error";
  if (input.canRequestApproval) return "preview_ready";
  return "intake";
}

function resolveWorkflowId(state: Record<string, unknown>): string | null {
  const surface = isRecord(state.surface) ? state.surface : null;
  const manifest = isRecord(state.manifest) ? state.manifest : null;
  const source = manifest && isRecord(manifest.source) ? manifest.source : null;
  return cleanString(surface?.skillId) ?? cleanString(surface?.id) ?? cleanString(source?.skill) ?? null;
}

function getQuestionCards(content: Spec): NonNullable<AgentUiWorkflowSnapshot["currentQuestion"]>[] {
  return Object.values(content.elements ?? {}).flatMap((element) => {
    if (!isRecord(element) || element.type !== "QuestionCard" || !isRecord(element.props)) return [];
    const props = element.props;
    const id = cleanString(props.questionId);
    const title = cleanString(props.title);
    const answerType = cleanString(props.answerType);
    if (!id || !title || !answerType) return [];
    return [{
      id,
      title,
      required: props.required === true,
      answerType,
      choices: normalizeChoices(props.choices),
    }];
  });
}

function getQuestionSpec(content: Spec, questionId: string): AskUserQuestionSpec {
  for (const element of Object.values(content.elements ?? {})) {
    if (!isRecord(element) || element.type !== "QuestionCard" || !isRecord(element.props)) continue;
    const props = element.props;
    if (props.questionId !== questionId) continue;
    return createAskUserQuestionSpec({
      id: props.questionId,
      title: props.title,
      body: props.body,
      whyThisMatters: props.whyThisMatters === null ? undefined : props.whyThisMatters,
      answerType: props.answerType,
      choices: props.choices,
      required: props.required,
      allowSkip: props.allowSkip,
      skipValue: props.skipValue,
      writesTo: props.writesTo === null ? undefined : props.writesTo,
      minSelections: props.minSelections,
      maxSelections: props.maxSelections,
      confidence: props.confidence === null ? undefined : props.confidence,
      reviewRequired: props.reviewRequired,
    });
  }
  throw new Error(`Question ${questionId} was not found in the active workflow artifact.`);
}

function normalizeChoices(value: unknown): NonNullable<NonNullable<AgentUiWorkflowSnapshot["currentQuestion"]>["choices"]> | undefined {
  if (!Array.isArray(value)) return undefined;
  const choices = value.flatMap((choice) => {
    if (!isRecord(choice)) return [];
    const rawValue = choice.value;
    if (typeof rawValue !== "string" && typeof rawValue !== "number" && typeof rawValue !== "boolean") return [];
    return [{ value: rawValue, label: cleanString(choice.label) ?? String(rawValue), disabled: choice.disabled === true }];
  });
  return choices.length > 0 ? choices : undefined;
}

function collectWorkflowErrors(questionStates: Record<string, unknown>, questionErrors: Record<string, unknown>): AgentUiWorkflowVisibleError[] {
  const errors: AgentUiWorkflowVisibleError[] = [];
  for (const [field, value] of Object.entries(questionErrors)) {
    if (value === undefined || value === null || value === false || value === "") continue;
    errors.push({ field, code: "question_answer_not_saved", message: String(value).slice(0, 300) });
  }
  for (const [field, value] of Object.entries(questionStates)) {
    const status = String(value).toLowerCase();
    if (status === "error" || status === "errored" || status === "invalid") {
      if (!errors.some((error) => error.field === field)) errors.push({ field, code: "question_state_invalid", message: `Question ${field} is ${status}.` });
    }
  }
  return errors;
}

function createStableManifestHash(value: unknown): string {
  const text = stableStringify(value ?? null);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
