alter table sonik_agent_ui.agent_workflow_effect_claims
  add column if not exists effect_namespace text,
  add column if not exists external_effect_key_digest text,
  add column if not exists command_id text,
  add column if not exists resolved_input_hash text;

update sonik_agent_ui.agent_workflow_effect_claims
set effect_namespace = coalesce(effect_namespace, 'workflow-run-v1'),
    external_effect_key_digest = coalesce(external_effect_key_digest, 'sha256:' || encode(sha256(convert_to(idempotency_key, 'UTF8')), 'hex')),
    command_id = coalesce(command_id, 'legacy:' || logical_effect_id),
    resolved_input_hash = coalesce(resolved_input_hash, 'sha256:' || encode(sha256(convert_to(idempotency_key, 'UTF8')), 'hex'));

alter table sonik_agent_ui.agent_workflow_effect_claims
  alter column effect_namespace set not null,
  alter column external_effect_key_digest set not null,
  alter column command_id set not null,
  alter column resolved_input_hash set not null;

create unique index if not exists agent_workflow_effect_claims_external_identity_idx
  on sonik_agent_ui.agent_workflow_effect_claims
  (organization_id, effect_namespace, external_effect_key_digest);

drop policy if exists agent_workflow_effect_claims_scope on sonik_agent_ui.agent_workflow_effect_claims;
create policy agent_workflow_effect_claims_scope on sonik_agent_ui.agent_workflow_effect_claims
  using (organization_id = sonik_agent_ui.current_organization_id())
  with check (organization_id = sonik_agent_ui.current_organization_id());
