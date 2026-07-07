# Twenty AI Settings copy-retrofit donor pack

Source: `twentyhq/twenty` at `1a85b88d38d62f57c7955fc87d82116f9fc65ce0`.
Manifest: `manifests/copy-retrofit/twenty-ai-settings.json`.

This directory is a preserved upstream reference island for Agent Settings UX patterns. Do not edit copied files in place; copy-retrofit changes belong in Sonik runtime code outside this directory.

## Donor patterns retained

- AI settings shell with tabs for Overview, Models, Skills, Tools, Usage.
- Model picker with default smart/fast model selection, searchable enabled models, recommended toggle, and optimistic action semantics.
- Skill catalog UI with search, active/deactivated state, and activate/delete actions.
- Tool catalog UI with search and Custom/Managed/Standard-style filtering.
- Permission validation modal that summarizes requested scopes before authorization.
- MCP scope picker and setup guidance for user/workspace-scoped add-ons.

## Sonik retrofit mapping

Implemented Sonik runtime equivalents live in:

- `packages/chat-surface/src/components/AgentSettingsPanel.svelte` — embedded gear/settings panel.
- `apps/standalone-sveltekit/src/lib/agent-settings.ts` — type-safe model, skill, tool-family, and permission-mode registry.
- `apps/standalone-sveltekit/src/routes/+page.svelte` — passes selected model, runtime skills, and tool-family modes into `/api/generate`.
- `apps/standalone-sveltekit/src/routes/api/generate/+server.ts` — sanitizes settings at the server boundary and appends them to the run context.
- `apps/standalone-sveltekit/src/lib/tools/command-catalog.ts` — enforces `off` tool-family mode before command execution/commit. `ask` and `allow` never bypass trusted host approval.

