# Agent UI tour action contract v0 handoff

Status: Agent UI contract/harness only. No booking-service or Amplify changes. No deploy.

## What Agent UI exposes

`window.__sonikAgentUI.getActions()` now describes tour-capable host actions with explicit `actionKey` metadata:

- `openCanvas` -> `canvas.open`
- `highlightTarget` -> `tour.highlight`, `requiresTarget: true`
- `focusTarget` -> `tour.focusTarget`, `requiresTarget: true`
- `requestApprovalPreview` -> `approval.requestPreview`
- `requestHostAction` remains the low-level escape hatch for allowlisted host actions.

`window.__sonikAgentUI.getTargetRegistry()` remains the source of semantic target ids. Agents should pass target ids from that registry, never CSS selectors.

## Host implementation seam

Booking/Amplify hosts implement visuals behind `mountSonikAgentUI({ handleHostAction })`:

1. Evaluate with `evaluateHostActionRequest({ request, registry })`.
2. For `tour.highlight` / `tour.focusTarget`, resolve the semantic target to host DOM or canvas bounds.
3. Return `createHostActionResult(...)` with an executed or blocked receipt.
4. Do not execute writes from `approval.requestPreview`; it should return/drive approval preview only.

## Smoke expectation

From the embedded iframe, an ultratest can:

```js
const actions = await pageControl.getActions();
const registry = await pageControl.getTargetRegistry();
await pageControl.callAction('highlightTarget', { targetId: 'booking.ui.schedulePanel' });
await pageControl.callAction('focusTarget', { targetId: 'booking.ui.schedulePanel' });
```

Expected: semantic receipts, no DOM scraping, controlled failures when the host has not mounted a target/action handler.
