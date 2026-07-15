# Channels and Triggers Pre-work

**Status:** fixture-only contract and UI seam
**Scope:** WhatsApp and Slack channel states plus dormant workflow trigger bindings
**Non-goal:** no provider connection, provisioning, OAuth, webhook, or message delivery

## Decisions

- Channels is a local workspace mode (`workspace | workflow-builder | channels`). It is reachable from the existing conversation action slot in standalone and embedded hosts without changing embed-mode or workspace-session schemas.
- The UI renders eight server-projected fixtures: WhatsApp and Slack in `unconfigured`, `pending`, `connected`, and `error` states. Fixture identifiers are templates; request authority supplies the organization, user, workspace, and session scope.
- Every provider-facing action and trigger activation is a native disabled control with `disabledReason: "integration_not_yet_available"` and an associated visible explanation. These controls never simulate success.
- A user may save a fixture trigger binding through native labeled controls. The server accepts only channel, neutral event, fixture workflow, and JSON Pointer mapping fields. It rejects tenant fields and persists the binding as `runtimeMode: "fixture_only"`, `enabled: false`.
- One immutable server-derived projection supplies the Channels UI, page-control state, page assertions, action descriptors, and `workflow.triggers`. Host page-context merging reasserts the local trigger projection, so an embedding page cannot claim that a trigger is enabled.
- `getChannelsState`, `connectChannel`, `enableTriggerBinding`, and `saveFixtureTriggerBinding` extend the optional `__sonikAgentUI` contract. Connect and enable always return `ok: false` with the integration-unavailable reason. Save fails closed while context, session, or projection authority is unavailable.
- Fixture state reuses `agent_workspace_page_context_snapshots`; no migration or provider-specific table is introduced. Snapshots are session-scoped, `source: "browser-page-context"`, and permanently `authority: "display-only"`.
- Authenticated requests require the exact signed workspace-session context before a persistence read. The client never submits organization or user identity. Late GET and POST results are ignored after the active session changes.

## Deliberately Open Integration Seams

### WhatsApp provisioning

- Decide whether Meta Cloud API, Twilio, or another provider owns account and phone-number lifecycle.
- Define business verification, number purchase/porting, display-name review, and agent-ownable-number recovery flows.
- Replace the fixture state projection only after provider state has an authenticated, organization-scoped server adapter and an auditable retry model.

### Slack installation

- Define the Slack app installation and OAuth flow, workspace selection, token storage and rotation, uninstall behavior, and least-privilege scopes.
- Decide which neutral events map from Slack event types and how channel/thread identity is represented without leaking provider credentials into page context.

### Webhook ingress and trigger execution

- Add signature verification, replay protection, idempotency, ordering, rate limits, dead-letter handling, and organization/workspace routing before accepting provider events.
- Introduce a trusted server-derived trigger record and execution receipt. Display-only snapshots must never become execution authority.
- Resolve the neutral event vocabulary and versioning policy before connecting provider payloads to workflow `trigger` nodes.

### Outbound messaging and operations

- Define send permissions, approval policy, templates, delivery receipts, retries, failure visibility, retention, and privacy controls independently of this surface.
- Amplify send flows remain unchanged. No provider SDK, OAuth secret, webhook route, phone-number purchase, Slack scope, or outbound send capability is included in this pre-work.
