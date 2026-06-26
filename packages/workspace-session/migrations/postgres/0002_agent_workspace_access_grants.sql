-- Sonik Agent UI workspace sharing and access-audit v0
-- Target: additive schema over 0001_agent_workspace_persistence.sql.
-- Runtime contract: application code must set app.organization_id and app.user_id
-- from a trusted server-side auth/org resolver before touching these tables.
-- Browser page context is display/context only and must never set these values.

create or replace function sonik_agent_ui.is_active_access_grant(
  p_status text,
  p_expires_at timestamptz,
  p_revoked_at timestamptz
)
returns boolean
language sql
stable
as $$
  select p_status = 'active'
    and p_revoked_at is null
    and (p_expires_at is null or p_expires_at > now())
$$;

create or replace function sonik_agent_ui.current_principal_matches_grant(
  p_grantee_type text,
  p_grantee_organization_id text,
  p_grantee_user_id text
)
returns boolean
language sql
stable
as $$
  select case
    when p_grantee_type = 'user' then
      p_grantee_organization_id = sonik_agent_ui.current_organization_id()
      and p_grantee_user_id = sonik_agent_ui.current_user_id()
    when p_grantee_type = 'organization' then
      p_grantee_organization_id = sonik_agent_ui.current_organization_id()
    else false
  end
$$;

create table if not exists sonik_agent_ui.agent_workspace_access_grants (
  id text not null,
  organization_id text not null,
  user_id text not null,
  resource_type text not null check (resource_type in ('session', 'document', 'artifact', 'workspace')),
  resource_id text not null,
  grantee_type text not null check (grantee_type in ('user', 'organization', 'external_identity')),
  grantee_organization_id text,
  grantee_user_id text,
  external_email text,
  external_domain text,
  role text not null default 'viewer' check (role in ('viewer', 'commenter', 'editor', 'owner')),
  permissions jsonb not null default '{}'::jsonb,
  policy_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('pending', 'active', 'revoked', 'expired')),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by_organization_id text,
  revoked_by_user_id text,
  created_by_organization_id text not null,
  created_by_user_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  check (
    (grantee_type = 'user' and grantee_organization_id is not null and grantee_user_id is not null and external_email is null)
    or (grantee_type = 'organization' and grantee_organization_id is not null and grantee_user_id is null and external_email is null)
    or (grantee_type = 'external_identity' and external_email is not null)
  ),
  check ((status = 'revoked') = (revoked_at is not null))
);

comment on table sonik_agent_ui.agent_workspace_access_grants is
  'Resource-owner scoped sharing grants for sessions, documents, artifacts, and future workspace resources. organization_id/user_id identify the resource owner; grantee fields identify who can access.';
comment on column sonik_agent_ui.agent_workspace_access_grants.permissions is
  'Extensible permission metadata. Enforceable access decisions should still be represented by relational fields plus policy checks, not JSON alone.';
comment on column sonik_agent_ui.agent_workspace_access_grants.policy_snapshot is
  'Point-in-time policy context used to explain why the grant was created or changed.';

create or replace function sonik_agent_ui.current_principal_has_active_resource_grant(
  p_owner_organization_id text,
  p_owner_user_id text,
  p_resource_type text,
  p_resource_id text
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from sonik_agent_ui.agent_workspace_access_grants grant_row
    where grant_row.organization_id = p_owner_organization_id
      and grant_row.user_id = p_owner_user_id
      and grant_row.resource_type = p_resource_type
      and grant_row.resource_id = p_resource_id
      and sonik_agent_ui.is_active_access_grant(grant_row.status, grant_row.expires_at, grant_row.revoked_at)
      and sonik_agent_ui.current_principal_matches_grant(
        grant_row.grantee_type,
        grant_row.grantee_organization_id,
        grant_row.grantee_user_id
      )
  )
$$;

create table if not exists sonik_agent_ui.agent_workspace_access_grant_audit (
  id text not null,
  organization_id text not null,
  user_id text not null,
  grant_id text,
  resource_type text not null check (resource_type in ('session', 'document', 'artifact', 'workspace')),
  resource_id text not null,
  event text not null check (event in (
    'grant_created',
    'grant_updated',
    'grant_revoked',
    'grant_expired',
    'accessed',
    'denied',
    'role_changed',
    'external_invite_sent',
    'external_invite_accepted'
  )),
  actor_type text not null default 'user' check (actor_type in ('user', 'system', 'external_identity')),
  actor_organization_id text,
  actor_user_id text,
  actor_external_email text,
  target_grantee_type text check (target_grantee_type in ('user', 'organization', 'external_identity')),
  target_grantee_organization_id text,
  target_grantee_user_id text,
  target_external_email text,
  before_state jsonb,
  after_state jsonb,
  decision jsonb not null default '{}'::jsonb,
  request_id text,
  reason text,
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id, id),
  foreign key (organization_id, user_id, grant_id)
    references sonik_agent_ui.agent_workspace_access_grants (organization_id, user_id, id)
    on delete set null (grant_id)
);

comment on table sonik_agent_ui.agent_workspace_access_grant_audit is
  'Append-oriented audit trail for grant creation, mutation, revocation, access, and denial decisions. organization_id/user_id identify the resource owner.';
comment on column sonik_agent_ui.agent_workspace_access_grant_audit.decision is
  'Policy decision metadata such as allow/deny reason, effective role, policy sources, and delegation context.';

create index if not exists agent_workspace_access_grants_resource_idx
  on sonik_agent_ui.agent_workspace_access_grants (organization_id, user_id, resource_type, resource_id, status);
create index if not exists agent_workspace_access_grants_user_grantee_idx
  on sonik_agent_ui.agent_workspace_access_grants (grantee_organization_id, grantee_user_id, status, expires_at)
  where grantee_type = 'user';
create index if not exists agent_workspace_access_grants_org_grantee_idx
  on sonik_agent_ui.agent_workspace_access_grants (grantee_organization_id, status, expires_at)
  where grantee_type = 'organization';
create index if not exists agent_workspace_access_grants_external_grantee_idx
  on sonik_agent_ui.agent_workspace_access_grants (lower(external_email), status, expires_at)
  where grantee_type = 'external_identity';
create index if not exists agent_workspace_access_grant_audit_resource_idx
  on sonik_agent_ui.agent_workspace_access_grant_audit (organization_id, user_id, resource_type, resource_id, created_at desc);
create index if not exists agent_workspace_access_grant_audit_actor_idx
  on sonik_agent_ui.agent_workspace_access_grant_audit (actor_organization_id, actor_user_id, created_at desc);
create index if not exists agent_workspace_access_grant_audit_request_idx
  on sonik_agent_ui.agent_workspace_access_grant_audit (request_id, created_at desc)
  where request_id is not null;

create trigger agent_workspace_access_grants_touch_updated_at
  before update on sonik_agent_ui.agent_workspace_access_grants
  for each row execute function sonik_agent_ui.touch_updated_at();

alter table sonik_agent_ui.agent_workspace_access_grants enable row level security;
alter table sonik_agent_ui.agent_workspace_access_grant_audit enable row level security;
alter table sonik_agent_ui.agent_workspace_access_grants force row level security;
alter table sonik_agent_ui.agent_workspace_access_grant_audit force row level security;

create policy agent_workspace_access_grants_owner_or_grantee_scope
  on sonik_agent_ui.agent_workspace_access_grants
  using (
    (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
    or (
      sonik_agent_ui.is_active_access_grant(status, expires_at, revoked_at)
      and sonik_agent_ui.current_principal_matches_grant(grantee_type, grantee_organization_id, grantee_user_id)
    )
  )
  with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());

create policy agent_workspace_access_grant_audit_owner_or_actor_scope
  on sonik_agent_ui.agent_workspace_access_grant_audit
  using (
    (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
    or (actor_organization_id = sonik_agent_ui.current_organization_id() and actor_user_id = sonik_agent_ui.current_user_id())
  )
  with check (
    (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
    or (
      actor_organization_id = sonik_agent_ui.current_organization_id()
      and actor_user_id = sonik_agent_ui.current_user_id()
      and sonik_agent_ui.current_principal_has_active_resource_grant(organization_id, user_id, resource_type, resource_id)
    )
  );
