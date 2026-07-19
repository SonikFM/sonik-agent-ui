export type CommitLedgerFailureStage = "read" | "claim" | "write" | "release";
export type CommitLedgerFailureReason = `ledger_${CommitLedgerFailureStage}_failed`;

export type IdempotentCommitOutcome<TReceipt extends Record<string, unknown>> =
  | { kind: "replayed"; receipt: TReceipt & { replayed: true } }
  | { kind: "committed"; receipt: TReceipt }
  | { kind: "commit_in_progress" }
  | { kind: "ledger_read_failed"; error: unknown }
  | { kind: "ledger_claim_failed"; error: unknown };

export function commitLedgerFailureReason(stage: CommitLedgerFailureStage): CommitLedgerFailureReason {
  return `ledger_${stage}_failed`;
}

export async function runIdempotentCommit<TReceipt extends Record<string, unknown> & { ok: boolean }>(input: {
  getReceipt: () => Promise<TReceipt | null>;
  claim?: () => Promise<boolean>;
  releaseClaim?: () => Promise<unknown>;
  commit: () => Promise<TReceipt>;
  recordReceipt: (receipt: TReceipt) => Promise<unknown>;
  claimWaitMs?: number;
  claimPollMs?: number;
  onLedgerFailure?: (stage: CommitLedgerFailureStage, error: unknown) => void | Promise<void>;
}): Promise<IdempotentCommitOutcome<TReceipt>> {
  const initial = await readReceipt(input);
  if (!initial.ok) return { kind: "ledger_read_failed", error: initial.error };
  if (initial.receipt) return replay(initial.receipt);

  let claimAcquired = false;
  if (input.claim) {
    try {
      claimAcquired = await input.claim();
    } catch (error) {
      await notifyLedgerFailure(input.onLedgerFailure, "claim", error);
      return { kind: "ledger_claim_failed", error };
    }

    if (!claimAcquired) {
      return waitForReceipt(input);
    }

    // A prior owner can finalize after our first read and release immediately
    // before this claim. Re-read under the lease before performing any write.
    const afterClaim = await readReceipt(input);
    if (!afterClaim.ok) {
      await releaseClaim(input);
      return { kind: "ledger_read_failed", error: afterClaim.error };
    }
    if (afterClaim.receipt) {
      await releaseClaim(input);
      return replay(afterClaim.receipt);
    }
  }

  let receipt: TReceipt;
  try {
    receipt = await input.commit();
  } catch (error) {
    if (claimAcquired) await releaseClaim(input);
    throw error;
  }

  let finalized = false;
  if (receipt.ok) {
    try {
      await input.recordReceipt(receipt);
      finalized = true;
    } catch (error) {
      await notifyLedgerFailure(input.onLedgerFailure, "write", error);
    }
  }

  // Keep a successful-but-unrecorded write leased until expiry. This prevents
  // an immediate duplicate while the downstream service's stable idempotency
  // key remains the crash/retry backstop. Failed writes are released at once.
  if (claimAcquired && (finalized || !receipt.ok)) await releaseClaim(input);
  return { kind: "committed", receipt };
}

async function readReceipt<TReceipt extends Record<string, unknown> & { ok: boolean }>(input: {
  getReceipt: () => Promise<TReceipt | null>;
  onLedgerFailure?: (stage: CommitLedgerFailureStage, error: unknown) => void | Promise<void>;
}): Promise<{ ok: true; receipt: TReceipt | null } | { ok: false; error: unknown }> {
  try {
    return { ok: true, receipt: await input.getReceipt() };
  } catch (error) {
    await notifyLedgerFailure(input.onLedgerFailure, "read", error);
    return { ok: false, error };
  }
}

async function waitForReceipt<TReceipt extends Record<string, unknown> & { ok: boolean }>(input: {
  getReceipt: () => Promise<TReceipt | null>;
  claimWaitMs?: number;
  claimPollMs?: number;
  onLedgerFailure?: (stage: CommitLedgerFailureStage, error: unknown) => void | Promise<void>;
}): Promise<IdempotentCommitOutcome<TReceipt>> {
  const waitMs = Math.max(0, input.claimWaitMs ?? 10_000);
  const pollMs = Math.max(10, input.claimPollMs ?? 100);
  const deadline = Date.now() + waitMs;
  do {
    if (waitMs > 0) await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
    const current = await readReceipt(input);
    if (!current.ok) return { kind: "ledger_read_failed", error: current.error };
    if (current.receipt) return replay(current.receipt);
  } while (Date.now() < deadline);
  return { kind: "commit_in_progress" };
}

async function releaseClaim(input: {
  releaseClaim?: () => Promise<unknown>;
  onLedgerFailure?: (stage: CommitLedgerFailureStage, error: unknown) => void | Promise<void>;
}): Promise<void> {
  if (!input.releaseClaim) return;
  try {
    await input.releaseClaim();
  } catch (error) {
    await notifyLedgerFailure(input.onLedgerFailure, "release", error);
  }
}

function replay<TReceipt extends Record<string, unknown>>(receipt: TReceipt): IdempotentCommitOutcome<TReceipt> {
  return { kind: "replayed", receipt: { ...receipt, replayed: true } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function notifyLedgerFailure(handler: ((stage: CommitLedgerFailureStage, error: unknown) => void | Promise<void>) | undefined, stage: CommitLedgerFailureStage, error: unknown): Promise<void> {
  try {
    await handler?.(stage, error);
  } catch {
    // Telemetry is evidence, not part of the commit result.
  }
}
