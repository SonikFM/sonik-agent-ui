import {
  questionAnswerSubmissionSchema,
  type QuestionAnswerSubmission,
} from "@sonik-agent-ui/tool-contracts";

export const QUESTION_ANSWER_TURN_VERSION = "sonik-agent-ui.question-answer-turn.v1";
export const QUESTION_ANSWER_TURN_FENCE = "sonik_question_answer";

export interface QuestionAnswerTurnPayload {
  version: typeof QUESTION_ANSWER_TURN_VERSION;
  kind: "question_answer";
  entryFrom: "question_answer";
  artifact: {
    id: string;
    version: number;
  };
  submission: QuestionAnswerSubmission;
  answer: {
    questionId: string;
    value: unknown;
    skipped: boolean;
    writesTo?: string;
    artifactId: string;
    artifactVersion: number;
    sessionId?: string;
    answeredAt?: string;
  };
}

export interface CreateQuestionAnswerTurnPayloadInput {
  actionParams?: Record<string, unknown>;
  artifactId: string;
  artifactVersion: number;
  sessionId?: string | null;
  answeredAt?: string;
}

export function createQuestionAnswerTurnPayload(input: CreateQuestionAnswerTurnPayloadInput): QuestionAnswerTurnPayload {
  const params = isRecord(input.actionParams) ? input.actionParams : {};
  const rawSubmission = isRecord(params.submission) ? params.submission : {};
  const submission = questionAnswerSubmissionSchema.parse({
    ...rawSubmission,
    questionId: rawSubmission.questionId ?? params.questionId,
    value: rawSubmission.value ?? params.value,
    skipped: typeof rawSubmission.skipped === "boolean" ? rawSubmission.skipped : params.skipped === true,
    writesTo: rawSubmission.writesTo ?? params.writesTo ?? undefined,
    artifactId: input.artifactId,
    sessionId: input.sessionId ?? rawSubmission.sessionId ?? undefined,
    answeredAt: rawSubmission.answeredAt ?? input.answeredAt,
  });

  return {
    version: QUESTION_ANSWER_TURN_VERSION,
    kind: "question_answer",
    entryFrom: "question_answer",
    artifact: {
      id: input.artifactId,
      version: input.artifactVersion,
    },
    submission,
    answer: {
      questionId: submission.questionId,
      value: submission.value ?? null,
      skipped: submission.skipped === true,
      ...(submission.writesTo ? { writesTo: submission.writesTo } : {}),
      artifactId: input.artifactId,
      artifactVersion: input.artifactVersion,
      ...(submission.sessionId ? { sessionId: submission.sessionId } : {}),
      ...(submission.answeredAt ? { answeredAt: submission.answeredAt } : {}),
    },
  };
}

export function serializeQuestionAnswerTurnMessage(payload: QuestionAnswerTurnPayload): string {
  return [
    "Question answered. Continue the intake workflow using this machine-readable answer block.",
    `\`\`\`${QUESTION_ANSWER_TURN_FENCE}`,
    JSON.stringify(payload, null, 2),
    "```",
    "Ask the next highest-impact missing question. Do not execute commands or treat this answer as approval.",
  ].join("\n");
}

export function parseQuestionAnswerTurnPayload(text: string): QuestionAnswerTurnPayload | null {
  const pattern = new RegExp(`\`\`\`${QUESTION_ANSWER_TURN_FENCE}\\s*\\n([\\s\\S]*?)\\n\`\`\``);
  const match = pattern.exec(text);
  if (!match?.[1]) return null;
  const parsed = JSON.parse(match[1]) as QuestionAnswerTurnPayload;
  if (parsed.version !== QUESTION_ANSWER_TURN_VERSION || parsed.kind !== "question_answer") return null;
  return {
    ...parsed,
    submission: questionAnswerSubmissionSchema.parse(parsed.submission),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
