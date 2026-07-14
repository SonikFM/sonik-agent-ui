-- Enforce user-turn provenance for every run write, including raw SQL callers.
-- user_message_id remains nullable for legacy runs; message_id remains the assistant id.

create or replace function sonik_agent_ui.enforce_run_user_message_provenance()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.user_message_id is not null and not exists (
    select 1
    from sonik_agent_ui.agent_workspace_messages as message
    where message.organization_id = new.organization_id
      and message.user_id = new.user_id
      and message.id = new.user_message_id
      and message.session_id = new.session_id
      and message.role = 'user'
  ) then
    raise exception using
      errcode = '23503',
      constraint = 'agent_workspace_runs_user_message_provenance_check',
      message = 'run user_message_id must reference a user message in the same session';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_run_user_message_provenance on sonik_agent_ui.agent_workspace_runs;
create trigger enforce_run_user_message_provenance
before insert or update of organization_id, user_id, session_id, user_message_id
on sonik_agent_ui.agent_workspace_runs
for each row execute function sonik_agent_ui.enforce_run_user_message_provenance();
