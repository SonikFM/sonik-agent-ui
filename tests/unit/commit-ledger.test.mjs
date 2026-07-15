import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createAsyncWorkspacePersistenceAdapter,
  createCloudWorkspacePersistenceAdapter,
  createInMemoryWorkspacePersistence,
} from "../../packages/workspace-session/src/index.ts";
import { createTelemetryEvent } from "../../packages/agent-observability/src/index.ts";
import { commitLedgerFailureReason, runIdempotentCommit } from "../../apps/standalone-sveltekit/src/lib/server/commit-idempotency.ts";
import { sanitizeAgentTelemetry } from "../../apps/standalone-sveltekit/src/lib/server/agent-telemetry.ts";

const memory = createAsyncWorkspacePersistenceAdapter(createInMemoryWorkspacePersistence());
const reservationKey = { kind: "reservation", idempotency_key: "preview-call-1" };
const storedReservation = { ok: true, kind: "reservation-commit", bookingId: "booking-1" };
await memory.recordCommitReceipt({ ...reservationKey, session_id: "session-1", resource_id: "preview-call-1", receipt: storedReservation });
await memory.recordCommitReceipt({ ...reservationKey, receipt: { ok: true, bookingId: "booking-replaced" } });
assert.equal((await memory.getCommitReceipt(reservationKey))?.receipt.bookingId, "booking-1", "recording the same key must preserve the first successful receipt");

let runtimeFetcherCalls = 0;
const replay = await runIdempotentCommit({
  getReceipt: async () => (await memory.getCommitReceipt(reservationKey))?.receipt ?? null,
  commit: async () => {
    runtimeFetcherCalls += 1;
    return { ok: true, kind: "reservation-commit", bookingId: "duplicate" };
  },
  recordReceipt: (receipt) => memory.recordCommitReceipt({ ...reservationKey, receipt }),
});
assert.equal(replay.kind, "replayed");
assert.equal(replay.receipt.replayed, true);
assert.equal(replay.receipt.bookingId, "booking-1");
assert.equal(runtimeFetcherCalls, 0, "a replay must perform zero service/runtime fetches");

const failedKey = { kind: "reservation", idempotency_key: "preview-call-failed" };
const failed = await runIdempotentCommit({
  getReceipt: async () => (await memory.getCommitReceipt(failedKey))?.receipt ?? null,
  commit: async () => ({ ok: false, kind: "reservation-commit", error: "guest_create_failed" }),
  recordReceipt: (receipt) => memory.recordCommitReceipt({ ...failedKey, receipt }),
});
assert.equal(failed.kind, "committed");
assert.equal(failed.receipt.ok, false);
assert.equal(await memory.getCommitReceipt(failedKey), null, "failed commits must remain retryable");

const readFailures = [];
let readFailureCommitCalls = 0;
const readFailure = await runIdempotentCommit({
  getReceipt: async () => { throw new Error("ledger offline"); },
  commit: async () => {
    readFailureCommitCalls += 1;
    return { ok: true };
  },
  recordReceipt: async () => undefined,
  onLedgerFailure: (stage, error) => readFailures.push({ stage, message: error.message }),
});
assert.equal(readFailure.kind, "ledger_read_failed");
assert.equal(readFailureCommitCalls, 0, "an unavailable ledger must fail closed before service calls");
assert.deepEqual(readFailures, [{ stage: "read", message: "ledger offline" }]);

const writeFailures = [];
const completedDespiteLedgerFailure = await runIdempotentCommit({
  getReceipt: async () => null,
  commit: async () => ({ ok: true, kind: "reservation-commit", bookingId: "booking-complete" }),
  recordReceipt: async () => { throw new Error("ledger full"); },
  onLedgerFailure: (stage, error) => writeFailures.push({ stage, message: error.message }),
});
assert.equal(completedDespiteLedgerFailure.kind, "committed");
assert.equal(completedDespiteLedgerFailure.receipt.bookingId, "booking-complete", "ledger writes must not mask completed commits");
assert.deepEqual(writeFailures, [{ stage: "write", message: "ledger full" }]);

const privateLedgerSentinel = "private-provider-storage-sentinel";
for (const [stage, reason] of [["read", "ledger_read_failed"], ["write", "ledger_write_failed"]]) {
  assert.equal(commitLedgerFailureReason(stage), reason);
  for (const sanitize of [createTelemetryEvent, sanitizeAgentTelemetry]) {
    const event = sanitize({
      source: "server",
      event: "commit.human_approved",
      ok: false,
      reason: commitLedgerFailureReason(stage),
      error: privateLedgerSentinel,
    });
    assert.equal(event.reason, reason, `${reason} must survive the final telemetry sanitizer`);
    assert.equal(JSON.stringify(event).includes(privateLedgerSentinel), false, `${reason} must not leak storage/provider text`);
  }
}

const intakeKey = { kind: "intake", idempotency_key: "artifact-1:v3" };
await memory.recordCommitReceipt({ ...intakeKey, resource_id: "artifact-1", receipt: { ok: true, kind: "intake-command-commit" } });
let intakeServiceCalls = 0;
const intakeReplay = await runIdempotentCommit({
  getReceipt: async () => (await memory.getCommitReceipt(intakeKey))?.receipt ?? null,
  commit: async () => {
    intakeServiceCalls += 1;
    return { ok: true, kind: "intake-command-commit" };
  },
  recordReceipt: (receipt) => memory.recordCommitReceipt({ ...intakeKey, receipt }),
});
assert.equal(intakeReplay.kind, "replayed");
assert.equal(intakeReplay.receipt.replayed, true);
assert.equal(intakeServiceCalls, 0, "intake replays must skip the booking service");

class CommitLedgerSqlExecutor {
  rows = new Map();
  context = null;

  async transaction(fn) {
    this.context = null;
    return fn(this);
  }

  async query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized === "select sonik_agent_ui.set_request_context($1, $2)") {
      this.context = { organizationId: params[0], userId: params[1] };
      return { rows: [] };
    }
    assert.ok(this.context, "cloud ledger queries must run after the per-request context resolver");
    const key = `${params[0]}\u0000${params[1]}\u0000${params[2]}\u0000${params[3]}`;
    assert.deepEqual([params[0], params[1]], [this.context.organizationId, this.context.userId]);
    if (normalized.startsWith("insert into sonik_agent_ui.agent_workspace_commit_ledger")) {
      if (this.rows.has(key)) return { rows: [] };
      const row = {
        commit_kind: params[2],
        idempotency_key: params[3],
        session_id: params[4],
        resource_id: params[5],
        receipt_version: 1,
        receipt: JSON.parse(params[6]),
        created_at: "2026-07-14T12:00:00.000Z",
      };
      this.rows.set(key, row);
      return { rows: [structuredClone(row)] };
    }
    if (normalized.startsWith("select commit_kind, idempotency_key") && normalized.includes("agent_workspace_commit_ledger")) {
      const row = this.rows.get(key);
      return { rows: row ? [structuredClone(row)] : [] };
    }
    throw new Error(`unexpected SQL: ${normalized}`);
  }
}

function cloudRuntime(executor, organizationId) {
  return {
    kind: "cloud",
    env: {},
    db: executor,
    userId: "user-1",
    organizationId,
    requestId: "request-1",
    commandPolicy: { allowed: true, commandId: "workspace.commit.write", reasonCode: "test", effectiveScope: "workspace" },
    hostSession: { source: "test", authenticated: true, organizationId, userId: "user-1", scopes: ["workspace:write"] },
  };
}

const executor = new CommitLedgerSqlExecutor();
const cloudA = createCloudWorkspacePersistenceAdapter(cloudRuntime(executor, "org-a"));
const cloudB = createCloudWorkspacePersistenceAdapter(cloudRuntime(executor, "org-b"));
await cloudA.recordCommitReceipt({ ...reservationKey, receipt: storedReservation });
assert.equal((await cloudA.getCommitReceipt(reservationKey))?.receipt.bookingId, "booking-1");
assert.equal(await cloudB.getCommitReceipt(reservationKey), null, "cloud commit receipts must be org scoped");

const [migration, runner, reservationRoute, intakeRoute] = await Promise.all([
  readFile("packages/workspace-session/migrations/postgres/0012_commit_ledger.sql", "utf8"),
  readFile("scripts/run-postgres-migrations.mjs", "utf8"),
  readFile("apps/standalone-sveltekit/src/routes/api/reservation/commit/+server.ts", "utf8"),
  readFile("apps/standalone-sveltekit/src/routes/api/intake/commit/+server.ts", "utf8"),
]);
assert.match(migration, /primary key \(organization_id, user_id, commit_kind, idempotency_key\)/i);
assert.match(migration, /create table if not exists sonik_agent_ui\.agent_workspace_commit_ledger/i);
assert.match(migration, /create index if not exists agent_workspace_commit_ledger_created_idx/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /force row level security/i);
assert.match(migration, /if not exists \([\s\S]*from pg_policies/i, "the migration must be safe to re-run without recreating its policy");
assert.match(runner, /version: "0012"[\s\S]*name: "commit_ledger"[\s\S]*0012_commit_ledger\.sql/);
assert.match(runner, /version: "0012"[\s\S]*to_regclass\('sonik_agent_ui\.agent_workspace_commit_ledger'\)/, "the runner must baseline/version an already-applied 0012 table");
assert.doesNotMatch(reservationRoute, /createRequestWorkspaceArtifact|getRequestWorkspaceArtifact|as unknown as/);
for (const [name, route] of [["reservation", reservationRoute], ["intake", intakeRoute]]) {
  assert.match(route, /runIdempotentCommit/, `${name} commit must use the shared replay guard`);
  assert.match(route, /outcome\.kind === "ledger_read_failed"[\s\S]*status: 503/, `${name} commit must fail closed when commit history cannot be read`);
  assert.match(route, /outcome\.kind === "replayed"[\s\S]*reason: "idempotent_replay"/, `${name} commit must report replays`);
  assert.match(route, /commitLedgerFailureReason\(stage\)/, `${name} commit must report category-only read/write ledger failures without changing the receipt`);
  assert.doesNotMatch(route, /commitLedgerFailureReason\([^)]*ledgerError/, `${name} commit must never pass storage/provider text into telemetry`);
  assert.match(route, /return json\(outcome\.receipt, \{ status: 200 \}\)/, `${name} commit must return the shared replay/commit receipt`);
}
assert.match(intakeRoute, /artifactVersion === null \? artifactId : `\$\{artifactId\}:v\$\{artifactVersion\}`/);
assert.match(intakeRoute, /reason: commitLedgerFailureReason\("read"\)/, "intake artifact-version lookup failures use the same category-only telemetry reason");

console.log(JSON.stringify({ ok: true, checked: "typed-commit-ledger" }));
