-- Explicit run provenance. Existing rows remain null and therefore quarantined;
-- every new application-created row persists its authority kind.
alter table sonik_agent_ui.agent_workflow_runs
  add column if not exists source_kind text;

alter table sonik_agent_ui.agent_workflow_runs
  drop constraint if exists agent_workflow_runs_source_kind_check;

alter table sonik_agent_ui.agent_workflow_runs
  add constraint agent_workflow_runs_source_kind_check
  check (source_kind is null or source_kind in ('internal', 'draft', 'published'));
