import type { Spec } from "@json-render/core";
import type { JsonRenderArtifact } from "@sonik-agent-ui/artifact-model";

export type ArtifactWarehouseKind = "json-render" | "document";
export type ArtifactWarehouseVersionSource = "agent" | "user-edit" | "import" | "system";

export interface ArtifactWarehouseRecord {
  artifactId: string;
  sessionId: string;
  kind: ArtifactWarehouseKind;
  title: string;
  currentVersionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactWarehouseVersion<TPayload = unknown> {
  versionId: string;
  artifactId: string;
  version: number;
  payload: TPayload;
  source: ArtifactWarehouseVersionSource;
  createdAt: string;
}

export interface ArtifactWarehouseSnapshot<TPayload = unknown> {
  record: ArtifactWarehouseRecord;
  currentVersion: ArtifactWarehouseVersion<TPayload>;
  versions: ArtifactWarehouseVersion<TPayload>[];
}

export interface CommitJsonRenderArtifactInput {
  sessionId?: string | null;
  artifact: JsonRenderArtifact;
  source: ArtifactWarehouseVersionSource;
  now?: string;
}

export interface SelectArtifactVersionInput {
  sessionId?: string | null;
  artifactId: string;
  version: number;
  now?: string;
}

export interface HydrateJsonRenderArtifactInput {
  sessionId?: string | null;
  artifact: JsonRenderArtifact;
  versions: ArtifactWarehouseVersion<Spec>[];
}

const LOCAL_SESSION_ID = "local-session";

function clone<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}

function resolveSessionId(sessionId?: string | null): string {
  return sessionId?.trim() || LOCAL_SESSION_ID;
}

function createVersionId(artifactId: string, version: number): string {
  return `${artifactId}:v${version}`;
}

function createScopedArtifactKey(sessionId: string, artifactId: string): string {
  return `${sessionId}::${artifactId}`;
}

function payloadSignature(payload: unknown): string {
  return JSON.stringify(payload);
}

function toJsonRenderArtifact(snapshot: ArtifactWarehouseSnapshot<Spec>): JsonRenderArtifact {
  return {
    id: snapshot.record.artifactId,
    kind: "json-render",
    title: snapshot.record.title,
    version: snapshot.currentVersion.version,
    content: clone(snapshot.currentVersion.payload),
    createdAt: snapshot.record.createdAt,
    updatedAt: snapshot.currentVersion.createdAt,
  };
}

export class InMemoryArtifactWarehouse {
  #records = new Map<string, ArtifactWarehouseRecord>();
  #versions = new Map<string, ArtifactWarehouseVersion[]>();
  #activeBySession = new Map<string, string>();

  commitJsonRenderArtifact({ sessionId, artifact, source, now = new Date().toISOString() }: CommitJsonRenderArtifactInput): ArtifactWarehouseSnapshot<Spec> & { artifact: JsonRenderArtifact } {
    const resolvedSessionId = resolveSessionId(sessionId);
    const scopedKey = createScopedArtifactKey(resolvedSessionId, artifact.id);
    const existing = this.#records.get(scopedKey);
    const existingVersions = this.#versions.get(scopedKey) ?? [];
    const latestVersion = existingVersions.at(-1) as ArtifactWarehouseVersion<Spec> | undefined;
    const nextPayload = clone(artifact.content);
    const nextTitle = artifact.title?.trim() || "JSON artifact";

    if (!existing) {
      const version: ArtifactWarehouseVersion<Spec> = Object.freeze({
        versionId: createVersionId(artifact.id, 1),
        artifactId: artifact.id,
        version: 1,
        payload: nextPayload,
        source,
        createdAt: now,
      });
      const record: ArtifactWarehouseRecord = Object.freeze({
        artifactId: artifact.id,
        sessionId: resolvedSessionId,
        kind: "json-render",
        title: nextTitle,
        currentVersionId: version.versionId,
        createdAt: artifact.createdAt ?? now,
        updatedAt: now,
      });
      this.#records.set(scopedKey, record);
      this.#versions.set(scopedKey, [version]);
      this.#activeBySession.set(resolvedSessionId, scopedKey);
      return this.#jsonSnapshot(record, version);
    }

    const contentChanged = !latestVersion || payloadSignature(latestVersion.payload) !== payloadSignature(nextPayload);
    const titleChanged = existing.title !== nextTitle;
    let currentVersion = latestVersion;
    let versions = existingVersions;

    if (contentChanged) {
      currentVersion = Object.freeze({
        versionId: createVersionId(artifact.id, existingVersions.length + 1),
        artifactId: artifact.id,
        version: existingVersions.length + 1,
        payload: nextPayload,
        source,
        createdAt: now,
      });
      versions = [...existingVersions, currentVersion];
      this.#versions.set(scopedKey, versions);
    }

    if (!currentVersion) {
      throw new Error(`Artifact ${artifact.id} has no version history.`);
    }

    const record: ArtifactWarehouseRecord = Object.freeze({
      ...existing,
      sessionId: resolvedSessionId,
      title: titleChanged ? nextTitle : existing.title,
      currentVersionId: currentVersion.versionId,
      updatedAt: contentChanged || titleChanged ? now : existing.updatedAt,
    });
    this.#records.set(scopedKey, record);
    this.#activeBySession.set(resolvedSessionId, scopedKey);
    return this.#jsonSnapshot(record, currentVersion);
  }

  hydrateJsonRenderArtifact(input: HydrateJsonRenderArtifactInput): ArtifactWarehouseSnapshot<Spec> & { artifact: JsonRenderArtifact } {
    const resolvedSessionId = resolveSessionId(input.sessionId ?? input.artifact.id);
    const sortedVersions = [...input.versions].sort((a, b) => a.version - b.version);
    const currentVersion = sortedVersions.find((version) => version.version === input.artifact.version) ?? sortedVersions.at(-1) ?? {
      versionId: createVersionId(input.artifact.id, input.artifact.version || 1),
      artifactId: input.artifact.id,
      version: input.artifact.version || 1,
      payload: clone(input.artifact.content),
      source: "system",
      createdAt: input.artifact.updatedAt ?? input.artifact.createdAt ?? new Date().toISOString(),
    } satisfies ArtifactWarehouseVersion<Spec>;
    const record: ArtifactWarehouseRecord = Object.freeze({
      artifactId: input.artifact.id,
      sessionId: resolvedSessionId,
      kind: "json-render",
      title: input.artifact.title?.trim() || "JSON artifact",
      currentVersionId: currentVersion.versionId,
      createdAt: input.artifact.createdAt ?? currentVersion.createdAt,
      updatedAt: input.artifact.updatedAt ?? currentVersion.createdAt,
    });
    const scopedKey = createScopedArtifactKey(resolvedSessionId, input.artifact.id);
    this.#records.set(scopedKey, record);
    this.#versions.set(scopedKey, sortedVersions.length > 0 ? sortedVersions.map((version) => Object.freeze(clone(version))) : [Object.freeze(clone(currentVersion))]);
    this.#activeBySession.set(resolvedSessionId, scopedKey);
    return this.#jsonSnapshot(record, currentVersion);
  }

  selectJsonRenderArtifactVersion(input: SelectArtifactVersionInput): (ArtifactWarehouseSnapshot<Spec> & { artifact: JsonRenderArtifact }) | null {
    const sessionId = resolveSessionId(input.sessionId);
    const scopedKey = createScopedArtifactKey(sessionId, input.artifactId);
    const record = this.#records.get(scopedKey);
    if (!record || record.kind !== "json-render") return null;
    const version = (this.#versions.get(scopedKey) ?? []).find((entry) => entry.version === input.version) as ArtifactWarehouseVersion<Spec> | undefined;
    if (!version) return null;
    const updated: ArtifactWarehouseRecord = Object.freeze({
      ...record,
      sessionId,
      currentVersionId: version.versionId,
      updatedAt: input.now ?? record.updatedAt,
    });
    this.#records.set(scopedKey, updated);
    this.#activeBySession.set(sessionId, scopedKey);
    return this.#jsonSnapshot(updated, version);
  }

  getActiveJsonRenderArtifact(sessionId?: string | null): (ArtifactWarehouseSnapshot<Spec> & { artifact: JsonRenderArtifact }) | null {
    const scopedKey = this.#activeBySession.get(resolveSessionId(sessionId));
    if (!scopedKey) return null;
    const record = this.#records.get(scopedKey);
    if (!record || record.kind !== "json-render") return null;
    const version = (this.#versions.get(scopedKey) ?? []).find((entry) => entry.versionId === record.currentVersionId) as ArtifactWarehouseVersion<Spec> | undefined;
    if (!version) return null;
    return this.#jsonSnapshot(record, version);
  }

  clearActiveArtifact(sessionId?: string | null): void {
    this.#activeBySession.delete(resolveSessionId(sessionId));
  }

  deleteSession(sessionId?: string | null): void {
    const resolvedSessionId = resolveSessionId(sessionId);
    for (const [scopedKey, record] of [...this.#records.entries()]) {
      if (record.sessionId !== resolvedSessionId) continue;
      this.#records.delete(scopedKey);
      this.#versions.delete(scopedKey);
    }
    this.#activeBySession.delete(resolvedSessionId);
  }

  #jsonSnapshot(record: ArtifactWarehouseRecord, currentVersion: ArtifactWarehouseVersion<Spec>): ArtifactWarehouseSnapshot<Spec> & { artifact: JsonRenderArtifact } {
    const versions = (this.#versions.get(createScopedArtifactKey(record.sessionId, record.artifactId)) ?? []) as ArtifactWarehouseVersion<Spec>[];
    const snapshot: ArtifactWarehouseSnapshot<Spec> = {
      record: clone(record),
      currentVersion: clone(currentVersion),
      versions: versions.map(clone),
    };
    return {
      ...snapshot,
      artifact: toJsonRenderArtifact(snapshot),
    };
  }
}

export function createInMemoryArtifactWarehouse(): InMemoryArtifactWarehouse {
  return new InMemoryArtifactWarehouse();
}
