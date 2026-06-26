import { tool } from "ai";
import { z } from "zod";
import {
  createWorkspaceArtifact,
  createWorkspaceDocument,
  getWorkspaceDocument,
  syncActiveWorkspaceDocumentSnapshot,
  updateWorkspaceDocument,
  type WorkspaceDocumentRecord,
} from "../server/workspace-store";
import type { AsyncWorkspacePersistenceAdapter } from "@sonik-agent-ui/workspace-session";

const documentLanguageSchema = z.string().default("markdown");
const preferredDocumentViewSchema = z.enum(["auto", "edit", "preview"]).default("auto");

export type PreferredDocumentView = z.infer<typeof preferredDocumentViewSchema>;

export interface DocumentToolContext {
  activeDocument?: WorkspaceDocumentRecord | null;
  sessionId?: string | null;
  persistence?: AsyncWorkspacePersistenceAdapter | null;
}

interface DocumentToolRuntime {
  activeDocument: WorkspaceDocumentRecord | null;
  preferredView: PreferredDocumentView;
  sessionId: string | null;
}

async function resolveDocumentSnapshot(document: WorkspaceDocumentRecord | null | undefined, persistence?: AsyncWorkspacePersistenceAdapter | null): Promise<WorkspaceDocumentRecord | null> {
  if (!document?.id) return null;
  if (persistence) {
    const stored = await persistence.getDocument(document.id);
    if (!stored) return document;
    return persistence.syncActiveDocumentSnapshot({ ...stored, ...document });
  }
  const stored = getWorkspaceDocument(document.id);
  if (!stored) return document;
  return syncActiveWorkspaceDocumentSnapshot({ ...stored, ...document });
}

function normalizePreferredView(value: PreferredDocumentView | undefined, language?: string): PreferredDocumentView {
  if (value && value !== "auto") return value;
  return isPreviewableDocumentLanguage(language) ? "preview" : "edit";
}

function isPreviewableDocumentLanguage(language?: string): boolean {
  return /^(markdown|md|html|htm|svg|xml)$/i.test(language ?? "");
}

export function createDocumentTools(context: DocumentToolContext = {}) {
  const persistence = context.persistence ?? null;
  const initialDocument = context.activeDocument ?? null;
  const runtime: DocumentToolRuntime = {
    activeDocument: initialDocument,
    preferredView: normalizePreferredView("auto", initialDocument?.language),
    sessionId: initialDocument?.session_id ?? context.sessionId ?? null,
  };

  return {
    readActiveDocument: tool({
      description: "Read the current active Workspace/Sonik document that is open in the canvas document editor.",
      inputSchema: z.object({}),
      execute: async () => {
        const document = await resolveDocumentSnapshot(runtime.activeDocument, persistence);
        if (!document) {
          return { ok: false, error: "NO_ACTIVE_DOCUMENT", message: "No active document is open in the workspace." };
        }
        runtime.activeDocument = document;
        runtime.sessionId = document.session_id ?? runtime.sessionId;
        runtime.preferredView = normalizePreferredView(runtime.preferredView, document.language);
        return { ok: true, document, preferredView: runtime.preferredView };
      },
    }),
    readDocumentArtifact: tool({
      description: "Read a specific Workspace/Sonik document artifact by id, or read the current active document when no id is supplied. Sets the read document as the active document for subsequent document tools in the same turn.",
      inputSchema: z.object({
        documentId: z.string().optional().describe("Document id to read. Defaults to the current active document."),
      }),
      execute: async ({ documentId }) => {
        const document = documentId
          ? (persistence ? await persistence.getDocument(documentId) : getWorkspaceDocument(documentId))
          : await resolveDocumentSnapshot(runtime.activeDocument, persistence);
        if (!document) {
          return { ok: false, error: "DOCUMENT_NOT_FOUND", message: documentId ? `Document ${documentId} was not found.` : "No active document is open in the workspace." };
        }
        runtime.activeDocument = document;
        runtime.sessionId = document.session_id ?? runtime.sessionId;
        runtime.preferredView = normalizePreferredView(runtime.preferredView, document.language);
        return { ok: true, document, preferredView: runtime.preferredView };
      },
    }),
    createDocumentArtifact: tool({
      description: "Create a markdown, HTML, JSON, code, or plain-text document artifact in the workspace document editor canvas. Use this for explicit document/editor artifact requests, not for every answer.",
      inputSchema: z.object({
        title: z.string().describe("Short title for the document tab."),
        language: documentLanguageSchema.describe("Document language/render mode, e.g. markdown, html, json, typescript, python, csv."),
        content: z.string().describe("Complete document contents."),
        preferredView: preferredDocumentViewSchema.describe("Initial editor view. Use preview for HTML/Markdown/SVG/XML when the user asks to see the rendered document; use edit for code/source-first work; auto lets the app infer from language."),
      }),
      execute: async ({ title, language, content, preferredView }) => {
        const document = persistence
          ? await persistence.createDocument({
              session_id: runtime.sessionId,
              title,
              language,
              content,
              source: "ai",
              summary: "Created by agent",
            })
          : createWorkspaceDocument({
              session_id: runtime.sessionId,
              title,
              language,
              content,
              source: "ai",
              summary: "Created by agent",
            });
        runtime.activeDocument = document;
        runtime.sessionId = document.session_id ?? runtime.sessionId;
        runtime.preferredView = normalizePreferredView(preferredView, document.language);
        const artifact = persistence
          ? await persistence.createArtifact({
              session_id: document.session_id,
              kind: "document",
              title: document.title,
              content: document,
            })
          : createWorkspaceArtifact({
              session_id: document.session_id,
              kind: "document",
              title: document.title,
              content: document,
            });
        return {
          kind: "document-artifact" as const,
          action: "create" as const,
          document,
          artifactId: artifact.id,
          createdAt: artifact.created_at,
          preferredView: runtime.preferredView,
        };
      },
    }),
    updateDocumentArtifact: tool({
      description: "Update the active Workspace/Sonik document artifact with complete replacement content. Uses the active document unless documentId is supplied.",
      inputSchema: z.object({
        documentId: z.string().optional().describe("Document id to update. Defaults to the active document."),
        title: z.string().optional().describe("Optional new document title."),
        language: z.string().optional().describe("Optional new document language/render mode."),
        content: z.string().describe("Complete replacement document contents."),
        preferredView: preferredDocumentViewSchema.describe("View to show after the update. Use preview for rendered HTML/Markdown/SVG/XML output when the user is validating the rendered artifact; use edit when they need source editing."),
      }),
      execute: async ({ documentId, title, language, content, preferredView }) => {
        const targetId = documentId || runtime.activeDocument?.id;
        if (!targetId) {
          return { ok: false, error: "NO_ACTIVE_DOCUMENT", message: "No active document is available to update." };
        }
        const document = persistence
          ? await persistence.updateDocument(targetId, {
              title,
              language,
              content,
              source: "ai",
              summary: "Updated by agent",
            })
          : updateWorkspaceDocument(targetId, {
              title,
              language,
              content,
              source: "ai",
              summary: "Updated by agent",
            });
        if (!document) {
          return { ok: false, error: "DOCUMENT_NOT_FOUND", message: `Document ${targetId} was not found.` };
        }
        runtime.activeDocument = document;
        runtime.sessionId = document.session_id ?? runtime.sessionId;
        runtime.preferredView = normalizePreferredView(preferredView, document.language);
        return {
          kind: "document-artifact" as const,
          action: "update" as const,
          document,
          preferredView: runtime.preferredView,
        };
      },
    }),
  };
}
