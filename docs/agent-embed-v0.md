# Sonik Agent UI embedding v0

The Agent UI embedding seam is transport-neutral. Hosts donate **display page context** and may separately donate a server-signed **opaque authority**. Trusted auth, organization, and scope fields must never be inferred from browser page context.

## Package exports

Use `@sonik-agent-ui/agent-embed` for the shared semantic contract:

- `AgentHostPageContext` — sanitized host page context: route, surface, page type, active entity, command families, skill families, and visible actions.
- `AgentHostContextProvider` — native host provider shape for framework adapters.
- `AgentHostAuthorityDonation` — bounded `{ header, revision, expiresAt }` wrapper around an opaque server-signed header. Consumers forward `header` byte-for-byte and never decode or rebuild it.
- `AgentHostContextDonation` — `{ pageContext, authority? }`, keeping display context and authority structurally separate.
- `AgentTrustedHostContext` — trusted auth/org/scopes/host-session envelope passed only by server-owned adapter paths.
- `mergeAgentHostPageContext(local, host, trusted?)` — overlays local app state, host page context, and trusted server context.
- `SONIK_AGENT_UI_HOST_MESSAGE_SOURCE` / `SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE` — stable postMessage envelope constants.
- `isAgentHostPageContextMessage(value)` — runtime guard for iframe transport messages.
- `AgentEmbedMode` — host launcher mode: `workspace`, `chat`, or `canvas`.
- `AgentEmbedRailMode` — session rail intent: `expanded`, `collapsed`, or `hidden`.
- `normalizeAgentEmbedIntent(input)` — centralizes launcher-mode and rail-mode defaults so iframe hosts and native shells do not duplicate mode parsing.

## Iframe/postMessage transport

The current standalone reference host uses iframe/postMessage first because it isolates CSS/runtime concerns and keeps the Agent UI easy to embed before native shell integration.

Production v0 is **same-origin by default**. Cross-origin browser embedding needs an explicit origin allowlist. Display page context is never an auth, org, scope, token, or credential channel. The only browser-carried authority is the bounded opaque sibling produced by a server signer; the iframe accepts it only from the configured parent window and allowed origin.

Workspace history ownership is stable across host-session rotation. Signed
`organization_id` and `user_id` values are the row-visibility authority;
`host_session_id` is insert-time audit provenance and command-lifetime context
only. It is never a history, document, artifact, file, run, or event visibility
predicate. No migration or backfill is required: legacy rows with an older or
null host-session value remain visible to their existing organization/user
owner, and reads do not rewrite their identifiers, provenance, or timestamps.

```ts
import {
  SONIK_AGENT_UI_HOST_MESSAGE_SOURCE,
  SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE,
  createAgentHostPageContextMessage,
  type AgentHostAuthorityDonation,
  type AgentHostPageContext,
} from "@sonik-agent-ui/agent-embed";

const context: AgentHostPageContext = {
  route: "/booking/bookings/booking_123",
  surface: "booking-console",
  pageType: "event-booking-detail",
  activeEntity: { type: "booking", id: "booking_123", label: "Summer Jazz Night" },
  commandFamilies: ["booking", "event"],
  skillFamilies: ["booking-ops"],
  visibleActions: ["viewBooking", "listResources", "assignResource"],
};

// `signedByHostServer` is returned by a same-origin server signer. Do not
// decode, normalize, log, render, or reconstruct its `header` value.
const authority: AgentHostAuthorityDonation = signedByHostServer.authority;
iframe.contentWindow?.postMessage(
  createAgentHostPageContextMessage(context, authority),
  window.location.origin,
);
```

See `apps/standalone-sveltekit/static/fake-booking-host.html` for the local smoke harness.

## Launcher modes

The embed should not force a full workspace iframe onto every host page. Hosts should launch one of three modes:

| Mode | Intended UX | Recommended rail |
| --- | --- | --- |
| `chat` | Compact assistant pane/drawer for contextual Q&A. | `hidden` |
| `canvas` | Near-fullscreen workspace modal for live artifacts/documents. | `collapsed` |
| `workspace` | Standalone/full app shell. | `expanded` |

Iframe hosts pass this as URL state while continuing to donate page context over postMessage:

```ts
const params = new URLSearchParams({
  agentUiHostOrigin: window.location.origin,
  embedMode: "chat",
  rail: "hidden",
});

iframe.src = `/agent-ui?${params.toString()}`;
```

Native hosts should use `normalizeAgentEmbedIntent` with the same semantic values in their shell adapter rather than coupling to iframe-specific query strings.

## Native Svelte API sketch

A native shell can use the same semantics without iframe transport by providing a page-context provider and a trusted context from the server session loader.

```ts
import { mergeAgentHostPageContext, type AgentHostContextProvider, type AgentTrustedHostContext } from "@sonik-agent-ui/agent-embed";

export const providePageContext: AgentHostContextProvider = () => ({
  route: window.location.pathname,
  surface: "campaign-wizard",
  pageType: "wizard",
  activeEntity: { type: "campaign", id: "cmp_123", label: "Summer Launch" },
  commandFamilies: ["campaign"],
  skillFamilies: ["campaign-authoring"],
});

export function createMergedAgentContext(localSnapshot: object, trusted: AgentTrustedHostContext) {
  return mergeAgentHostPageContext(localSnapshot, providePageContext(), trusted);
}
```

## Booking context adapter example

A Sonik booking page should map its route state to page context, then let command indexing load booking/event families. The donated context is **not authorization**; it only guides command relevance and agent grounding.

```ts
const bookingContext = {
  route: `/booking/bookings/${booking.id}`,
  surface: "booking-console",
  pageType: "event-booking-detail",
  activeEntity: { type: "booking", id: booking.id, label: booking.eventName },
  commandFamilies: ["booking", "event"],
  skillFamilies: ["booking-ops"],
  visibleActions: ["viewBooking", "listResources", "assignResource"],
};
```

## Amplify shell context adapter example

An Amplify app shell should derive trusted organization/session state from `$amplify-auth` / `$amplify-org-context` server paths, while client page context stays display/surface-only.

```ts
import { createEmbeddedHostSessionEnvelope, platformAdapterContextFromHostSession } from "@sonik-agent-ui/platform-adapters";
import { mergeAgentHostPageContext, type AgentHostPageContext } from "@sonik-agent-ui/agent-embed";

const amplifyPageContext: AgentHostPageContext = {
  route: "/campaigns/new",
  surface: "amplify-campaign-wizard",
  pageType: "wizard",
  activeEntity: { type: "campaign", id: draftCampaign.id, label: draftCampaign.name },
  commandFamilies: ["campaign", "integration"],
  skillFamilies: ["campaign-authoring"],
};

const hostSession = createEmbeddedHostSessionEnvelope({
  source: "amplify-embedded",
  sessionId: amplifySession.id,
  userId: amplifyUser.id,
  organizationId: amplifyOrg.id,
  authenticated: true,
  scopes: amplifySession.scopes,
});

const trusted = {
  ...platformAdapterContextFromHostSession(hostSession),
  hostSession,
};

const agentContext = mergeAgentHostPageContext(localAgentSnapshot, amplifyPageContext, trusted);
```

Never pass `organizationId`, `authenticated`, `scopes`, tokens, cookies, API keys, or reconstructable signature fields through display page context. Donate only the server-produced opaque authority sibling, forward its header unchanged, and keep it out of logs and UI.
