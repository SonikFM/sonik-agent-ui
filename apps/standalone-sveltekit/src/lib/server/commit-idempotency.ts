export type CommitLedgerFailureStage = "read" | "write";
export type CommitLedgerFailureReason = `ledger_${CommitLedgerFailureStage}_failed`;

export type IdempotentCommitOutcome<TReceipt extends Record<string, unknown>> =
  | { kind: "replayed"; receipt: TReceipt & { replayed: true } }
  | { kind: "committed"; receipt: TReceipt }
  | { kind: "ledger_read_failed"; error: unknown };

export function commitLedgerFailureReason(stage: CommitLedgerFailureStage): CommitLedgerFailureReason {
  return `ledger_${stage}_failed`;
}

// ponytail: this blocks sequential replays, not simultaneous first attempts;
// add a database claim/lease before service calls if concurrent exactly-once is required.
export async function runIdempotentCommit<TReceipt extends Record<string, unknown> & { ok: boolean }>(input: {
  getReceipt: () => Promise<TReceipt | null>;
  commit: () => Promise<TReceipt>;
  recordReceipt: (receipt: TReceipt) => Promise<unknown>;
  onLedgerFailure?: (stage: CommitLedgerFailureStage, error: unknown) => void | Promise<void>;
}): Promise<IdempotentCommitOutcome<TReceipt>> {
  let prior: TReceipt | null;
  try {
    prior = await input.getReceipt();
  } catch (error) {
    await notifyLedgerFailure(input.onLedgerFailure, "read", error);
    return { kind: "ledger_read_failed", error };
  }

  if (prior) return { kind: "replayed", receipt: { ...prior, replayed: true } };

  const receipt = await input.commit();
  if (receipt.ok) {
    try {
      await input.recordReceipt(receipt);
    } catch (error) {
      await notifyLedgerFailure(input.onLedgerFailure, "write", error);
    }
  }
  return { kind: "committed", receipt };
}

async function notifyLedgerFailure(handler: ((stage: CommitLedgerFailureStage, error: unknown) => void | Promise<void>) | undefined, stage: CommitLedgerFailureStage, error: unknown): Promise<void> {
  try {
    await handler?.(stage, error);
  } catch {
    // Telemetry is evidence, not part of the commit result.
  }
}
