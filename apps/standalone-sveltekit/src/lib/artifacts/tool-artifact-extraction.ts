import type { Spec } from "@json-render/core";
import type { WorkspaceDocumentRecord } from "$lib/server/workspace-store";

export const CREATE_JSON_ARTIFACT_TOOL_PART_TYPE = "tool-createJsonArtifact";
export const CREATE_DOCUMENT_ARTIFACT_TOOL_PART_TYPE = "tool-createDocumentArtifact";
export const UPDATE_DOCUMENT_ARTIFACT_TOOL_PART_TYPE = "tool-updateDocumentArtifact";

export interface JsonArtifactToolCandidate {
  id: string;
  spec: Spec;
  title?: string;
}

export type PreferredDocumentView = "auto" | "edit" | "preview";

export interface DocumentArtifactToolCandidate {
  id: string;
  action: "create" | "update";
  document: WorkspaceDocumentRecord;
  title: string;
  artifactId?: string;
  preferredView?: PreferredDocumentView;
}

interface ToolPartLike {
  type?: unknown;
  toolCallId?: unknown;
  output?: unknown;
}

interface JsonArtifactToolOutput {
  kind?: unknown;
  title?: unknown;
  spec?: unknown;
}

interface DocumentArtifactToolOutput {
  kind?: unknown;
  action?: unknown;
  document?: unknown;
  artifactId?: unknown;
  preferredView?: unknown;
}

export function findJsonArtifactToolCandidate(
  messageId: string,
  parts: readonly unknown[],
): JsonArtifactToolCandidate | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index] as ToolPartLike;
    if (!part || part.type !== CREATE_JSON_ARTIFACT_TOOL_PART_TYPE) continue;

    const output = part.output as JsonArtifactToolOutput;
    if (!isJsonArtifactToolOutput(output)) continue;

    const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : `part-${index}`;
    return {
      id: `json-render-tool:${messageId}:${toolCallId}`,
      spec: output.spec,
      title: typeof output.title === "string" ? output.title : undefined,
    };
  }

  return null;
}

export function findDocumentArtifactToolCandidate(
  messageId: string,
  parts: readonly unknown[],
): DocumentArtifactToolCandidate | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index] as ToolPartLike;
    if (!part || !isDocumentArtifactToolPartType(part.type)) continue;

    const output = part.output as DocumentArtifactToolOutput;
    if (!isDocumentArtifactToolOutput(output)) continue;

    const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : `part-${index}`;
    return {
      id: `document-tool:${messageId}:${toolCallId}`,
      action: output.action,
      document: output.document,
      title: output.document.title,
      artifactId: typeof output.artifactId === "string" ? output.artifactId : undefined,
      preferredView: isPreferredDocumentView(output.preferredView) ? output.preferredView : undefined,
    };
  }

  return null;
}

export function isJsonArtifactToolOutput(output: unknown): output is { title?: string; spec: Spec } {
  if (!isRecord(output)) return false;
  if (output.kind !== "json-render-artifact") return false;
  return isSpec(output.spec);
}

export function isDocumentArtifactToolOutput(
  output: unknown,
): output is { kind: "document-artifact"; action: "create" | "update"; document: WorkspaceDocumentRecord; artifactId?: string; preferredView?: PreferredDocumentView } {
  if (!isRecord(output)) return false;
  if (output.kind !== "document-artifact") return false;
  if (output.action !== "create" && output.action !== "update") return false;
  return isWorkspaceDocumentRecord(output.document);
}

function isDocumentArtifactToolPartType(type: unknown): boolean {
  return type === CREATE_DOCUMENT_ARTIFACT_TOOL_PART_TYPE || type === UPDATE_DOCUMENT_ARTIFACT_TOOL_PART_TYPE;
}

function isPreferredDocumentView(value: unknown): value is PreferredDocumentView {
  return value === "auto" || value === "edit" || value === "preview";
}

function isWorkspaceDocumentRecord(value: unknown): value is WorkspaceDocumentRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    (typeof value.session_id === "string" || value.session_id === null) &&
    typeof value.title === "string" &&
    typeof value.language === "string" &&
    typeof value.current_content === "string" &&
    typeof value.version_count === "number" &&
    typeof value.is_active === "boolean" &&
    typeof value.archived === "boolean" &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string"
  );
}

function isSpec(value: unknown): value is Spec {
  if (!isRecord(value)) return false;
  if (typeof value.root !== "string") return false;
  if (!isRecord(value.elements)) return false;

  const rootElement = value.elements[value.root];
  if (!isRecord(rootElement)) return false;
  return typeof rootElement.type === "string" && isRecord(rootElement.props);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
