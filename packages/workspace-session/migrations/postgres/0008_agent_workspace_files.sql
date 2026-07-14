-- Sonik Agent UI tenant- and session-scoped file catalog v0
-- Stores file metadata and opaque server references only; never file bytes.
-- Runtime contract: application code must set app.organization_id and app.user_id
-- from a trusted server-side auth/org resolver before touching this table.

create table if not exists sonik_agent_ui.agent_workspace_files (
  id text not null,
  organization_id text not null,
  user_id text not null,
  session_id text not null,
  storage_key text not null,
  original_filename text not null,
  media_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  checksum text,
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'deleted')),
  provider_references jsonb,
  provider_references_expires_at timestamptz,
  ready_at timestamptz,
  failed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  unique (organization_id, user_id, storage_key),
  foreign key (organization_id, user_id, session_id)
    references sonik_agent_ui.agent_workspace_sessions (organization_id, user_id, id)
    on delete cascade
);

comment on table sonik_agent_ui.agent_workspace_files is
  'Metadata-only Agent UI file catalog. storage_key and provider_references are opaque server-owned references; file bytes are stored elsewhere.';

create index if not exists agent_workspace_files_session_created_idx
  on sonik_agent_ui.agent_workspace_files (organization_id, user_id, session_id, created_at desc);
create index if not exists agent_workspace_files_status_updated_idx
  on sonik_agent_ui.agent_workspace_files (organization_id, user_id, status, updated_at desc);
create index if not exists agent_workspace_files_provider_expiry_idx
  on sonik_agent_ui.agent_workspace_files (provider_references_expires_at)
  where provider_references is not null;

drop trigger if exists agent_workspace_files_touch_updated_at on sonik_agent_ui.agent_workspace_files;
create trigger agent_workspace_files_touch_updated_at
  before update on sonik_agent_ui.agent_workspace_files
  for each row execute function sonik_agent_ui.touch_updated_at();

alter table sonik_agent_ui.agent_workspace_files enable row level security;
alter table sonik_agent_ui.agent_workspace_files force row level security;

drop policy if exists agent_workspace_files_scope on sonik_agent_ui.agent_workspace_files;
create policy agent_workspace_files_scope on sonik_agent_ui.agent_workspace_files
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
