alter table sonik_agent_ui.agent_workspace_sessions
  add column if not exists deleting_at timestamptz;

comment on column sonik_agent_ui.agent_workspace_sessions.deleting_at is
  'Durable lifecycle fence: file creation must stop once session deletion begins.';
