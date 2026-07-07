# Agent UI Host Action Runtime v0 — Booking/Amplify handoff

Date: 2026-07-07
Repo owner: `sonik-agent-ui`
Runtime contract: `sonik.agent_ui.host_action.v1`
Target registry contract: `sonik-agent-ui.target-registry.v0`

## What landed in Agent UI

Agent UI now has a typed host-action channel layered on the Target Registry Contract:

- iframe/client helper: `requestAgentHostAction(...)` from `@sonik-agent-ui/agent-embed`
- host SDK listener: `mountSonikAgentUI({ handleHostAction })`
- page-control wrappers exposed on `window.__sonikAgentUI.actions`:
  - `requestHostAction({ actionKey, targetId, targetInstanceId, entityRef, input, intentLabel })`
  - `openCanvas()`
  - `highlightTarget({ targetId, targetInstanceId, entityRef })`
  - `requestApprovalPreview({ targetId?, targetInstanceId?, entityRef? })`
- `getPageContext()` now includes sanitized `hostUiTargets` and `hostUiTargetRegistry`.

The runtime is intentionally honest:

- standalone mode returns `host_action_parent_unavailable`
- missing host origin returns `host_action_origin_unavailable`
- no host reply returns `host_action_timeout`
- malformed host reply returns `host_action_result_invalid`
- SDK default handler only executes `canvas.open` / `canvas.close`
- tour/highlight/approval actions return `host_action_handler_not_registered` until the host implements `handleHostAction`

## Booking service host adapter requirements

Booking should install a host adapter beside the existing `mountSonikAgentUI(...)` call.

Minimum implementation. Prefer `hostUiTargetRegistry`; if the host only exposes `hostUiTargets`, Agent UI will derive a bounded public registry, but the host adapter should still use the richer envelope for provenance and telemetry:

```ts
import {
  mountSonikAgentUI,
  type AgentEmbedHostActionHandler,
} from '@sonik-agent-ui/agent-embed';
import {
  createHostActionResult,
  evaluateHostActionRequest,
  type HostActionRequest,
  type HostUiTargetRegistry,
} from '@sonik-agent-ui/tool-contracts/target-registry';

const handleHostAction: AgentEmbedHostActionHandler = async (request, context) => {
  const policy = evaluateHostActionRequest({
    request,
    registry: context.registry,
    // Do not include approval.confirmTrustedAction until the host creates a trusted approval ref.
  });
  if (!policy.ok) return policy;

  switch (request.actionKey) {
    case 'canvas.open':
      context.controller.openCanvas();
      return policy;
    case 'canvas.close':
      context.controller.close('canvas');
      return policy;
    case 'tour.highlight':
    case 'tour.focusTarget':
      return highlightRegisteredTarget(request, context.registry);
    case 'approval.requestPreview':
      return showBookingCommandPreview(request, context.registry);
    case 'artifact.submitAnswer':
      return routeArtifactAnswerToVisibleController(request);
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
```

Target registry examples booking should expose through `getPageContext()`:

```ts
hostUiTargetRegistry: {
  version: 'sonik-agent-ui.target-registry.v0',
  generatedAt: new Date().toISOString(),
  provider: 'sonik-booking-service',
  route,
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
      targetId: 'booking.command.approval-preview',
      label: 'Booking command approval preview',
      description: 'Trusted preview/approval region for booking mutations.',
      surface: 'booking-context',
      entityRef: { kind: 'booking_context', id: contextId, label: contextName },
      capabilities: ['highlight', 'scroll', 'approve', 'describe'],
      locator: { kind: 'data-sonik-target', value: 'booking.command.approval-preview' },
      policy: { actionMode: 'ask', reason: 'Booking mutations require trusted host approval.' },
    },
  ],
}
```

DOM hooks should use semantic target attributes, not raw selectors in agent prompts:

```svelte
<section data-sonik-target="booking.context.schedule" data-sonik-entity-kind="booking_context" data-sonik-entity-id={contextId}>
  ...
</section>
```

Telemetry expected in Pipe-B/logs:

- `host_action.request.received`
- `host_action.policy.blocked`
- `host_action.approval_required`
- `host_action.executed`
- `host_action.unavailable`

Each event should include: `requestId`, `actionKey`, `targetId`, `targetInstanceId`, `entityRef.kind`, `entityRef.id`, `policyMode`, `status`, and a redacted `disabledReason` if not executed.

## Amplify host adapter requirements

Amplify should follow the same handler shape and expose targets for campaign/workflow surfaces, for example:

- `amplify.campaign.wizard.step`
- `amplify.campaign.preview`
- `amplify.workflow.node`
- `amplify.command.approval-preview`
- `amplify.agent.settings.drawer`

Amplify should start with these actions:

- `canvas.open`
- `tour.highlight`
- `tour.focusTarget`
- `approval.requestPreview`

Do not expose `approval.confirmTrustedAction` until Amplify has a server-generated trusted approval ref and audit row.

## Manual smoke prompts after host adapters land

In embedded booking:

1. `Open the canvas and highlight the schedule section for this booking context.`
   - Expected: host action `canvas.open` executes; then `tour.highlight` returns executed receipt for `booking.context.schedule`.
2. `Show me the approval preview area before creating this booking context.`
   - Expected: `approval.requestPreview` returns `approval_required`, not executed, and visibly focuses the approval preview region.
3. `What host UI targets can you act on right now?`
   - Expected: answer references semantic labels from `hostUiTargetRegistry`, not DOM selectors.

In standalone Agent UI:

1. Call `window.__sonikAgentUI.actions.openCanvas()` in devtools.
   - Expected: controlled failure `host_action_parent_unavailable`; no crash.

## Validation already completed in Agent UI

- `pnpm --filter @sonik-agent-ui/agent-embed typecheck`
- `pnpm --filter svelte-chat check-types`
- `node --experimental-strip-types tests/unit/agent-host-action-runtime.test.mjs`
- `node --experimental-strip-types tests/unit/agent-embed.test.mjs`
- `node --experimental-strip-types tests/unit/inline-chat-action-wiring.test.mjs`
- `node --experimental-strip-types tests/unit/target-registry-contracts.test.mjs`

## Agent UI JSON-render receipt UX update

Agent UI also records JSON-render action receipts in artifact state:

- `lastActionReceipt` — the current user-facing receipt
- `actionReceipts.<actionName>` — latest receipt by renderer/controller action

`ActionRail` binds to `/lastActionReceipt` and shows a visible success/blocker message for workflow controls. For host actions, JSON-render specs can use `requestHostAction` / `hostAction`; Agent UI forwards the request to the host action channel and records the host result without executing commands locally.

This means booking/Amplify host adapters should return precise typed results because those results are now visible to users, tests, and Pipe-B evidence.
