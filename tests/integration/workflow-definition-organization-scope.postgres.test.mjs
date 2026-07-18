import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildPgEnv } from "../../scripts/lib/postgres-connection.mjs";

const sourceUrl = process.env.POSTGRES_TEST_URL;
if (!sourceUrl) {
  console.log("workflow-definition-organization-scope.postgres.test.mjs: SKIP (POSTGRES_TEST_URL unavailable)");
  process.exit(0);
}

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";
const database = `sonik_agent_ui_workflow_scope_${process.pid}_${Date.now()}`;
const role = `sonik_agent_ui_workflow_scope_${process.pid}_${Date.now()}`;
const testUrl = new URL(sourceUrl);
testUrl.pathname = `/${database}`;

function psql(url, sql) {
  return execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "-X", "-At", "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, ...buildPgEnv(url.toString()) },
  }).trim();
}

function runMigrations({ dryRun = false } = {}) {
  return execFileSync(process.execPath, ["scripts/run-postgres-migrations.mjs", ...(dryRun ? ["--dry-run"] : [])], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

psql(adminUrl, `create database ${database}`);
try {
  runMigrations();

  assert.equal(
    psql(testUrl, `
      select string_agg(attribute.attname, ',' order by key_column.ordinality)
      from pg_constraint as constraint_definition
      cross join lateral unnest(constraint_definition.conkey) with ordinality as key_column(attribute_number, ordinality)
      join pg_attribute as attribute on attribute.attrelid = constraint_definition.conrelid and attribute.attnum = key_column.attribute_number
      where constraint_definition.conrelid = 'sonik_agent_ui.workflow_definition_published_versions'::regclass
        and constraint_definition.contype = 'p'
    `),
    "organization_id,workflow_version_id",
  );

  const digest = `sha256:${"a".repeat(64)}`;
  psql(testUrl, `
    insert into sonik_agent_ui.workflow_definition_published_versions
      (organization_id, user_id, workflow_id, workflow_version_id, source_draft_revision, definition_digest, definition, dependency_pins, published_by)
    values
      ('org-a', 'publisher-a', 'shared', 'shared@1', 0, '${digest}', '{}'::jsonb, '{}'::jsonb, 'publisher-a'),
      ('org-b', 'publisher-b', 'shared', 'shared@1', 0, '${digest}', '{}'::jsonb, '{}'::jsonb, 'publisher-b');
    create role ${role} nologin;
    grant usage on schema sonik_agent_ui to ${role};
    grant select, insert on sonik_agent_ui.workflow_definition_published_versions to ${role};
    grant execute on function sonik_agent_ui.set_request_context(text, text) to ${role};
    grant execute on function sonik_agent_ui.current_organization_id() to ${role};
    grant execute on function sonik_agent_ui.current_user_id() to ${role};
  `);

  assert.deepEqual(
    psql(testUrl, `
      begin;
      set local role ${role};
      select sonik_agent_ui.set_request_context('org-a', 'reader-a');
      select organization_id || ':' || user_id || ':' || workflow_version_id
      from sonik_agent_ui.workflow_definition_published_versions
      order by organization_id;
      rollback;
    `).split("\n").filter((line) => line.startsWith("org-")),
    ["org-a:publisher-a:shared@1"],
    "same-org readers see immutable published versions while cross-org rows stay hidden",
  );

  assert.throws(
    () => psql(testUrl, `
      insert into sonik_agent_ui.workflow_definition_published_versions
        (organization_id, user_id, workflow_id, workflow_version_id, source_draft_revision, definition_digest, definition, dependency_pins, published_by)
      values ('org-a', 'publisher-c', 'shared', 'shared@1', 0, '${digest}', '{}'::jsonb, '{}'::jsonb, 'publisher-c')
    `),
    "organization-local workflow version IDs are immutable identities across publishers",
  );
  assert.throws(
    () => psql(testUrl, `
      begin;
      set local role ${role};
      select sonik_agent_ui.set_request_context('org-a', 'reader-a');
      insert into sonik_agent_ui.workflow_definition_published_versions
        (organization_id, user_id, workflow_id, workflow_version_id, source_draft_revision, definition_digest, definition, dependency_pins, published_by)
      values ('org-a', 'publisher-c', 'shared', 'shared@2', 0, '${digest}', '{}'::jsonb, '{}'::jsonb, 'publisher-c');
      commit;
    `),
    "publish-time RLS preserves current-user provenance",
  );
  assert.throws(
    () => psql(testUrl, "update sonik_agent_ui.workflow_definition_published_versions set workflow_id = 'mutated' where organization_id = 'org-a' and workflow_version_id = 'shared@1'"),
    "published workflow versions reject mutation",
  );

  runMigrations();

  psql(testUrl, `
    alter table sonik_agent_ui.workflow_definition_published_versions
      drop constraint workflow_definition_published_versions_pkey,
      add primary key (organization_id, user_id, workflow_version_id);
    drop index sonik_agent_ui.workflow_definition_versions_organization_workflow_idx;
    create index workflow_definition_versions_owner_workflow_idx
      on sonik_agent_ui.workflow_definition_published_versions (organization_id, user_id, workflow_id, published_at desc);
    drop policy workflow_definition_versions_scope on sonik_agent_ui.workflow_definition_published_versions;
    create policy workflow_definition_versions_scope on sonik_agent_ui.workflow_definition_published_versions
      using (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id())
      with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
    delete from sonik_agent_ui.schema_migrations where version = '0019';
    insert into sonik_agent_ui.workflow_definition_published_versions
      (organization_id, user_id, workflow_id, workflow_version_id, source_draft_revision, definition_digest, definition, dependency_pins, published_by)
    values ('org-a', 'publisher-c', 'shared', 'shared@1', 0, '${digest}', '{}'::jsonb, '{}'::jsonb, 'publisher-c');
  `);

  assert.throws(
    () => runMigrations(),
    "the 0019 upgrade fails atomically instead of discarding duplicate organization-local version identities",
  );
  assert.equal(psql(testUrl, "select count(*) from sonik_agent_ui.schema_migrations where version = '0019'"), "0");
  assert.equal(
    psql(testUrl, "select count(*) from sonik_agent_ui.workflow_definition_published_versions where organization_id = 'org-a' and workflow_version_id = 'shared@1'"),
    "2",
    "a failed upgrade preserves both conflicting rows for explicit operator repair",
  );
  assert.equal(
    psql(testUrl, `
      select string_agg(attribute.attname, ',' order by key_column.ordinality)
      from pg_constraint as constraint_definition
      cross join lateral unnest(constraint_definition.conkey) with ordinality as key_column(attribute_number, ordinality)
      join pg_attribute as attribute on attribute.attrelid = constraint_definition.conrelid and attribute.attnum = key_column.attribute_number
      where constraint_definition.conrelid = 'sonik_agent_ui.workflow_definition_published_versions'::regclass
        and constraint_definition.contype = 'p'
    `),
    "organization_id,user_id,workflow_version_id",
    "the failed 0019 transaction leaves the pre-upgrade primary key intact",
  );

  psql(testUrl, `
    alter table sonik_agent_ui.workflow_definition_published_versions disable trigger workflow_definition_versions_immutable;
    delete from sonik_agent_ui.workflow_definition_published_versions
      where organization_id = 'org-a' and user_id = 'publisher-c' and workflow_version_id = 'shared@1';
    alter table sonik_agent_ui.workflow_definition_published_versions enable trigger workflow_definition_versions_immutable;
  `);
  runMigrations();
  assert.equal(
    psql(testUrl, "select applied_via from sonik_agent_ui.schema_migrations where version = '0019'"),
    "runner",
    "the repaired pre-0019 schema upgrades through the migration runner",
  );
  assert.equal(
    psql(testUrl, "select user_id || ':' || published_by from sonik_agent_ui.workflow_definition_published_versions where organization_id = 'org-a' and workflow_version_id = 'shared@1'"),
    "publisher-a:publisher-a",
    "the successful upgrade retains publisher provenance",
  );

  psql(testUrl, `
    drop policy workflow_definition_versions_scope on sonik_agent_ui.workflow_definition_published_versions;
    create policy workflow_definition_versions_scope on sonik_agent_ui.workflow_definition_published_versions
      using (true)
      with check (organization_id = sonik_agent_ui.current_organization_id() and user_id = sonik_agent_ui.current_user_id());
    delete from sonik_agent_ui.schema_migrations where version = '0019';
  `);
  assert.deepEqual(
    psql(testUrl, `
      begin;
      set local role ${role};
      select sonik_agent_ui.set_request_context('org-a', 'reader-a');
      select organization_id from sonik_agent_ui.workflow_definition_published_versions order by organization_id;
      rollback;
    `).split("\n").filter((line) => line.startsWith("org-")),
    ["org-a", "org-b"],
    "the deliberately permissive policy demonstrates the cross-organization leak the baseline must reject",
  );
  const permissivePolicyPlan = runMigrations({ dryRun: true });
  assert.match(permissivePolicyPlan, /\[db:migrate\] 0019 organization_scoped_workflow_versions: applying /);
  assert.doesNotMatch(permissivePolicyPlan, /0019 organization_scoped_workflow_versions: existing schema detected; recording baseline/);

  runMigrations();
  psql(testUrl, `
    create policy workflow_definition_versions_permissive
      on sonik_agent_ui.workflow_definition_published_versions using (true);
    delete from sonik_agent_ui.schema_migrations where version = '0019';
  `);
  assert.match(runMigrations({ dryRun: true }), /\[db:migrate\] 0019 organization_scoped_workflow_versions: applying /, "an additive permissive policy invalidates the baseline");
  runMigrations();
  assert.equal(
    psql(testUrl, "select string_agg(polname, ',' order by polname) from pg_policy where polrelid = 'sonik_agent_ui.workflow_definition_published_versions'::regclass"),
    "workflow_definition_versions_scope",
    "0019 removes additive policies before creating the canonical policy",
  );

  psql(testUrl, `
    create or replace function sonik_agent_ui.wrong_workflow_mutation_trigger()
    returns trigger language plpgsql set search_path = pg_catalog as $$ begin return old; end $$;
  `);
  const corruptTrigger = (sql, message) => {
    psql(testUrl, `${sql}; delete from sonik_agent_ui.schema_migrations where version = '0019'`);
    assert.match(runMigrations({ dryRun: true }), /\[db:migrate\] 0019 organization_scoped_workflow_versions: applying /, message);
    runMigrations();
  };
  corruptTrigger(
    "alter table sonik_agent_ui.workflow_definition_published_versions disable trigger workflow_definition_versions_immutable",
    "a disabled immutability trigger invalidates the baseline",
  );
  corruptTrigger(`
    drop trigger workflow_definition_versions_immutable on sonik_agent_ui.workflow_definition_published_versions;
    create trigger workflow_definition_versions_immutable before update or delete
      on sonik_agent_ui.workflow_definition_published_versions for each row
      execute function sonik_agent_ui.wrong_workflow_mutation_trigger()
  `, "a trigger bound to the wrong function invalidates the baseline");
  corruptTrigger(`
    drop trigger workflow_definition_versions_immutable on sonik_agent_ui.workflow_definition_published_versions;
    create trigger workflow_definition_versions_immutable after insert
      on sonik_agent_ui.workflow_definition_published_versions for each row
      execute function sonik_agent_ui.reject_published_workflow_mutation()
  `, "a wrong-event trigger invalidates the baseline");
  corruptTrigger(`
    create or replace function sonik_agent_ui.reject_published_workflow_mutation()
    returns trigger language plpgsql set search_path = pg_catalog as $$ begin return old; end $$
  `, "a no-op canonical trigger function invalidates the baseline");
  assert.throws(
    () => psql(testUrl, "delete from sonik_agent_ui.workflow_definition_published_versions where organization_id = 'org-a' and workflow_version_id = 'shared@1'"),
    "the repaired canonical trigger rejects deletes",
  );

  console.log("workflow-definition-organization-scope.postgres.test.mjs: all assertions passed");
} finally {
  psql(adminUrl, `drop database if exists ${database} with (force)`);
  psql(adminUrl, `drop role if exists ${role}`);
}
