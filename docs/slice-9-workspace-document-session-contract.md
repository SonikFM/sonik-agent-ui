# Slice 9 — Workspace document/session contract

## What changed

- The copied Odysseus document editor remains a vendored UI island. We did not rewrite its editor internals.
- Sonik now owns the document/session/artifact contract in `workspace-store.ts`.
- Odysseus-style REST compatibility routes are backed by that contract so the copied editor can keep using its native API shape.
- Agent document tools now create/read/update document artifacts separately from JSON-render artifacts.
- The Svelte parent receives active document snapshots from the Odysseus iframe and sends that context with chat requests.

## Contract boundary

Current ORPC-shaped procedure names are exposed as `workspaceProcedures`:

- `workspace.session.create/list/get/archive`
- `workspace.document.create/update/patch/list/library/get/versions/restore/archive/syncActiveSnapshot`
- `workspace.artifact.create/get`

These are intentionally implemented as in-process functions for this slice. They are the seam that can become real ORPC procedures in Sonik without changing the copied Odysseus editor island.

## Compatibility routes

The copied editor can call:

- `/api/document`, `/api/document/:id`, `/api/documents/:sessionId`
- `/api/documents/library`
- `/api/document/:id/versions`, `/api/document/:id/version/:num`, `/api/document/:id/restore/:num`
- `/api/document/:id/archive`
- `/api/session`, `/api/sessions`, `/api/sessions/archived`
- `/api/session/:id/archive`, `/api/session/:id/unarchive`, `/api/session/:id/important`

`/api/research/library` is an empty compatibility placeholder. Deep research remains deferred.

## Persistence status

Still ephemeral: this pass uses a process-local in-memory store. The next persistence slice should replace the map-backed service with Sonik-backed ORPC/database storage while preserving these procedure names and response shapes.

## Safety notes added after review

- Active editor snapshots are synced into the workspace document store before an agent turn/tool read so recent iframe edits do not get overwritten by stale stored content.
- The Odysseus host no longer creates a replacement document when a requested document id fails to load; it surfaces the load error to preserve document identity.
- Parent/iframe bridge messages now validate source markers and frame source before accepting document snapshots.
- REST document routes now enforce basic local-demo size/type limits; production Sonik integration still needs auth/org/session scoping through ORPC.
