# Booking SDK host-action receiver handoff — Agent UI v0

Date: 2026-07-07
Owner: booking-service / booking SDK agent
Source repo: `sonik-agent-ui`
Relevant PR/branch: `feat/analytics-hints-release-gate-20260702`

## Why this handoff exists

Agent UI now emits a typed host-action request from the iframe instead of relying on chat text, raw selectors, or model-invented approval. The booking app must install the receiver side so embedded Agent UI can:

1. open/dock canvas predictably,
2. highlight/focus semantic booking UI targets,
3. request approval previews for command-backed actions,
4. submit artifact/question state through the host controller when applicable,
5. emit Pipe-B telemetry for every request/result.

Until this receiver exists, Agent UI correctly returns controlled failures such as `host_action_handler_not_registered` or `host_action_parent_unavailable` for non-canvas actions.

## Contracts to consume

Install/use these from Agent UI packages:

```ts
import {
  mountSonikAgentUI,
  type AgentEmbedHostActionHandler,
} from '@sonik-agent-ui/agent-embed';
import {
  createHostActionResult,
  evaluateHostActionRequest,
  getHostUiTargetDomAttributes,
  type HostActionRequest,
  type HostUiTargetRegistry,
} from '@sonik-agent-ui/tool-contracts/target-registry';
```

Contract docs:

- `docs/contracts/target-registry-and-action-channel-v0.md`
- `docs/handoffs/agent-ui-host-action-runtime-v0-handoff-2026-07-07.md`

## Required booking SDK changes

### 1. Pass a real `handleHostAction` into `mountSonikAgentUI`

Find the booking SDK embed wrapper, likely around `BookingAgentUiEmbed` / `sonik-sdk/src/agent-ui`, where `mountSonikAgentUI(...)` is called.

Add a host receiver like this:

```ts
const handleHostAction: AgentEmbedHostActionHandler = async (request, context) => {
  const policy = evaluateHostActionRequest({
    request,
    registry: context.registry,
    // Deliberately omit approval.confirmTrustedAction until booking creates
    // a server/audit-backed trustedApprovalRef.
    allowedActions: [
      'canvas.open',
      'canvas.close',
      'tour.highlight',
      'tour.focusTarget',
      'tour.clear',
      'approval.requestPreview',
      'artifact.submitAnswer',
    ],
  });

  if (!policy.ok && policy.status !== 'approval_required') {
    emitPipeBHostAction('host_action.policy.blocked', request, policy);
    return policy;
  }

  switch (request.actionKey) {
    case 'canvas.open':
      context.controller.openCanvas();
      emitPipeBHostAction('host_action.executed', request, policy);
      return policy;

    case 'canvas.close':
      context.controller.close('canvas');
      emitPipeBHostAction('host_action.executed', request, policy);
      return policy;

    case 'tour.highlight':
    case 'tour.focusTarget':
      return highlightOrFocusRegisteredTarget(request, context.registry);

    case 'approval.requestPreview':
      return renderBookingApprovalPreview(request, context.registry);

    case 'artifact.submitAnswer':
      return routeArtifactAnswerToBookingController(request);

    default:
      return createHostActionResult({
        requestId: request.requestId,
        actionKey: request.actionKey,
        ok: false,
        status: 'blocked',
        policyMode: 'block',
        disabledReason: 'booking_host_action_not_supported',
      });
  }
};

mountSonikAgentUI({
  // existing config...
  handleHostAction,
});
```

### 2. Expose `hostUiTargetRegistry` in `getPageContext()`

The host action receiver needs semantic targets. Do not send raw selectors to the model. Use stable target ids plus host-owned locators:

```ts
hostUiTargetRegistry: {
  version: 'sonik-agent-ui.target-registry.v0',
  generatedAt: new Date().toISOString(),
  provider: 'sonik-booking-service',
  route: location.pathname,
  surface: 'booking-context',
  targets: [
    {
      targetId: 'booking.context.header',
      label: 'Booking context header',
      description: 'Header for the active booking context.',
      surface: 'booking-context',
      entityRef: { kind: 'booking_context', id: contextId, label: contextName },
      capabilities: ['highlight', 'scroll', 'describe', 'open'],
      locator: { kind: 'data-sonik-target', value: 'booking.context.header' },
      policy: { actionMode: 'allow' },
    },
    {
      targetId: 'booking.context.schedule',
      label: 'Booking schedule',
      description: 'Schedule and operating hours for the active booking context.',
      surface: 'booking-context',
      entityRef: { kind: 'booking_context', id: contextId, label: contextName },
      capabilities: ['highlight', 'scroll', 'focus', 'edit', 'describe'],
      locator: { kind: 'data-sonik-target', value: 'booking.context.schedule' },
      policy: { actionMode: 'allow' },
    },
    {
      targetId: 'booking.context.inventory',
      label: 'Booking inventory',
      description: 'Tables, resources, slots, and capacity for the active booking context.',
      surface: 'booking-context',
      entityRef: { kind: 'booking_context', id: contextId, label: contextName },
      capabilities: ['highlight', 'scroll', 'focus', 'edit', 'describe'],
      locator: { kind: 'data-sonik-target', value: 'booking.context.inventory' },
      policy: { actionMode: 'allow' },
    },
    {
      targetId: 'booking.command.approval-preview',
      label: 'Booking command approval preview',
      description: 'Preview and approval region for command-backed booking writes.',
      surface: 'booking-context',
      entityRef: { kind: 'booking_context', id: contextId, label: contextName },
      capabilities: ['highlight', 'scroll', 'approve', 'describe'],
      locator: { kind: 'data-sonik-target', value: 'booking.command.approval-preview' },
      policy: { actionMode: 'ask', reason: 'Booking mutations require trusted host approval.' },
    },
  ],
}
```

### 3. Put semantic target attributes on visible DOM

Examples:

```svelte
<header data-sonik-target="booking.context.header" data-sonik-entity-kind="booking_context" data-sonik-entity-id={contextId}>
  ...
</header>

<section data-sonik-target="booking.context.schedule" data-sonik-entity-kind="booking_context" data-sonik-entity-id={contextId}>
  ...
</section>

<section data-sonik-target="booking.context.inventory" data-sonik-entity-kind="booking_context" data-sonik-entity-id={contextId}>
  ...
</section>

<section data-sonik-target="booking.command.approval-preview" data-sonik-entity-kind="booking_context" data-sonik-entity-id={contextId}>
  ...
</section>
```

### 4. Pipe-B telemetry requirements

Emit one event per request/result:

- `host_action.request.received`
- `host_action.policy.blocked`
- `host_action.approval_required`
- `host_action.executed`
- `host_action.unavailable`

Minimum fields:

```ts
{
  requestId,
  actionKey,
  targetId,
  targetInstanceId,
  entityKind: entityRef?.kind,
  entityId: entityRef?.id,
  policyMode,
  status,
  ok,
  disabledReason, // redacted
  sessionId,
  organizationId,
  route,
}
```

### 5. Approval boundary

Do **not** treat chat text or JSON-render button clicks as command approval. A JSON-render button can request a preview or submit an answer; it cannot mint approval.

`approval.confirmTrustedAction` should remain blocked until booking has a server-generated `trustedApprovalRef` bound to:

- actor/user/org/session,
- command id,
- target entity,
- input hash,
- expiry,
- audit row / Pipe-B receipt.

## Manual smoke after booking changes

1. Open embedded Agent UI on a booking context page.
2. In devtools inside Agent UI iframe:

```js
await window.__sonikAgentUI.actions.requestHostAction({
  actionKey: 'tour.highlight',
  targetId: 'booking.context.schedule',
  intentLabel: 'Highlight the schedule editor.'
})
```

Expected: visible schedule target highlights/focuses and a typed receipt is returned.

3. Ask in chat: `Show me the approval preview area for this booking setup.`

Expected: agent uses `approval.requestPreview`; host returns `approval_required`; Pipe-B logs the request/result; no write executes.

4. Ask in chat: `What host UI targets can you act on right now?`

Expected: the answer names semantic labels from `hostUiTargetRegistry` and does not expose raw selectors, cookies, or secrets.

## Acceptance gate

- Booking build/typecheck passes.
- Booking embedded smoke proves `canvas.open` and `tour.highlight` execute.
- `approval.requestPreview` returns `approval_required` with a visible preview affordance.
- No host write is approved from chat text alone.
- Pipe-B contains request/result telemetry for each action.
