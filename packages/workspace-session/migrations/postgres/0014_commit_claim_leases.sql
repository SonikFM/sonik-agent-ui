-- A short-lived, owner-scoped lease closes the first-attempt race before a
-- human-approved external write. Successful receipts remain in the durable
-- commit ledger; claims are deleted after finalization or expire for recovery.

create schema if not exists sonik_agent_ui;

create table if not exists sonik_agent_ui.agent_workspace_commit_claims (
  organization_id text not null,
  user_id text not null,
  commit_kind text not null check (commit_kind in ('reservation', 'intake')),
  idempotency_key text not null,
  claim_token text not null,
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, commit_kind, idempotency_key)
);

create index if not exists agent_workspace_commit_claims_expiry_idx
  on sonik_agent_ui.agent_workspace_commit_claims (lease_expires_at);

alter table sonik_agent_ui.agent_workspace_commit_claims enable row level security;
alter table sonik_agent_ui.agent_workspace_commit_claims force row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'sonik_agent_ui'
      and tablename = 'agent_workspace_commit_claims'
      and policyname = 'agent_workspace_commit_claims_scope'
  ) then
    create policy agent_workspace_commit_claims_scope
      on sonik_agent_ui.agent_workspace_commit_claims
      using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
      with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
  end if;
end
$$;
