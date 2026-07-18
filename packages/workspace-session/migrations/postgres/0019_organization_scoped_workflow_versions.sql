begin;

-- ponytail: take one upgrade-time lock so history reconciliation and the new identity are atomic.
lock table sonik_agent_ui.workflow_definition_published_versions in access exclusive mode;
lock table sonik_agent_ui.agent_workflow_runs in access exclusive mode;
alter table sonik_agent_ui.workflow_definition_published_versions disable row level security;
alter table sonik_agent_ui.agent_workflow_runs disable row level security;
alter table sonik_agent_ui.workflow_definition_published_versions disable trigger workflow_definition_versions_immutable;

do $$
declare
  conflicting_version record;
  candidate_number bigint;
  candidate_version_id text;
begin
  for conflicting_version in
    select
      organization_id,
      user_id,
      workflow_id,
      workflow_version_id,
      row_number() over (
        partition by organization_id, workflow_version_id
        order by published_at, user_id
      ) as duplicate_rank
    from sonik_agent_ui.workflow_definition_published_versions
    order by organization_id, workflow_version_id, published_at, user_id
  loop
    if conflicting_version.duplicate_rank > 1 then
      candidate_number := conflicting_version.duplicate_rank - 1;
      loop
        candidate_version_id := conflicting_version.workflow_version_id || '~legacy-' || candidate_number::text;
        exit when not exists (
          select 1
          from sonik_agent_ui.workflow_definition_published_versions
          where organization_id = conflicting_version.organization_id
            and workflow_version_id = candidate_version_id
        );
        candidate_number := candidate_number + 1;
      end loop;

      update sonik_agent_ui.agent_workflow_runs
      set workflow_version_id = candidate_version_id
      where organization_id = conflicting_version.organization_id
        and user_id = conflicting_version.user_id
        and workflow_id = conflicting_version.workflow_id
        and workflow_version_id = conflicting_version.workflow_version_id;

      update sonik_agent_ui.workflow_definition_published_versions
      set workflow_version_id = candidate_version_id,
          dependency_pins = jsonb_set(dependency_pins, '{workflowVersionId}', to_jsonb(candidate_version_id), true)
      where organization_id = conflicting_version.organization_id
        and user_id = conflicting_version.user_id
        and workflow_version_id = conflicting_version.workflow_version_id;
    end if;
  end loop;
end
$$;

alter table sonik_agent_ui.workflow_definition_published_versions enable trigger workflow_definition_versions_immutable;
alter table sonik_agent_ui.workflow_definition_published_versions enable row level security;
alter table sonik_agent_ui.workflow_definition_published_versions force row level security;
alter table sonik_agent_ui.agent_workflow_runs enable row level security;
alter table sonik_agent_ui.agent_workflow_runs force row level security;

alter table sonik_agent_ui.workflow_definition_published_versions
  drop constraint if exists workflow_definition_versions_org_version_guard,
  add constraint workflow_definition_versions_org_version_guard
    unique (organization_id, workflow_version_id);

commit;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'sonik_agent_ui.workflow_definition_published_versions'::regclass
      and conname = 'workflow_definition_published_versions_pkey'
      and conindid = to_regclass('sonik_agent_ui.workflow_definition_published_versions_organization_version_key')
  ) then
    alter table sonik_agent_ui.workflow_definition_published_versions
      drop constraint workflow_definition_published_versions_pkey;
  end if;
end
$$;

drop index concurrently if exists sonik_agent_ui.workflow_definition_published_versions_organization_version_key;
create unique index concurrently workflow_definition_published_versions_organization_version_key
  on sonik_agent_ui.workflow_definition_published_versions (organization_id, workflow_version_id);

alter table sonik_agent_ui.workflow_definition_published_versions
  drop constraint if exists workflow_definition_published_versions_pkey,
  add constraint workflow_definition_published_versions_pkey
    primary key using index workflow_definition_published_versions_organization_version_key,
  drop constraint workflow_definition_versions_org_version_guard;

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
