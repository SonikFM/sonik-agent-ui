-- Deterministic user-turn provenance for persisted agent runs.
-- message_id remains the assistant message id used by run reattachment.

alter table sonik_agent_ui.agent_workspace_runs
  add column if not exists user_message_id text;

alter table sonik_agent_ui.agent_workspace_runs
  drop constraint if exists agent_workspace_runs_user_message_id_fkey,
  add constraint agent_workspace_runs_user_message_id_fkey
    foreign key (organization_id, user_id, user_message_id)
    references sonik_agent_ui.agent_workspace_messages (organization_id, user_id, id)
    on delete set null (user_message_id);

comment on column sonik_agent_ui.agent_workspace_runs.user_message_id is
  'User message that supplied this run context. Nullable for legacy runs; message_id remains the assistant message id used for reattachment.';
