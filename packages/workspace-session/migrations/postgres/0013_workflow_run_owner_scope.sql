-- Stable workflow-run ownership. organization_id + user_id are the durable
-- authority; host_session_id is insert-time audit provenance only.
--
-- Rows created before this migration have no trustworthy owner. They remain
-- nullable and become intentionally invisible under the forced-RLS policy
-- rather than being guessed/backfilled into a tenant.

alter table sonik_agent_ui.agent_workflow_runs
  add column if not exists organization_id text,
  add column if not exists user_id text,
  add column if not exists host_session_id text;

alter table sonik_agent_ui.agent_workflow_runs
  drop constraint if exists agent_workflow_runs_pkey;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'sonik_agent_ui.agent_workflow_runs'::regclass
      and conname = 'agent_workflow_runs_owner_pair_check'
  ) then
    alter table sonik_agent_ui.agent_workflow_runs
      add constraint agent_workflow_runs_owner_pair_check
      check ((organization_id is null and user_id is null) or (organization_id is not null and user_id is not null));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'sonik_agent_ui.agent_workflow_runs'::regclass
      and conname = 'agent_workflow_runs_owner_run_key'
  ) then
    alter table sonik_agent_ui.agent_workflow_runs
      add constraint agent_workflow_runs_owner_run_key unique (organization_id, user_id, run_id);
  end if;
end
$$;

create index if not exists agent_workflow_runs_owner_updated_idx
  on sonik_agent_ui.agent_workflow_runs (organization_id, user_id, updated_at desc);

comment on column sonik_agent_ui.agent_workflow_runs.host_session_id is
  'Insert-time host-session provenance only; never a workflow-run visibility predicate.';

alter table sonik_agent_ui.agent_workflow_runs enable row level security;
alter table sonik_agent_ui.agent_workflow_runs force row level security;

drop policy if exists agent_workflow_runs_owner_scope on sonik_agent_ui.agent_workflow_runs;
create policy agent_workflow_runs_owner_scope on sonik_agent_ui.agent_workflow_runs
  using (
    organization_id = sonik_agent_ui.current_organization_id()
    and user_id = sonik_agent_ui.current_user_id()
  )
  with check (
    organization_id = sonik_agent_ui.current_organization_id()
    and user_id = sonik_agent_ui.current_user_id()
  );
