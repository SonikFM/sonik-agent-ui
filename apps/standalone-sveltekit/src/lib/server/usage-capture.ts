// v7 `finish`/`finish-step` UI-message chunks carry no usage fields (see
// createRunEventMapper's dead `if (usage)` branch in run-event-log.ts), so the
// only source of a run's usage event is the streamText result's `totalUsage`
// promise, captured here and appended once it resolves.
export interface UsageEvent {
  kind: "usage";
  requestId: string;
  usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export async function recordUsageFromResult(
  appendRunEvent: (event: UsageEvent) => unknown,
  input: { requestId: string; totalUsage: PromiseLike<{ inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined> },
): Promise<void> {
  let usage;
  try {
    usage = await input.totalUsage;
  } catch {
    return;
  }
  if (!usage) return;
  appendRunEvent({
    kind: "usage",
    requestId: input.requestId,
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens },
  });
}
