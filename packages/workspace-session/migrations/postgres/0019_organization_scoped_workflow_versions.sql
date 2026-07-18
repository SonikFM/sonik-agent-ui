drop index concurrently if exists sonik_agent_ui.workflow_definition_published_versions_organization_version_key;
create unique index concurrently workflow_definition_published_versions_organization_version_key
  on sonik_agent_ui.workflow_definition_published_versions (organization_id, workflow_version_id);

alter table sonik_agent_ui.workflow_definition_published_versions
  drop constraint workflow_definition_published_versions_pkey,
  add constraint workflow_definition_published_versions_pkey
    primary key using index workflow_definition_published_versions_organization_version_key;

drop index concurrently if exists sonik_agent_ui.workflow_definition_versions_owner_workflow_idx;
do $$
declare
  constraint_name name;
begin
  select conname into constraint_name
  from pg_constraint
  where conindid = to_regclass('sonik_agent_ui.workflow_definition_versions_organization_workflow_idx')
    and conrelid = 'sonik_agent_ui.workflow_definition_published_versions'::regclass
    and conname = 'workflow_definition_versions_organization_workflow_idx';

  if constraint_name is not null then
    execute format(
      'alter table sonik_agent_ui.workflow_definition_published_versions drop constraint %I',
      constraint_name
    );
  end if;
end
$$;
drop index concurrently if exists sonik_agent_ui.workflow_definition_versions_organization_workflow_idx;
create index concurrently workflow_definition_versions_organization_workflow_idx
  on sonik_agent_ui.workflow_definition_published_versions (organization_id, workflow_id, published_at desc);

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

alter table sonik_agent_ui.workflow_definition_published_versions enable row level security;
alter table sonik_agent_ui.workflow_definition_published_versions force row level security;

do $$
declare
  policy_name text;
begin
  for policy_name in
    select polname
    from pg_policy
    where polrelid = 'sonik_agent_ui.workflow_definition_published_versions'::regclass
  loop
    execute format(
      'drop policy %I on sonik_agent_ui.workflow_definition_published_versions',
      policy_name
    );
  end loop;
end
$$;

create policy workflow_definition_versions_scope on sonik_agent_ui.workflow_definition_published_versions
  using (organization_id = sonik_agent_ui.current_organization_id())
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
