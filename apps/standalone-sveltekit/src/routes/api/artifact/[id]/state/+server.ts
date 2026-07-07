import { error, json } from "@sveltejs/kit";
import type { Spec } from "@json-render/core";
import { applyJsonRenderStateChanges, normalizeJsonRenderStateChanges, type JsonRenderStateChange } from "$lib/render/json-render-state-controller";
import {
  getRequestWorkspaceArtifact,
  getRequestWorkspacePersistence,
  listRequestWorkspaceArtifactVersions,
  updateRequestWorkspaceArtifact,
  type WorkspaceArtifactVersionRecord,
} from "$lib/server/workspace-request-store";
import { createWorkspaceRuntimeDiagnosticHeaders } from "$lib/server/workspace-services";
import { routeString, WORKSPACE_CONTENT_MAX_CHARS } from "$lib/server/workspace-route-limits";
import type { RequestHandler } from "./$types";

export const PATCH: RequestHandler = async (event) => {
  const artifactId = routeString(event.params.id, "id", 256, "").trim();
  if (!artifactId) error(400, "Artifact id is required");

  const body = await parsePatchBody(event.request);
  const baseVersion = normalizeBaseVersion(body.baseVersion);
  const requestId = body.requestId === undefined || body.requestId === null ? null : routeString(body.requestId, "requestId", 256, "");
  const summary = routeString(body.summary, "summary", WORKSPACE_CONTENT_MAX_CHARS, "JSON-render state patch");
  const changes = normalizeIncomingChanges(body.changes);

  const existing = await getRequestWorkspaceArtifact(event, artifactId);
  if (!existing) error(404, "Artifact not found");
  if (existing.kind !== "json-render" || !isSpec(existing.content)) error(400, "Artifact state patches require a json-render artifact");

  if (baseVersion !== null && existing.version !== baseVersion) {
    await recordStatePatchTelemetry(event, {
      event: "json_render.state_patch.conflict",
      sessionId: existing.session_id,
      requestId,
      ok: false,
      error: "Artifact version conflict",
      payload: { artifactId, baseVersion, latestVersion: existing.version, changeCount: changes.length },
    });
    return json(
      { ok: false, code: "artifact-version-conflict", error: "Artifact version conflict", latestVersion: existing.version },
      { status: 409, headers: createWorkspaceRuntimeDiagnosticHeaders(event) },
    );
  }

  const content = applyJsonRenderStateChanges(existing.content, changes);
  const updated = await updateRequestWorkspaceArtifact(event, artifactId, { content, source: "user", summary });
  if (!updated) error(404, "Artifact not found");
  const versions = await listJsonRenderArtifactVersions(event, artifactId);

  await recordStatePatchTelemetry(event, {
    event: "json_render.state_patch.persisted",
    sessionId: updated.session_id,
    requestId,
    ok: true,
    payload: { artifactId, baseVersion: existing.version, version: updated.version, changeCount: changes.length, paths: changes.map((change) => change.path) },
  });

  return json({ ok: true, artifact: updated, activeArtifactVersions: versions, changes }, { headers: createWorkspaceRuntimeDiagnosticHeaders(event) });
};

async function parsePatchBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    if (!isRecord(parsed)) error(400, "Artifact state patch payload must be a JSON object");
    return parsed;
  } catch (caught) {
    if (caught && typeof caught === "object" && "status" in caught) throw caught;
    error(400, "Invalid JSON artifact state patch payload");
  }
}

function normalizeBaseVersion(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1) error(400, "baseVersion must be a positive integer when provided");
  return parsed;
}

function normalizeIncomingChanges(value: unknown): JsonRenderStateChange[] {
  if (!Array.isArray(value)) error(400, "changes must be an array");
  try {
    return normalizeJsonRenderStateChanges(value as JsonRenderStateChange[]);
  } catch (caught) {
    error(400, caught instanceof Error ? caught.message : "Invalid JSON-render state changes");
  }
}

async function listJsonRenderArtifactVersions(event: Parameters<typeof listRequestWorkspaceArtifactVersions>[0], artifactId: string): Promise<WorkspaceArtifactVersionRecord<Spec>[]> {
  const versions = await listRequestWorkspaceArtifactVersions(event, artifactId);
  return versions.filter((version): version is WorkspaceArtifactVersionRecord<Spec> => isSpec(version.content));
}

async function recordStatePatchTelemetry(event: Parameters<typeof getRequestWorkspacePersistence>[0], input: { event: string; sessionId?: string | null; requestId?: string | null; ok: boolean; error?: string | null; payload: unknown }): Promise<void> {
  try {
    await getRequestWorkspacePersistence(event).recordTelemetryEvent({
      session_id: input.sessionId ?? null,
      request_id: input.requestId ?? null,
      source: "server",
      event: input.event,
      payload: input.payload,
      ok: input.ok,
      error: input.error ?? null,
    });
  } catch (caught) {
    console.warn("sonik_agent_ui_json_render_state_telemetry_failed", {
      event: input.event,
      sessionId: input.sessionId ?? null,
      requestId: input.requestId ?? null,
      error: caught instanceof Error ? caught.message : String(caught),
    });
  }
}

function isSpec(value: unknown): value is Spec {
  if (!isRecord(value)) return false;
  if (typeof value.root !== "string") return false;
  if (!isRecord(value.elements)) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
