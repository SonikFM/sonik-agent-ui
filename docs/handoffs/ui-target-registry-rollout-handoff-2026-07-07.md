# UI target registry rollout handoff

Date: 2026-07-07
Scope: Booking, Amplify, and any host embedding Sonik Agent UI.

## Naming rule

`targetId` is UI-only. It is not a command id and not a database id.

Use three separate identifiers:

| Kind | Example | Meaning |
| --- | --- | --- |
| Command id | `booking.create.schedule.rule` | Executable ORPC/command action. |
| UI target id | `booking.ui.schedulePanel` | Visible region the agent can highlight/focus/describe. |
| Entity id | `34bb4e79-...` | Business object UUID. |

Use `booking.ui.*` for booking host targets. Avoid old names like `booking.context.schedule`; they read like domain/command objects and confuse agents.

Recommended first booking targets:

- `booking.ui.contextHeader`
- `booking.ui.schedulePanel`
- `booking.ui.inventoryPanel`
- `booking.ui.commandApprovalPanel`

## Host markup

```svelte
<section data-sonik-target="booking.ui.schedulePanel" data-sonik-entity-kind="booking_context" data-sonik-entity-id={contextId}>
  ...
</section>
```

## Registry entry

```ts
{
  targetId: 'booking.ui.schedulePanel',
  label: 'Schedule panel',
  description: 'Schedule rules and operating hours for the selected booking context.',
  surface: 'booking-context',
  entityRef: { kind: 'booking_context', id: contextId, label: contextName },
  capabilities: ['highlight', 'scroll', 'focus', 'edit', 'describe'],
  locator: { kind: 'data-sonik-target', value: 'booking.ui.schedulePanel' },
  policy: { actionMode: 'allow' },
}
```

## Validation

Agent UI now includes:

```bash
pnpm check:target-registry
```

The script is intentionally small: it catches unstable target ids and the deprecated/confusing `booking.context.*` / `booking.command.*` target namespaces. It does not auto-write targets; semantic names need product intent.

## Global rollout path

1. Add `data-sonik-target` anchors to stable host UI regions.
2. Add those same ids to `hostUiTargetRegistry` in page context.
3. Implement `tour.highlight` / `tour.focusTarget` in the host receiver.
4. Run `pnpm check:target-registry` in Agent UI and host-equivalent checks in Booking/Amplify.
5. Smoke from the iframe with `window.__sonikAgentUI.getTargetRegistry()` and `highlightTarget({ targetId })`.

Skipped: auto-injecting targets into host code. Add it only after Booking and Amplify settle shared naming conventions.
