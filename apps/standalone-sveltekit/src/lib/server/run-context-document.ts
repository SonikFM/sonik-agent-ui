// Resolves which document's content is actually fed to the agent for a turn.
//
// A composer document chip can select a document other than the request's active
// one. When it does, the selected document's content must be loaded from
// session-scoped persistence and fed to the agent — otherwise the page context
// advertises the selected document while the injected content still comes from
// the request's active document.
//
// Scoping is authoritative: only a document belonging to the current session may
// be substituted. Org scoping is enforced upstream by the persistence adapter
// (RLS / per-request org context); this guards against selecting another
// session's document within the same org. Explicit selections fail closed when
// their canonical row cannot be verified.

export interface SelectableDocument {
  id: string;
  session_id?: string | null;
}

export async function syncSessionContextDocument<T extends SelectableDocument>(input: {
  document: T | null;
  sessionId: string;
  loadDocument: (id: string) => Promise<T | null>;
  syncDocument: (document: T) => Promise<T>;
}): Promise<T | null> {
  const document = input.document;
  if (!document) return null;
  if (document.session_id && document.session_id !== input.sessionId) {
    throw Object.assign(new Error("Active document belongs to another workspace session"), { status: 400 });
  }
  const existing = await input.loadDocument(document.id);
  if (existing?.session_id && existing.session_id !== input.sessionId) {
    throw Object.assign(new Error("Active document belongs to another workspace session"), { status: 400 });
  }
  return input.syncDocument({ ...document, session_id: input.sessionId });
}

export async function resolveEffectiveContextDocument<T extends SelectableDocument>(input: {
  includeActiveDocument: boolean;
  selectedDocumentId: string | undefined | null;
  requestActiveDocument: T | null;
  sessionId: string | null | undefined;
  loadDocument: (id: string) => Promise<T | null>;
}): Promise<T | null> {
  if (!input.includeActiveDocument) return null;
  const base = input.requestActiveDocument;
  const selectedId = input.selectedDocumentId;
  if (!selectedId) return base;
  if (!input.sessionId) {
    throw Object.assign(new Error("Selected document requires a workspace session"), { status: 400 });
  }
  const loaded = await input.loadDocument(selectedId);
  if (!loaded) {
    throw Object.assign(new Error("Selected document is unavailable"), { status: 400 });
  }
  if (loaded.session_id !== input.sessionId) {
    throw Object.assign(new Error("Selected document belongs to another workspace session"), { status: 400 });
  }
  return loaded;
}
