-- Sonik Agent UI: durable workflow-run store (P1 #5,
-- production-readiness-agent-creation-2026-07-13.md). The controller's first
-- production caller (POST /api/workflow-runs) persists one row per run,
-- following agent_definition_drafts' shape (0005_agent_definitions.sql): the
-- run's own WorkflowRunState is the source of truth, this table just makes it
-- durable across a Worker isolate recycle.
--
-- org scoping seam: no organization_id column yet, same reasoning as
-- 0005_agent_definitions.sql -- the credentials lane owns real org context.

create schema if not exists sonik_agent_ui;

create table if not exists sonik_agent_ui.agent_workflow_runs (
  run_id text primary key,
  workflow_id text not null,
  workflow_version_id text not null,
  definition jsonb not null,
  input jsonb,
  state jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_workflow_runs_workflow_id_idx
  on sonik_agent_ui.agent_workflow_runs (workflow_id);
