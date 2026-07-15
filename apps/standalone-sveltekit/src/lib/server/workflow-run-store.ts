import type { WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
import type { WorkflowRunState } from "@sonik-agent-ui/tool-contracts/workflow-run-state";
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

/** Module-level local/test store. Every operation still requires a stable owner scope. */
export const workflowRunStore: WorkflowRunStore = createInMemoryWorkflowRunStore();

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

export function createNeonWorkflowRunStore(databaseUrl: string): AsyncWorkflowRunStore {
  return createCloudWorkflowRunStore(createNeonWorkspaceSqlExecutor(databaseUrl));
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

function parseJsonColumn<T = unknown>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}
