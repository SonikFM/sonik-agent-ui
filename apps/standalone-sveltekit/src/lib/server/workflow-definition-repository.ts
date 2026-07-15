import { createHash } from "node:crypto";
import type { WorkflowDependencyPins, WorkflowVNextDefinition } from "@sonik-agent-ui/tool-contracts/workflow-vnext";
import type { WorkspaceSqlExecutor, WorkspaceSqlTransaction } from "@sonik-agent-ui/workspace-session";
import { createNeonWorkspaceSqlExecutor } from "./workspace-cloud-sql.ts";

export interface WorkflowDefinitionOwner {
  organizationId: string;
  userId: string;
}

export interface WorkflowDraftRecord extends WorkflowDefinitionOwner {
  workflowId: string;
  draftRevision: number;
  definitionDigest: string;
  definition: WorkflowVNextDefinition;
  archivedAt: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishedWorkflowRecord extends WorkflowDefinitionOwner {
  workflowId: string;
  workflowVersionId: string;
  sourceDraftRevision: number;
  definitionDigest: string;
  definition: WorkflowVNextDefinition;
  dependencyPins: WorkflowDependencyPins;
  publishedBy: string;
  publishedAt: string;
}

export type WorkflowDefinitionPin =
  | { kind: "draft"; workflowId: string; draftRevision: number; definitionDigest: string }
  | { kind: "published"; workflowVersionId: string; definitionDigest: string };

export interface WorkflowDefinitionRepository {
  createDraft(owner: WorkflowDefinitionOwner, definition: WorkflowVNextDefinition, actorId: string): Promise<WorkflowDraftRecord | null>;
  updateDraft(owner: WorkflowDefinitionOwner, workflowId: string, expectedRevision: number, definition: WorkflowVNextDefinition, actorId: string): Promise<WorkflowDraftRecord | null>;
  getDraft(owner: WorkflowDefinitionOwner, workflowId: string): Promise<WorkflowDraftRecord | null>;
  listDrafts(owner: WorkflowDefinitionOwner, includeArchived?: boolean): Promise<WorkflowDraftRecord[]>;
  archiveDraft(owner: WorkflowDefinitionOwner, workflowId: string, expectedRevision: number, actorId: string): Promise<WorkflowDraftRecord | null>;
  publish(owner: WorkflowDefinitionOwner, input: { workflowId: string; expectedRevision: number; workflowVersionId: string; definitionDigest: string; dependencyPins: WorkflowDependencyPins; actorId: string }): Promise<PublishedWorkflowRecord | null>;
  getPublished(owner: WorkflowDefinitionOwner, workflowVersionId: string): Promise<PublishedWorkflowRecord | null>;
  listPublished(owner: WorkflowDefinitionOwner, workflowId: string): Promise<PublishedWorkflowRecord[]>;
  resolvePin(owner: WorkflowDefinitionOwner, pin: WorkflowDefinitionPin): Promise<WorkflowDraftRecord | PublishedWorkflowRecord | null>;
}

export function workflowDefinitionDigest(definition: WorkflowVNextDefinition): string {
  return `sha256:${createHash("sha256").update(canonicalJson(definition)).digest("hex")}`;
}

export function createInMemoryWorkflowDefinitionRepository(): WorkflowDefinitionRepository {
  const drafts = new Map<string, WorkflowDraftRecord>();
  const versions = new Map<string, PublishedWorkflowRecord>();

  return {
    async createDraft(ownerInput, definition, actorId) {
      const owner = normalizeOwner(ownerInput);
      const key = draftKey(owner, definition.workflowId);
      if (drafts.has(key)) return null;
      const now = new Date().toISOString();
      const row: WorkflowDraftRecord = { ...owner, workflowId: definition.workflowId, draftRevision: 0, definitionDigest: workflowDefinitionDigest(definition), definition: clone(definition), archivedAt: null, createdBy: actorId, updatedBy: actorId, createdAt: now, updatedAt: now };
      drafts.set(key, row);
      return clone(row);
    },
    async updateDraft(ownerInput, workflowId, expectedRevision, definition, actorId) {
      const owner = normalizeOwner(ownerInput);
      const key = draftKey(owner, workflowId);
      const existing = drafts.get(key);
      if (!existing || existing.archivedAt || existing.draftRevision !== expectedRevision) return null;
      const updated: WorkflowDraftRecord = { ...existing, draftRevision: existing.draftRevision + 1, definitionDigest: workflowDefinitionDigest(definition), definition: clone(definition), updatedBy: actorId, updatedAt: new Date().toISOString() };
      drafts.set(key, updated);
      return clone(updated);
    },
    async getDraft(ownerInput, workflowId) {
      const row = drafts.get(draftKey(normalizeOwner(ownerInput), workflowId));
      return row ? clone(row) : null;
    },
    async listDrafts(ownerInput, includeArchived = false) {
      const owner = normalizeOwner(ownerInput);
      return [...drafts.values()].filter((row) => row.organizationId === owner.organizationId && row.userId === owner.userId && (includeArchived || !row.archivedAt)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(clone);
    },
    async archiveDraft(ownerInput, workflowId, expectedRevision, actorId) {
      const owner = normalizeOwner(ownerInput);
      const key = draftKey(owner, workflowId);
      const existing = drafts.get(key);
      if (!existing || existing.archivedAt || existing.draftRevision !== expectedRevision) return null;
      const now = new Date().toISOString();
      const archived: WorkflowDraftRecord = { ...existing, draftRevision: existing.draftRevision + 1, archivedAt: now, updatedBy: actorId, updatedAt: now };
      drafts.set(key, archived);
      return clone(archived);
    },
    async publish(ownerInput, input) {
      const owner = normalizeOwner(ownerInput);
      const draft = drafts.get(draftKey(owner, input.workflowId));
      if (!draft || draft.archivedAt || draft.draftRevision !== input.expectedRevision || draft.definitionDigest !== input.definitionDigest || versions.has(versionKey(owner, input.workflowVersionId))) return null;
      const row: PublishedWorkflowRecord = { ...owner, workflowId: draft.workflowId, workflowVersionId: input.workflowVersionId, sourceDraftRevision: draft.draftRevision, definitionDigest: draft.definitionDigest, definition: clone(draft.definition), dependencyPins: clone(input.dependencyPins), publishedBy: input.actorId, publishedAt: new Date().toISOString() };
      versions.set(versionKey(owner, input.workflowVersionId), row);
      return clone(row);
    },
    async getPublished(ownerInput, workflowVersionId) {
      const row = versions.get(versionKey(normalizeOwner(ownerInput), workflowVersionId));
      return row ? clone(row) : null;
    },
    async listPublished(ownerInput, workflowId) {
      const owner = normalizeOwner(ownerInput);
      return [...versions.values()].filter((row) => row.organizationId === owner.organizationId && row.userId === owner.userId && row.workflowId === workflowId).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map(clone);
    },
    async resolvePin(owner, pin) {
      if (pin.kind === "published") {
        const row = await this.getPublished(owner, pin.workflowVersionId);
        return row?.definitionDigest === pin.definitionDigest ? row : null;
      }
      const row = await this.getDraft(owner, pin.workflowId);
      return row?.draftRevision === pin.draftRevision && row.definitionDigest === pin.definitionDigest ? row : null;
    },
  };
}

type DraftColumns = { organization_id: string; user_id: string; workflow_id: string; draft_revision: number | string; definition_digest: string; definition: WorkflowVNextDefinition | string; archived_at: string | null; created_by: string; updated_by: string; created_at: string; updated_at: string };
type PublishedColumns = { organization_id: string; user_id: string; workflow_id: string; workflow_version_id: string; source_draft_revision: number | string; definition_digest: string; definition: WorkflowVNextDefinition | string; dependency_pins: WorkflowDependencyPins | string; published_by: string; published_at: string };
const DRAFT_COLUMNS = "organization_id, user_id, workflow_id, draft_revision, definition_digest, definition, archived_at, created_by, updated_by, created_at, updated_at";
const PUBLISHED_COLUMNS = "organization_id, user_id, workflow_id, workflow_version_id, source_draft_revision, definition_digest, definition, dependency_pins, published_by, published_at";

export function createCloudWorkflowDefinitionRepository(executor: WorkspaceSqlExecutor): WorkflowDefinitionRepository {
  return {
    createDraft: (owner, definition, actorId) => withOwner(executor, owner, async (tx, scope) => rowOrNull(await tx.query<DraftColumns>(`insert into sonik_agent_ui.workflow_definition_drafts (organization_id, user_id, workflow_id, definition_digest, definition, created_by, updated_by) values ($1, $2, $3, $4, $5::jsonb, $6, $6) on conflict do nothing returning ${DRAFT_COLUMNS}`, [scope.organizationId, scope.userId, definition.workflowId, workflowDefinitionDigest(definition), JSON.stringify(definition), actorId]), draftFromColumns)),
    updateDraft: (owner, workflowId, expectedRevision, definition, actorId) => withOwner(executor, owner, async (tx, scope) => rowOrNull(await tx.query<DraftColumns>(`update sonik_agent_ui.workflow_definition_drafts set draft_revision = draft_revision + 1, definition_digest = $5, definition = $6::jsonb, updated_by = $7, updated_at = now() where organization_id = $1 and user_id = $2 and workflow_id = $3 and draft_revision = $4 and archived_at is null returning ${DRAFT_COLUMNS}`, [scope.organizationId, scope.userId, workflowId, expectedRevision, workflowDefinitionDigest(definition), JSON.stringify(definition), actorId]), draftFromColumns)),
    getDraft: (owner, workflowId) => withOwner(executor, owner, async (tx, scope) => rowOrNull(await tx.query<DraftColumns>(`select ${DRAFT_COLUMNS} from sonik_agent_ui.workflow_definition_drafts where organization_id = $1 and user_id = $2 and workflow_id = $3`, [scope.organizationId, scope.userId, workflowId]), draftFromColumns)),
    listDrafts: (owner, includeArchived = false) => withOwner(executor, owner, async (tx, scope) => (await tx.query<DraftColumns>(`select ${DRAFT_COLUMNS} from sonik_agent_ui.workflow_definition_drafts where organization_id = $1 and user_id = $2 and ($3::boolean or archived_at is null) order by updated_at desc`, [scope.organizationId, scope.userId, includeArchived])).rows.map(draftFromColumns)),
    archiveDraft: (owner, workflowId, expectedRevision, actorId) => withOwner(executor, owner, async (tx, scope) => rowOrNull(await tx.query<DraftColumns>(`update sonik_agent_ui.workflow_definition_drafts set draft_revision = draft_revision + 1, archived_at = now(), updated_by = $5, updated_at = now() where organization_id = $1 and user_id = $2 and workflow_id = $3 and draft_revision = $4 and archived_at is null returning ${DRAFT_COLUMNS}`, [scope.organizationId, scope.userId, workflowId, expectedRevision, actorId]), draftFromColumns)),
    publish: (owner, input) => withOwner(executor, owner, async (tx, scope) => rowOrNull(await tx.query<PublishedColumns>(`insert into sonik_agent_ui.workflow_definition_published_versions (organization_id, user_id, workflow_id, workflow_version_id, source_draft_revision, definition_digest, definition, dependency_pins, published_by) select organization_id, user_id, workflow_id, $5, draft_revision, definition_digest, definition, $7::jsonb, $8 from sonik_agent_ui.workflow_definition_drafts where organization_id = $1 and user_id = $2 and workflow_id = $3 and draft_revision = $4 and definition_digest = $6 and archived_at is null on conflict do nothing returning ${PUBLISHED_COLUMNS}`, [scope.organizationId, scope.userId, input.workflowId, input.expectedRevision, input.workflowVersionId, input.definitionDigest, JSON.stringify(input.dependencyPins), input.actorId]), publishedFromColumns)),
    getPublished: (owner, workflowVersionId) => withOwner(executor, owner, async (tx, scope) => rowOrNull(await tx.query<PublishedColumns>(`select ${PUBLISHED_COLUMNS} from sonik_agent_ui.workflow_definition_published_versions where organization_id = $1 and user_id = $2 and workflow_version_id = $3`, [scope.organizationId, scope.userId, workflowVersionId]), publishedFromColumns)),
    listPublished: (owner, workflowId) => withOwner(executor, owner, async (tx, scope) => (await tx.query<PublishedColumns>(`select ${PUBLISHED_COLUMNS} from sonik_agent_ui.workflow_definition_published_versions where organization_id = $1 and user_id = $2 and workflow_id = $3 order by published_at desc`, [scope.organizationId, scope.userId, workflowId])).rows.map(publishedFromColumns)),
    resolvePin: (owner, pin) => withOwner(executor, owner, async (tx, scope) => pin.kind === "published"
      ? rowOrNull(await tx.query<PublishedColumns>(`select ${PUBLISHED_COLUMNS} from sonik_agent_ui.workflow_definition_published_versions where organization_id = $1 and user_id = $2 and workflow_version_id = $3 and definition_digest = $4`, [scope.organizationId, scope.userId, pin.workflowVersionId, pin.definitionDigest]), publishedFromColumns)
      : rowOrNull(await tx.query<DraftColumns>(`select ${DRAFT_COLUMNS} from sonik_agent_ui.workflow_definition_drafts where organization_id = $1 and user_id = $2 and workflow_id = $3 and draft_revision = $4 and definition_digest = $5`, [scope.organizationId, scope.userId, pin.workflowId, pin.draftRevision, pin.definitionDigest]), draftFromColumns)),
  };
}

export function createNeonWorkflowDefinitionRepository(databaseUrl: string): WorkflowDefinitionRepository { return createCloudWorkflowDefinitionRepository(createNeonWorkspaceSqlExecutor(databaseUrl)); }
export function resolveWorkflowDefinitionRepository(env?: Record<string, unknown> | null): WorkflowDefinitionRepository {
  for (const key of ["SONIK_AGENT_UI_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL", "NEON_DATABASE_URL"]) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim()) return createNeonWorkflowDefinitionRepository(value.trim());
  }
  return inMemoryWorkflowDefinitionRepository;
}
export const inMemoryWorkflowDefinitionRepository = createInMemoryWorkflowDefinitionRepository();

async function withOwner<T>(executor: WorkspaceSqlExecutor, ownerInput: WorkflowDefinitionOwner, operation: (tx: WorkspaceSqlTransaction, owner: WorkflowDefinitionOwner) => Promise<T>): Promise<T> {
  const owner = normalizeOwner(ownerInput);
  return executor.transaction(async (tx) => { await tx.query("select sonik_agent_ui.set_request_context($1, $2)", [owner.organizationId, owner.userId]); return operation(tx, owner); });
}
function normalizeOwner(owner: WorkflowDefinitionOwner): WorkflowDefinitionOwner {
  const organizationId = owner.organizationId?.trim();
  const userId = owner.userId?.trim();
  if (!organizationId || !userId) throw new Error("Workflow definition persistence requires organizationId and userId");
  return { organizationId, userId };
}
function draftKey(owner: WorkflowDefinitionOwner, workflowId: string): string { return JSON.stringify([owner.organizationId, owner.userId, workflowId]); }
function versionKey(owner: WorkflowDefinitionOwner, workflowVersionId: string): string { return JSON.stringify([owner.organizationId, owner.userId, workflowVersionId]); }
function canonicalJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`; return JSON.stringify(value); }
function clone<T>(value: T): T { return structuredClone(value); }
function parseJson<T>(value: T | string): T { return typeof value === "string" ? JSON.parse(value) as T : value; }
function draftFromColumns(row: DraftColumns): WorkflowDraftRecord { return { organizationId: row.organization_id, userId: row.user_id, workflowId: row.workflow_id, draftRevision: Number(row.draft_revision), definitionDigest: row.definition_digest, definition: parseJson(row.definition), archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null, createdBy: row.created_by, updatedBy: row.updated_by, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }; }
function publishedFromColumns(row: PublishedColumns): PublishedWorkflowRecord { return { organizationId: row.organization_id, userId: row.user_id, workflowId: row.workflow_id, workflowVersionId: row.workflow_version_id, sourceDraftRevision: Number(row.source_draft_revision), definitionDigest: row.definition_digest, definition: parseJson(row.definition), dependencyPins: parseJson(row.dependency_pins), publishedBy: row.published_by, publishedAt: new Date(row.published_at).toISOString() }; }
function rowOrNull<TColumns, TRow>(result: { rows: TColumns[] }, map: (row: TColumns) => TRow): TRow | null { return result.rows[0] ? map(result.rows[0]) : null; }
