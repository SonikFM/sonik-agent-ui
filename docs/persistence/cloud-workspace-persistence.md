# Cloud workspace persistence v0

The Agent UI runtime currently uses an in-memory `WorkspacePersistenceAdapter` for local/manual testing. Cloud persistence starts with the Postgres/RLS migration in:

```txt
packages/workspace-session/migrations/postgres/0001_agent_workspace_persistence.sql
```

## Boundary

The migration is a durable schema contract, not a runtime adapter swap. The working standalone app should keep using the in-memory adapter until a request-scoped cloud adapter is wired and tested.

## Auth/org doctrine

Before any cloud write or org-owned read, the host must resolve a trusted runtime envelope in this order:

1. authenticate the user/session/server principal;
2. resolve organization as a hint, not authority;
3. validate membership or system binding;
4. evaluate the command/capability policy for the workspace operation;
5. create the DB client from the current request/Worker environment;
6. set transaction-local DB context values with `sonik_agent_ui.set_request_context(organizationId, userId)`;
7. perform org-scoped queries through the persistence adapter.

Browser page context donated over iframe/postMessage is display/context only. It can record route, surface, entity labels, visible actions, command families, and skill families; it must not be used as organization, user, credential, scope, or policy authority.

## Tables

The schema creates org/user-scoped tables for:

- `agent_workspace_sessions`
- `agent_workspace_messages`
- `agent_workspace_documents`
- `agent_workspace_document_versions`
- `agent_workspace_artifacts`
- `agent_workspace_artifact_versions`
- `agent_workspace_tool_calls`
- `agent_workspace_layout_snapshots`
- `agent_workspace_page_context_snapshots`
- `agent_workspace_telemetry_events`

Every table has `organization_id text not null` and `user_id text not null` and has row-level security enabled and forced. Child rows use composite foreign keys containing `organization_id`, `user_id`, and the parent id so a child cannot reference another user's/org's session, document, artifact, or message.

## Runtime adapter target

The next runtime slice should add a `WorkspacePersistenceAdapter` implementation backed by the cloud database. That adapter should accept a trusted request-scoped runtime, not raw request/browser context:

```ts
type CloudWorkspaceRuntime = {
  db: unknown;
  organizationId: string;
  userId: string;
  requestId: string;
  commandPolicy: unknown;
};
```

The adapter should set RLS context through the migration-owned `sonik_agent_ui.set_request_context(organizationId, userId)` helper inside the request transaction before query execution. If the final platform is Cloudflare Workers plus Postgres, use the current Worker env path; do not introduce `process.env` fallbacks in deployed credential/DB paths.

## Local vs cloud

SQLite remains useful for local/desktop/offline persistence, but it should be a separate adapter. This migration targets cloud RLS semantics and should be treated as the Postgres-compatible source of truth for hosted Agent UI persistence.
