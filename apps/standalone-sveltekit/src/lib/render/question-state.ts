import { createQuestionAnswerStateUpdateRecord, type AskUserQuestionSpec } from "@sonik-agent-ui/tool-contracts";

export type QuestionStateControllerInput = {
  question: AskUserQuestionSpec;
  value?: unknown;
  skipped?: boolean;
  writesTo?: string | null;
  artifactId?: string | null;
  sessionId?: string | null;
  now?: string | Date;
};

export function createQuestionStateUpdateRecord(input: QuestionStateControllerInput): Record<string, unknown> {
  return createQuestionAnswerStateUpdateRecord(
    input.question,
    {
      questionId: input.question.id,
      value: input.value,
      skipped: input.skipped === true,
      writesTo: input.writesTo ?? input.question.writesTo,
      artifactId: input.artifactId ?? undefined,
      sessionId: input.sessionId ?? undefined,
    },
    { now: input.now },
  );
}
