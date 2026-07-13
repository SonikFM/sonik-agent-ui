-- Sonik Agent UI: durable knowledge store (P0 #1,
-- production-readiness-agent-creation-2026-07-13.md). Knowledge v1 doctrine
-- is small, human-readable markdown/plaintext files -- no vectors/chunking --
-- so content lives in Neon text alongside metadata rather than splitting
-- across FS + DB; see knowledge-store.ts's createNeonKnowledgeStore.
--
-- org scoping seam: no organization_id column yet, same rationale/upgrade
-- path as 0005_agent_definitions.sql.

create schema if not exists sonik_agent_ui;

create table if not exists sonik_agent_ui.agent_knowledge_stores (
  store_id text primary key,
  title text not null,
  created_at timestamptz not null default now()
);

create table if not exists sonik_agent_ui.agent_knowledge_files (
  store_id text not null references sonik_agent_ui.agent_knowledge_stores (store_id) on delete cascade,
  file_id text not null,
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  primary key (store_id, file_id)
);
