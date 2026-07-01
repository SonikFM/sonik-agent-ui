import { createInteractiveSurfaceSpec } from "@sonik-agent-ui/tool-contracts";
import type { InteractiveSurfaceSpec } from "@sonik-agent-ui/tool-contracts";

export type JsonRenderSpecLike = {
  root: string;
  elements: Record<string, { type: string; props: Record<string, unknown>; children?: string[] }>;
  state: Record<string, unknown>;
};

function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function stableQuestionElementId(questionId: string, index: number): string {
  return `question-${index}-${escapeJsonPointerSegment(questionId).replace(/[^a-zA-Z0-9_~.-]/g, "-")}`;
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
    const mainElement = elements.main;
    if (!mainElement) throw new Error("Interactive surface renderer invariant failed: missing main element.");
    mainElement.children = [...(mainElement.children ?? []), "manifest-preview"];
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
    elements[stableQuestionElementId(question.id, index)] = {
      type: "QuestionCard",
      props: {
        questionId: question.id,
        title: question.title,
        body: question.body,
        whyThisMatters: question.whyThisMatters ?? null,
        answerType: question.answerType,
        choices: question.choices,
        value: { $bindState: `/draftAnswers/${questionIdSegment}` },
        required: question.required,
        allowSkip: question.allowSkip,
        skipValue: question.skipValue,
        writesTo: question.writesTo ?? null,
        minSelections: question.minSelections,
        maxSelections: question.maxSelections ?? null,
        confidence: question.confidence ?? null,
        reviewRequired: question.reviewRequired,
        submitLabel: "Save answer",
        skipLabel: "Mark unknown",
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
