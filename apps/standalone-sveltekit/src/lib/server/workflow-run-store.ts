import type { WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
import type { WorkflowRunState } from "@sonik-agent-ui/tool-contracts/workflow-run-state";
import {
  canTransitionEffectClaim,
  effectClaimSchema,
  parseCanonicalWorkflowEvent,
  replayCanonicalWorkflowEvents,
  runLeaseSchema,
  workflowEffectIdempotencyKey,
  workflowVNextRunStateSchema,
  workflowWaitpointSchema,
  type CanonicalWorkflowEvent,
  type WorkflowWaitpoint,
} from "@sonik-agent-ui/tool-contracts/workflow-vnext";
import type { WorkspaceSqlExecutor, WorkspaceSqlTransaction } from "@sonik-agent-ui/workspace-session";
import { createNeonWorkspaceSqlExecutor } from "./workspace-cloud-sql.ts";

export interface WorkflowRunOwner {
  organizationId: string;
  userId: string;
  /** Insert-time audit provenance only. Host-session rotation never changes ownership. */
  hostSessionId?: string | null;
}

export interface WorkflowRunRow {
  organizationId: string;
  userId: string;
  hostSessionId: string | null;
  runId: string;
  workflowId: string;
  workflowVersionId: string;
  /** The exact definition this run was started against. */
  definition: WorkflowDefinition;
  /** Opaque per-workflow input closed over by registered callbacks. */
  input: unknown;
  state: WorkflowRunState;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowRunInput {
  workflowId: string;
  workflowVersionId: string;
  definition: WorkflowDefinition;
  input: unknown;
  state: WorkflowRunState;
}

export type WorkflowRunSnapshot = ReturnType<typeof workflowVNextRunStateSchema.parse>;
export type WorkflowRunLease = ReturnType<typeof runLeaseSchema.parse>;
export type WorkflowEffectClaim = ReturnType<typeof effectClaimSchema.parse> & { result?: unknown };

export interface AppendWorkflowRunEventInput {
  expectedRevision: number;
  leaseId: string;
  event: CanonicalWorkflowEvent;
  snapshot: WorkflowRunSnapshot;
}

export interface ClaimWorkflowEffectInput {
  claimId: string;
  runId: string;
  logicalEffectId: string;
  attemptId: string;
  idempotencyKey: string;
  providerSupportsIdempotency: boolean;
}

export interface WorkflowRunJournalStore {
  appendEventAndProject(owner: WorkflowRunOwner, input: AppendWorkflowRunEventInput): Promise<boolean>;
  getSnapshot(owner: WorkflowRunOwner, runId: string): Promise<WorkflowRunSnapshot | null>;
  listEvents(owner: WorkflowRunOwner, runId: string): Promise<CanonicalWorkflowEvent[]>;
  replayEvents(owner: WorkflowRunOwner, initial: WorkflowRunSnapshot): Promise<WorkflowRunSnapshot>;
  acquireLease(owner: WorkflowRunOwner, runId: string, lease: WorkflowRunLease): Promise<boolean>;
  releaseLease(owner: WorkflowRunOwner, runId: string, leaseId: string): Promise<boolean>;
  createWaitpoint(owner: WorkflowRunOwner, waitpoint: WorkflowWaitpoint): Promise<boolean>;
  resolveWaitpoint(owner: WorkflowRunOwner, runId: string, waitpointId: string): Promise<boolean>;
  claimEffect(owner: WorkflowRunOwner, input: ClaimWorkflowEffectInput): Promise<{ created: boolean; claim: WorkflowEffectClaim }>;
  transitionEffectClaim(owner: WorkflowRunOwner, runId: string, logicalEffectId: string, from: WorkflowEffectClaim["status"], to: WorkflowEffectClaim["status"], result?: unknown): Promise<WorkflowEffectClaim | null>;
}

export interface WorkflowRunStore {
  createRun(owner: WorkflowRunOwner, input: CreateWorkflowRunInput): WorkflowRunRow;
  getRun(owner: WorkflowRunOwner, runId: string): WorkflowRunRow | null;
  listRuns(owner: WorkflowRunOwner): WorkflowRunRow[];
  updateRunState(owner: WorkflowRunOwner, runId: string, state: WorkflowRunState): WorkflowRunRow | null;
}

export function createInMemoryWorkflowRunStore(): WorkflowRunStore {
  const rows = new Map<string, WorkflowRunRow>();

  function createRun(ownerInput: WorkflowRunOwner, input: CreateWorkflowRunInput): WorkflowRunRow {
    const owner = normalizeWorkflowRunOwner(ownerInput);
    const key = workflowRunKey(owner, input.state.runId);
    if (rows.has(key)) throw workflowRunConflictError(input.state.runId);
    const now = new Date().toISOString();
    const row: WorkflowRunRow = {
      organizationId: owner.organizationId,
      userId: owner.userId,
      hostSessionId: owner.hostSessionId ?? null,
      runId: input.state.runId,
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      definition: input.definition,
      input: input.input,
      state: input.state,
      createdAt: now,
      updatedAt: now,
    };
    rows.set(key, row);
    return row;
  }

  function getRun(ownerInput: WorkflowRunOwner, runId: string): WorkflowRunRow | null {
    const owner = normalizeWorkflowRunOwner(ownerInput);
    return rows.get(workflowRunKey(owner, runId)) ?? null;
  }

  function listRuns(ownerInput: WorkflowRunOwner): WorkflowRunRow[] {
    const owner = normalizeWorkflowRunOwner(ownerInput);
    return [...rows.values()]
      .filter((row) => row.organizationId === owner.organizationId && row.userId === owner.userId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  function updateRunState(ownerInput: WorkflowRunOwner, runId: string, state: WorkflowRunState): WorkflowRunRow | null {
    const owner = normalizeWorkflowRunOwner(ownerInput);
    const key = workflowRunKey(owner, runId);
    const existing = rows.get(key);
    if (!existing) return null;
    const updated: WorkflowRunRow = { ...existing, state, updatedAt: new Date().toISOString() };
    rows.set(key, updated);
    return updated;
  }

  return { createRun, getRun, listRuns, updateRunState };
}

export function createInMemoryWorkflowRunJournalStore(runStore: WorkflowRunStore): WorkflowRunJournalStore {
  const events = new Map<string, CanonicalWorkflowEvent[]>();
  const snapshots = new Map<string, WorkflowRunSnapshot>();
  const leases = new Map<string, WorkflowRunLease>();
  const waitpoints = new Map<string, WorkflowWaitpoint & { resolved: boolean }>();
  const claims = new Map<string, WorkflowEffectClaim>();

  return {
    async appendEventAndProject(ownerInput, input) {
      const owner = normalizeWorkflowRunOwner(ownerInput);
      const event = validateJournalAppend(input);
      if (!runStore.getRun(owner, event.workflowRunId)) return false;
      const key = workflowRunKey(owner, event.workflowRunId);
      const current = snapshots.get(key);
      const lease = leases.get(key);
      if ((current?.revision ?? 0) !== input.expectedRevision
        || lease?.leaseId !== input.leaseId
        || Date.parse(lease.expiresAt) <= Date.now()) return false;
      events.set(key, [...(events.get(key) ?? []), event]);
      snapshots.set(key, input.snapshot);
      return true;
    },
    async listEvents(ownerInput, runId) {
      const owner = normalizeWorkflowRunOwner(ownerInput);
      return [...(events.get(workflowRunKey(owner, runId)) ?? [])];
    },
    async getSnapshot(ownerInput, runId) {
      const snapshot = snapshots.get(workflowRunKey(normalizeWorkflowRunOwner(ownerInput), runId));
      return snapshot ? structuredClone(snapshot) : null;
    },
    async replayEvents(owner, initial) {
      return replayCanonicalWorkflowEvents(initial, await this.listEvents(owner, initial.workflowRunId));
    },
    async acquireLease(ownerInput, runId, leaseInput) {
      const owner = normalizeWorkflowRunOwner(ownerInput);
      if (!runStore.getRun(owner, runId)) return false;
      const lease = runLeaseSchema.parse(leaseInput);
      if (Date.parse(lease.expiresAt) <= Date.now()) return false;
      const key = workflowRunKey(owner, runId);
      const current = leases.get(key);
      if (current && current.leaseId !== lease.leaseId && Date.parse(current.expiresAt) > Date.now()) return false;
      leases.set(key, lease);
      return true;
    },
    async releaseLease(ownerInput, runId, leaseId) {
      const key = workflowRunKey(normalizeWorkflowRunOwner(ownerInput), runId);
      if (leases.get(key)?.leaseId !== leaseId) return false;
      return leases.delete(key);
    },
    async createWaitpoint(ownerInput, waitpointInput) {
      const owner = normalizeWorkflowRunOwner(ownerInput);
      const waitpoint = workflowWaitpointSchema.parse(waitpointInput);
      if (!runStore.getRun(owner, waitpoint.runId)) return false;
      const key = waitpointKey(owner, waitpoint.runId, waitpoint.waitpointId);
      if (waitpoints.has(key)) return false;
      waitpoints.set(key, { ...waitpoint, resolved: false });
      return true;
    },
    async resolveWaitpoint(ownerInput, runId, waitpointId) {
      const key = waitpointKey(normalizeWorkflowRunOwner(ownerInput), runId, waitpointId);
      const current = waitpoints.get(key);
      if (!current || current.resolved || ("expiresAt" in current && current.expiresAt && Date.parse(current.expiresAt) <= Date.now())) return false;
      waitpoints.set(key, { ...current, resolved: true });
      return true;
    },
    async claimEffect(ownerInput, input) {
      const owner = normalizeWorkflowRunOwner(ownerInput);
      if (!runStore.getRun(owner, input.runId)) throw new Error("workflow_run_not_found");
      validateEffectIdentity(input);
      const key = effectClaimKey(owner, input.runId, input.logicalEffectId);
      const current = claims.get(key);
      if (current) return { created: false, claim: current };
      const now = new Date().toISOString();
      const claim = effectClaimSchema.parse({ ...input, status: "claimed", createdAt: now, updatedAt: now });
      claims.set(key, claim);
      return { created: true, claim };
    },
    async transitionEffectClaim(ownerInput, runId, logicalEffectId, from, to, result) {
      if (!canTransitionEffectClaim(from, to)) throw new Error("invalid_effect_claim_transition");
      const key = effectClaimKey(normalizeWorkflowRunOwner(ownerInput), runId, logicalEffectId);
      const current = claims.get(key);
      if (!current || current.status !== from) return null;
      const updated = { ...current, status: to, updatedAt: new Date().toISOString(), ...(result === undefined ? {} : { result }) };
      claims.set(key, updated);
      return updated;
    },
  };
}

/** Module-level local/test store. Every operation still requires a stable owner scope. */
export const workflowRunStore: WorkflowRunStore = createInMemoryWorkflowRunStore();
const workflowRunJournalStore = createInMemoryWorkflowRunJournalStore(workflowRunStore);

export interface AsyncWorkflowRunStore {
  createRun(owner: WorkflowRunOwner, input: CreateWorkflowRunInput): Promise<WorkflowRunRow>;
  getRun(owner: WorkflowRunOwner, runId: string): Promise<WorkflowRunRow | null>;
  listRuns(owner: WorkflowRunOwner): Promise<WorkflowRunRow[]>;
  updateRunState(owner: WorkflowRunOwner, runId: string, state: WorkflowRunState): Promise<WorkflowRunRow | null>;
}

export function wrapWorkflowRunStoreAsync(store: WorkflowRunStore): AsyncWorkflowRunStore {
  return {
    createRun: async (owner, input) => store.createRun(owner, input),
    getRun: async (owner, runId) => store.getRun(owner, runId),
    listRuns: async (owner) => store.listRuns(owner),
    updateRunState: async (owner, runId, state) => store.updateRunState(owner, runId, state),
  };
}

type WorkflowRunRowColumns = {
  organization_id: string;
  user_id: string;
  host_session_id: string | null;
  run_id: string;
  workflow_id: string;
  workflow_version_id: string;
  definition: WorkflowDefinition | string;
  input: unknown;
  state: WorkflowRunState | string;
  created_at: string;
  updated_at: string;
};

const WORKFLOW_RUN_COLUMNS = `
  organization_id, user_id, host_session_id, run_id, workflow_id,
  workflow_version_id, definition, input, state, created_at, updated_at
`;

function rowFromColumns(columns: WorkflowRunRowColumns): WorkflowRunRow {
  return {
    organizationId: columns.organization_id,
    userId: columns.user_id,
    hostSessionId: columns.host_session_id,
    runId: columns.run_id,
    workflowId: columns.workflow_id,
    workflowVersionId: columns.workflow_version_id,
    definition: parseJsonColumn<WorkflowDefinition>(columns.definition),
    input: parseJsonColumn(columns.input),
    state: parseJsonColumn<WorkflowRunState>(columns.state),
    createdAt: new Date(columns.created_at).toISOString(),
    updatedAt: new Date(columns.updated_at).toISOString(),
  };
}

/** RLS-backed workflow-run store. Explicit owner predicates are defense in depth. */
export function createCloudWorkflowRunStore(executor: WorkspaceSqlExecutor): AsyncWorkflowRunStore {
  async function createRun(ownerInput: WorkflowRunOwner, input: CreateWorkflowRunInput): Promise<WorkflowRunRow> {
    return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
      const now = new Date().toISOString();
      const result = await tx.query<WorkflowRunRowColumns>(`
        insert into sonik_agent_ui.agent_workflow_runs
          (organization_id, user_id, host_session_id, run_id, workflow_id, workflow_version_id, definition, input, state, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $10)
        returning ${WORKFLOW_RUN_COLUMNS}
      `, [
        owner.organizationId,
        owner.userId,
        owner.hostSessionId ?? null,
        input.state.runId,
        input.workflowId,
        input.workflowVersionId,
        JSON.stringify(input.definition),
        JSON.stringify(input.input),
        JSON.stringify(input.state),
        now,
      ]);
      const created = result.rows[0];
      if (!created) throw new Error("Workflow run insert returned no row");
      return rowFromColumns(created);
    });
  }

  async function getRun(ownerInput: WorkflowRunOwner, runId: string): Promise<WorkflowRunRow | null> {
    return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
      const result = await tx.query<WorkflowRunRowColumns>(`
        select ${WORKFLOW_RUN_COLUMNS}
        from sonik_agent_ui.agent_workflow_runs
        where organization_id = $1 and user_id = $2 and run_id = $3
      `, [owner.organizationId, owner.userId, runId]);
      return result.rows[0] ? rowFromColumns(result.rows[0]) : null;
    });
  }

  async function listRuns(ownerInput: WorkflowRunOwner): Promise<WorkflowRunRow[]> {
    return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
      const result = await tx.query<WorkflowRunRowColumns>(`
        select ${WORKFLOW_RUN_COLUMNS}
        from sonik_agent_ui.agent_workflow_runs
        where organization_id = $1 and user_id = $2
        order by updated_at desc
      `, [owner.organizationId, owner.userId]);
      return result.rows.map(rowFromColumns);
    });
  }

  async function updateRunState(ownerInput: WorkflowRunOwner, runId: string, state: WorkflowRunState): Promise<WorkflowRunRow | null> {
    return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
      const result = await tx.query<WorkflowRunRowColumns>(`
        update sonik_agent_ui.agent_workflow_runs
        set state = $4::jsonb, updated_at = $5
        where organization_id = $1 and user_id = $2 and run_id = $3
        returning ${WORKFLOW_RUN_COLUMNS}
      `, [owner.organizationId, owner.userId, runId, JSON.stringify(state), new Date().toISOString()]);
      return result.rows[0] ? rowFromColumns(result.rows[0]) : null;
    });
  }

  return { createRun, getRun, listRuns, updateRunState };
}

type JournalEventColumns = { event: CanonicalWorkflowEvent | string };
type EffectClaimColumns = {
  claim_id: string;
  run_id: string;
  logical_effect_id: string;
  attempt_id: string;
  idempotency_key: string;
  provider_supports_idempotency: boolean;
  status: WorkflowEffectClaim["status"];
  result: unknown;
  created_at: string;
  updated_at: string;
  created?: boolean;
};

/** Production journal operations. Every state transition is one SQL statement because the Neon
 * executor re-establishes request context per query rather than holding a callback-wide session. */
export function createCloudWorkflowRunJournalStore(executor: WorkspaceSqlExecutor): WorkflowRunJournalStore {
  return {
    async appendEventAndProject(ownerInput, input) {
      const event = validateJournalAppend(input);
      return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
        const result = await tx.query<{ event_id: string }>(`
          with projected as (
            update sonik_agent_ui.agent_workflow_runs
            set journal_revision = $4,
                journal_sequence = $5,
                canonical_snapshot = $6::jsonb,
                compatibility_phase = $7,
                updated_at = now()
            where organization_id = $1 and user_id = $2 and run_id = $3
              and journal_revision = $8
              and exists (
                select 1 from sonik_agent_ui.agent_workflow_run_leases
                where organization_id = $1 and user_id = $2 and run_id = $3
                  and lease_id = $12 and lease_expires_at > now()
              )
            returning organization_id, user_id, run_id
          ), appended as (
            insert into sonik_agent_ui.agent_workflow_run_events
              (organization_id, user_id, run_id, sequence, revision, event_id, event_type, event, created_at)
            select organization_id, user_id, run_id, $5, $4, $9, $10, $11::jsonb, now()
            from projected
            returning event_id
          )
          select event_id from appended
        `, [
          owner.organizationId,
          owner.userId,
          event.workflowRunId,
          event.revision,
          event.sequence,
          JSON.stringify(input.snapshot),
          input.snapshot.compatibilityPhase,
          input.expectedRevision,
          event.eventId,
          event.eventType,
          JSON.stringify(event),
          input.leaseId,
        ]);
        return result.rows.length === 1;
      });
    },
    async listEvents(ownerInput, runId) {
      return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
        const result = await tx.query<JournalEventColumns>(`
          select event
          from sonik_agent_ui.agent_workflow_run_events
          where organization_id = $1 and user_id = $2 and run_id = $3
          order by sequence
        `, [owner.organizationId, owner.userId, runId]);
        return result.rows.map(({ event }) => parseCanonicalWorkflowEvent(parseJsonColumn(event)));
      });
    },
    async getSnapshot(ownerInput, runId) {
      return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
        const result = await tx.query<{ canonical_snapshot: WorkflowRunSnapshot | string }>(`
          select canonical_snapshot
          from sonik_agent_ui.agent_workflow_runs
          where organization_id = $1 and user_id = $2 and run_id = $3
            and canonical_snapshot is not null
        `, [owner.organizationId, owner.userId, runId]);
        return result.rows[0]
          ? workflowVNextRunStateSchema.parse(parseJsonColumn(result.rows[0].canonical_snapshot))
          : null;
      });
    },
    async replayEvents(owner, initial) {
      return replayCanonicalWorkflowEvents(initial, await this.listEvents(owner, initial.workflowRunId));
    },
    async acquireLease(ownerInput, runId, leaseInput) {
      const lease = runLeaseSchema.parse(leaseInput);
      return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
        const result = await tx.query<{ lease_id: string }>(`
          insert into sonik_agent_ui.agent_workflow_run_leases
            (organization_id, user_id, run_id, lease_id, owner_id, lease_expires_at, updated_at)
          select $1, $2, $3, $4, $5, $6, now()
          where exists (
            select 1 from sonik_agent_ui.agent_workflow_runs
            where organization_id = $1 and user_id = $2 and run_id = $3
          )
            and $6::timestamptz > now()
          on conflict (organization_id, user_id, run_id) do update
          set lease_id = excluded.lease_id,
              owner_id = excluded.owner_id,
              lease_expires_at = excluded.lease_expires_at,
              updated_at = now()
          where agent_workflow_run_leases.lease_expires_at <= now()
             or (agent_workflow_run_leases.lease_id = excluded.lease_id
                 and agent_workflow_run_leases.owner_id = excluded.owner_id)
          returning lease_id
        `, [owner.organizationId, owner.userId, runId, lease.leaseId, lease.ownerId, lease.expiresAt]);
        return result.rows.length === 1;
      });
    },
    async releaseLease(ownerInput, runId, leaseId) {
      return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
        const result = await tx.query<{ lease_id: string }>(`
          delete from sonik_agent_ui.agent_workflow_run_leases
          where organization_id = $1 and user_id = $2 and run_id = $3 and lease_id = $4
          returning lease_id
        `, [owner.organizationId, owner.userId, runId, leaseId]);
        return result.rows.length === 1;
      });
    },
    async createWaitpoint(ownerInput, waitpointInput) {
      const waitpoint = workflowWaitpointSchema.parse(waitpointInput);
      return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
        const result = await tx.query<{ waitpoint_id: string }>(`
          insert into sonik_agent_ui.agent_workflow_run_waitpoints
            (organization_id, user_id, run_id, waitpoint_id, kind, waitpoint, status, created_at, updated_at)
          select $1, $2, $3, $4, $5, $6::jsonb, 'open', now(), now()
          where exists (
            select 1 from sonik_agent_ui.agent_workflow_runs
            where organization_id = $1 and user_id = $2 and run_id = $3
          )
          on conflict (organization_id, user_id, run_id, waitpoint_id) do nothing
          returning waitpoint_id
        `, [owner.organizationId, owner.userId, waitpoint.runId, waitpoint.waitpointId, waitpoint.kind, JSON.stringify(waitpoint)]);
        return result.rows.length === 1;
      });
    },
    async resolveWaitpoint(ownerInput, runId, waitpointId) {
      return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
        const result = await tx.query<{ waitpoint_id: string }>(`
          update sonik_agent_ui.agent_workflow_run_waitpoints
          set status = 'resolved', updated_at = now()
          where organization_id = $1 and user_id = $2 and run_id = $3
            and waitpoint_id = $4 and status = 'open'
            and (waitpoint->>'expiresAt' is null or (waitpoint->>'expiresAt')::timestamptz > now())
          returning waitpoint_id
        `, [owner.organizationId, owner.userId, runId, waitpointId]);
        return result.rows.length === 1;
      });
    },
    async claimEffect(ownerInput, input) {
      validateEffectIdentity(input);
      return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
        const result = await tx.query<EffectClaimColumns>(`
          with inserted as (
            insert into sonik_agent_ui.agent_workflow_effect_claims
              (organization_id, user_id, run_id, logical_effect_id, claim_id, attempt_id,
               idempotency_key, provider_supports_idempotency, status, created_at, updated_at)
            select $1, $2, $3, $4, $5, $6, $7, $8, 'claimed', now(), now()
            where exists (
              select 1 from sonik_agent_ui.agent_workflow_runs
              where organization_id = $1 and user_id = $2 and run_id = $3
            )
            on conflict (organization_id, user_id, run_id, logical_effect_id) do nothing
            returning *, true as created
          )
          select claim_id, run_id, logical_effect_id, attempt_id, idempotency_key,
                 provider_supports_idempotency, status, result, created_at, updated_at, created
          from inserted
          union all
          select claim_id, run_id, logical_effect_id, attempt_id, idempotency_key,
                 provider_supports_idempotency, status, result, created_at, updated_at, false as created
          from sonik_agent_ui.agent_workflow_effect_claims
          where organization_id = $1 and user_id = $2 and run_id = $3 and logical_effect_id = $4
            and not exists (select 1 from inserted)
          limit 1
        `, [
          owner.organizationId,
          owner.userId,
          input.runId,
          input.logicalEffectId,
          input.claimId,
          input.attemptId,
          input.idempotencyKey,
          input.providerSupportsIdempotency,
        ]);
        const row = result.rows[0];
        if (!row) throw new Error("workflow_run_not_found");
        const claim = effectClaimFromColumns(row);
        if (claim.idempotencyKey !== input.idempotencyKey) throw new Error("logical_effect_identity_conflict");
        return { created: row.created === true, claim };
      });
    },
    async transitionEffectClaim(ownerInput, runId, logicalEffectId, from, to, resultValue) {
      if (!canTransitionEffectClaim(from, to)) throw new Error("invalid_effect_claim_transition");
      return withWorkflowRunOwner(executor, ownerInput, async (tx, owner) => {
        const result = await tx.query<EffectClaimColumns>(`
          update sonik_agent_ui.agent_workflow_effect_claims
          set status = $6, result = $7::jsonb, updated_at = now()
          where organization_id = $1 and user_id = $2 and run_id = $3
            and logical_effect_id = $4 and status = $5
          returning claim_id, run_id, logical_effect_id, attempt_id, idempotency_key,
                    provider_supports_idempotency, status, result, created_at, updated_at
        `, [owner.organizationId, owner.userId, runId, logicalEffectId, from, to, JSON.stringify(resultValue ?? null)]);
        return result.rows[0] ? effectClaimFromColumns(result.rows[0]) : null;
      });
    },
  };
}

export function createNeonWorkflowRunStore(databaseUrl: string): AsyncWorkflowRunStore {
  return createCloudWorkflowRunStore(createNeonWorkspaceSqlExecutor(databaseUrl));
}

export function createNeonWorkflowRunJournalStore(databaseUrl: string): WorkflowRunJournalStore {
  return createCloudWorkflowRunJournalStore(createNeonWorkspaceSqlExecutor(databaseUrl));
}

function readWorkflowRunDatabaseUrl(env?: Record<string, unknown> | null): string | null {
  for (const key of ["SONIK_AGENT_UI_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL", "NEON_DATABASE_URL"]) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function resolveWorkflowRunStore(env?: Record<string, unknown> | null): AsyncWorkflowRunStore {
  const databaseUrl = readWorkflowRunDatabaseUrl(env);
  return databaseUrl ? createNeonWorkflowRunStore(databaseUrl) : wrapWorkflowRunStoreAsync(workflowRunStore);
}

export function resolveWorkflowRunJournalStore(env?: Record<string, unknown> | null): WorkflowRunJournalStore {
  const databaseUrl = readWorkflowRunDatabaseUrl(env);
  return databaseUrl ? createNeonWorkflowRunJournalStore(databaseUrl) : workflowRunJournalStore;
}

async function withWorkflowRunOwner<T>(
  executor: WorkspaceSqlExecutor,
  ownerInput: WorkflowRunOwner,
  operation: (tx: WorkspaceSqlTransaction, owner: WorkflowRunOwner) => Promise<T>,
): Promise<T> {
  const owner = normalizeWorkflowRunOwner(ownerInput);
  return executor.transaction(async (tx) => {
    await tx.query("select sonik_agent_ui.set_request_context($1, $2)", [owner.organizationId, owner.userId]);
    return operation(tx, owner);
  });
}

function normalizeWorkflowRunOwner(owner: WorkflowRunOwner): WorkflowRunOwner {
  const organizationId = owner.organizationId?.trim();
  const userId = owner.userId?.trim();
  if (!organizationId || !userId) throw new Error("Workflow run persistence requires organizationId and userId");
  return {
    organizationId,
    userId,
    hostSessionId: typeof owner.hostSessionId === "string" && owner.hostSessionId.trim() ? owner.hostSessionId.trim() : null,
  };
}

function workflowRunKey(owner: WorkflowRunOwner, runId: string): string {
  return JSON.stringify([owner.organizationId, owner.userId, runId]);
}

function workflowRunConflictError(runId: string): Error & { code: string } {
  return Object.assign(new Error(`Workflow run ${runId} already exists for this workspace owner`), { code: "23505" });
}

function validateJournalAppend(input: AppendWorkflowRunEventInput): CanonicalWorkflowEvent {
  const event = parseCanonicalWorkflowEvent(input.event);
  const snapshot = workflowVNextRunStateSchema.parse(input.snapshot);
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error("invalid_expected_revision");
  if (typeof input.leaseId !== "string" || !input.leaseId.trim()) throw new Error("invalid_workflow_run_lease");
  if (event.workflowRunId !== snapshot.workflowRunId
    || event.revision !== input.expectedRevision + 1
    || event.sequence !== input.expectedRevision + 1
    || snapshot.revision !== event.revision
    || snapshot.eventSequence !== event.sequence) {
    throw new Error("invalid_workflow_event_projection");
  }
  return event;
}

function validateEffectIdentity(input: ClaimWorkflowEffectInput): void {
  if (input.idempotencyKey !== workflowEffectIdempotencyKey(input.runId, input.logicalEffectId)) {
    throw new Error("invalid_effect_idempotency");
  }
}

function waitpointKey(owner: WorkflowRunOwner, runId: string, waitpointId: string): string {
  return JSON.stringify([owner.organizationId, owner.userId, runId, waitpointId]);
}

function effectClaimKey(owner: WorkflowRunOwner, runId: string, logicalEffectId: string): string {
  return JSON.stringify([owner.organizationId, owner.userId, runId, logicalEffectId]);
}

function effectClaimFromColumns(row: EffectClaimColumns): WorkflowEffectClaim {
  const claim = effectClaimSchema.parse({
    claimId: row.claim_id,
    runId: row.run_id,
    logicalEffectId: row.logical_effect_id,
    attemptId: row.attempt_id,
    idempotencyKey: row.idempotency_key,
    providerSupportsIdempotency: row.provider_supports_idempotency,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
  return row.result == null ? claim : { ...claim, result: parseJsonColumn(row.result) };
}

function parseJsonColumn<T = unknown>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}
