#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPgEnv } from "./lib/postgres-connection.mjs";

const repoRoot = process.cwd();
const databaseUrl = process.env.DATABASE_URL;
const dryRun = process.argv.includes("--dry-run");

const migrations = [
	{
		version: "0001",
		name: "agent_workspace_persistence",
		file: "packages/workspace-session/migrations/postgres/0001_agent_workspace_persistence.sql",
		baselineCheck: `
			select (
				to_regclass('sonik_agent_ui.agent_workspace_sessions') is not null
				and to_regclass('sonik_agent_ui.agent_workspace_messages') is not null
				and to_regclass('sonik_agent_ui.agent_workspace_documents') is not null
				and to_regclass('sonik_agent_ui.agent_workspace_artifacts') is not null
				and to_regclass('sonik_agent_ui.agent_workspace_telemetry_events') is not null
			)::text
		`,
	},
	{
		version: "0002",
		name: "agent_workspace_access_grants",
		file: "packages/workspace-session/migrations/postgres/0002_agent_workspace_access_grants.sql",
		baselineCheck: `
			select (
				to_regclass('sonik_agent_ui.agent_workspace_access_grants') is not null
				and to_regclass('sonik_agent_ui.agent_workspace_access_grant_audit') is not null
			)::text
		`,
	},
	{
		version: "0003",
		name: "agent_run_lifecycle",
		file: "packages/workspace-session/migrations/postgres/0003_agent_run_lifecycle.sql",
		baselineCheck: `
				select (
					to_regclass('sonik_agent_ui.agent_workspace_runs') is not null
					and to_regclass('sonik_agent_ui.agent_workspace_run_events') is not null
				)::text
			`,
	},
	{
		version: "0004",
		name: "run_context_selection",
		file: "packages/workspace-session/migrations/postgres/0004_run_context_selection.sql",
		baselineCheck: `
				select (
					exists (
						select 1 from information_schema.columns
						where table_schema = 'sonik_agent_ui'
							and table_name = 'agent_workspace_runs'
							and column_name = 'context_selection'
					)
				)::text
			`,
	},
	{
		version: "0005",
		name: "agent_definitions",
		file: "packages/workspace-session/migrations/postgres/0005_agent_definitions.sql",
		baselineCheck: `
				select (
					to_regclass('sonik_agent_ui.agent_definition_drafts') is not null
					and to_regclass('sonik_agent_ui.agent_definition_published_versions') is not null
				)::text
			`,
	},
	{
		version: "0006",
		name: "agent_knowledge",
		file: "packages/workspace-session/migrations/postgres/0006_agent_knowledge.sql",
		baselineCheck: `
				select (
					to_regclass('sonik_agent_ui.agent_knowledge_stores') is not null
					and to_regclass('sonik_agent_ui.agent_knowledge_files') is not null
				)::text
			`,
	},
	{
		version: "0007",
		name: "agent_workflow_runs",
		file: "packages/workspace-session/migrations/postgres/0007_agent_workflow_runs.sql",
		baselineCheck: `
				select (
					to_regclass('sonik_agent_ui.agent_workflow_runs') is not null
				)::text
			`,
	},
	{
		version: "0008",
		name: "agent_workspace_files",
		file: "packages/workspace-session/migrations/postgres/0008_agent_workspace_files.sql",
		baselineCheck: `select (to_regclass('sonik_agent_ui.agent_workspace_files') is not null)::text`,
	},
	{
		version: "0009",
		name: "run_user_message_id",
		file: "packages/workspace-session/migrations/postgres/0009_run_user_message_id.sql",
		baselineCheck: `
			select exists (
				select 1 from information_schema.columns
				where table_schema = 'sonik_agent_ui'
					and table_name = 'agent_workspace_runs'
					and column_name = 'user_message_id'
			)::text
		`,
	},
	{
		version: "0010",
		name: "run_user_message_provenance",
		file: "packages/workspace-session/migrations/postgres/0010_run_user_message_provenance.sql",
		baselineCheck: `
			select exists (
				select 1
				from pg_trigger as migration_trigger
				join pg_proc as trigger_function on trigger_function.oid = migration_trigger.tgfoid
				join pg_namespace as function_schema on function_schema.oid = trigger_function.pronamespace
				where migration_trigger.tgrelid = to_regclass('sonik_agent_ui.agent_workspace_runs')
					and migration_trigger.tgname = 'enforce_run_user_message_provenance'
					and not migration_trigger.tgisinternal
					and function_schema.nspname = 'sonik_agent_ui'
					and trigger_function.proname = 'enforce_run_user_message_provenance'
					and not trigger_function.prosecdef
					and trigger_function.proconfig @> array['search_path=pg_catalog']
			)::text
		`,
	},
	{
		version: "0011",
		name: "session_deletion_lifecycle",
		file: "packages/workspace-session/migrations/postgres/0011_session_deletion_lifecycle.sql",
		baselineCheck: `
			select exists (
				select 1 from information_schema.columns
				where table_schema = 'sonik_agent_ui'
					and table_name = 'agent_workspace_sessions'
					and column_name = 'deleting_at'
			)::text
		`,
	},
	{
		version: "0012",
		name: "commit_ledger",
		file: "packages/workspace-session/migrations/postgres/0012_commit_ledger.sql",
		baselineCheck: `
			select (
				to_regclass('sonik_agent_ui.agent_workspace_commit_ledger') is not null
			)::text
		`,
	},
	{
		version: "0013",
		name: "workflow_run_owner_scope",
		file: "packages/workspace-session/migrations/postgres/0013_workflow_run_owner_scope.sql",
		baselineCheck: `
			select (
				exists (
					select 1 from information_schema.columns
					where table_schema = 'sonik_agent_ui'
						and table_name = 'agent_workflow_runs'
						and column_name = 'organization_id'
				)
				and exists (
					select 1 from information_schema.columns
					where table_schema = 'sonik_agent_ui'
						and table_name = 'agent_workflow_runs'
						and column_name = 'user_id'
				)
				and exists (
					select 1 from pg_class
					where oid = to_regclass('sonik_agent_ui.agent_workflow_runs')
						and relrowsecurity
						and relforcerowsecurity
				)
			)::text
		`,
	},
	{
		version: "0014",
		name: "commit_claim_leases",
		file: "packages/workspace-session/migrations/postgres/0014_commit_claim_leases.sql",
		baselineCheck: `
			select (
				to_regclass('sonik_agent_ui.agent_workspace_commit_claims') is not null
			)::text
		`,
	},
	{
		version: "0015",
		name: "agent_definition_tenant_authority",
		file: "packages/workspace-session/migrations/postgres/0015_agent_definition_tenant_authority.sql",
		postApply: `
			do $$
			declare
				owning_constraint text;
			begin
				if to_regclass('sonik_agent_ui.agent_definition_drafts_tenant_agent_key') is not null
					and regexp_replace(lower(pg_get_indexdef(to_regclass('sonik_agent_ui.agent_definition_drafts_tenant_agent_key'))), '[[:space:]()]', '', 'g')
						<> 'createuniqueindexagent_definition_drafts_tenant_agent_keyonsonik_agent_ui.agent_definition_draftsusingbtreeorganization_id,agent_idwhereorganization_idisnotnull'
				then
					select conname into owning_constraint
					from pg_constraint
					where conindid = to_regclass('sonik_agent_ui.agent_definition_drafts_tenant_agent_key');

					if owning_constraint is null then
						drop index sonik_agent_ui.agent_definition_drafts_tenant_agent_key;
					else
						execute format('alter table sonik_agent_ui.agent_definition_drafts drop constraint %I', owning_constraint);
					end if;
				end if;
				if to_regclass('sonik_agent_ui.agent_definition_drafts_tenant_agent_key') is null then
					create unique index agent_definition_drafts_tenant_agent_key
						on sonik_agent_ui.agent_definition_drafts (organization_id, agent_id)
						where organization_id is not null;
				end if;

				if to_regclass('sonik_agent_ui.agent_definition_published_versions_tenant_package_key') is not null
					and regexp_replace(lower(pg_get_indexdef(to_regclass('sonik_agent_ui.agent_definition_published_versions_tenant_package_key'))), '[[:space:]()]', '', 'g')
						<> 'createuniqueindexagent_definition_published_versions_tenant_package_keyonsonik_agent_ui.agent_definition_published_versionsusingbtreeorganization_id,package_version_idwhereorganization_idisnotnull'
				then
					select conname into owning_constraint
					from pg_constraint
					where conindid = to_regclass('sonik_agent_ui.agent_definition_published_versions_tenant_package_key');

					if owning_constraint is null then
						drop index sonik_agent_ui.agent_definition_published_versions_tenant_package_key;
					else
						execute format('alter table sonik_agent_ui.agent_definition_published_versions drop constraint %I', owning_constraint);
					end if;
				end if;
				if to_regclass('sonik_agent_ui.agent_definition_published_versions_tenant_package_key') is null then
					create unique index agent_definition_published_versions_tenant_package_key
						on sonik_agent_ui.agent_definition_published_versions (organization_id, package_version_id)
						where organization_id is not null;
				end if;

				if exists (
					select 1 from pg_constraint
					where conrelid = to_regclass('sonik_agent_ui.agent_definition_drafts')
						and conname = 'agent_definition_drafts_authority_or_quarantine_check'
						and regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]]', '', 'g')
							<> 'check((((organization_idisnotnull)and(created_by_user_idisnotnull)and(updated_by_user_idisnotnull)and(legacy_quarantined_atisnull))or((organization_idisnull)and(created_by_user_idisnull)and(updated_by_user_idisnull)and(legacy_quarantined_atisnotnull))))'
				) then
					alter table sonik_agent_ui.agent_definition_drafts
						drop constraint agent_definition_drafts_authority_or_quarantine_check;
				end if;
				if not exists (
					select 1 from pg_constraint
					where conrelid = 'sonik_agent_ui.agent_definition_drafts'::regclass
						and conname = 'agent_definition_drafts_authority_or_quarantine_check'
				) then
					alter table sonik_agent_ui.agent_definition_drafts
						add constraint agent_definition_drafts_authority_or_quarantine_check check (
							(organization_id is not null and created_by_user_id is not null and updated_by_user_id is not null and legacy_quarantined_at is null)
							or (organization_id is null and created_by_user_id is null and updated_by_user_id is null and legacy_quarantined_at is not null)
						);
				end if;

				if exists (
					select 1 from pg_constraint
					where conrelid = to_regclass('sonik_agent_ui.agent_definition_published_versions')
						and conname = 'agent_definition_published_authority_or_quarantine_check'
						and regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]]', '', 'g')
							<> 'check((((organization_idisnotnull)and(created_by_user_idisnotnull)and(legacy_quarantined_atisnull))or((organization_idisnull)and(created_by_user_idisnull)and(legacy_quarantined_atisnotnull))))'
				) then
					alter table sonik_agent_ui.agent_definition_published_versions
						drop constraint agent_definition_published_authority_or_quarantine_check;
				end if;
				if not exists (
					select 1 from pg_constraint
					where conrelid = 'sonik_agent_ui.agent_definition_published_versions'::regclass
						and conname = 'agent_definition_published_authority_or_quarantine_check'
				) then
					alter table sonik_agent_ui.agent_definition_published_versions
						add constraint agent_definition_published_authority_or_quarantine_check check (
							(organization_id is not null and created_by_user_id is not null and legacy_quarantined_at is null)
							or (organization_id is null and created_by_user_id is null and legacy_quarantined_at is not null)
						);
				end if;
			end
			$$;
		`,
		baselineCheck: `
			select (
				not exists (
					select 1
					from (values
						('agent_definition_drafts', 'organization_id'),
						('agent_definition_drafts', 'created_by_user_id'),
						('agent_definition_drafts', 'updated_by_user_id'),
						('agent_definition_drafts', 'legacy_quarantined_at'),
						('agent_definition_published_versions', 'organization_id'),
						('agent_definition_published_versions', 'created_by_user_id'),
						('agent_definition_published_versions', 'legacy_quarantined_at')
					) as required(table_name, column_name)
					where not exists (
						select 1 from information_schema.columns
						where table_schema = 'sonik_agent_ui'
							and columns.table_name = required.table_name
							and columns.column_name = required.column_name
					)
				)
				and to_regclass('sonik_agent_ui.agent_definition_drafts_tenant_agent_key') is not null
				and to_regclass('sonik_agent_ui.agent_definition_published_versions_tenant_package_key') is not null
				and to_regclass('sonik_agent_ui.agent_definition_published_versions_tenant_agent_seq_idx') is not null
				and not exists (
					select 1
					from (values
						('agent_definition_drafts', 'agent_definition_drafts_authority_or_quarantine_check', 'agent_definition_drafts_tenant_scope'),
						('agent_definition_published_versions', 'agent_definition_published_authority_or_quarantine_check', 'agent_definition_published_versions_tenant_scope')
					) as required(table_name, constraint_name, policy_name)
					where not exists (
						select 1 from pg_class
						where oid = to_regclass('sonik_agent_ui.' || required.table_name)
							and relrowsecurity
							and relforcerowsecurity
					)
					or not exists (
						select 1 from pg_constraint
						where conrelid = to_regclass('sonik_agent_ui.' || required.table_name)
							and conname = required.constraint_name
					)
					or not exists (
						select 1 from pg_policy
						where polrelid = to_regclass('sonik_agent_ui.' || required.table_name)
							and polname = required.policy_name
					)
				)
				and not exists (
					select 1
					from (values
						('agent_definition_drafts_tenant_agent_key', 'createuniqueindexagent_definition_drafts_tenant_agent_keyonsonik_agent_ui.agent_definition_draftsusingbtreeorganization_id,agent_idwhereorganization_idisnotnull'),
						('agent_definition_published_versions_tenant_package_key', 'createuniqueindexagent_definition_published_versions_tenant_package_keyonsonik_agent_ui.agent_definition_published_versionsusingbtreeorganization_id,package_version_idwhereorganization_idisnotnull'),
						('agent_definition_published_versions_tenant_agent_seq_idx', 'createindexagent_definition_published_versions_tenant_agent_seq_idxonsonik_agent_ui.agent_definition_published_versionsusingbtreeorganization_id,agent_id,seq')
					) as required(index_name, index_definition)
					where not exists (
						select 1 from pg_index
						where indexrelid = to_regclass('sonik_agent_ui.' || required.index_name)
							and indisvalid
							and indisready
							and regexp_replace(lower(pg_get_indexdef(indexrelid)), '[[:space:]()]', '', 'g') = required.index_definition
					)
				)
				and not exists (
					select 1
					from (values
						('agent_definition_drafts', 'agent_definition_drafts_authority_or_quarantine_check', 'check((((organization_idisnotnull)and(created_by_user_idisnotnull)and(updated_by_user_idisnotnull)and(legacy_quarantined_atisnull))or((organization_idisnull)and(created_by_user_idisnull)and(updated_by_user_idisnull)and(legacy_quarantined_atisnotnull))))'),
						('agent_definition_published_versions', 'agent_definition_published_authority_or_quarantine_check', 'check((((organization_idisnotnull)and(created_by_user_idisnotnull)and(legacy_quarantined_atisnull))or((organization_idisnull)and(created_by_user_idisnull)and(legacy_quarantined_atisnotnull))))')
					) as required(table_name, constraint_name, constraint_definition)
					where not exists (
						select 1 from pg_constraint
						where conrelid = to_regclass('sonik_agent_ui.' || required.table_name)
							and conname = required.constraint_name
							and regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]]', '', 'g') = required.constraint_definition
					)
				)
				and not exists (
					select 1
					from (values
						('agent_definition_drafts', 'agent_definition_drafts_tenant_scope', '(organization_id=sonik_agent_ui.current_organization_id())', '((organization_id=sonik_agent_ui.current_organization_id())and(created_by_user_idisnotnull)and(updated_by_user_id=sonik_agent_ui.current_user_id())and(legacy_quarantined_atisnull))'),
						('agent_definition_published_versions', 'agent_definition_published_versions_tenant_scope', '(organization_id=sonik_agent_ui.current_organization_id())', '((organization_id=sonik_agent_ui.current_organization_id())and(created_by_user_id=sonik_agent_ui.current_user_id())and(legacy_quarantined_atisnull))')
					) as required(table_name, policy_name, using_expression, check_expression)
					where (select count(*) from pg_policy where polrelid = to_regclass('sonik_agent_ui.' || required.table_name)) <> 1
						or not exists (
							select 1 from pg_policy
							where polrelid = to_regclass('sonik_agent_ui.' || required.table_name)
								and polname = required.policy_name
								and polpermissive
								and polcmd = '*'
								and polroles = array[0::oid]
								and regexp_replace(lower(pg_get_expr(polqual, polrelid)), '[[:space:]]', '', 'g') = required.using_expression
								and regexp_replace(lower(pg_get_expr(polwithcheck, polrelid)), '[[:space:]]', '', 'g') = required.check_expression
						)
				)
			)::text
		`,
	},
	{
		version: "0016",
		name: "workflow_definitions",
		file: "packages/workspace-session/migrations/postgres/0016_workflow_definitions.sql",
		postApply: `
			do $$
			begin
				if exists (
					select 1 from pg_constraint
					where conrelid = to_regclass('sonik_agent_ui.workflow_definition_drafts')
						and conname = 'workflow_definition_drafts_pkey'
						and regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]]', '', 'g')
							<> 'primarykey(organization_id,user_id,workflow_id)'
				) then
					alter table sonik_agent_ui.workflow_definition_drafts
						drop constraint workflow_definition_drafts_pkey;
				end if;
				if not exists (
					select 1 from pg_constraint
					where conrelid = 'sonik_agent_ui.workflow_definition_drafts'::regclass
						and conname = 'workflow_definition_drafts_pkey'
				) then
					alter table sonik_agent_ui.workflow_definition_drafts
						add constraint workflow_definition_drafts_pkey primary key (organization_id, user_id, workflow_id);
				end if;
			end
			$$;
		`,
		baselineCheck: `
			select (
				not exists (
					select 1
					from (values
						('workflow_definition_drafts', 'organization_id'),
						('workflow_definition_drafts', 'user_id'),
						('workflow_definition_drafts', 'workflow_id'),
						('workflow_definition_drafts', 'draft_revision'),
						('workflow_definition_drafts', 'definition_digest'),
						('workflow_definition_drafts', 'definition'),
						('workflow_definition_drafts', 'archived_at'),
						('workflow_definition_drafts', 'created_by'),
						('workflow_definition_drafts', 'updated_by'),
						('workflow_definition_drafts', 'created_at'),
						('workflow_definition_drafts', 'updated_at'),
						('workflow_definition_published_versions', 'organization_id'),
						('workflow_definition_published_versions', 'user_id'),
						('workflow_definition_published_versions', 'workflow_id'),
						('workflow_definition_published_versions', 'workflow_version_id'),
						('workflow_definition_published_versions', 'source_draft_revision'),
						('workflow_definition_published_versions', 'definition_digest'),
						('workflow_definition_published_versions', 'definition'),
						('workflow_definition_published_versions', 'dependency_pins'),
						('workflow_definition_published_versions', 'published_by'),
						('workflow_definition_published_versions', 'published_at')
					) as required(table_name, column_name)
					where not exists (
						select 1 from information_schema.columns
						where table_schema = 'sonik_agent_ui'
							and columns.table_name = required.table_name
							and columns.column_name = required.column_name
					)
				)
				and to_regclass('sonik_agent_ui.workflow_definition_drafts_owner_updated_idx') is not null
				and to_regprocedure('sonik_agent_ui.reject_published_workflow_mutation()') is not null
				and exists (
					select 1 from pg_trigger
					where tgrelid = to_regclass('sonik_agent_ui.workflow_definition_published_versions')
						and tgname = 'workflow_definition_versions_immutable'
						and not tgisinternal
				)
				and not exists (
					select 1
					from (values
						('workflow_definition_drafts', 'workflow_definition_drafts_pkey', 'workflow_definition_drafts_scope'),
						('workflow_definition_published_versions', 'workflow_definition_published_versions_pkey', 'workflow_definition_versions_scope')
					) as required(table_name, constraint_name, policy_name)
					where not exists (
						select 1 from pg_class
						where oid = to_regclass('sonik_agent_ui.' || required.table_name)
							and relrowsecurity
							and relforcerowsecurity
					)
					or not exists (
						select 1 from pg_constraint
						where conrelid = to_regclass('sonik_agent_ui.' || required.table_name)
							and conname = required.constraint_name
					)
					or not exists (
						select 1 from pg_policy
						where polrelid = to_regclass('sonik_agent_ui.' || required.table_name)
							and polname = required.policy_name
					)
				)
				and exists (
					select 1 from pg_index
					where indexrelid = to_regclass('sonik_agent_ui.workflow_definition_drafts_owner_updated_idx')
						and indisvalid
						and indisready
						and regexp_replace(lower(pg_get_indexdef(indexrelid)), '[[:space:]()]', '', 'g')
							= 'createindexworkflow_definition_drafts_owner_updated_idxonsonik_agent_ui.workflow_definition_draftsusingbtreeorganization_id,user_id,updated_atdesc'
				)
				and exists (
					select 1 from pg_index
					where indexrelid in (
						to_regclass('sonik_agent_ui.workflow_definition_versions_owner_workflow_idx'),
						to_regclass('sonik_agent_ui.workflow_definition_versions_organization_workflow_idx')
					)
						and indisvalid
						and indisready
						and regexp_replace(lower(pg_get_indexdef(indexrelid)), '[[:space:]()]', '', 'g') in (
							'createindexworkflow_definition_versions_owner_workflow_idxonsonik_agent_ui.workflow_definition_published_versionsusingbtreeorganization_id,user_id,workflow_id,published_atdesc',
							'createindexworkflow_definition_versions_organization_workflow_idxonsonik_agent_ui.workflow_definition_published_versionsusingbtreeorganization_id,workflow_id,published_atdesc'
						)
				)
				and exists (
					select 1 from pg_constraint
					where conrelid = to_regclass('sonik_agent_ui.workflow_definition_drafts')
						and conname = 'workflow_definition_drafts_pkey'
						and regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]]', '', 'g')
							= 'primarykey(organization_id,user_id,workflow_id)'
				)
				and exists (
					select 1 from pg_constraint
					where conrelid = to_regclass('sonik_agent_ui.workflow_definition_published_versions')
						and conname = 'workflow_definition_published_versions_pkey'
						and regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]]', '', 'g') in (
							'primarykey(organization_id,user_id,workflow_version_id)',
							'primarykey(organization_id,workflow_version_id)'
						)
				)
				and exists (
					select 1
					from pg_trigger as immutable_trigger
					join pg_proc as trigger_function on trigger_function.oid = immutable_trigger.tgfoid
					join pg_namespace as function_schema on function_schema.oid = trigger_function.pronamespace
					join pg_language as function_language on function_language.oid = trigger_function.prolang
					where immutable_trigger.tgrelid = to_regclass('sonik_agent_ui.workflow_definition_published_versions')
						and immutable_trigger.tgname = 'workflow_definition_versions_immutable'
						and not immutable_trigger.tgisinternal
						and immutable_trigger.tgenabled = 'O'
						and immutable_trigger.tgtype = 27
						and immutable_trigger.tgqual is null
						and immutable_trigger.tgattr = ''::int2vector
						and function_schema.nspname = 'sonik_agent_ui'
						and trigger_function.proname = 'reject_published_workflow_mutation'
						and function_language.lanname = 'plpgsql'
						and trigger_function.prorettype = 'trigger'::regtype
						and trigger_function.pronargs = 0
						and not trigger_function.prosecdef
						and trigger_function.proconfig @> array['search_path=pg_catalog']
						and regexp_replace(lower(trigger_function.prosrc), '[[:space:]]', '', 'g')
							= 'beginraiseexception''publishedworkflowversionsareimmutable''usingerrcode=''55000'';end'
				)
				and not exists (
					select 1
					from (values
						('workflow_definition_drafts', 'workflow_definition_drafts_scope', '((organization_id=sonik_agent_ui.current_organization_id())and(user_id=sonik_agent_ui.current_user_id()))', '((organization_id=sonik_agent_ui.current_organization_id())and(user_id=sonik_agent_ui.current_user_id()))'),
						('workflow_definition_published_versions', 'workflow_definition_versions_scope', '(organization_id=sonik_agent_ui.current_organization_id())', '((organization_id=sonik_agent_ui.current_organization_id())and(user_id=sonik_agent_ui.current_user_id()))')
					) as required(table_name, policy_name, using_expression, check_expression)
					where (select count(*) from pg_policy where polrelid = to_regclass('sonik_agent_ui.' || required.table_name)) <> 1
						or not exists (
							select 1 from pg_policy
							where polrelid = to_regclass('sonik_agent_ui.' || required.table_name)
								and polname = required.policy_name
								and polpermissive
								and polcmd = '*'
								and polroles = array[0::oid]
								and regexp_replace(lower(pg_get_expr(polqual, polrelid)), '[[:space:]]', '', 'g') in (
									required.using_expression,
									'((organization_id=sonik_agent_ui.current_organization_id())and(user_id=sonik_agent_ui.current_user_id()))'
								)
								and regexp_replace(lower(pg_get_expr(polwithcheck, polrelid)), '[[:space:]]', '', 'g') = required.check_expression
						)
				)
			)::text
		`,
	},
	{
		version: "0017",
		name: "workflow_run_journal",
		file: "packages/workspace-session/migrations/postgres/0017_workflow_run_journal.sql",
		postApply: `
			do $$
			begin
				if exists (
					select 1 from pg_constraint
					where conrelid = to_regclass('sonik_agent_ui.agent_workflow_run_waitpoints')
						and conname = 'agent_workflow_run_waitpoints_pkey'
						and regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]]', '', 'g')
							<> 'primarykey(organization_id,user_id,run_id,waitpoint_id)'
				) then
					alter table sonik_agent_ui.agent_workflow_run_waitpoints
						drop constraint agent_workflow_run_waitpoints_pkey;
				end if;
				if not exists (
					select 1 from pg_constraint
					where conrelid = 'sonik_agent_ui.agent_workflow_run_waitpoints'::regclass
						and conname = 'agent_workflow_run_waitpoints_pkey'
				) then
					alter table sonik_agent_ui.agent_workflow_run_waitpoints
						add constraint agent_workflow_run_waitpoints_pkey primary key (organization_id, user_id, run_id, waitpoint_id);
				end if;
			end
			$$;
		`,
		baselineCheck: `
			select (
				not exists (
					select 1
					from (values
						('agent_workflow_runs', 'journal_revision'),
						('agent_workflow_runs', 'journal_sequence'),
						('agent_workflow_runs', 'canonical_snapshot'),
						('agent_workflow_runs', 'compatibility_phase'),
						('agent_workflow_run_events', 'organization_id'),
						('agent_workflow_run_events', 'user_id'),
						('agent_workflow_run_events', 'run_id'),
						('agent_workflow_run_events', 'sequence'),
						('agent_workflow_run_events', 'revision'),
						('agent_workflow_run_events', 'event_id'),
						('agent_workflow_run_events', 'event_type'),
						('agent_workflow_run_events', 'event'),
						('agent_workflow_run_events', 'created_at'),
						('agent_workflow_run_leases', 'organization_id'),
						('agent_workflow_run_leases', 'user_id'),
						('agent_workflow_run_leases', 'run_id'),
						('agent_workflow_run_leases', 'lease_id'),
						('agent_workflow_run_leases', 'owner_id'),
						('agent_workflow_run_leases', 'lease_expires_at'),
						('agent_workflow_run_leases', 'updated_at'),
						('agent_workflow_run_waitpoints', 'organization_id'),
						('agent_workflow_run_waitpoints', 'user_id'),
						('agent_workflow_run_waitpoints', 'run_id'),
						('agent_workflow_run_waitpoints', 'waitpoint_id'),
						('agent_workflow_run_waitpoints', 'kind'),
						('agent_workflow_run_waitpoints', 'waitpoint'),
						('agent_workflow_run_waitpoints', 'status'),
						('agent_workflow_run_waitpoints', 'created_at'),
						('agent_workflow_run_waitpoints', 'updated_at'),
						('agent_workflow_effect_claims', 'organization_id'),
						('agent_workflow_effect_claims', 'user_id'),
						('agent_workflow_effect_claims', 'run_id'),
						('agent_workflow_effect_claims', 'logical_effect_id'),
						('agent_workflow_effect_claims', 'claim_id'),
						('agent_workflow_effect_claims', 'attempt_id'),
						('agent_workflow_effect_claims', 'idempotency_key'),
						('agent_workflow_effect_claims', 'provider_supports_idempotency'),
						('agent_workflow_effect_claims', 'status'),
						('agent_workflow_effect_claims', 'result'),
						('agent_workflow_effect_claims', 'created_at'),
						('agent_workflow_effect_claims', 'updated_at')
					) as required(table_name, column_name)
					where not exists (
						select 1 from information_schema.columns
						where table_schema = 'sonik_agent_ui'
							and columns.table_name = required.table_name
							and columns.column_name = required.column_name
					)
				)
				and to_regclass('sonik_agent_ui.agent_workflow_run_leases_expiry_idx') is not null
				and exists (
					select 1 from pg_constraint
					where conrelid = to_regclass('sonik_agent_ui.agent_workflow_runs')
						and conname = 'agent_workflow_runs_journal_position_check'
				)
				and not exists (
					select 1
					from (values
						('agent_workflow_run_events', 'agent_workflow_run_events_pkey', 'agent_workflow_run_events_scope'),
						('agent_workflow_run_leases', 'agent_workflow_run_leases_pkey', 'agent_workflow_run_leases_scope'),
						('agent_workflow_run_waitpoints', 'agent_workflow_run_waitpoints_pkey', 'agent_workflow_run_waitpoints_scope'),
						('agent_workflow_effect_claims', 'agent_workflow_effect_claims_pkey', 'agent_workflow_effect_claims_scope')
					) as required(table_name, constraint_name, policy_name)
					where not exists (
						select 1 from pg_class
						where oid = to_regclass('sonik_agent_ui.' || required.table_name)
							and relrowsecurity
							and relforcerowsecurity
					)
					or not exists (
						select 1 from pg_constraint
						where conrelid = to_regclass('sonik_agent_ui.' || required.table_name)
							and conname = required.constraint_name
					)
					or not exists (
						select 1 from pg_policy
						where polrelid = to_regclass('sonik_agent_ui.' || required.table_name)
							and polname = required.policy_name
					)
				)
				and exists (
					select 1 from pg_index
					where indexrelid = to_regclass('sonik_agent_ui.agent_workflow_run_leases_expiry_idx')
						and indisvalid
						and indisready
						and regexp_replace(lower(pg_get_indexdef(indexrelid)), '[[:space:]()]', '', 'g')
							= 'createindexagent_workflow_run_leases_expiry_idxonsonik_agent_ui.agent_workflow_run_leasesusingbtreelease_expires_at'
				)
				and not exists (
					select 1
					from (values
						('agent_workflow_runs', 'check((journal_revision=journal_sequence))'),
						('agent_workflow_run_events', 'primarykey(organization_id,user_id,run_id,sequence)'),
						('agent_workflow_run_events', 'unique(organization_id,user_id,run_id,event_id)'),
						('agent_workflow_run_events', 'foreignkey(organization_id,user_id,run_id)referencessonik_agent_ui.agent_workflow_runs(organization_id,user_id,run_id)ondeletecascade'),
						('agent_workflow_run_leases', 'primarykey(organization_id,user_id,run_id)'),
						('agent_workflow_run_leases', 'foreignkey(organization_id,user_id,run_id)referencessonik_agent_ui.agent_workflow_runs(organization_id,user_id,run_id)ondeletecascade'),
						('agent_workflow_run_waitpoints', 'primarykey(organization_id,user_id,run_id,waitpoint_id)'),
						('agent_workflow_run_waitpoints', 'foreignkey(organization_id,user_id,run_id)referencessonik_agent_ui.agent_workflow_runs(organization_id,user_id,run_id)ondeletecascade'),
						('agent_workflow_effect_claims', 'primarykey(organization_id,user_id,run_id,logical_effect_id)'),
						('agent_workflow_effect_claims', 'unique(organization_id,user_id,run_id,idempotency_key)'),
						('agent_workflow_effect_claims', 'unique(organization_id,user_id,run_id,claim_id)'),
						('agent_workflow_effect_claims', 'foreignkey(organization_id,user_id,run_id)referencessonik_agent_ui.agent_workflow_runs(organization_id,user_id,run_id)ondeletecascade')
					) as required(table_name, constraint_definition)
					where not exists (
						select 1 from pg_constraint
						where conrelid = to_regclass('sonik_agent_ui.' || required.table_name)
							and regexp_replace(lower(pg_get_constraintdef(oid)), '[[:space:]]', '', 'g') = required.constraint_definition
					)
				)
				and not exists (
					select 1
					from (values
						('agent_workflow_run_events', 'agent_workflow_run_events_scope'),
						('agent_workflow_run_leases', 'agent_workflow_run_leases_scope'),
						('agent_workflow_run_waitpoints', 'agent_workflow_run_waitpoints_scope'),
						('agent_workflow_effect_claims', 'agent_workflow_effect_claims_scope')
					) as required(table_name, policy_name)
					where (select count(*) from pg_policy where polrelid = to_regclass('sonik_agent_ui.' || required.table_name)) <> 1
						or not exists (
							select 1 from pg_policy
							where polrelid = to_regclass('sonik_agent_ui.' || required.table_name)
								and polname = required.policy_name
								and polpermissive
								and polcmd = '*'
								and polroles = array[0::oid]
								and (
									regexp_replace(lower(pg_get_expr(polqual, polrelid)), '[[:space:]]', '', 'g')
										= '((organization_id=sonik_agent_ui.current_organization_id())and(user_id=sonik_agent_ui.current_user_id()))'
									or (
										required.table_name = 'agent_workflow_effect_claims'
										and regexp_replace(lower(pg_get_expr(polqual, polrelid)), '[[:space:]]', '', 'g')
											= '(organization_id=sonik_agent_ui.current_organization_id())'
									)
								)
								and regexp_replace(lower(pg_get_expr(polwithcheck, polrelid)), '[[:space:]]', '', 'g')
									= regexp_replace(lower(pg_get_expr(polqual, polrelid)), '[[:space:]]', '', 'g')
						)
				)
			)::text
		`,
	},
	{
		version: "0018",
		name: "org_scoped_external_effect_claims",
		file: "packages/workspace-session/migrations/postgres/0018_org_scoped_external_effect_claims.sql",
		baselineCheck: `
			select (
				(
					select count(*) = 4
					from information_schema.columns
					where table_schema = 'sonik_agent_ui'
						and table_name = 'agent_workflow_effect_claims'
						and column_name in ('effect_namespace', 'external_effect_key_digest', 'command_id', 'resolved_input_hash')
						and is_nullable = 'NO'
				)
				and to_regclass('sonik_agent_ui.agent_workflow_effect_claims_external_identity_idx') is not null
				and exists (
					select 1 from pg_policies
					where schemaname = 'sonik_agent_ui'
						and tablename = 'agent_workflow_effect_claims'
						and policyname = 'agent_workflow_effect_claims_scope'
				)
			)::text
		`,
	},
	{
		version: "0019",
		name: "organization_scoped_workflow_versions",
		file: "packages/workspace-session/migrations/postgres/0019_organization_scoped_workflow_versions.sql",
		transactional: false,
		baselineCheck: `
			select (
				(
					select string_agg(attribute.attname, ',' order by key_column.ordinality)
					from pg_constraint as constraint_definition
					cross join lateral unnest(constraint_definition.conkey) with ordinality as key_column(attribute_number, ordinality)
					join pg_attribute as attribute
						on attribute.attrelid = constraint_definition.conrelid
						and attribute.attnum = key_column.attribute_number
					where constraint_definition.conrelid = to_regclass('sonik_agent_ui.workflow_definition_published_versions')
						and constraint_definition.contype = 'p'
				) = 'organization_id,workflow_version_id'
				and exists (
					select 1
					from pg_index as canonical_index
					where canonical_index.indexrelid = to_regclass('sonik_agent_ui.workflow_definition_versions_organization_workflow_idx')
						and canonical_index.indisvalid
						and canonical_index.indisready
						and regexp_replace(lower(pg_get_indexdef(canonical_index.indexrelid)), '[[:space:]]', '', 'g')
							= 'createindexworkflow_definition_versions_organization_workflow_idxonsonik_agent_ui.workflow_definition_published_versionsusingbtreeorganization_id,workflow_id,published_atdesc'
				)
				and (
					select relrowsecurity and relforcerowsecurity
					from pg_class
					where oid = to_regclass('sonik_agent_ui.workflow_definition_published_versions')
				)
				and exists (
					select 1
					from pg_trigger as immutable_trigger
					join pg_proc as trigger_function on trigger_function.oid = immutable_trigger.tgfoid
					join pg_namespace as function_schema on function_schema.oid = trigger_function.pronamespace
					join pg_language as function_language on function_language.oid = trigger_function.prolang
					where immutable_trigger.tgrelid = to_regclass('sonik_agent_ui.workflow_definition_published_versions')
						and immutable_trigger.tgname = 'workflow_definition_versions_immutable'
						and not immutable_trigger.tgisinternal
						and immutable_trigger.tgenabled = 'O'
						and immutable_trigger.tgtype = 27
						and immutable_trigger.tgqual is null
						and immutable_trigger.tgattr = ''::int2vector
						and function_schema.nspname = 'sonik_agent_ui'
						and trigger_function.proname = 'reject_published_workflow_mutation'
						and function_language.lanname = 'plpgsql'
						and trigger_function.prorettype = 'trigger'::regtype
						and trigger_function.pronargs = 0
						and not trigger_function.prosecdef
						and trigger_function.proconfig @> array['search_path=pg_catalog']
						and regexp_replace(lower(trigger_function.prosrc), '[[:space:]]', '', 'g')
							= 'beginraiseexception''publishedworkflowversionsareimmutable''usingerrcode=''55000'';end'
				)
				and (
					select count(*)
					from pg_policy
					where polrelid = to_regclass('sonik_agent_ui.workflow_definition_published_versions')
				) = 1
				and exists (
					select 1 from pg_policy as canonical_policy
					where canonical_policy.polrelid = to_regclass('sonik_agent_ui.workflow_definition_published_versions')
						and canonical_policy.polname = 'workflow_definition_versions_scope'
						and canonical_policy.polpermissive
						and canonical_policy.polcmd = '*'
						and canonical_policy.polroles = array[0::oid]
						and regexp_replace(pg_get_expr(canonical_policy.polqual, canonical_policy.polrelid), '[[:space:]]', '', 'g')
							= '(organization_id=sonik_agent_ui.current_organization_id())'
						and regexp_replace(pg_get_expr(canonical_policy.polwithcheck, canonical_policy.polrelid), '[[:space:]]', '', 'g')
							= '((organization_id=sonik_agent_ui.current_organization_id())AND(user_id=sonik_agent_ui.current_user_id()))'
				)
			)::text
		`,
	},
	{
		version: "0020",
		name: "workflow_run_source_kind",
		file: "packages/workspace-session/migrations/postgres/0020_workflow_run_source_kind.sql",
		baselineCheck: `
			select (
				exists (
					select 1 from information_schema.columns
					where table_schema = 'sonik_agent_ui'
						and table_name = 'agent_workflow_runs'
						and column_name = 'source_kind'
						and data_type = 'text'
						and is_nullable = 'YES'
				)
				and exists (
					select 1 from pg_constraint as source_kind_constraint
					where conrelid = to_regclass('sonik_agent_ui.agent_workflow_runs')
						and conname = 'agent_workflow_runs_source_kind_check'
						and contype = 'c'
						and convalidated
						and regexp_replace(lower(pg_get_constraintdef(source_kind_constraint.oid)), '[[:space:]]', '', 'g')
							= 'check(((source_kindisnull)or(source_kind=any(array[''internal''::text,''draft''::text,''published''::text]))))'
				)
			)::text
		`,
	},
];

if (!databaseUrl) {
	console.error("DATABASE_URL is required. Example: DATABASE_URL='<postgres-url>' pnpm run db:migrate");
	process.exit(2);
}

// Supply the connection via PG* env vars, never as a psql argv: a non-zero psql
// exit echoes its argv (password included) to stderr, which the release gate
// captures and persists into evidence. Keeping credentials in the env keeps them
// out of any error/log output.
const pgEnv = buildPgEnv(databaseUrl);

function psql(args, options = {}) {
	return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", ...args], {
		cwd: repoRoot,
		encoding: "utf8",
		stdio: options.stdio ?? ["ignore", "pipe", "inherit"],
		env: { ...process.env, ...pgEnv },
	});
}

function scalar(sql) {
	return psql(["-At", "-c", sql]).trim();
}

function sqlLiteral(value) {
	return `'${String(value).replaceAll("'", "''")}'`;
}

function checksum(filePath) {
	return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function ensureMigrationLedger() {
	psql([
		"-c",
		`
			create schema if not exists sonik_agent_ui;
			create table if not exists sonik_agent_ui.schema_migrations (
				version text primary key,
				name text not null,
				checksum text not null,
				applied_via text not null check (applied_via in ('runner', 'baseline')),
				applied_at timestamptz not null default now()
			);
		`,
	]);
}

function migrationLedgerExists() {
	return scalar("select (to_regclass('sonik_agent_ui.schema_migrations') is not null)::text") === "true";
}

function readRecordedMigration(version) {
	if (!migrationLedgerExists()) return null;
	const row = scalar(`select concat_ws(E'\t', checksum, applied_via) from sonik_agent_ui.schema_migrations where version = ${sqlLiteral(version)}`);
	if (!row) return null;
	const [recordedChecksum, appliedVia] = row.split("\t");
	return { checksum: recordedChecksum, appliedVia };
}

function assertRecordedMigrationMatches(migration, sum, recorded) {
	if (recorded.checksum === sum) return;
	throw new Error(`[db:migrate] ${migration.version} ${migration.name}: recorded checksum ${recorded.checksum} differs from current ${sum}. Refusing to ignore migration drift.`);
}

function recordMigration(migration, sum, appliedVia) {
	psql([
		"-c",
		`
			insert into sonik_agent_ui.schema_migrations (version, name, checksum, applied_via)
			values (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(sum)}, ${sqlLiteral(appliedVia)})
			on conflict (version) do nothing;
		`,
	]);
}

function baselineExists(migration) {
	return scalar(migration.baselineCheck) === "true";
}

function applyMigration(migration, sum) {
	const filePath = path.resolve(repoRoot, migration.file);
	if (migration.transactional === false) {
		psql(["-f", filePath], { stdio: "inherit" });
		recordMigration(migration, sum, "runner");
		return;
	}
	const recordSql = `
		insert into sonik_agent_ui.schema_migrations (version, name, checksum, applied_via)
		values (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(sum)}, 'runner')
		on conflict (version) do nothing;
	`;
	psql(["-1", "-f", filePath, ...(migration.postApply ? ["-c", migration.postApply] : []), "-c", recordSql], { stdio: "inherit" });
}

if (!dryRun) ensureMigrationLedger();

for (const migration of migrations) {
	const filePath = path.resolve(repoRoot, migration.file);
	const sum = checksum(filePath);
	const recorded = readRecordedMigration(migration.version);
	if (recorded) {
		assertRecordedMigrationMatches(migration, sum, recorded);
		console.log(`[db:migrate] ${migration.version} ${migration.name}: already recorded (${recorded.appliedVia})`);
		continue;
	}
	if (baselineExists(migration)) {
		console.log(`[db:migrate] ${migration.version} ${migration.name}: existing schema detected; recording baseline`);
		if (!dryRun) recordMigration(migration, sum, "baseline");
		continue;
	}
	console.log(`[db:migrate] ${migration.version} ${migration.name}: applying ${migration.file}`);
	if (!dryRun) applyMigration(migration, sum);
}

console.log("[db:migrate] complete");
