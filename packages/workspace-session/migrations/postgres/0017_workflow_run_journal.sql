-- Canonical workflow journal and crash-safe coordination for Train 1C.
-- The legacy state column remains untouched for PR56 compatibility; new runs can
-- project canonical snapshots beside it while advancing revision and sequence together.

alter table sonik_agent_ui.agent_workflow_runs
  add column if not exists journal_revision bigint not null default 0 check (journal_revision >= 0),
  add column if not exists journal_sequence bigint not null default 0 check (journal_sequence >= 0),
  add column if not exists canonical_snapshot jsonb,
  add column if not exists compatibility_phase text not null default 'legacy_v1';

create table if not exists sonik_agent_ui.agent_workflow_run_events (
  organization_id text not null,
  user_id text not null,
  run_id text not null,
  sequence bigint not null check (sequence > 0),
  revision bigint not null check (revision = sequence),
  event_id text not null,
  event_type text not null check (event_type in ('run_started', 'node_completed', 'wait_created', 'effect_claim_changed', 'run_status_changed')),
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, run_id, sequence),
  unique (organization_id, user_id, run_id, event_id),
  foreign key (organization_id, user_id, run_id)
    references sonik_agent_ui.agent_workflow_runs (organization_id, user_id, run_id) on delete cascade
);

create table if not exists sonik_agent_ui.agent_workflow_run_leases (
  organization_id text not null,
  user_id text not null,
  run_id text not null,
  lease_id text not null,
  owner_id text not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, run_id),
  foreign key (organization_id, user_id, run_id)
    references sonik_agent_ui.agent_workflow_runs (organization_id, user_id, run_id) on delete cascade
);

create index if not exists agent_workflow_run_leases_expiry_idx
  on sonik_agent_ui.agent_workflow_run_leases (lease_expires_at);

create table if not exists sonik_agent_ui.agent_workflow_run_waitpoints (
  organization_id text not null,
  user_id text not null,
  run_id text not null,
  waitpoint_id text not null,
  kind text not null check (kind in ('answer', 'approval')),
  waitpoint jsonb not null,
  status text not null check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, run_id, waitpoint_id),
  foreign key (organization_id, user_id, run_id)
    references sonik_agent_ui.agent_workflow_runs (organization_id, user_id, run_id) on delete cascade
);

create table if not exists sonik_agent_ui.agent_workflow_effect_claims (
  organization_id text not null,
  user_id text not null,
  run_id text not null,
  logical_effect_id text not null,
  claim_id text not null,
  attempt_id text not null,
  idempotency_key text not null,
  provider_supports_idempotency boolean not null,
  status text not null check (status in ('claimed', 'in_flight', 'succeeded', 'failed', 'outcome_unknown', 'reconciled')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, run_id, logical_effect_id),
  unique (organization_id, user_id, run_id, idempotency_key),
  unique (organization_id, user_id, run_id, claim_id),
  foreign key (organization_id, user_id, run_id)
    references sonik_agent_ui.agent_workflow_runs (organization_id, user_id, run_id) on delete cascade
);

alter table sonik_agent_ui.agent_workflow_run_events enable row level security;
alter table sonik_agent_ui.agent_workflow_run_events force row level security;
alter table sonik_agent_ui.agent_workflow_run_leases enable row level security;
alter table sonik_agent_ui.agent_workflow_run_leases force row level security;
alter table sonik_agent_ui.agent_workflow_run_waitpoints enable row level security;
alter table sonik_agent_ui.agent_workflow_run_waitpoints force row level security;
alter table sonik_agent_ui.agent_workflow_effect_claims enable row level security;
alter table sonik_agent_ui.agent_workflow_effect_claims force row level security;

drop policy if exists agent_workflow_run_events_scope on sonik_agent_ui.agent_workflow_run_events;
create policy agent_workflow_run_events_scope on sonik_agent_ui.agent_workflow_run_events
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());

drop policy if exists agent_workflow_run_leases_scope on sonik_agent_ui.agent_workflow_run_leases;
create policy agent_workflow_run_leases_scope on sonik_agent_ui.agent_workflow_run_leases
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());

drop policy if exists agent_workflow_run_waitpoints_scope on sonik_agent_ui.agent_workflow_run_waitpoints;
create policy agent_workflow_run_waitpoints_scope on sonik_agent_ui.agent_workflow_run_waitpoints
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());

drop policy if exists agent_workflow_effect_claims_scope on sonik_agent_ui.agent_workflow_effect_claims;
create policy agent_workflow_effect_claims_scope on sonik_agent_ui.agent_workflow_effect_claims
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
