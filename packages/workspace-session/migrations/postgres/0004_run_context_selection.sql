-- Sonik Agent UI composer run-context selection persistence v0
-- Target: additive schema over 0003_agent_run_lifecycle.sql.
-- Runtime contract: application code must set app.organization_id and app.user_id
-- from a trusted server-side auth/org resolver before touching these tables.
--
-- The composer context selection (user-attached context chips + the authoritative
-- record of removed auto-seeded chips) is the per-turn context the user chose. It
-- is captured on the run so it can be replayed as provenance and re-hydrated on
-- reload (removed chips stay removed). Nullable: absent for runs created before
-- this migration and for turns sent with no explicit selection (implicit-context
-- fallback). jsonb mirrors AgentRunContextSelection ({ items, dismissedAutoSeedIds }).

alter table sonik_agent_ui.agent_workspace_runs
  add column if not exists context_selection jsonb;

comment on column sonik_agent_ui.agent_workspace_runs.context_selection is
  'Composer AgentRunContextSelection for this turn ({ items, dismissedAutoSeedIds }); null when no explicit selection was sent. Explicit selection wins over implicit host/page context.';
