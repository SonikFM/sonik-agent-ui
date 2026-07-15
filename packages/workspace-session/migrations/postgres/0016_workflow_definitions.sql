create schema if not exists sonik_agent_ui;

create table if not exists sonik_agent_ui.workflow_definition_drafts (
  organization_id text not null,
  user_id text not null,
  workflow_id text not null,
  draft_revision bigint not null default 0 check (draft_revision >= 0),
  definition_digest text not null check (definition_digest ~ '^sha256:[a-f0-9]{64}$'),
  definition jsonb not null,
  archived_at timestamptz,
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, workflow_id)
);

create table if not exists sonik_agent_ui.workflow_definition_published_versions (
  organization_id text not null,
  user_id text not null,
  workflow_id text not null,
  workflow_version_id text not null,
  source_draft_revision bigint not null check (source_draft_revision >= 0),
  definition_digest text not null check (definition_digest ~ '^sha256:[a-f0-9]{64}$'),
  definition jsonb not null,
  dependency_pins jsonb not null check (jsonb_typeof(dependency_pins) = 'object'),
  published_by text not null,
  published_at timestamptz not null default now(),
  primary key (organization_id, user_id, workflow_version_id)
);

create index if not exists workflow_definition_drafts_owner_updated_idx
  on sonik_agent_ui.workflow_definition_drafts (organization_id, user_id, updated_at desc);
create index if not exists workflow_definition_versions_owner_workflow_idx
  on sonik_agent_ui.workflow_definition_published_versions (organization_id, user_id, workflow_id, published_at desc);

create or replace function sonik_agent_ui.reject_published_workflow_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'published workflow versions are immutable' using errcode = '55000';
end
$$;

drop trigger if exists workflow_definition_versions_immutable on sonik_agent_ui.workflow_definition_published_versions;
create trigger workflow_definition_versions_immutable
before update or delete on sonik_agent_ui.workflow_definition_published_versions
for each row execute function sonik_agent_ui.reject_published_workflow_mutation();

alter table sonik_agent_ui.workflow_definition_drafts enable row level security;
alter table sonik_agent_ui.workflow_definition_drafts force row level security;
alter table sonik_agent_ui.workflow_definition_published_versions enable row level security;
alter table sonik_agent_ui.workflow_definition_published_versions force row level security;

drop policy if exists workflow_definition_drafts_scope on sonik_agent_ui.workflow_definition_drafts;
create policy workflow_definition_drafts_scope on sonik_agent_ui.workflow_definition_drafts
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());

drop policy if exists workflow_definition_versions_scope on sonik_agent_ui.workflow_definition_published_versions;
create policy workflow_definition_versions_scope on sonik_agent_ui.workflow_definition_published_versions
  using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
