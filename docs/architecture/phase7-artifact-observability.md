# Phase 7 — Artifact observability and manual smoke gate

## Outcome

Phase 7 keeps the copied `json-render` chat stream and Slice 6 promotion policy intact while making the artifact lifecycle visible enough for manual testing.

This is still an app-local prototype layer:

- artifacts remain in browser memory only;
- inline JSON-render responses can stay inline-only;
- promoted workspace artifacts now expose id, version, promotion reason, source prompt, source user/assistant message ids, update time, raw JSON-render spec, and recent promotion events;
- no durable artifact warehouse, ORPC tool-contract generation, Sonik adapter mapping, MCP projection, sandbox execution, or memory system is introduced in this slice.

## Implemented seam

- `apps/standalone-sveltekit/src/lib/artifacts/artifact-observability.ts`
  - converts `promoteJsonRenderArtifact(...)` results into observable events;
  - distinguishes `inline_rendered`, `artifact_promoted`, `artifact_updated`, and `artifact_unchanged`;
  - derives an active artifact status object for the workspace inspector;
  - uses a monotonic in-session observation index instead of content-signature truncation for event identity;
  - dedupes and bounds recent in-memory events.
- `apps/standalone-sveltekit/src/lib/artifacts/ArtifactInspector.svelte`
  - renders the active artifact id, version, promotion reason, source prompt, source user/assistant message ids, and update timestamp;
  - exposes a raw JSON-render spec drawer with copy affordance;
  - shows the latest in-memory artifact events.
- `apps/standalone-sveltekit/src/routes/+page.svelte`
  - keeps `Chat` + `DefaultChatTransport` + `/api/generate` unchanged;
  - keeps inline `JsonArtifactRenderer` unchanged;
  - records observation events after the existing promotion decision;
  - clears artifact observability state when the chat session is reset.

## Manual smoke gate

Run the standalone app and verify the following before treating the artifact UX as manually testable:

1. Ask: `Show me the weather in Bogota as a temporary inline table in chat only.`
   - Expected: JSON-render appears inline in chat.
   - Expected: workspace pane remains unchanged or still shows the previous active artifact.
2. Ask: `Create a canvas dashboard for the weather in Bogota.`
   - Expected: inline render appears in chat.
   - Expected: workspace pane shows the same rendered artifact.
   - Expected: workspace inspector shows `Promoted workspace artifact`, artifact id, version, promotion reason, source prompt, and source user/assistant message ids.
   - Expected: raw JSON-render spec drawer opens and copy works in a browser with clipboard permission.
3. Ask after step 2: `Update this canvas with London and Tokyo too.`
   - Expected: active artifact id is reused.
   - Expected: version advances when the JSON-render spec changes.
   - Expected: recent event log shows an `artifact_updated` event.
4. Ask after step 3: `Show me the Hacker News top stories in chat only.`
   - Expected: inline chat render can appear.
   - Expected: existing workspace artifact remains visible and is not overwritten.

## Current persistence answer

The active artifact is not saved locally to a database or filesystem yet. It is session/browser-memory state held by the Svelte page. Observation events are also in-memory UI records, keyed by a monotonic session-local observation index. This slice makes that explicit in the UI and creates the seam that a later artifact warehouse can replace with first-class causal metadata.
