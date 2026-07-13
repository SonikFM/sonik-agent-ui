-- Sonik Agent UI: durable agent-definition store (P0 #1,
-- production-readiness-agent-creation-2026-07-13.md). Shares the
-- sonik_agent_ui schema/migration mechanism with agent_workspace_* even
-- though definitions are not session state -- see scripts/run-postgres-migrations.mjs.
--
-- org scoping seam: no organization_id column yet (auth/org context is a
-- blocking dependency owned by the credentials lane, D002/D020 doctrine).
-- When it lands: add organization_id text not null to both tables, repoint
-- agent_definition_drafts' primary key to (organization_id, agent_id), and
-- add organization_id to agent_definition_published_versions with an index.

create schema if not exists sonik_agent_ui;

create table if not exists sonik_agent_ui.agent_definition_drafts (
  agent_id text primary key,
  definition jsonb not null,
  updated_at timestamptz not null default now()
);

-- Published versions are APPEND-ONLY: package_version_id is immutable (D002),
-- republishing the same one must be rejected, never overwritten. `seq` gives
-- stable insertion-order for "most recent" resolution independent of
-- same-millisecond created_at collisions.
create table if not exists sonik_agent_ui.agent_definition_published_versions (
  seq bigserial primary key,
  package_version_id text not null unique,
  agent_id text not null,
  version jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_definition_published_versions_agent_id_seq_idx
  on sonik_agent_ui.agent_definition_published_versions (agent_id, seq);
