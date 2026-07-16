-- Successful human-approved commits only. The composite key is scoped by the
-- same trusted request context as the workspace store; failed commits are never
-- inserted so callers can retry them.

create schema if not exists sonik_agent_ui;

create table if not exists sonik_agent_ui.agent_workspace_commit_ledger (
  organization_id text not null,
  user_id text not null,
  commit_kind text not null check (commit_kind in ('reservation', 'intake')),
  idempotency_key text not null,
  session_id text,
  resource_id text,
  receipt_version integer not null default 1 check (receipt_version = 1),
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, commit_kind, idempotency_key)
);

create index if not exists agent_workspace_commit_ledger_created_idx
  on sonik_agent_ui.agent_workspace_commit_ledger (organization_id, user_id, created_at desc);

alter table sonik_agent_ui.agent_workspace_commit_ledger enable row level security;
alter table sonik_agent_ui.agent_workspace_commit_ledger force row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'sonik_agent_ui'
      and tablename = 'agent_workspace_commit_ledger'
      and policyname = 'agent_workspace_commit_ledger_scope'
  ) then
    create policy agent_workspace_commit_ledger_scope
      on sonik_agent_ui.agent_workspace_commit_ledger
      using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
      with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
  end if;
end
$$;
