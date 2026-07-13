// P1 #5 (production-readiness-agent-creation-2026-07-13.md): persists WorkflowRunState rows for
// the workflow-runs endpoint (the controller's first production caller). Sync in-memory store
// below is the local-dev/test fallback (mirrors agent-definition-store.ts's own split exactly);
// the durable Neon-backed AsyncWorkflowRunStore + resolveWorkflowRunStore live at the bottom of
// this file, same shape and same env vars as resolveAgentDefinitionStore. Schema:
// packages/workspace-session/migrations/postgres/0007_agent_workflow_runs.sql (appended to the
// shared migration manifest in scripts/run-postgres-migrations.mjs after Lane A's 0006).

import { neon } from "@neondatabase/serverless";
import type { WorkflowDefinition } from "@sonik-agent-ui/tool-contracts/marketplace";
import type { WorkflowRunState } from "@sonik-agent-ui/tool-contracts/workflow-run-state";

export interface WorkflowRunRow {
  runId: string;
  workflowId: string;
  workflowVersionId: string;
  /** The exact definition this run was started against -- re-resolving it by id later could drift
   *  if a draft changes mid-run; the run pins its own copy (D002-style immutability applied to runs). */
  definition: WorkflowDefinition;
  /** Opaque per-workflow input the registered callbacks close over (e.g. the Amplify campaign brief).
   *  Null for workflows with no registered callbacks. */
  input: unknown;
  state: WorkflowRunState;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunStore {
  createRun(input: { workflowId: string; workflowVersionId: string; definition: WorkflowDefinition; input: unknown; state: WorkflowRunState }): WorkflowRunRow;
  getRun(runId: string): WorkflowRunRow | null;
  updateRunState(runId: string, state: WorkflowRunState): WorkflowRunRow | null;
}

export function createInMemoryWorkflowRunStore(): WorkflowRunStore {
  const rows = new Map<string, WorkflowRunRow>();

  function createRun(input: { workflowId: string; workflowVersionId: string; definition: WorkflowDefinition; input: unknown; state: WorkflowRunState }): WorkflowRunRow {
    const now = new Date().toISOString();
    const row: WorkflowRunRow = {
      runId: input.state.runId,
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      definition: input.definition,
      input: input.input,
      state: input.state,
      createdAt: now,
      updatedAt: now,
    };
    rows.set(row.runId, row);
    return row;
  }

  // org scoping seam: filter by organization_id once the auth/org lane lands --
  // runs are process-wide across tenants until then (same seam as createRun above).
  function getRun(runId: string): WorkflowRunRow | null {
    return rows.get(runId) ?? null;
  }

  // org scoping seam: scope the update by organization_id once the auth/org lane lands.
  function updateRunState(runId: string, state: WorkflowRunState): WorkflowRunRow | null {
    const existing = rows.get(runId);
    if (!existing) return null;
    const updated: WorkflowRunRow = { ...existing, state, updatedAt: new Date().toISOString() };
    rows.set(runId, updated);
    return updated;
  }

  return { createRun, getRun, updateRunState };
}

/** Module-level singleton for the running process, mirroring agent-definition-store.ts's
 *  `agentDefinitionStore` singleton pattern. */
export const workflowRunStore: WorkflowRunStore = createInMemoryWorkflowRunStore();

// --- Durable (Neon) backing, P1 #5 (production-readiness-agent-creation-2026-07-13.md) ---
//
// Same split as agent-definition-store.ts: the sync store above stays exactly as-is (in-memory,
// the local-dev/test fallback); Neon queries are inherently async, so durable persistence is a
// SEPARATE async-returning interface. Callers opt in via resolveWorkflowRunStore(env) and await
// every call -- identical code path whether or not a DB is actually configured.
export interface AsyncWorkflowRunStore {
  createRun(input: { workflowId: string; workflowVersionId: string; definition: WorkflowDefinition; input: unknown; state: WorkflowRunState }): Promise<WorkflowRunRow>;
  getRun(runId: string): Promise<WorkflowRunRow | null>;
  updateRunState(runId: string, state: WorkflowRunState): Promise<WorkflowRunRow | null>;
}

/** Wraps the synchronous in-memory store in a Promise-returning facade, same reasoning as
 *  wrapAgentDefinitionStoreAsync: callers can `await` regardless of which backing is live. */
export function wrapWorkflowRunStoreAsync(store: WorkflowRunStore): AsyncWorkflowRunStore {
  return {
    createRun: async (input) => store.createRun(input),
    getRun: async (runId) => store.getRun(runId),
    updateRunState: async (runId, state) => store.updateRunState(runId, state),
  };
}

type WorkflowRunRowColumns = {
  run_id: string;
  workflow_id: string;
  workflow_version_id: string;
  definition: WorkflowDefinition;
  input: unknown;
  state: WorkflowRunState;
  created_at: string;
  updated_at: string;
};

function rowFromColumns(columns: WorkflowRunRowColumns): WorkflowRunRow {
  return {
    runId: columns.run_id,
    workflowId: columns.workflow_id,
    workflowVersionId: columns.workflow_version_id,
    definition: columns.definition,
    input: columns.input,
    state: columns.state,
    createdAt: new Date(columns.created_at).toISOString(),
    updatedAt: new Date(columns.updated_at).toISOString(),
  };
}

/** Neon-backed AsyncWorkflowRunStore. Runs are keyed by runId (created once, updated in place as
 *  the lifecycle advances) -- schema: 0007_agent_workflow_runs.sql. */
export function createNeonWorkflowRunStore(databaseUrl: string): AsyncWorkflowRunStore {
  const sql = neon(databaseUrl.trim());

  async function createRun(input: { workflowId: string; workflowVersionId: string; definition: WorkflowDefinition; input: unknown; state: WorkflowRunState }): Promise<WorkflowRunRow> {
    const now = new Date().toISOString();
    // org scoping seam: add organization_id (from the resolved host session) once the auth/org
    // lane lands, same reasoning as agent-definition-store.ts's saveDraft.
    await sql`
      insert into sonik_agent_ui.agent_workflow_runs (run_id, workflow_id, workflow_version_id, definition, input, state, created_at, updated_at)
      values (${input.state.runId}, ${input.workflowId}, ${input.workflowVersionId}, ${JSON.stringify(input.definition)}::jsonb, ${JSON.stringify(input.input)}::jsonb, ${JSON.stringify(input.state)}::jsonb, ${now}, ${now})
    `;
    return {
      runId: input.state.runId,
      workflowId: input.workflowId,
      workflowVersionId: input.workflowVersionId,
      definition: input.definition,
      input: input.input,
      state: input.state,
      createdAt: now,
      updatedAt: now,
    };
  }

  // org scoping seam: filter by organization_id once the auth/org lane lands.
  async function getRun(runId: string): Promise<WorkflowRunRow | null> {
    const rows = await sql`select * from sonik_agent_ui.agent_workflow_runs where run_id = ${runId}`;
    if (rows.length === 0) return null;
    return rowFromColumns(rows[0] as WorkflowRunRowColumns);
  }

  // org scoping seam: scope the update by organization_id once the auth/org lane lands.
  async function updateRunState(runId: string, state: WorkflowRunState): Promise<WorkflowRunRow | null> {
    const rows = await sql`
      update sonik_agent_ui.agent_workflow_runs
      set state = ${JSON.stringify(state)}::jsonb, updated_at = ${new Date().toISOString()}
      where run_id = ${runId}
      returning *
    `;
    if (rows.length === 0) return null;
    return rowFromColumns(rows[0] as WorkflowRunRowColumns);
  }

  return { createRun, getRun, updateRunState };
}

function readWorkflowRunDatabaseUrl(env?: Record<string, unknown> | null): string | null {
  // Same env var names/precedence as agent-definition-store.ts's readAgentDefinitionDatabaseUrl,
  // so one deploy env config (SONIK_AGENT_UI_DATABASE_URL) backs every store in this app.
  for (const key of ["SONIK_AGENT_UI_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL", "NEON_DATABASE_URL"]) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Per-request resolution: Neon-backed when a DB env is configured, else the in-memory singleton
 *  wrapped async -- no caller code change needed when a DB is wired up later. */
export function resolveWorkflowRunStore(env?: Record<string, unknown> | null): AsyncWorkflowRunStore {
  const databaseUrl = readWorkflowRunDatabaseUrl(env);
  return databaseUrl ? createNeonWorkflowRunStore(databaseUrl) : wrapWorkflowRunStoreAsync(workflowRunStore);
}
