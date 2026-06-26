-- Sonik Agent UI cloud workspace persistence v0
-- Target: PostgreSQL-compatible databases with row-level security.
-- Runtime contract: application code must set app.organization_id and app.user_id
-- from a trusted server-side auth/org resolver before touching these tables.
-- Browser page context is display/context only and must never set these values.

create schema if not exists sonik_agent_ui;

create or replace function sonik_agent_ui.current_organization_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('app.organization_id', true), '')
$$;

create or replace function sonik_agent_ui.current_user_id()
returns text
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')
$$;


create or replace function sonik_agent_ui.set_request_context(
  p_organization_id text,
  p_user_id text
)
returns void
language plpgsql
as $$
begin
  if nullif(p_organization_id, '') is null then
    raise exception 'sonik_agent_ui.set_request_context requires organization id';
  end if;
  if nullif(p_user_id, '') is null then
    raise exception 'sonik_agent_ui.set_request_context requires user id';
  end if;

  perform set_config('app.organization_id', p_organization_id, true);
  perform set_config('app.user_id', p_user_id, true);
end;
$$;

create or replace function sonik_agent_ui.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists sonik_agent_ui.agent_workspace_sessions (
  id text not null,
  organization_id text not null,
  user_id text not null,
  host_session_id text,
  name text not null default 'New chat',
  mode text not null default 'chat' check (mode in ('chat', 'artifact', 'document', 'research')),
  archived boolean not null default false,
  is_important boolean not null default false,
  folder text,
  message_count integer not null default 0 check (message_count >= 0),
  active_document_id text,
  active_artifact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_accessed timestamptz not null default now(),
  last_message_at timestamptz,
  primary key (organization_id, user_id, id)
);

create table if not exists sonik_agent_ui.agent_workspace_messages (
  id text not null,
  organization_id text not null,
  user_id text not null,
  session_id text not null,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content text not null default '',
  parts jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  foreign key (organization_id, user_id, session_id)
    references sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
    on delete cascade
);

create table if not exists sonik_agent_ui.agent_workspace_documents (
  id text not null,
  organization_id text not null,
  user_id text not null,
  session_id text,
  title text not null default 'Untitled',
  language text not null default 'markdown',
  current_content text not null default '',
  version_count integer not null default 1 check (version_count >= 1),
  is_active boolean not null default true,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  foreign key (organization_id, user_id, session_id)
    references sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
    on delete cascade
);

create table if not exists sonik_agent_ui.agent_workspace_document_versions (
  id text not null,
  organization_id text not null,
  user_id text not null,
  document_id text not null,
  version_number integer not null check (version_number >= 1),
  content text not null default '',
  summary text,
  source text not null default 'user' check (source in ('user', 'ai', 'system')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  unique (organization_id, user_id, document_id, version_number),
  foreign key (organization_id, user_id, document_id)
    references sonik_agent_ui.agent_workspace_documents (organization_id, user_id, id)
    on delete cascade
);

create table if not exists sonik_agent_ui.agent_workspace_artifacts (
  id text not null,
  organization_id text not null,
  user_id text not null,
  session_id text,
  kind text not null check (kind in ('json-render', 'document')),
  title text not null default 'Untitled artifact',
  content jsonb not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  foreign key (organization_id, user_id, session_id)
    references sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
    on delete cascade
);

create table if not exists sonik_agent_ui.agent_workspace_artifact_versions (
  id text not null,
  organization_id text not null,
  user_id text not null,
  artifact_id text not null,
  version_number integer not null check (version_number >= 1),
  content jsonb not null,
  summary text,
  source text not null default 'ai' check (source in ('user', 'ai', 'system')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  unique (organization_id, user_id, artifact_id, version_number),
  foreign key (organization_id, user_id, artifact_id)
    references sonik_agent_ui.agent_workspace_artifacts (organization_id, user_id, id)
    on delete cascade
);

create table if not exists sonik_agent_ui.agent_workspace_tool_calls (
  id text not null,
  organization_id text not null,
  user_id text not null,
  session_id text,
  message_id text,
  tool_name text not null,
  source text not null default 'unknown' check (source in ('orpc', 'openapi', 'mcp', 'sandbox', 'local-ui', 'unknown')),
  effect text not null default 'unknown' check (effect in ('read', 'write', 'destructive', 'environment', 'unknown')),
  status text not null default 'pending' check (status in ('pending', 'success', 'error')),
  input jsonb,
  output jsonb,
  error text,
  artifact_id text,
  document_id text,
  request_id text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (organization_id, user_id, id),
  foreign key (organization_id, user_id, session_id)
    references sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
    on delete cascade,
  foreign key (organization_id, user_id, message_id)
    references sonik_agent_ui.agent_workspace_messages (organization_id, user_id, id)
    on delete set null (message_id),
  foreign key (organization_id, user_id, artifact_id)
    references sonik_agent_ui.agent_workspace_artifacts (organization_id, user_id, id)
    on delete set null (artifact_id),
  foreign key (organization_id, user_id, document_id)
    references sonik_agent_ui.agent_workspace_documents (organization_id, user_id, id)
    on delete set null (document_id)
);

create table if not exists sonik_agent_ui.agent_workspace_layout_snapshots (
  id text not null,
  organization_id text not null,
  user_id text not null,
  session_id text not null,
  active_pane_id text,
  active_artifact_id text,
  layout jsonb not null,
  source text not null default 'user' check (source in ('user', 'ai', 'system')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  foreign key (organization_id, user_id, session_id)
    references sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
    on delete cascade,
  foreign key (organization_id, user_id, active_artifact_id)
    references sonik_agent_ui.agent_workspace_artifacts (organization_id, user_id, id)
    on delete set null (active_artifact_id)
);

create table if not exists sonik_agent_ui.agent_workspace_page_context_snapshots (
  id text not null,
  organization_id text not null,
  user_id text not null,
  session_id text not null,
  source text not null default 'browser-page-context' check (source in ('browser-page-context', 'trusted-host-adapter', 'system')),
  authority text not null default 'display-only' check (authority in ('display-only', 'trusted-server-derived')),
  check (source <> 'browser-page-context' or authority = 'display-only'),
  check (authority <> 'trusted-server-derived' or source in ('trusted-host-adapter', 'system')),
  route text,
  surface text,
  page_type text,
  active_entity jsonb,
  command_families text[] not null default '{}',
  skill_families text[] not null default '{}',
  visible_actions text[] not null default '{}',
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  foreign key (organization_id, user_id, session_id)
    references sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
    on delete cascade
);

comment on column sonik_agent_ui.agent_workspace_page_context_snapshots.authority is
  'Browser page context is display-only and not an auth/org/scope authority. trusted-server-derived rows must come from a server-owned host adapter after auth/org/policy resolution.';

create table if not exists sonik_agent_ui.agent_workspace_telemetry_events (
  id text not null,
  organization_id text not null,
  user_id text not null,
  session_id text,
  request_id text,
  source text not null,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  ok boolean,
  error text,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  foreign key (organization_id, user_id, session_id)
    references sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
    on delete cascade
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_workspace_sessions_active_document_scope_fk'
      and conrelid = 'sonik_agent_ui.agent_workspace_sessions'::regclass
  ) then
    alter table sonik_agent_ui.agent_workspace_sessions
      add constraint agent_workspace_sessions_active_document_scope_fk
      foreign key (organization_id, user_id, active_document_id)
      references sonik_agent_ui.agent_workspace_documents (organization_id, user_id, id)
      on delete set null (active_document_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_workspace_sessions_active_artifact_scope_fk'
      and conrelid = 'sonik_agent_ui.agent_workspace_sessions'::regclass
  ) then
    alter table sonik_agent_ui.agent_workspace_sessions
      add constraint agent_workspace_sessions_active_artifact_scope_fk
      foreign key (organization_id, user_id, active_artifact_id)
      references sonik_agent_ui.agent_workspace_artifacts (organization_id, user_id, id)
      on delete set null (active_artifact_id);
  end if;
end
$$;

create index if not exists agent_workspace_sessions_scope_recent_idx
  on sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, archived, last_accessed desc);
create index if not exists agent_workspace_messages_session_created_idx
  on sonik_agent_ui.agent_workspace_messages (organization_id, user_id, session_id, created_at asc);
create index if not exists agent_workspace_documents_session_recent_idx
  on sonik_agent_ui.agent_workspace_documents (organization_id, user_id, session_id, archived, updated_at desc);
create index if not exists agent_workspace_document_versions_recent_idx
  on sonik_agent_ui.agent_workspace_document_versions (organization_id, user_id, document_id, version_number desc);
create index if not exists agent_workspace_artifacts_session_recent_idx
  on sonik_agent_ui.agent_workspace_artifacts (organization_id, user_id, session_id, updated_at desc);
create index if not exists agent_workspace_artifact_versions_recent_idx
  on sonik_agent_ui.agent_workspace_artifact_versions (organization_id, user_id, artifact_id, version_number desc);
create index if not exists agent_workspace_tool_calls_session_created_idx
  on sonik_agent_ui.agent_workspace_tool_calls (organization_id, user_id, session_id, created_at asc);
create index if not exists agent_workspace_layout_snapshots_session_created_idx
  on sonik_agent_ui.agent_workspace_layout_snapshots (organization_id, user_id, session_id, created_at desc);
create index if not exists agent_workspace_page_context_session_created_idx
  on sonik_agent_ui.agent_workspace_page_context_snapshots (organization_id, user_id, session_id, created_at desc);
create index if not exists agent_workspace_telemetry_session_created_idx
  on sonik_agent_ui.agent_workspace_telemetry_events (organization_id, user_id, session_id, created_at desc);

create trigger agent_workspace_sessions_touch_updated_at
  before update on sonik_agent_ui.agent_workspace_sessions
  for each row execute function sonik_agent_ui.touch_updated_at();
create trigger agent_workspace_documents_touch_updated_at
  before update on sonik_agent_ui.agent_workspace_documents
  for each row execute function sonik_agent_ui.touch_updated_at();
create trigger agent_workspace_artifacts_touch_updated_at
  before update on sonik_agent_ui.agent_workspace_artifacts
  for each row execute function sonik_agent_ui.touch_updated_at();

alter table sonik_agent_ui.agent_workspace_sessions enable row level security;
alter table sonik_agent_ui.agent_workspace_messages enable row level security;
alter table sonik_agent_ui.agent_workspace_documents enable row level security;
alter table sonik_agent_ui.agent_workspace_document_versions enable row level security;
alter table sonik_agent_ui.agent_workspace_artifacts enable row level security;
alter table sonik_agent_ui.agent_workspace_artifact_versions enable row level security;
alter table sonik_agent_ui.agent_workspace_tool_calls enable row level security;
alter table sonik_agent_ui.agent_workspace_layout_snapshots enable row level security;
alter table sonik_agent_ui.agent_workspace_page_context_snapshots enable row level security;
alter table sonik_agent_ui.agent_workspace_telemetry_events enable row level security;

alter table sonik_agent_ui.agent_workspace_sessions force row level security;
alter table sonik_agent_ui.agent_workspace_messages force row level security;
alter table sonik_agent_ui.agent_workspace_documents force row level security;
alter table sonik_agent_ui.agent_workspace_document_versions force row level security;
alter table sonik_agent_ui.agent_workspace_artifacts force row level security;
alter table sonik_agent_ui.agent_workspace_artifact_versions force row level security;
alter table sonik_agent_ui.agent_workspace_tool_calls force row level security;
alter table sonik_agent_ui.agent_workspace_layout_snapshots force row level security;
alter table sonik_agent_ui.agent_workspace_page_context_snapshots force row level security;
alter table sonik_agent_ui.agent_workspace_telemetry_events force row level security;

create policy agent_workspace_sessions_scope on sonik_agent_ui.agent_workspace_sessions
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
create policy agent_workspace_messages_scope on sonik_agent_ui.agent_workspace_messages
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
create policy agent_workspace_documents_scope on sonik_agent_ui.agent_workspace_documents
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
create policy agent_workspace_document_versions_scope on sonik_agent_ui.agent_workspace_document_versions
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
create policy agent_workspace_artifacts_scope on sonik_agent_ui.agent_workspace_artifacts
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
create policy agent_workspace_artifact_versions_scope on sonik_agent_ui.agent_workspace_artifact_versions
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
create policy agent_workspace_tool_calls_scope on sonik_agent_ui.agent_workspace_tool_calls
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
create policy agent_workspace_layout_snapshots_scope on sonik_agent_ui.agent_workspace_layout_snapshots
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
create policy agent_workspace_page_context_snapshots_scope on sonik_agent_ui.agent_workspace_page_context_snapshots
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
create policy agent_workspace_telemetry_events_scope on sonik_agent_ui.agent_workspace_telemetry_events
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
