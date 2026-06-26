# Slice 8 — Canvas viewport shell

## Outcome

Slice 8 makes the artifact surface visibly platform-level instead of a barely labeled side pane. It does **not** copy Odysseus internals and does **not** change the copied `json-render` renderer behavior. The slice adds a local Sonik Agent UI canvas shell around the existing JSON-render artifact renderer.

The goal is manual-test clarity: when an artifact exists, the right side now presents itself as an `Artifact Canvas` with canvas chrome, panel controls, fullscreen mode, raw JSON mode, inspector mode, and a clear empty/pending state.

## Implemented seam

| Area | Files | Treatment |
| --- | --- | --- |
| Canvas toolbar | `packages/workspace-core/src/components/CanvasToolbar.svelte` | New reusable Svelte toolbar for canvas title/subtitle, panel selection, fullscreen toggle, and clear action. |
| Canvas viewport | `packages/workspace-core/src/components/CanvasViewport.svelte` | New reusable viewport shell with three modes: rendered canvas, inspector, raw JSON. Wraps child renderer snippets instead of owning JSON-render internals. |
| Package exports | `packages/workspace-core/src/index.ts` | Exports `CanvasViewport`, `CanvasToolbar`, and their public types. |
| Standalone wiring | `apps/standalone-sveltekit/src/routes/+page.svelte` | Replaces the app's right-pane use of `ArtifactFrame` with `CanvasViewport`, while preserving `JsonArtifactRenderer`, `ArtifactInspector`, active artifact state, and `createJsonArtifact` promotion behavior. |

## Source reuse / copy-retrofit status

This slice is **retrofit-only** around already-copied donor code:

- JSON rendering still delegates to the copied `@json-render/svelte` behavior through `@sonik-agent-ui/json-ui-runtime`:
  `JsonUIProvider initialState={spec.state}` + `Renderer {spec} {registry} {loading}`.
- The chat stream loop and `/api/generate` pipeline remain intact.
- No Odysseus source files were copied in this slice. The shell is a local platform seam added so a future Odysseus copy-retrofit pass has an obvious destination surface.

## Manual testing expectations

1. Fresh load: right pane should show `Artifact Canvas`, `Artifact workspace`, and `Canvas viewport ready`.
2. Submit an artifact prompt: right pane should show `Artifact Canvas`, `Preparing artifact...`, and `Artifact creation requested` while streaming.
3. After promotion: right pane should show the artifact title, `json-render · v1`, and toolbar buttons: `Canvas`, `Inspector`, `Raw JSON`, `Fullscreen`, `Clear`.
4. `Inspector` should show the existing promotion metadata.
5. `Raw JSON` should show the in-memory JSON-render payload.
6. `Fullscreen` should expand the canvas shell over the app without changing artifact state.
7. `Clear` should clear only the active artifact/canvas state, not the chat transcript.

## Deferred

- No Odysseus artifact workspace/document editor copy yet.
- No resizable/tmux pane tree wiring.
- No durable artifact warehouse.
- No ORPC/Sonik contract-backed artifact persistence.
- No sandbox/static-JS artifact runtime.
- No chat inline-render suppression for artifact tool output beyond existing behavior.

## Post-manual-smoke correction — 2026-06-19

Manual testing showed the first viewport shell still behaved like a below-chat duplicate renderer rather than a true workspace canvas. The follow-up correction made four bounded platform-shell fixes without changing the JSON-render donor renderer:

- `WorkspaceRoot` now opens the artifact pane only when an artifact is pending or active, and uses component-scoped CSS grid rules so desktop layout is reliably chat-left / canvas-right instead of relying on Tailwind arbitrary grid class generation from a package file.
- `AgentConversation` / `AgentMessage` accept `shouldRenderArtifact`, letting the standalone app suppress inline JSON-render output for promoted canvas artifact messages. Explicit artifact tool calls now render in the canvas only, while normal temporary JSON-render responses can still render inline.
- `CanvasViewport` fullscreen is implemented with component CSS (`position: fixed`) rather than interpolated utility classes, so the viewport actually overlays the app.
- `CanvasViewport` gained an `Edit JSON` panel with an editable JSON-render spec textarea and apply callback. This is a minimal direct-edit seam, not the future Odysseus block/type palette.

Still deferred: Odysseus-style artifact block palette/message-type selector, durable artifact warehouse persistence, ORPC tool-contract routing, sandbox execution, and true multi-pane tmux workspace operations in the live UI.
