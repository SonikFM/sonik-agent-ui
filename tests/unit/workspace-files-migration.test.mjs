import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("packages/workspace-session/migrations/postgres/0008_agent_workspace_files.sql", "utf8");

for (const column of ["organization_id", "user_id", "session_id", "storage_key", "original_filename", "media_type", "byte_size", "checksum", "status", "provider_references", "provider_references_expires_at"]) {
  assert.match(sql, new RegExp(`\\b${column}\\b`, "i"), `missing ${column}`);
}
assert.match(sql, /primary key \(organization_id, user_id, id\)/i);
assert.match(sql, /foreign key \(organization_id, user_id, session_id\)[\s\S]*agent_workspace_sessions/i);
assert.match(sql, /unique \(organization_id, user_id, storage_key\)/i);
assert.match(sql, /agent_workspace_files_touch_updated_at[\s\S]*sonik_agent_ui\.touch_updated_at\(\)/i);
assert.match(sql, /enable row level security/i);
assert.match(sql, /force row level security/i);
assert.match(sql, /organization_id = sonik_agent_ui\.current_organization_id\(\)/i);
assert.match(sql, /user_id = sonik_agent_ui\.current_user_id\(\)/i);
assert.match(sql, /never file bytes|file bytes are stored elsewhere/i);
assert.doesNotMatch(sql, /\b(bytea|blob)\b/i);
assert.match(sql, /provider_references\s+jsonb/i);

console.log("workspace files migration contract tests passed");
