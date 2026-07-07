export function escapeJsonPointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function createQuestionErrorStatePath(questionId: string): `/questionErrors/${string}` {
  return `/questionErrors/${escapeJsonPointerSegment(questionId)}`;
}

export function createQuestionLifecycleStatePath(questionId: string): `/questionStates/${string}` {
  return `/questionStates/${escapeJsonPointerSegment(questionId)}`;
}
