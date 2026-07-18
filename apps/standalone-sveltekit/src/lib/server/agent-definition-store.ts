// Phase 4 (agent-creation-tool-plan-2026-07-13.md): persist DRAFT agent
// definitions and publish them into the shipped marketplace envelope --
// MarketplacePackageVersion{kind:"agent"}, immutable packageVersionId (D002),
// install-mode pinned (D014). Draft vs. published is entirely about WHERE a
// definition lives (this store's draft map vs. an immutable published
// version); no mutable state enum belongs on the definition itself (D002/D020).
//
// Mirrors workspace-store.ts's shape: thin, typed functions delegating to one
// underlying store. ponytail: an in-memory, single-process store -- the
// smallest thing that actually round-trips edit -> publish -> next
// conversation within one running server, matching knowledge-store.ts's own
// choice (file-based) of a focused store over the full workspace-session
// cloud/memory adapter. Upgrade path if agent definitions need cross-instance
// or restart-durable persistence: a workspace-session-style adapter.

import { createHash } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import {
  agentDefinitionSchema,
  marketplaceManifestSchema,
  marketplacePackageVersionSchema,
  createMarketplacePackageVersion,
  type AgentDefinition,
  type MarketplaceManifest,
  type MarketplacePackageVersion,
} from "@sonik-agent-ui/tool-contracts/marketplace";

export interface AgentDefinitionDraftRecord {
  organizationId: string;
  agentId: string;
  definition: AgentDefinition;
  createdByUserId: string;
  updatedByUserId: string;
  updatedAt: string;
}

export const AGENT_DEFINITION_ACTIONS = ["view", "edit_draft", "publish", "start", "approve_commit", "inspect_org_history"] as const;
export type AgentDefinitionAction = (typeof AGENT_DEFINITION_ACTIONS)[number];

export interface AgentDefinitionAuthority {
  organizationId: string;
  userId: string;
  scopes: readonly string[];
}

type TrustedHostSession = {
  authenticated?: boolean;
  organizationId?: string | null;
  userId?: string | null;
  scopes?: readonly string[] | null;
};

export function agentDefinitionScope(action: AgentDefinitionAction): string {
  return `agent-definitions:${action}`;
}

export function agentDefinitionAuthorityFromHostSession(session: TrustedHostSession | null | undefined): AgentDefinitionAuthority | null {
  const organizationId = session?.organizationId?.trim();
  const userId = session?.userId?.trim();
  if (!session?.authenticated || !organizationId || !userId) return null;
  return { organizationId, userId, scopes: session.scopes ?? [] };
}

export function assertAgentDefinitionAuthorized(authority: AgentDefinitionAuthority | null | undefined, action: AgentDefinitionAction): asserts authority is AgentDefinitionAuthority {
  if (!authority?.organizationId?.trim() || !authority.userId?.trim()) throw new Error("agent_definition_owner_context_required");
  if (!authority.scopes.includes(agentDefinitionScope(action)) && !authority.scopes.includes("agent-definitions:*")) {
    throw new Error(`agent_definition_${action}_forbidden`);
  }
}

export interface PublishAgentDefinitionInput {
  agentId: string;
  /** Caller-supplied semver bump, e.g. "0.1.0" -- publishing the same
   *  packageVersionId twice is rejected (D002 immutability). */
  packageSemver: string;
  title?: string;
  publisher?: MarketplaceManifest["publisher"];
}

export interface AgentDefinitionStore {
  saveDraft(authority: AgentDefinitionAuthority, definition: AgentDefinition): AgentDefinitionDraftRecord;
  getDraft(authority: AgentDefinitionAuthority, agentId: string, action?: "view" | "start"): AgentDefinitionDraftRecord | null;
  listDrafts(authority: AgentDefinitionAuthority): AgentDefinitionDraftRecord[];
  deleteDraft(authority: AgentDefinitionAuthority, agentId: string): boolean;
  publish(authority: AgentDefinitionAuthority, input: PublishAgentDefinitionInput): MarketplacePackageVersion;
  listPublishedVersions(authority: AgentDefinitionAuthority, agentId: string): MarketplacePackageVersion[];
  /** The definition inside the most recently published version, or null if
   *  nothing has ever been published for this agentId (fallback-safe: callers
   *  must treat null as "no publish has happened yet", not an error). */
  resolvePublished(authority: AgentDefinitionAuthority, agentId: string, action?: "view" | "start"): AgentDefinition | null;
}

const DEFAULT_PUBLISHER: MarketplaceManifest["publisher"] = { publisherId: "sonik.first_party", displayName: "Sonik", type: "sonik" };

function manifestHashFor(manifestWithoutHash: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(manifestWithoutHash)).digest("hex")}`;
}

// P1 (production-readiness ledger): publish must reject a packageSemver that
// doesn't move a published agent forward, not just an exact duplicate (D002
// only catches the identical-version case). ponytail: numeric major.minor.patch
// prefix only, no pre-release/build-tag ordering -- semverLikeSchema allows a
// trailing "-beta"/"+build" suffix, which this ignores when comparing; upgrade
// to a real semver lib if pre-release ordering ever matters here.
function parseSemverPrefix(semver: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(semver.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Positive when `next` is newer than `latest`, 0 when equal, negative when older.
 *  Unparsable input (shouldn't happen past agentDefinitionSchema/semverLikeSchema
 *  validation) never blocks -- publish's other checks still catch the real
 *  duplicate case. */
function compareSemverPrefix(next: string, latest: string): number {
  const nextParts = parseSemverPrefix(next);
  const latestParts = parseSemverPrefix(latest);
  if (!nextParts || !latestParts) return 1;
  for (let i = 0; i < 3; i++) {
    if (nextParts[i] !== latestParts[i]) return nextParts[i] - latestParts[i];
  }
  return 0;
}

function assertSemverAdvancesPast(agentId: string, packageSemver: string, latestPublishedSemver: string | undefined): void {
  if (latestPublishedSemver === undefined) return;
  if (compareSemverPrefix(packageSemver, latestPublishedSemver) <= 0) {
    throw new Error(
      `packageSemver ${packageSemver} must be greater than the latest published semver ${latestPublishedSemver} for ${agentId} (monotonic increase required)`,
    );
  }
}

/** Shared by every backing (in-memory + Neon): builds the immutable published
 *  MarketplacePackageVersion{kind:"agent"} envelope for a draft (D002). Pulled
 *  out so the Neon-backed store (below) doesn't hand-roll a second copy of the
 *  manifest-construction rules. */
function buildAgentDefinitionPackageVersion(
  draftDefinition: AgentDefinition,
  input: PublishAgentDefinitionInput,
  packageVersionId: string,
): MarketplacePackageVersion {
  const manifestWithoutHash = {
    marketplaceSchemaVersion: "1" as const,
    packageId: draftDefinition.agentId,
    packageVersionId,
    packageSemver: input.packageSemver,
    kind: "agent" as const,
    title: input.title ?? draftDefinition.title,
    publisher: input.publisher ?? DEFAULT_PUBLISHER,
    payload: { agent: draftDefinition },
  };
  const manifestHash = manifestHashFor(manifestWithoutHash);
  const manifest = marketplaceManifestSchema.parse({ ...manifestWithoutHash, manifestHash });
  return createMarketplacePackageVersion({
    packageVersionId,
    packageId: draftDefinition.agentId,
    packageSemver: input.packageSemver,
    marketplaceSchemaVersion: "1",
    manifest,
    changelog: "",
  });
}

export function parseStoredAgentDefinition(value: unknown): AgentDefinition {
  return agentDefinitionSchema.parse(typeof value === "string" ? JSON.parse(value) : structuredClone(value));
}

export function createInMemoryAgentDefinitionStore(): AgentDefinitionStore {
  const drafts = new Map<string, AgentDefinitionDraftRecord>();
  // organizationId + agentId -> published versions, oldest first.
  const publishedVersions = new Map<string, MarketplacePackageVersion[]>();
  const key = (authority: AgentDefinitionAuthority, agentId: string) => JSON.stringify([authority.organizationId, agentId]);

  function saveDraft(authority: AgentDefinitionAuthority, definition: AgentDefinition): AgentDefinitionDraftRecord {
    assertAgentDefinitionAuthorized(authority, "edit_draft");
    const parsed = agentDefinitionSchema.parse(structuredClone(definition));
    const existing = drafts.get(key(authority, parsed.agentId));
    const record: AgentDefinitionDraftRecord = {
      organizationId: authority.organizationId,
      agentId: parsed.agentId,
      definition: parsed,
      createdByUserId: existing?.createdByUserId ?? authority.userId,
      updatedByUserId: authority.userId,
      updatedAt: new Date().toISOString(),
    };
    drafts.set(key(authority, parsed.agentId), record);
    return structuredClone(record);
  }

  function getDraft(authority: AgentDefinitionAuthority, agentId: string, action: "view" | "start" = "view"): AgentDefinitionDraftRecord | null {
    assertAgentDefinitionAuthorized(authority, action);
    const draft = drafts.get(key(authority, agentId));
    return draft ? structuredClone(draft) : null;
  }

  function listDrafts(authority: AgentDefinitionAuthority): AgentDefinitionDraftRecord[] {
    assertAgentDefinitionAuthorized(authority, "inspect_org_history");
    return structuredClone([...drafts.values()].filter((draft) => draft.organizationId === authority.organizationId));
  }

  function deleteDraft(authority: AgentDefinitionAuthority, agentId: string): boolean {
    assertAgentDefinitionAuthorized(authority, "edit_draft");
    return drafts.delete(key(authority, agentId));
  }

  function publish(authority: AgentDefinitionAuthority, input: PublishAgentDefinitionInput): MarketplacePackageVersion {
    assertAgentDefinitionAuthorized(authority, "publish");
    const scopedKey = key(authority, input.agentId);
    const draft = drafts.get(scopedKey);
    if (!draft) throw new Error(`No draft agent definition found for ${input.agentId}`);
    const packageVersionId = `${draft.agentId}@${input.packageSemver}`;
    const existing = publishedVersions.get(scopedKey) ?? [];
    if (existing.some((version) => version.packageVersionId === packageVersionId)) {
      throw new Error(`Package version ${packageVersionId} is already published (packageVersionId is immutable, D002) -- bump packageSemver`);
    }
    assertSemverAdvancesPast(draft.agentId, input.packageSemver, existing.at(-1)?.packageSemver);
    const version = buildAgentDefinitionPackageVersion(draft.definition, input, packageVersionId);
    publishedVersions.set(scopedKey, [...existing, structuredClone(version)]);
    return structuredClone(version);
  }

  function listPublishedVersions(authority: AgentDefinitionAuthority, agentId: string): MarketplacePackageVersion[] {
    assertAgentDefinitionAuthorized(authority, "view");
    return structuredClone(publishedVersions.get(key(authority, agentId)) ?? []);
  }

  function resolvePublished(authority: AgentDefinitionAuthority, agentId: string, action: "view" | "start" = "view"): AgentDefinition | null {
    assertAgentDefinitionAuthorized(authority, action);
    const versions = publishedVersions.get(key(authority, agentId));
    if (!versions || versions.length === 0) return null;
    const definition = versions[versions.length - 1].manifest.payload.agent;
    return definition ? structuredClone(definition) : null;
  }

  return { saveDraft, getDraft, listDrafts, deleteDraft, publish, listPublishedVersions, resolvePublished };
}

/** Module-level singleton for the running process, mirroring workspace-store.ts's
 *  `workspacePersistence` singleton pattern. */
export const agentDefinitionStore: AgentDefinitionStore = createInMemoryAgentDefinitionStore();

// marketplacePackageVersionSchema re-exported only for tests that want to
// validate a version object shape without importing the package directly.
export { marketplacePackageVersionSchema };

// --- Durable (Neon) backing, P0 #1 (production-readiness-agent-creation-2026-07-13.md) ---
//
// The store above is kept exactly as-is (in-memory, fully synchronous) as the
// local-dev/test fallback -- it's what createInMemoryAgentDefinitionStore()
// always was, and tests that construct it directly keep working unmodified.
// Neon queries are inherently async, so durable persistence is exposed as a
// SEPARATE async-returning interface (mirrors workspace-store.ts's split:
// its sync singleton is memory-only; a Neon-backed adapter is resolved
// per-request via workspace-services.ts's createRequestWorkspaceServices).
// Callers opt in by calling resolveAgentDefinitionStore(env) and awaiting.
export interface AsyncAgentDefinitionStore {
  saveDraft(authority: AgentDefinitionAuthority, definition: AgentDefinition): Promise<AgentDefinitionDraftRecord>;
  getDraft(authority: AgentDefinitionAuthority, agentId: string, action?: "view" | "start"): Promise<AgentDefinitionDraftRecord | null>;
  listDrafts(authority: AgentDefinitionAuthority): Promise<AgentDefinitionDraftRecord[]>;
  deleteDraft(authority: AgentDefinitionAuthority, agentId: string): Promise<boolean>;
  publish(authority: AgentDefinitionAuthority, input: PublishAgentDefinitionInput): Promise<MarketplacePackageVersion>;
  listPublishedVersions(authority: AgentDefinitionAuthority, agentId: string): Promise<MarketplacePackageVersion[]>;
  resolvePublished(authority: AgentDefinitionAuthority, agentId: string, action?: "view" | "start"): Promise<AgentDefinition | null>;
}

/** Wraps the synchronous in-memory store in a Promise-returning facade so
 *  callers can `await` regardless of which backing is actually live. A sync
 *  throw inside an `async` function rejects the returned Promise, so publish's
 *  immutability rejection (D002) still surfaces the same way. */
export function wrapAgentDefinitionStoreAsync(store: AgentDefinitionStore): AsyncAgentDefinitionStore {
  return {
    saveDraft: async (authority, definition) => store.saveDraft(authority, definition),
    getDraft: async (authority, agentId, action) => store.getDraft(authority, agentId, action),
    listDrafts: async (authority) => store.listDrafts(authority),
    deleteDraft: async (authority, agentId) => store.deleteDraft(authority, agentId),
    publish: async (authority, input) => store.publish(authority, input),
    listPublishedVersions: async (authority, agentId) => store.listPublishedVersions(authority, agentId),
    resolvePublished: async (authority, agentId, action) => store.resolvePublished(authority, agentId, action),
  };
}

/** Neon-backed AsyncAgentDefinitionStore. Drafts are keyed by agentId (upsert);
 *  published versions are APPEND-ONLY, keyed by immutable packageVersionId
 *  (D002) -- republishing the same packageVersionId is rejected exactly like
 *  the in-memory store. Schema: packages/workspace-session/migrations/postgres/
 *  0005_agent_definitions.sql (same migration mechanism as workspace-store.ts;
 *  see scripts/run-postgres-migrations.mjs). */
export function createNeonAgentDefinitionStoreFromSql(sql: NeonQueryFunction<false, false>): AsyncAgentDefinitionStore {
  async function scopedRows(
    authority: AgentDefinitionAuthority,
    action: AgentDefinitionAction,
    query: ReturnType<typeof sql>,
  ): Promise<unknown[]> {
    assertAgentDefinitionAuthorized(authority, action);
    const results = await sql.transaction([
      sql`select sonik_agent_ui.set_request_context(${authority.organizationId}, ${authority.userId})`,
      query,
    ]);
    return results[1] as unknown[];
  }

  async function saveDraft(authority: AgentDefinitionAuthority, definition: AgentDefinition): Promise<AgentDefinitionDraftRecord> {
    const parsed = agentDefinitionSchema.parse(definition);
    const updatedAt = new Date().toISOString();
    const rows = await scopedRows(authority, "edit_draft", sql`
      insert into sonik_agent_ui.agent_definition_drafts (
        organization_id, agent_id, definition, created_by_user_id, updated_by_user_id, updated_at
      ) values (
        ${authority.organizationId}, ${parsed.agentId}, ${JSON.stringify(parsed)}::jsonb,
        ${authority.userId}, ${authority.userId}, ${updatedAt}
      )
      on conflict (organization_id, agent_id) where organization_id is not null
      do update set definition = excluded.definition, updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at
      returning organization_id, agent_id, definition, created_by_user_id, updated_by_user_id, updated_at
    `);
    const row = rows[0] as { organization_id: string; agent_id: string; definition: AgentDefinition; created_by_user_id: string; updated_by_user_id: string; updated_at: string };
    return {
      organizationId: row.organization_id,
      agentId: row.agent_id,
      definition: parseStoredAgentDefinition(row.definition),
      createdByUserId: row.created_by_user_id,
      updatedByUserId: row.updated_by_user_id,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async function getDraft(authority: AgentDefinitionAuthority, agentId: string, action: "view" | "start" = "view"): Promise<AgentDefinitionDraftRecord | null> {
    const rows = await scopedRows(authority, action, sql`
      select organization_id, agent_id, definition, created_by_user_id, updated_by_user_id, updated_at
      from sonik_agent_ui.agent_definition_drafts
      where organization_id = ${authority.organizationId} and agent_id = ${agentId}
    `);
    if (rows.length === 0) return null;
    const row = rows[0] as { organization_id: string; agent_id: string; definition: AgentDefinition; created_by_user_id: string; updated_by_user_id: string; updated_at: string };
    return {
      organizationId: row.organization_id,
      agentId: row.agent_id,
      definition: parseStoredAgentDefinition(row.definition),
      createdByUserId: row.created_by_user_id,
      updatedByUserId: row.updated_by_user_id,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async function listDrafts(authority: AgentDefinitionAuthority): Promise<AgentDefinitionDraftRecord[]> {
    const rows = await scopedRows(authority, "inspect_org_history", sql`
      select organization_id, agent_id, definition, created_by_user_id, updated_by_user_id, updated_at
      from sonik_agent_ui.agent_definition_drafts
      where organization_id = ${authority.organizationId}
    `);
    return (rows as { organization_id: string; agent_id: string; definition: AgentDefinition; created_by_user_id: string; updated_by_user_id: string; updated_at: string }[]).map((row) => ({
      organizationId: row.organization_id,
      agentId: row.agent_id,
      definition: parseStoredAgentDefinition(row.definition),
      createdByUserId: row.created_by_user_id,
      updatedByUserId: row.updated_by_user_id,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async function deleteDraft(authority: AgentDefinitionAuthority, agentId: string): Promise<boolean> {
    const rows = await scopedRows(authority, "edit_draft", sql`
      delete from sonik_agent_ui.agent_definition_drafts
      where organization_id = ${authority.organizationId} and agent_id = ${agentId}
      returning agent_id
    `);
    return rows.length > 0;
  }

  async function publish(authority: AgentDefinitionAuthority, input: PublishAgentDefinitionInput): Promise<MarketplacePackageVersion> {
    assertAgentDefinitionAuthorized(authority, "publish");
    const draftRows = await scopedRows(authority, "publish", sql`
      select agent_id, definition from sonik_agent_ui.agent_definition_drafts
      where organization_id = ${authority.organizationId} and agent_id = ${input.agentId}
    `);
    const draft = draftRows[0] as { agent_id: string; definition: unknown } | undefined;
    if (!draft) throw new Error(`No draft agent definition found for ${input.agentId}`);
    const draftDefinition = parseStoredAgentDefinition(draft.definition);
    const packageVersionId = `${draft.agent_id}@${input.packageSemver}`;
    const existing = await scopedRows(authority, "publish", sql`
      select 1 from sonik_agent_ui.agent_definition_published_versions
      where organization_id = ${authority.organizationId} and package_version_id = ${packageVersionId}
    `);
    if (existing.length > 0) {
      throw new Error(`Package version ${packageVersionId} is already published (packageVersionId is immutable, D002) -- bump packageSemver`);
    }
    const latestRows = await scopedRows(authority, "publish", sql`
      select version ->> 'packageSemver' as package_semver from sonik_agent_ui.agent_definition_published_versions
      where organization_id = ${authority.organizationId} and agent_id = ${input.agentId}
      order by seq desc
      limit 1
    `);
    assertSemverAdvancesPast(draft.agent_id, input.packageSemver, (latestRows[0] as { package_semver: string } | undefined)?.package_semver);
    const version = buildAgentDefinitionPackageVersion(draftDefinition, input, packageVersionId);
    await scopedRows(authority, "publish", sql`
      insert into sonik_agent_ui.agent_definition_published_versions (
        organization_id, package_version_id, agent_id, version, created_by_user_id
      ) values (
        ${authority.organizationId}, ${packageVersionId}, ${draft.agent_id}, ${JSON.stringify(version)}::jsonb, ${authority.userId}
      )
      returning package_version_id
    `);
    return version;
  }

  async function listPublishedVersions(authority: AgentDefinitionAuthority, agentId: string): Promise<MarketplacePackageVersion[]> {
    const rows = await scopedRows(authority, "view", sql`
      select version from sonik_agent_ui.agent_definition_published_versions
      where organization_id = ${authority.organizationId} and agent_id = ${agentId}
      order by seq asc
    `);
    return (rows as { version: unknown }[]).map((row) => marketplacePackageVersionSchema.parse(row.version));
  }

  async function resolvePublished(authority: AgentDefinitionAuthority, agentId: string, action: "view" | "start" = "view"): Promise<AgentDefinition | null> {
    const rows = await scopedRows(authority, action, sql`
      select version from sonik_agent_ui.agent_definition_published_versions
      where organization_id = ${authority.organizationId} and agent_id = ${agentId}
      order by seq desc
      limit 1
    `);
    if (rows.length === 0) return null;
    const version = marketplacePackageVersionSchema.parse((rows[0] as { version: unknown }).version);
    return version.manifest.payload.agent ?? null;
  }

  return { saveDraft, getDraft, listDrafts, deleteDraft, publish, listPublishedVersions, resolvePublished };
}

export function createNeonAgentDefinitionStore(databaseUrl: string): AsyncAgentDefinitionStore {
  return createNeonAgentDefinitionStoreFromSql(neon(databaseUrl.trim()));
}

function readAgentDefinitionDatabaseUrl(env?: Record<string, unknown> | null): string | null {
  // Same env var names/precedence as workspace-services.ts's resolveCloudWorkspaceRuntime,
  // so one deploy env config (SONIK_AGENT_UI_DATABASE_URL) backs both stores.
  for (const key of ["SONIK_AGENT_UI_DATABASE_URL", "DATABASE_URL", "POSTGRES_URL", "NEON_DATABASE_URL"]) {
    const value = env?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Per-request resolution: Neon-backed when a DB env is configured, else the
 *  in-memory singleton wrapped async. Callers (routes) call this once per
 *  request and await every call -- no code change needed when a DB is wired
 *  up later, since the interface is identical either way. */
export function resolveAgentDefinitionStore(env?: Record<string, unknown> | null): AsyncAgentDefinitionStore {
  const databaseUrl = readAgentDefinitionDatabaseUrl(env);
  return databaseUrl ? createNeonAgentDefinitionStore(databaseUrl) : wrapAgentDefinitionStoreAsync(agentDefinitionStore);
}
