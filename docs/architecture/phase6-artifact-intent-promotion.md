# Phase 6 — Artifact intent and promotion layer

## Outcome

Phase 6 keeps the copied `json-render` streaming path intact and adds a thin promotion policy at the existing app seam where parsed JSON-render specs may become workspace artifacts.

The rule is intentionally narrow and temporary:

- tool results can stay as plain data for text answers;
- JSON-render specs can render ephemerally inline in chat;
- workspace artifacts are created or upserted only when the user asks for a canvas/artifact/workspace-style output or asks to update the active artifact.

JSON-render remains a renderer and stream format. This prompt heuristic is a temporary UX policy for the standalone prototype; it lives in the standalone app, not shared `artifact-model`, and is not the future ORPC/OpenAPI/MCP tool-contract shape.

## Implemented seam

- `apps/standalone-sveltekit/src/lib/artifacts/artifact-promotion.ts`
  - `decideArtifactPromotion(...)`
  - detects `none`, `inline`, or `artifact` promotion;
  - gives explicit inline-only intent priority over artifact/update intent;
  - reuses the active artifact only for active update language such as “update this canvas”.
- `apps/standalone-sveltekit/src/lib/artifacts/json-render-promotion.ts`
  - `promoteJsonRenderArtifact(...)`;
  - centralizes the decide + upsert flow in the standalone app so the page does not own artifact mutation policy and shared `artifact-model` does not expose prompt heuristics.
- `apps/standalone-sveltekit/src/routes/+page.svelte`
  - keeps `pipeJsonRender()` and inline chat rendering unchanged;
  - keeps existing canvas artifacts stable during plain chat turns and inline-only visual turns;
  - promotes latest JSON-render specs only when the promotion helper says to create/upsert an artifact;
  - keeps promotion application in a `$effect` and artifact state in `$state`, avoiding render-time mutation inside `$derived`.
- `packages/workspace-core/src/components/ArtifactFrame.svelte`
  - updates empty-state copy to explain that temporary JSON-render responses can stay in chat.

## Decision table

| User prompt shape | JSON-render spec? | Active artifact? | Result |
|---|---:|---:|---|
| “What is X?” | no | any | text only; artifact unchanged |
| “Show X as a table” | yes | none | inline chat render only |
| “Show X in chat only” | yes | yes | inline chat render only; artifact unchanged |
| “Create a canvas dashboard for X” | yes | any | create/upsert artifact |
| “Update this canvas with Y” | yes | yes | upsert active artifact |

## Deferred

- ORPC/tool-contract generation.
- Sonik booking/OpenAPI adapter mapping.
- MCP projection.
- Sandbox execution.
- Durable database-backed artifact warehouse.
- Model-authored artifact operation tool calls.

Those remain separate from the renderer policy so the current local JSON-render loop stays easy to reason about.

## Manual testing gate

Run the standalone app and verify:

1. Ask: `What is the weather in Bogota?`
   - Expected: text/tool answer may appear; no canvas artifact is required.
2. Ask: `Show me the weather in Bogota as a temporary inline table in chat only.`
   - Expected: JSON-render appears inline in chat; artifact pane remains unchanged.
3. Ask: `Create a canvas dashboard for the weather in Bogota.`
   - Expected: inline render appears in chat and the canvas artifact pane receives the same JSON-render artifact.
4. Ask after step 3: `Update this canvas with London and Tokyo too.`
   - Expected: active canvas artifact is upserted; artifact ID is reused and version can advance.
5. Ask after step 4: `Show me the Hacker News top stories in chat only.`
   - Expected: inline chat render can appear while the existing canvas artifact remains visible.
