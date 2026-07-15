import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("packages/workspace-session/migrations/postgres/0015_agent_definition_tenant_authority.sql", "utf8");
const store = await readFile("apps/standalone-sveltekit/src/lib/server/agent-definition-store.ts", "utf8");
const route = await readFile("apps/standalone-sveltekit/src/routes/api/agent-definitions/+server.ts", "utf8");
const generate = await readFile("apps/standalone-sveltekit/src/routes/api/generate/+server.ts", "utf8");

for (const table of ["agent_definition_drafts", "agent_definition_published_versions"]) {
  assert.match(migration, new RegExp(`alter table sonik_agent_ui\\.${table} force row level security`, "i"));
  assert.match(migration, new RegExp(`${table}[\\s\\S]*organization_id = sonik_agent_ui\\.current_organization_id\\(\\)`, "i"));
}
assert.match(migration, /legacy_quarantined_at[\s\S]*where organization_id is null/i, "legacy rows are quarantined, never assigned guessed owners");
assert.match(migration, /created_by_user_id[\s\S]*updated_by_user_id/i, "draft user provenance is durable");
assert.match(store, /set_request_context\(\$\{authority\.organizationId\}, \$\{authority\.userId\}\)/, "every Neon operation establishes trusted RLS context");
assert.match(route, /createAgentHostSessionEnvelope\(event\)/, "definition routes derive authority from the signed host session");
assert.match(generate, /assertAgentDefinitionAuthorized\(agentDefinitionAuthority, "start"\)/, "generation requires explicit start authorization");
assert.doesNotMatch(route, /body[^\n]*organizationId/, "route never accepts tenant authority from the request body");

console.log("agent-definition-tenant-authority.test.mjs passed");
