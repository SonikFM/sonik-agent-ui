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

  function getDraft(agentId: string): AgentDefinitionDraftRecord | null {
    return drafts.get(agentId) ?? null;
  }

  function listDrafts(): AgentDefinitionDraftRecord[] {
    return [...drafts.values()];
  }

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
    const manifestWithoutHash = {
      marketplaceSchemaVersion: "1" as const,
      packageId: draft.agentId,
      packageVersionId,
      packageSemver: input.packageSemver,
      kind: "agent" as const,
      title: input.title ?? draft.definition.title,
      publisher: input.publisher ?? DEFAULT_PUBLISHER,
      payload: { agent: draft.definition },
    };
    const manifestHash = manifestHashFor(manifestWithoutHash);
    const manifest = marketplaceManifestSchema.parse({ ...manifestWithoutHash, manifestHash });
    const version = createMarketplacePackageVersion({
      packageVersionId,
      packageId: draft.agentId,
      packageSemver: input.packageSemver,
      marketplaceSchemaVersion: "1",
      manifest,
      changelog: "",
    });
    publishedVersions.set(draft.agentId, [...existing, version]);
    return version;
  }

  function listPublishedVersions(agentId: string): MarketplacePackageVersion[] {
    return publishedVersions.get(agentId) ?? [];
  }

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
