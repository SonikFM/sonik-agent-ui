-- Tenant authority for agent definitions. Rows created before this migration
-- have no trustworthy owner, so they are quarantined rather than guessed into
-- an organization. Forced RLS keeps those legacy rows invisible.

alter table sonik_agent_ui.agent_definition_drafts
  add column if not exists organization_id text,
  add column if not exists created_by_user_id text,
  add column if not exists updated_by_user_id text,
  add column if not exists legacy_quarantined_at timestamptz;

alter table sonik_agent_ui.agent_definition_published_versions
  add column if not exists organization_id text,
  add column if not exists created_by_user_id text,
  add column if not exists legacy_quarantined_at timestamptz;

update sonik_agent_ui.agent_definition_drafts
set legacy_quarantined_at = coalesce(legacy_quarantined_at, now())
where organization_id is null;

update sonik_agent_ui.agent_definition_published_versions
set legacy_quarantined_at = coalesce(legacy_quarantined_at, now())
where organization_id is null;

alter table sonik_agent_ui.agent_definition_drafts
  drop constraint if exists agent_definition_drafts_pkey;

alter table sonik_agent_ui.agent_definition_published_versions
  drop constraint if exists agent_definition_published_versions_package_version_id_key;

create unique index if not exists agent_definition_drafts_tenant_agent_key
  on sonik_agent_ui.agent_definition_drafts (organization_id, agent_id)
  where organization_id is not null;

create unique index if not exists agent_definition_published_versions_tenant_package_key
  on sonik_agent_ui.agent_definition_published_versions (organization_id, package_version_id)
  where organization_id is not null;

create index if not exists agent_definition_published_versions_tenant_agent_seq_idx
  on sonik_agent_ui.agent_definition_published_versions (organization_id, agent_id, seq);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'sonik_agent_ui.agent_definition_drafts'::regclass
      and conname = 'agent_definition_drafts_authority_or_quarantine_check'
  ) then
    alter table sonik_agent_ui.agent_definition_drafts
      add constraint agent_definition_drafts_authority_or_quarantine_check check (
        (
          organization_id is not null
          and created_by_user_id is not null
          and updated_by_user_id is not null
          and legacy_quarantined_at is null
        ) or (
          organization_id is null
          and created_by_user_id is null
          and updated_by_user_id is null
          and legacy_quarantined_at is not null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'sonik_agent_ui.agent_definition_published_versions'::regclass
      and conname = 'agent_definition_published_authority_or_quarantine_check'
  ) then
    alter table sonik_agent_ui.agent_definition_published_versions
      add constraint agent_definition_published_authority_or_quarantine_check check (
        (
          organization_id is not null
          and created_by_user_id is not null
          and legacy_quarantined_at is null
        ) or (
          organization_id is null
          and created_by_user_id is null
          and legacy_quarantined_at is not null
        )
      );
  end if;
end
$$;

alter table sonik_agent_ui.agent_definition_drafts enable row level security;
alter table sonik_agent_ui.agent_definition_drafts force row level security;
alter table sonik_agent_ui.agent_definition_published_versions enable row level security;
alter table sonik_agent_ui.agent_definition_published_versions force row level security;

drop policy if exists agent_definition_drafts_tenant_scope on sonik_agent_ui.agent_definition_drafts;
create policy agent_definition_drafts_tenant_scope on sonik_agent_ui.agent_definition_drafts
  using (organization_id = sonik_agent_ui.current_organization_id())
  with check (
    organization_id = sonik_agent_ui.current_organization_id()
    and created_by_user_id is not null
    and updated_by_user_id = sonik_agent_ui.current_user_id()
    and legacy_quarantined_at is null
  );

drop policy if exists agent_definition_published_versions_tenant_scope on sonik_agent_ui.agent_definition_published_versions;
create policy agent_definition_published_versions_tenant_scope on sonik_agent_ui.agent_definition_published_versions
  using (organization_id = sonik_agent_ui.current_organization_id())
  with check (
    organization_id = sonik_agent_ui.current_organization_id()
    and created_by_user_id = sonik_agent_ui.current_user_id()
    and legacy_quarantined_at is null
  );
