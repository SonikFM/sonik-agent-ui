import { createInteractiveSurfaceSpec } from "@sonik-agent-ui/tool-contracts";
import type { InteractiveSurfaceSpec } from "@sonik-agent-ui/tool-contracts";

export type JsonRenderSpecLike = {
  root: string;
  elements: Record<string, { type: string; props: Record<string, unknown>; children?: string[]; on?: Record<string, unknown> }>;
  state: Record<string, unknown>;
};

function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function stableQuestionElementId(questionId: string, index: number): string {
  return `question-${index}-${escapeJsonPointerSegment(questionId).replace(/[^a-zA-Z0-9_~.-]/g, "-")}`;
}


function createTrustedIntakeControllerActionElements(elements: JsonRenderSpecLike["elements"]): string[] {
  elements["action-rail"] = {
    type: "ActionRail",
    props: {
      title: "Trusted workflow actions",
      emptyMessage: null,
      actions: [
        {
          id: "saveDraft",
          label: "Save draft",
          description: "Persist the current artifact state without running tools.",
          status: "ready",
          commandId: null,
          effect: "artifact_state",
          approval: "not_required",
        },
        {
          id: "editDraft",
          label: "Edit draft",
          description: "Return to draft editing; no command preview or write is requested.",
          status: "ready",
          commandId: null,
          effect: "renderer_state",
          approval: "not_required",
        },
        {
          id: "submitToAgent",
          label: "Submit to agent",
          description: "Send the saved artifact state back into chat for the next step.",
          status: "ready",
          commandId: null,
          effect: "chat_turn",
          approval: "not_required",
        },
        {
          id: "reviseWithAgent",
          label: "Revise with agent",
          description: "Ask the agent to propose targeted changes from the saved draft state.",
          status: "ready",
          commandId: null,
          effect: "chat_turn",
          approval: "not_required",
        },
        {
          id: "requestApproval",
          label: "Request approval",
          description: "Ask the agent to validate and show a typed command preview before any write.",
          status: "requires_confirmation",
          commandId: "booking.create.context",
          effect: "preview_write",
          approval: "required",
        },
        {
          id: "cancelApproval",
          label: "Cancel approval",
          description: "Cancel the pending approval path and keep the manifest as a saved draft.",
          status: "ready",
          commandId: "booking.create.context",
          effect: "approval_cancelled",
          approval: "not_required",
        },
        {
          id: "approveAndRun",
          label: "Approve & run",
          description: "Submit an explicit approval turn; execution still requires trusted host/session approval.",
          status: "requires_confirmation",
          commandId: "booking.create.context",
          effect: "trusted_write_request",
          approval: "host_required",
        },
      ],
    },
    children: [],
  };

  const buttons = [
    { id: "action-save-draft", label: "Save draft", variant: "secondary", action: "saveDraft", commandId: null },
    { id: "action-edit-draft", label: "Edit draft", variant: "secondary", action: "editDraft", commandId: null },
    { id: "action-submit-to-agent", label: "Submit to agent", variant: "default", action: "submitToAgent", commandId: null },
    { id: "action-revise-agent", label: "Revise", variant: "outline", action: "reviseWithAgent", commandId: null },
    { id: "action-request-approval", label: "Request approval", variant: "outline", action: "requestApproval", commandId: "booking.create.context" },
    { id: "action-cancel-approval", label: "Cancel", variant: "secondary", action: "cancelApproval", commandId: "booking.create.context" },
    { id: "action-approve-run", label: "Approve & run", variant: "default", action: "approveAndRun", commandId: "booking.create.context" },
  ] as const;

  for (const button of buttons) {
    elements[button.id] = {
      type: "Button",
      props: { label: button.label, variant: button.variant, size: "sm", disabled: false },
      on: {
        press: {
          action: button.action,
          params: {
            source: "intake_action_rail",
            commandId: button.commandId ?? null,
          },
        },
      },
      children: [],
    };
  }

  elements["action-buttons"] = {
    type: "Stack",
    props: { direction: "horizontal", gap: "sm", wrap: true },
    children: buttons.map((button) => button.id),
  };

  return ["action-rail", "action-buttons"];
}

function normalizeRenderedMaxSelections(answerType: string, minSelections: number, maxSelections: number | undefined): number | null {
  if (answerType === "single_choice" || answerType === "choice_cards" || answerType === "confirmation") return 1;
  if (answerType !== "multi_choice") return null;
  if (typeof maxSelections === "number" && Number.isInteger(maxSelections) && maxSelections > 0) return Math.max(maxSelections, minSelections);
  return minSelections > 0 ? minSelections : null;
}

export function createInteractiveSurfaceJsonRenderSpec(surfaceInput: unknown): JsonRenderSpecLike {
  const surface: InteractiveSurfaceSpec = createInteractiveSurfaceSpec(surfaceInput);
  const questionElementIds = surface.questions.map((question, index) => stableQuestionElementId(question.id, index));
  const elements: JsonRenderSpecLike["elements"] = {
    main: {
      type: "Stack",
      props: { direction: "vertical", gap: "md", wrap: null },
      children: ["surface-header", ...questionElementIds],
    },
    "surface-header": {
      type: "Card",
      props: { title: surface.title, description: surface.description || null },
      children: [],
    },
  };

  if (surface.state.manifest && typeof surface.state.manifest === "object") {
    const actionElementIds = createTrustedIntakeControllerActionElements(elements);
    const mainElement = elements.main;
    if (!mainElement) throw new Error("Interactive surface renderer invariant failed: missing main element.");
    mainElement.children = [...(mainElement.children ?? []), "manifest-preview", ...actionElementIds];
    elements["manifest-preview"] = {
      type: "ManifestPreview",
      props: {
        title: "Manifest draft",
        manifest: { $bindState: "/manifest" },
        emptyMessage: "No manifest draft yet.",
      },
      children: [],
    };
  }

  const draftAnswers: Record<string, unknown> = {};
  const questionStates: Record<string, unknown> = {};
  for (const [index, question] of surface.questions.entries()) {
    const questionIdSegment = escapeJsonPointerSegment(question.id);
    draftAnswers[question.id] = question.defaultValue ?? null;
    questionStates[question.id] = "draft";
    const boundAnswerPointer = `/draftAnswers/${questionIdSegment}`;
    elements[stableQuestionElementId(question.id, index)] = {
      type: "QuestionCard",
      props: {
        questionId: question.id,
        title: question.title,
        body: question.body,
        whyThisMatters: question.whyThisMatters ?? null,
        answerType: question.answerType,
        choices: question.choices,
        value: { $bindState: boundAnswerPointer },
        required: question.required,
        allowSkip: question.allowSkip,
        skipValue: question.skipValue,
        writesTo: question.writesTo ?? null,
        minSelections: question.minSelections,
        maxSelections: normalizeRenderedMaxSelections(question.answerType, question.minSelections, question.maxSelections),
        confidence: question.confidence ?? null,
        reviewRequired: question.reviewRequired,
        submitLabel: "Save answer",
        skipLabel: "Mark unknown",
      },
      on: {
        submit: {
          action: "submitAnswer",
          params: {
            questionId: question.id,
            value: { $state: boundAnswerPointer },
            skipped: false,
            writesTo: question.writesTo ?? null,
          },
        },
        skip: {
          action: "submitAnswer",
          params: {
            questionId: question.id,
            value: { $state: boundAnswerPointer },
            skipped: true,
            writesTo: question.writesTo ?? null,
          },
        },
      },
      children: [],
    };
  }

  return {
    root: "main",
    elements,
    state: {
      ...surface.state,
      surface: {
        id: surface.id,
        kind: surface.kind,
        title: surface.title,
        skillId: surface.skillId ?? null,
        artifactId: surface.artifactId ?? null,
      },
      draftAnswers: { ...draftAnswers, ...(surface.state.draftAnswers && typeof surface.state.draftAnswers === "object" ? surface.state.draftAnswers as Record<string, unknown> : {}) },
      answers: surface.state.answers && typeof surface.state.answers === "object" ? surface.state.answers as Record<string, unknown> : {},
      questionStates: { ...questionStates, ...(surface.state.questionStates && typeof surface.state.questionStates === "object" ? surface.state.questionStates as Record<string, unknown> : {}) },
      questionSubmissions: surface.state.questionSubmissions && typeof surface.state.questionSubmissions === "object" ? surface.state.questionSubmissions as Record<string, unknown> : {},
      answerWrites: surface.state.answerWrites && typeof surface.state.answerWrites === "object" ? surface.state.answerWrites as Record<string, unknown> : {},
    },
  };
}
