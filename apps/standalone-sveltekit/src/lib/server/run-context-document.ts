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
// session's document within the same org. A missing or out-of-scope selection is
// ignored, leaving the request's active document (today's behavior).

export interface SelectableDocument {
  id: string;
  session_id?: string | null;
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
  // No distinct selection: keep the request's active document.
  if (!selectedId || selectedId === base?.id) return base;
  // Cannot scope the read without a session; ignore the selection.
  if (!input.sessionId) return base;
  const loaded = await input.loadDocument(selectedId).catch(() => null);
  // Session scoping: only substitute a document that belongs to this session.
  if (loaded && loaded.session_id === input.sessionId) return loaded;
  return base;
}
