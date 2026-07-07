# Sonik Agent UI Target Registry + Agent Action Channel v0

Date: 2026-07-07
Code surface: `packages/tool-contracts/src/target-registry.ts`
Package export: `@sonik-agent-ui/tool-contracts/target-registry`

## Decision

Sonik Agent UI uses a **semantic Target Registry** and a **versioned Agent Action Channel** for agent-controllable UI. Agents do not execute raw DOM selectors, arbitrary canvas coordinates, or chat-text approvals.

The host/page owns target resolution and action execution. The remote Agent UI may request an action against a typed target; the host validates the request, policy, target state, and trusted approval state before doing anything.

## Three identities, not one

A single `targetId` is not enough. A safe agent UI target separates these identities:

| Identity | Purpose | Example |
| --- | --- | --- |
| Business entity id | The domain object being discussed. | `booking_context:34bb4e79-...` |
| Semantic UI target id | The stable screen affordance/region. | `booking.context.schedule` |
| Locator/bounds detail | How the host resolves the region. | `data-sonik-target="booking.context.schedule"` or renderer bounds |

The agent sees semantic targets and safe entity references. The host keeps locator implementation detail authoritative.

```ts
{
  targetId: "booking.context.schedule",
  entityRef: {
    kind: "booking_context",
    id: "34bb4e79-95c6-46ae-bd03-25e0a108a7a8",
    label: "Main Course Tee Sheet"
  },
  capabilities: ["highlight", "focus", "edit", "describe"],
  policy: { actionMode: "allow" }
}
```

Do not use the booking context UUID alone as the target. The same entity can appear in a header, chip, schedule editor, inventory table, approval preview, and canvas artifact.

## Target Registry Contract v0

Runtime constant: `sonik-agent-ui.target-registry.v0`.

Required target fields:

- `targetId`: stable semantic affordance id.
- `targetInstanceId`: optional host-generated per-render disambiguator.
- `label` / `description`: safe agent-readable names.
- `surface`: page, canvas, artifact, or host surface name.
- `entityRef`: optional `{ kind, id, label }` for domain identity.
- `capabilities`: one or more of `highlight`, `focus`, `scroll`, `open`, `describe`, `edit`, `approve`, `run`.
- `visible` / `enabled` / `disabledReason`.
- `policy.actionMode`: `block`, `ask`, `allow`, or `require`.
- `locator` or `bounds`: host-owned resolution detail.

Validation rules in v0:

- `data-sonik-target` locator value must equal `targetId`.
- `data-sonik-target-instance` must match `targetInstanceId` when present.
- Disabled targets must expose `disabledReason`.
- `approve` / `run` targets cannot default to `allow`.
- Duplicate `targetId + targetInstanceId/entityRef` keys are rejected.

## DOM-backed vs canvas-backed resolution

### DOM-backed JSON-render/Svelte components

Preferred path. Add attributes from `getHostUiTargetDomAttributes(target)`:

```html
<section data-sonik-target="booking.context.schedule" data-sonik-entity-kind="booking_context" data-sonik-entity-id="34bb4e79-...">
  ...
</section>
```

This preserves accessibility, keyboard focus, testing, and Driver-style highlighting.

### Canvas/virtual renderer targets

If the object has no normal DOM node, the renderer registers bounds:

```ts
{
  targetId: "artifact.workflow.node",
  targetInstanceId: "artifact-123:node-456",
  locator: {
    kind: "bounds",
    bounds: { x: 10, y: 20, width: 300, height: 160, coordinateSpace: "canvas" }
  }
}
```

The agent still references `targetId`; only the host/renderer uses coordinates.

## Agent Action Channel v0

Runtime constant: `sonik.agent_ui.host_action.v1`.

Request shape:

```ts
{
  source: "sonik-agent-ui",
  type: "sonik:agent-ui:action-request",
  version: "sonik.agent_ui.host_action.v1",
  requestId: "req_123",
  actionKey: "tour.highlight",
  targetId: "booking.context.schedule",
  entityRef: { kind: "booking_context", id: "34bb..." },
  input: {},
  requiresReceipt: true
}
```

Result shape:

```ts
{
  source: "sonik-agent-host",
  type: "sonik:agent-ui:action-result",
  version: "sonik.agent_ui.host_action.v1",
  requestId: "req_123",
  actionKey: "tour.highlight",
  ok: true,
  status: "executed",
  policyMode: "allow",
  receipt: {
    actionKey: "tour.highlight",
    targetId: "booking.context.schedule",
    entityRef: { kind: "booking_context", id: "34bb..." },
    effect: "ui"
  }
}
```

Initial action keys:

- `canvas.open`
- `canvas.close`
- `tour.highlight`
- `tour.annotate`
- `tour.focusTarget`
- `tour.clear`
- `approval.requestPreview`
- `approval.confirmTrustedAction`
- `artifact.submitAnswer`

## Policy modes

| Mode | Meaning | Example |
| --- | --- | --- |
| `allow` | Host may execute after validation. | Highlight a visible schedule region. |
| `ask` | Host should render/return approval-required state. | Booking command approval preview. |
| `require` | Missing prerequisite. | Target not mounted or registry unavailable. |
| `block` | Not permitted in this host/session. | Unknown action or disabled target. |

Chat text is never approval. `approved: true`, `approvedCommandIds`, or similar model-provided fields are rejected as `model_supplied_approval_is_not_trusted`.

`approval.confirmTrustedAction` requires a host-owned `trustedApprovalRef` that the host validates against trusted approval state. This is not something the model can invent.

## Driver.js relationship

Driver.js remains a donor/reference for tour behavior: highlight, focus, popover, progress, and clear. It is not the architecture.

Sonik architecture is:

```text
Agent request -> semantic target/action -> host validation -> host target resolution -> host visual/action execution -> typed receipt
```

Driver-like rendering can be implemented later behind this contract. Raw selectors from the agent remain forbidden.

## JSON-render authoring guide

Interactive JSON-render components should register targets when they can be meaningfully highlighted, focused, edited, described, or approved.

Examples:

- Question card: `artifact.question-card` with `edit` capability.
- Approval card: `artifact.approval-card` with `approve` capability and `ask` policy.
- Active canvas artifact: `agent.canvas.active-artifact` with `highlight`, `scroll`, `open`, `describe`.

Renderer specs remain input/component specs. They must not contain executable command commits or approval grants.

## Booking / Amplify host integration guide

Hosts should prefer `AgentPageContext.hostUiTargetRegistry` for route/surface provenance. `hostUiTargets` remains a compatibility input; Agent UI derives a bounded public registry from it before action evaluation. Both inputs are sanitized before model/page-control exposure: private locators and arbitrary metadata are stripped, strings are bounded/redacted, and excessive targets are capped.

Booking examples:

- `booking.context.header`
- `booking.context.schedule`
- `booking.context.inventory`
- `booking.command.approval-preview`

Amplify examples:

- `amplify.campaign.wizard.step`
- `amplify.campaign.preview`
- `amplify.command.approval-preview`

Host responsibilities:

1. Register targets only for visible/relevant UI affordances.
2. Keep selectors/bounds host-owned.
3. Validate action keys against allowlist.
4. Validate target visibility, enabled state, capability, and policy.
5. Return typed receipts for success, block, ask, require, unavailable, or invalid request.
6. Emit telemetry/Pipe-B events with `requestId`, `actionKey`, `targetId`, `policyMode`, and status.

## Verification

Current regression coverage:

```bash
pnpm --filter @sonik-agent-ui/tool-contracts build
node --experimental-strip-types tests/unit/target-registry-contracts.test.mjs
```

The root `pnpm test` script now includes `tests/unit/target-registry-contracts.test.mjs`.

## JSON-render action receipts

JSON-render artifacts may request host actions with a renderer action such as:

```json
{
  "action": "requestHostAction",
  "params": {
    "actionKey": "approval.requestPreview",
    "targetId": "booking.command.approval-preview",
    "intentLabel": "Show the booking setup approval preview."
  }
}
```

The renderer does not execute the business action. Agent UI forwards the request through the host-action channel, then writes a bounded receipt into artifact state:

```json
{
  "lastActionReceipt": {
    "actionName": "requestHostAction",
    "ok": false,
    "status": "host_approval_required",
    "message": "Host approval is required before this action can run.",
    "hostAction": {
      "actionKey": "approval.requestPreview",
      "status": "approval_required",
      "policyMode": "ask",
      "requestId": "...",
      "targetId": "booking.command.approval-preview"
    }
  }
}
```

`ActionRail` renders this receipt as user-facing status. This keeps the user out of raw tool-call IDs while preserving telemetry and typed proof for tests.
