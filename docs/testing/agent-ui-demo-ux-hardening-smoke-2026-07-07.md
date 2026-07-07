# Agent UI Demo UX Hardening Smoke — 2026-07-07

Purpose: verify the Agent UI-side demo polish without depending on new booking-service or Amplify changes. This smoke checks presentation, receipts, and trust-boundary copy only; it does not prove host writes unless Pipe-B command receipts are present.

## Scope

- Embedded Agent UI sidecar or standalone Agent UI are acceptable for UI-only checks.
- Do not count a write as PASS from chat narration alone. A write needs a trusted command receipt or Pipe-B evidence.
- No deployment is assumed by this doc; first confirm the Worker or local dev build contains the commit under test.

## Quick checks

| # | Area | Prompt/action | Expected result |
| --- | --- | --- | --- |
| 1 | Empty state launchers | Open a fresh chat. | Suggested workflow cards are Sonik-specific, descriptive, and show readiness badges. |
| 2 | Friendly tool labels | Ask: `Use the booking command catalog to check availability for the current page.` | Chat shows friendly activity like “Finding the right workflow”, “Checking required fields”, or “Checking booking data” instead of raw `searchSkillCatalog` / `learnCommand` as the main text. Raw IDs may appear only inside an expandable technical receipt. |
| 3 | Approval card | Start booking-context intake until preview is available. | Chat approval card says “Trusted approval” / “Needs input” / “Preview ready” in the main badge. Raw `booking.create.context` is inside “Technical command receipt”, not the primary visual label. |
| 4 | Approval boundary | Type `approve` in chat without pressing an approval affordance. | The UI must not treat chat text alone as trusted approval. A real commit still needs trusted host/session gating and a receipt. |
| 5 | JSON-render action receipts | Click a JSON-render action button such as Save draft, Request approval, Approve & run, or a host action. | ActionRail shows a visible receipt/status; errors are visible and not silent. |
| 6 | Session rail compactness | Open canvas/embedded layout with a collapsed rail and multiple chats. | Rail rows show compact readable labels plus semantic kind (`Chat`, `Art`, `Doc`, `R&D`) and the actions button says `Menu` instead of spinner-like dots. |
| 7 | New chat naming | Create a new chat and send a first prompt. | New chat is named from the first user prompt, not only `Untitled` or one-letter labels. |

## Failure notes to capture

For every FAIL, capture:

1. URL / deployment version if visible.
2. Screenshot.
3. Last visible chat turn.
4. Whether the issue was UI-only or a backend/host-context failure.
5. Pipe-B event id or note “no Pipe-B receipt observed”.

## Non-goals for this smoke

- Booking-service host-action receiver implementation.
- New command mounts in booking-service or Amplify.
- Full live write proof for `booking.create.context` or reservations.
- Visual redesign of the chat shell.
