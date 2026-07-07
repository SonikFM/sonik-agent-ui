-- Sonik Agent UI run lifecycle persistence v0
-- Target: additive schema over 0001_agent_workspace_persistence.sql.
-- Runtime contract: application code must set app.organization_id and app.user_id
-- from a trusted server-side auth/org resolver before touching these tables.
-- Browser page context is display/context only and must never set these values.
--
-- A run is one agent turn as a persisted, resumable object. agent_workspace_runs
-- holds run status/resumable/error-code + correlation ids; agent_workspace_run_events
-- is the ordered, mapped event log mirroring the UI-message stream (text, tool_use,
-- tool_result, artifact, usage, status/error) — never raw transport chunks. On reload
-- the events replay in seq order to rebuild an in-flight or failed run's message.

create table if not exists sonik_agent_ui.agent_workspace_runs (
  id text not null,
  organization_id text not null,
  user_id text not null,
  session_id text not null,
  message_id text,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'canceled')),
  resumable boolean not null default false,
  error text,
  error_code text check (error_code in ('MISSING_HOST_CONTEXT', 'RATE_LIMITED', 'STALE_DEPLOYMENT', 'AGENT_STREAM_FAILED', 'UNKNOWN')),
  request_id text,
  trace_id text,
  traceparent text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  check ((status = 'running') = (ended_at is null)),
  foreign key (organization_id, user_id, session_id)
    references sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
    on delete cascade
);

comment on table sonik_agent_ui.agent_workspace_runs is
  'One agent turn as a persisted, resumable object. resumable drives the Continue affordance on transient failures; error_code drives error-specific UI.';

create table if not exists sonik_agent_ui.agent_workspace_run_events (
  id text not null,
  organization_id text not null,
  user_id text not null,
  run_id text not null,
  session_id text,
  seq integer not null check (seq >= 0),
  kind text not null check (kind in ('status', 'text', 'reasoning', 'tool_use', 'tool_result', 'artifact', 'usage', 'error')),
  event jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  unique (organization_id, user_id, run_id, seq),
  foreign key (organization_id, user_id, run_id)
    references sonik_agent_ui.agent_workspace_runs (organization_id, user_id, id)
    on delete cascade,
  foreign key (organization_id, user_id, session_id)
    references sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
    on delete set null (session_id)
);

comment on table sonik_agent_ui.agent_workspace_run_events is
  'Ordered, mapped mirror of the UI-message stream for a run. Persisted event union only (text/tool_use/tool_result/artifact/usage/status/error), never raw transport chunks.';

create index if not exists agent_workspace_runs_session_recent_idx
  on sonik_agent_ui.agent_workspace_runs (organization_id, user_id, session_id, created_at desc);
create index if not exists agent_workspace_runs_status_idx
  on sonik_agent_ui.agent_workspace_runs (organization_id, user_id, status, created_at desc);
create index if not exists agent_workspace_run_events_run_seq_idx
  on sonik_agent_ui.agent_workspace_run_events (organization_id, user_id, run_id, seq asc);

create trigger agent_workspace_runs_touch_updated_at
  before update on sonik_agent_ui.agent_workspace_runs
  for each row execute function sonik_agent_ui.touch_updated_at();

alter table sonik_agent_ui.agent_workspace_runs enable row level security;
alter table sonik_agent_ui.agent_workspace_run_events enable row level security;
alter table sonik_agent_ui.agent_workspace_runs force row level security;
alter table sonik_agent_ui.agent_workspace_run_events force row level security;

create policy agent_workspace_runs_scope on sonik_agent_ui.agent_workspace_runs
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
create policy agent_workspace_run_events_scope on sonik_agent_ui.agent_workspace_run_events
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
