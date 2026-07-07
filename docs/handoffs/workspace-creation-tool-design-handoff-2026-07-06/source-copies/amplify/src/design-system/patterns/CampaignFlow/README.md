# CampaignFlow — Shared Contracts and Theme Surface

This directory is the shared contract and documentation surface for the
campaign wizard. The live runtime canvas is Svelte-based under
`src/campaign-canvas/`, mounted into the React page shell via
`SvelteCanvasAdapter`.

## Live Architecture

| Layer | Live owner | Role |
|-------|------------|------|
| Route/page shell | `src/routes/campaign-wizard.*`, `src/pages/campaign-wizard/` | Auth gating, oRPC load/save, drawer state, palette orchestration |
| Runtime canvas | `src/campaign-canvas/` | Nodes, edges, viewport, selection, keyboard, context menu, undo/redo |
| Shared contracts | `src/design-system/patterns/CampaignFlow/types/` | Portable `FlowNode` / `FlowEdge` / `FlowViewport` DTOs |
| Theme surface | `src/design-system/patterns/CampaignFlow/theme/flow-tokens.css` | Flow-specific tokens and classes |

## Important Truths

- The live canvas runtime uses `@xyflow/svelte`, not `@xyflow/react`.
- `src/campaign-canvas/` is the canonical runtime implementation.
- Legacy React Flow implementation, old Storybook experiences, and the
  spreadsheet integration plan are archived under
  `_archive/campaign-flow-react-flow-archive/` and are excluded from active
  typecheck/runtime paths.
- `src/pages/campaign-wizard/campaign-to-flow.ts` is the current page-level
  bridge/fallback layer.
- If this README conflicts with the runtime files, the runtime files win.

## Key Files

```
CampaignFlow/
├── types/
│   ├── nodes.ts                 # Discriminated unions for channel/logic/event/ai-action
│   ├── edges.ts                 # Edge kinds and statuses
│   └── flow.ts                  # Shared node/edge/viewport DTOs + bridge props
├── theme/
│   └── flow-tokens.css          # Flow token classes used by Svelte runtime
└── README.md                    # Orientation only
```

## Current Wizard Status

- Flow graph load/save exists via `src/orpc/router/campaign-flow.ts`.
- Publish exists server-side and is wired from the page shell.
- Drag/drop, context insertion, and fit-view are owned by the page↔canvas bridge.
- Logic/Event/AI nodes are still partial product surfaces. Logic has minimal
  in-node configuration; Event and AI remain design-time-first.
- PixiJS edge glow is a decorative overlay, not workflow truth.

## Follow-On Work

- Keep docs aligned with `src/campaign-canvas/` and `src/pages/campaign-wizard/`.
- Keep historical React Flow artifacts in `_archive/`; do not add active imports back to `src/`.
- Prefer route/seam tests over Storybook-only confidence for wizard behavior.

## Key Design Decisions

**Discriminated unions on `data.kind`** — Every node/edge carries a `kind` field that
discriminates the union. TypeScript narrows automatically: `if (data.kind === 'channel') { data.provider }`.

**Sub-connections as typed edges** — Logic hooks, event triggers, AI actions are NOT metadata
on channel nodes. They are separate nodes connected via typed edges. This makes the graph
queryable and the layout engine treats them as first-class citizens.

**CSS custom properties, not Tailwind config** — All flow-specific colors go through
`--flow-*` CSS variables. The token file references DaisyUI's oklch channel vars
(`--bc`, `--b1`, `--p`, etc.) so theme changes propagate automatically.

**Controlled bridge** — the React page shell owns persistence/orchestration,
while the Svelte runtime owns interactive graph state. The bridge between them
must stay explicit and minimal.
