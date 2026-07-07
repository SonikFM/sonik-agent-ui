const SINGLE_SELECT_ANSWER_TYPES = new Set(["single_choice", "choice_cards", "confirmation"]);

export function normalizeRenderedMaxSelections(answerType: unknown, minSelections: unknown, maxSelections: unknown): number | undefined {
  if (typeof answerType === "string" && SINGLE_SELECT_ANSWER_TYPES.has(answerType)) return 1;
  if (answerType !== "multi_choice") return undefined;
  const min = typeof minSelections === "number" && Number.isInteger(minSelections) && minSelections > 0 ? minSelections : 0;
  if (typeof maxSelections === "number" && Number.isInteger(maxSelections) && maxSelections > 0) return Math.max(maxSelections, min);
  return min > 0 ? min : undefined;
}
