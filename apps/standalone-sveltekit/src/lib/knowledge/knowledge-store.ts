// Knowledge v1 runtime (Phase 9, agent-creation-tool-plan-2026-07-13.md):
// a file-based, human-readable knowledge store. Markdown/plaintext files
// only -- no vectors, no embeddings, no chunking (spec: Dify "ready-to-use"
// bar at minimum viable depth; Dan: "readable and file-based").
//
// Each store is a directory under `rootDir` holding a `_meta.json` index
// (KnowledgeRef sans readable-literal bookkeeping) plus one plaintext file
// per attached document. This module owns only the CRUD seam; runtime
// wiring (which rootDir to use per deployment, how `agentDefinitionSchema.
// knowledgeRefs` reach here) is out of scope -- see resolve-knowledge-context.ts
// for the pure resolver the adapter will call.

import { mkdir, readFile as readFileFs, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { KnowledgeFileRef, KnowledgeRef } from "../../../../../packages/tool-contracts/src/knowledge-ref.ts";

export type KnowledgeStore = {
  createStore(input: { storeId: string; title: string }): Promise<KnowledgeRef>;
  addFile(storeId: string, input: { title: string; content: string; fileId?: string }): Promise<KnowledgeFileRef>;
  listFiles(storeId: string): Promise<KnowledgeFileRef[]>;
  readFile(storeId: string, fileId: string): Promise<string>;
  removeFile(storeId: string, fileId: string): Promise<void>;
  writeArtifactFile(storeId: string, title: string, content: string): Promise<{ storeId: string; fileRef: KnowledgeFileRef }>;
};

type StoreMeta = { storeId: string; title: string; files: KnowledgeFileRef[] };

// ponytail: directory-name-safe id, not a full slug library -- storeId/fileId
// are first-party identifiers (dotted like "sonik.knowledge.campaign-briefs"),
// this only guards against path traversal.
function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new Error(`Invalid knowledge store/file id: ${JSON.stringify(id)}`);
  }
  return cleaned;
}

export function defaultKnowledgeRoot(): string {
  return process.env.SONIK_AGENT_UI_KNOWLEDGE_ROOT?.trim() || path.join(process.cwd(), ".data", "knowledge");
}

function readKnowledgeDatabaseUrl(env?: Record<string, unknown> | null): string | null {
  // Same env var names/precedence as workspace-services.ts / agent-definition-store.ts,
  // so one deploy env config (SONIK_AGENT_UI_DATABASE_URL) backs all three stores.
  // `env` (platform.env on Cloudflare, where secrets never reach process.env) is
  // checked first; process.env stays a fallback for node/local dev/tests.
  for (const key of ["SONIK_AGENT_UI_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL", "NEON_DATABASE_URL"]) {
    const value = env?.[key] ?? process.env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** P0 #1 (production-readiness-agent-creation-2026-07-13.md): on Cloudflare
 *  Workers there is no durable disk, so the file-based store below is
 *  ephemeral there. Dispatches to Neon when a DB env is configured, else
 *  keeps today's file-based behavior (local dev + existing tests, which set
 *  no DATABASE_URL, are unaffected). `rootDir` is only meaningful for the
 *  file-based fallback. `env` should be `platform.env` on Cloudflare (secrets
 *  live there, not on process.env) -- callers that omit it keep today's
 *  process.env-only dispatch. */
export function createKnowledgeStore(rootDir: string, env?: Record<string, unknown> | null): KnowledgeStore {
  const databaseUrl = readKnowledgeDatabaseUrl(env);
  return databaseUrl ? createNeonKnowledgeStore(databaseUrl) : createFileKnowledgeStore(rootDir);
}

function createFileKnowledgeStore(rootDir: string): KnowledgeStore {
  function storeDir(storeId: string): string {
    return path.join(rootDir, sanitizeId(storeId));
  }
  function metaPath(storeId: string): string {
    return path.join(storeDir(storeId), "_meta.json");
  }
  function filePath(storeId: string, fileId: string): string {
    return path.join(storeDir(storeId), `${sanitizeId(fileId)}.md`);
  }
  function relativeFilePath(storeId: string, fileId: string): string {
    return path.relative(rootDir, filePath(storeId, fileId));
  }

  async function readMeta(storeId: string): Promise<StoreMeta> {
    const raw = await readFileFs(metaPath(storeId), "utf-8").catch((error) => {
      throw new Error(`Knowledge store not found: ${storeId}`, { cause: error });
    });
    return JSON.parse(raw) as StoreMeta;
  }

  async function writeMeta(meta: StoreMeta): Promise<void> {
    await writeFile(metaPath(meta.storeId), JSON.stringify(meta, null, 2), "utf-8");
  }

  // org scoping seam: add organization_id + filter once the auth/org lane
  // resolves a trusted caller identity -- knowledge stores are process-wide
  // across tenants until then (dev-only file backing; same seam as the Neon
  // backing below).
  async function createStore(input: { storeId: string; title: string }): Promise<KnowledgeRef> {
    await mkdir(storeDir(input.storeId), { recursive: true });
    const existing = await readMeta(input.storeId).catch(() => null);
    if (existing) {
      return { storeId: existing.storeId, title: existing.title, fileRefs: existing.files, readable: true };
    }
    const meta: StoreMeta = { storeId: input.storeId, title: input.title, files: [] };
    await writeMeta(meta);
    return { storeId: meta.storeId, title: meta.title, fileRefs: [], readable: true };
  }

  // org scoping seam: same as createStore above.
  async function addFile(storeId: string, input: { title: string; content: string; fileId?: string }): Promise<KnowledgeFileRef> {
    const meta = await readMeta(storeId);
    const fileId = input.fileId ?? randomUUID();
    const fileRef: KnowledgeFileRef = { fileId, title: input.title, path: relativeFilePath(storeId, fileId) };
    await writeFile(filePath(storeId, fileId), input.content, "utf-8");
    meta.files = [...meta.files.filter((f) => f.fileId !== fileId), fileRef];
    await writeMeta(meta);
    return fileRef;
  }

  // org scoping seam: filter by organization_id once the auth/org lane lands.
  async function listFiles(storeId: string): Promise<KnowledgeFileRef[]> {
    const meta = await readMeta(storeId);
    return meta.files;
  }

  // org scoping seam: same as listFiles above.
  async function readFile(storeId: string, fileId: string): Promise<string> {
    const meta = await readMeta(storeId);
    const fileRef = meta.files.find((f) => f.fileId === fileId);
    if (!fileRef) throw new Error(`Knowledge file not found: ${storeId}/${fileId}`);
    return readFileFs(filePath(storeId, fileId), "utf-8");
  }

  // org scoping seam: scope the delete by organization_id once the auth/org lane lands.
  async function removeFile(storeId: string, fileId: string): Promise<void> {
    const meta = await readMeta(storeId);
    if (!meta.files.some((f) => f.fileId === fileId)) return; // ponytail: idempotent no-op, not a CRUD error path
    meta.files = meta.files.filter((f) => f.fileId !== fileId);
    await writeMeta(meta);
    await rm(filePath(storeId, fileId), { force: true });
  }

  async function writeArtifactFile(storeId: string, title: string, content: string): Promise<{ storeId: string; fileRef: KnowledgeFileRef }> {
    // Campaign tool_commit write path (Decision 2 dependency): same CRUD,
    // create-if-missing since a campaign may target a store on first commit.
    await createStore({ storeId, title });
    const fileRef = await addFile(storeId, { title, content });
    return { storeId, fileRef };
  }

  return { createStore, addFile, listFiles, readFile, removeFile, writeArtifactFile };
}

/** Neon-backed KnowledgeStore. Files are small human-readable markdown/plaintext
 *  (v1 doctrine, see file header) so content lives in Neon text alongside
 *  metadata rather than splitting across FS + DB -- the smaller diff, and it
 *  actually fixes durability on Workers (a file-content-on-disk split would
 *  still be ephemeral there). Schema: packages/workspace-session/migrations/
 *  postgres/0006_agent_knowledge.sql. Large-blob future: swap content storage
 *  to R2, same interface, if knowledge files stop being small/text-only. */
function createNeonKnowledgeStore(databaseUrl: string): KnowledgeStore {
  const sql = neon(databaseUrl.trim());

  // org scoping seam: filter by organization_id once the auth/org lane lands
  // (shared existence check underneath every read/mutation below).
  async function ensureStoreExists(storeId: string): Promise<void> {
    const rows = await sql`select 1 from sonik_agent_ui.agent_knowledge_stores where store_id = ${storeId}`;
    if (rows.length === 0) throw new Error(`Knowledge store not found: ${storeId}`);
  }

  async function createStore(input: { storeId: string; title: string }): Promise<KnowledgeRef> {
    const storeId = sanitizeId(input.storeId);
    // org scoping seam: add organization_id + filter once the auth/org lane
    // resolves a trusted caller identity -- knowledge stores are process-wide
    // across tenants until then.
    await sql`
      insert into sonik_agent_ui.agent_knowledge_stores (store_id, title)
      values (${storeId}, ${input.title})
      on conflict (store_id) do nothing
    `;
    const rows = await sql`select title from sonik_agent_ui.agent_knowledge_stores where store_id = ${storeId}`;
    const title = (rows[0] as { title: string } | undefined)?.title ?? input.title;
    return { storeId, title, fileRefs: await listFiles(storeId), readable: true };
  }

  // org scoping seam: same as createStore above.
  async function addFile(storeId: string, input: { title: string; content: string; fileId?: string }): Promise<KnowledgeFileRef> {
    await ensureStoreExists(storeId);
    const fileId = input.fileId ?? randomUUID();
    await sql`
      insert into sonik_agent_ui.agent_knowledge_files (store_id, file_id, title, content)
      values (${storeId}, ${fileId}, ${input.title}, ${input.content})
      on conflict (store_id, file_id) do update set title = excluded.title, content = excluded.content
    `;
    return { fileId, title: input.title, path: `${storeId}/${fileId}` };
  }

  // org scoping seam: filter by organization_id once the auth/org lane lands.
  async function listFiles(storeId: string): Promise<KnowledgeFileRef[]> {
    await ensureStoreExists(storeId);
    const rows = await sql`
      select file_id, title from sonik_agent_ui.agent_knowledge_files
      where store_id = ${storeId}
      order by created_at asc
    `;
    return (rows as { file_id: string; title: string }[]).map((row) => ({ fileId: row.file_id, title: row.title, path: `${storeId}/${row.file_id}` }));
  }

  // org scoping seam: same as listFiles above.
  async function readFile(storeId: string, fileId: string): Promise<string> {
    const rows = await sql`select content from sonik_agent_ui.agent_knowledge_files where store_id = ${storeId} and file_id = ${fileId}`;
    if (rows.length === 0) throw new Error(`Knowledge file not found: ${storeId}/${fileId}`);
    return (rows[0] as { content: string }).content;
  }

  // org scoping seam: scope the delete by organization_id once the auth/org lane lands.
  async function removeFile(storeId: string, fileId: string): Promise<void> {
    await sql`delete from sonik_agent_ui.agent_knowledge_files where store_id = ${storeId} and file_id = ${fileId}`; // idempotent no-op if absent, matches file-based store
  }

  // org scoping seam: same as createStore above.
  async function writeArtifactFile(storeId: string, title: string, content: string): Promise<{ storeId: string; fileRef: KnowledgeFileRef }> {
    await sql`insert into sonik_agent_ui.agent_knowledge_stores (store_id, title) values (${storeId}, ${title}) on conflict (store_id) do nothing`;
    const fileRef = await addFile(storeId, { title, content });
    return { storeId, fileRef };
  }

  return { createStore, addFile, listFiles, readFile, removeFile, writeArtifactFile };
}
