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
import { neon } from "@neondatabase/serverless";
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
  agentId: string;
  definition: AgentDefinition;
  updatedAt: string;
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
  saveDraft(definition: AgentDefinition): AgentDefinitionDraftRecord;
  getDraft(agentId: string): AgentDefinitionDraftRecord | null;
  listDrafts(): AgentDefinitionDraftRecord[];
  deleteDraft(agentId: string): boolean;
  publish(input: PublishAgentDefinitionInput): MarketplacePackageVersion;
  listPublishedVersions(agentId: string): MarketplacePackageVersion[];
  /** The definition inside the most recently published version, or null if
   *  nothing has ever been published for this agentId (fallback-safe: callers
   *  must treat null as "no publish has happened yet", not an error). */
  resolvePublished(agentId: string): AgentDefinition | null;
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

export function createInMemoryAgentDefinitionStore(): AgentDefinitionStore {
  const drafts = new Map<string, AgentDefinitionDraftRecord>();
  // agentId -> published versions, oldest first; "current" is the last entry.
  const publishedVersions = new Map<string, MarketplacePackageVersion[]>();

  function saveDraft(definition: AgentDefinition): AgentDefinitionDraftRecord {
    const parsed = agentDefinitionSchema.parse(definition);
    const record: AgentDefinitionDraftRecord = { agentId: parsed.agentId, definition: parsed, updatedAt: new Date().toISOString() };
    drafts.set(parsed.agentId, record);
    return record;
  }

  // org scoping seam: filter by organization_id once the auth/org lane lands --
  // drafts are process-wide across tenants until then (same seam as saveDraft above).
  function getDraft(agentId: string): AgentDefinitionDraftRecord | null {
    return drafts.get(agentId) ?? null;
  }

  // org scoping seam: filter by organization_id once the auth/org lane lands.
  function listDrafts(): AgentDefinitionDraftRecord[] {
    return [...drafts.values()];
  }

  // org scoping seam: scope the delete by organization_id once the auth/org lane lands.
  function deleteDraft(agentId: string): boolean {
    return drafts.delete(agentId);
  }

  function publish(input: PublishAgentDefinitionInput): MarketplacePackageVersion {
    const draft = drafts.get(input.agentId);
    if (!draft) throw new Error(`No draft agent definition found for ${input.agentId}`);
    const packageVersionId = `${draft.agentId}@${input.packageSemver}`;
    const existing = publishedVersions.get(draft.agentId) ?? [];
    if (existing.some((version) => version.packageVersionId === packageVersionId)) {
      throw new Error(`Package version ${packageVersionId} is already published (packageVersionId is immutable, D002) -- bump packageSemver`);
    }
    assertSemverAdvancesPast(draft.agentId, input.packageSemver, existing.at(-1)?.packageSemver);
    const version = buildAgentDefinitionPackageVersion(draft.definition, input, packageVersionId);
    publishedVersions.set(draft.agentId, [...existing, version]);
    return version;
  }

  // org scoping seam: filter by organization_id once the auth/org lane lands --
  // published versions are process-wide across tenants until then.
  function listPublishedVersions(agentId: string): MarketplacePackageVersion[] {
    return publishedVersions.get(agentId) ?? [];
  }

  // org scoping seam: same as listPublishedVersions above.
  function resolvePublished(agentId: string): AgentDefinition | null {
    const versions = publishedVersions.get(agentId);
    if (!versions || versions.length === 0) return null;
    return versions[versions.length - 1].manifest.payload.agent ?? null;
  }

  return { saveDraft, getDraft, listDrafts, deleteDraft, publish, listPublishedVersions, resolvePublished };
}

/** Module-level singleton for the running process, mirroring workspace-store.ts's
 *  `workspacePersistence` singleton pattern. */
export const agentDefinitionStore: AgentDefinitionStore = createInMemoryAgentDefinitionStore();

/** Fallback-safe: null means "nothing published yet", never an error -- the
 *  generate route's resolution must degrade to today's behavior on null. */
export function resolvePublishedAgentDefinition(agentId: string): AgentDefinition | null {
  return agentDefinitionStore.resolvePublished(agentId);
}

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
  saveDraft(definition: AgentDefinition): Promise<AgentDefinitionDraftRecord>;
  getDraft(agentId: string): Promise<AgentDefinitionDraftRecord | null>;
  listDrafts(): Promise<AgentDefinitionDraftRecord[]>;
  deleteDraft(agentId: string): Promise<boolean>;
  publish(input: PublishAgentDefinitionInput): Promise<MarketplacePackageVersion>;
  listPublishedVersions(agentId: string): Promise<MarketplacePackageVersion[]>;
  resolvePublished(agentId: string): Promise<AgentDefinition | null>;
}

/** Wraps the synchronous in-memory store in a Promise-returning facade so
 *  callers can `await` regardless of which backing is actually live. A sync
 *  throw inside an `async` function rejects the returned Promise, so publish's
 *  immutability rejection (D002) still surfaces the same way. */
export function wrapAgentDefinitionStoreAsync(store: AgentDefinitionStore): AsyncAgentDefinitionStore {
  return {
    saveDraft: async (definition) => store.saveDraft(definition),
    getDraft: async (agentId) => store.getDraft(agentId),
    listDrafts: async () => store.listDrafts(),
    deleteDraft: async (agentId) => store.deleteDraft(agentId),
    publish: async (input) => store.publish(input),
    listPublishedVersions: async (agentId) => store.listPublishedVersions(agentId),
    resolvePublished: async (agentId) => store.resolvePublished(agentId),
  };
}

/** Neon-backed AsyncAgentDefinitionStore. Drafts are keyed by agentId (upsert);
 *  published versions are APPEND-ONLY, keyed by immutable packageVersionId
 *  (D002) -- republishing the same packageVersionId is rejected exactly like
 *  the in-memory store. Schema: packages/workspace-session/migrations/postgres/
 *  0005_agent_definitions.sql (same migration mechanism as workspace-store.ts;
 *  see scripts/run-postgres-migrations.mjs). */
export function createNeonAgentDefinitionStore(databaseUrl: string): AsyncAgentDefinitionStore {
  const sql = neon(databaseUrl.trim());

  async function saveDraft(definition: AgentDefinition): Promise<AgentDefinitionDraftRecord> {
    const parsed = agentDefinitionSchema.parse(definition);
    const updatedAt = new Date().toISOString();
    // org scoping seam: add organization_id (from the resolved host session)
    // to this insert + a (organization_id, agent_id) key once the auth/org
    // lane lands -- drafts are process-wide across tenants until then.
    await sql`
      insert into sonik_agent_ui.agent_definition_drafts (agent_id, definition, updated_at)
      values (${parsed.agentId}, ${JSON.stringify(parsed)}::jsonb, ${updatedAt})
      on conflict (agent_id) do update set definition = excluded.definition, updated_at = excluded.updated_at
    `;
    return { agentId: parsed.agentId, definition: parsed, updatedAt };
  }

  // org scoping seam: filter by organization_id once the auth/org lane lands --
  // drafts are process-wide across tenants until then (same seam as saveDraft above).
  async function getDraft(agentId: string): Promise<AgentDefinitionDraftRecord | null> {
    const rows = await sql`select agent_id, definition, updated_at from sonik_agent_ui.agent_definition_drafts where agent_id = ${agentId}`;
    if (rows.length === 0) return null;
    const row = rows[0] as { agent_id: string; definition: AgentDefinition; updated_at: string };
    return { agentId: row.agent_id, definition: row.definition, updatedAt: new Date(row.updated_at).toISOString() };
  }

  // org scoping seam: filter by organization_id once the auth/org lane lands.
  async function listDrafts(): Promise<AgentDefinitionDraftRecord[]> {
    const rows = await sql`select agent_id, definition, updated_at from sonik_agent_ui.agent_definition_drafts`;
    return (rows as { agent_id: string; definition: AgentDefinition; updated_at: string }[]).map((row) => ({
      agentId: row.agent_id,
      definition: row.definition,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  // org scoping seam: scope the delete by organization_id once the auth/org lane lands.
  async function deleteDraft(agentId: string): Promise<boolean> {
    const rows = await sql`delete from sonik_agent_ui.agent_definition_drafts where agent_id = ${agentId} returning agent_id`;
    return rows.length > 0;
  }

  async function publish(input: PublishAgentDefinitionInput): Promise<MarketplacePackageVersion> {
    const draft = await getDraft(input.agentId);
    if (!draft) throw new Error(`No draft agent definition found for ${input.agentId}`);
    const packageVersionId = `${draft.agentId}@${input.packageSemver}`;
    const existing = await sql`select 1 from sonik_agent_ui.agent_definition_published_versions where package_version_id = ${packageVersionId}`;
    if (existing.length > 0) {
      throw new Error(`Package version ${packageVersionId} is already published (packageVersionId is immutable, D002) -- bump packageSemver`);
    }
    const latestRows = await sql`
      select version ->> 'packageSemver' as package_semver from sonik_agent_ui.agent_definition_published_versions
      where agent_id = ${input.agentId}
      order by seq desc
      limit 1
    `;
    assertSemverAdvancesPast(draft.agentId, input.packageSemver, (latestRows[0] as { package_semver: string } | undefined)?.package_semver);
    const version = buildAgentDefinitionPackageVersion(draft.definition, input, packageVersionId);
    // org scoping seam: same as saveDraft above.
    await sql`
      insert into sonik_agent_ui.agent_definition_published_versions (package_version_id, agent_id, version)
      values (${packageVersionId}, ${draft.agentId}, ${JSON.stringify(version)}::jsonb)
    `;
    return version;
  }

  // org scoping seam: filter by organization_id once the auth/org lane lands --
  // published versions are process-wide across tenants until then.
  async function listPublishedVersions(agentId: string): Promise<MarketplacePackageVersion[]> {
    const rows = await sql`
      select version from sonik_agent_ui.agent_definition_published_versions
      where agent_id = ${agentId}
      order by seq asc
    `;
    return (rows as { version: unknown }[]).map((row) => marketplacePackageVersionSchema.parse(row.version));
  }

  // org scoping seam: same as listPublishedVersions above.
  async function resolvePublished(agentId: string): Promise<AgentDefinition | null> {
    const rows = await sql`
      select version from sonik_agent_ui.agent_definition_published_versions
      where agent_id = ${agentId}
      order by seq desc
      limit 1
    `;
    if (rows.length === 0) return null;
    const version = marketplacePackageVersionSchema.parse((rows[0] as { version: unknown }).version);
    return version.manifest.payload.agent ?? null;
  }

  return { saveDraft, getDraft, listDrafts, deleteDraft, publish, listPublishedVersions, resolvePublished };
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
