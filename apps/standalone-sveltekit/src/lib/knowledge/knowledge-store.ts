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

export function createKnowledgeStore(rootDir: string): KnowledgeStore {
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

  async function addFile(storeId: string, input: { title: string; content: string; fileId?: string }): Promise<KnowledgeFileRef> {
    const meta = await readMeta(storeId);
    const fileId = input.fileId ?? randomUUID();
    const fileRef: KnowledgeFileRef = { fileId, title: input.title, path: relativeFilePath(storeId, fileId) };
    await writeFile(filePath(storeId, fileId), input.content, "utf-8");
    meta.files = [...meta.files.filter((f) => f.fileId !== fileId), fileRef];
    await writeMeta(meta);
    return fileRef;
  }

  async function listFiles(storeId: string): Promise<KnowledgeFileRef[]> {
    const meta = await readMeta(storeId);
    return meta.files;
  }

  async function readFile(storeId: string, fileId: string): Promise<string> {
    const meta = await readMeta(storeId);
    const fileRef = meta.files.find((f) => f.fileId === fileId);
    if (!fileRef) throw new Error(`Knowledge file not found: ${storeId}/${fileId}`);
    return readFileFs(filePath(storeId, fileId), "utf-8");
  }

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
