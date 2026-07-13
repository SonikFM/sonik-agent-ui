# HANDOFF — Composer Context Tools (parallel lane, 2026-07-13)

## Mission
Implement the chat composer's context-adding tools — **dynamic skills picker,
file upload, plugin/MCP selector** — in the existing in-app chat surface.
This is AC-8 of `.omc/specs/deep-interview-agent-creation-tool.md`, split out
for parallel execution while the main plan (agent definitions-as-data +
workflow builder) is consensus-refined. Work on a separate branch; commit
locally; **no push/PR/merge without Dan's explicit ask.**

## Why this is safe to parallelize
- Research complete: `docs/research/copy-retrofit-prerunners/composer-context-adding-2026-07-13.md`
  is the pattern book (read it fully before any code).
- File scope does not overlap the main plan's lane. **This lane owns:**
  `packages/chat-surface/**` (composer components) and the composer-adjacent
  parts of `apps/standalone-sveltekit` chat UI. **This lane must NOT touch:**
  `packages/tool-contracts/**`, `apps/standalone-sveltekit/src/lib/agent.ts` /
  `agent-settings.ts` (the adapter work), any new `routes/admin` or
  workflow-builder-mode routes, or reservation `+page.svelte` paths (merged A2
  commit path).
- No dependency on the new agent-definition contracts: build against today's
  `AgentRuntimeSettings` (`skillIds`, `toolPermissionModes`) and today's tool
  mounting. When the main plan lands definitions-as-data, only the DATA SOURCE
  behind the pickers changes — design picker components to take their catalog
  as a prop/store, never hardcode the source.

## Current state (verified by explorer, 2026-07-13)
- Chat rendering lives in `packages/chat-surface` (Svelte,
  `@sonik-agent-ui/chat-surface`); app shell + streaming endpoint in
  `apps/standalone-sveltekit/src/routes/+page.svelte` and
  `routes/api/generate/+server.ts`.
- Runtime tools mount per turn in `apps/standalone-sveltekit/src/lib/agent.ts:81-120`
  (skill-gated booking intake, command-catalog approval/host-gated, etc.).
- Skill catalog + command registry endpoints exist (`api/command-registry`,
  tool-manifest/skill-catalog tools) — use them as picker data sources.

## Design (from the pattern book — follow it)
1. **One editor, registered triggers** (reimplement-from-spec; OpenWebUI is
   Tier B — NEVER copy its source; Odysseus is AGPL Tier C — technique only):
   `$` → skills, `/` → commands/prompts (merge the live skill catalog into `/`
   too), `#` → knowledge (stub the data source until knowledge v1 lands),
   `@` → reserved (docs/pages later). One suggestion popup, one keyboard model
   (arrows/Tab/Enter/Esc), debounced search.
2. **Plugin/MCP selector = drill-down popover** (Onyx pattern, MIT Tier A):
   searchable flat list → per-server SwitchList → back; dual state per row —
   persistent enable (maps to `toolPermissionModes` today, `toolPolicy`
   allow/off later) + per-turn "force" pin rendered as a toolbar pill.
   **The popover reflects grants; it never issues them** — gating stays
   server-side. Support multiple pinned tools (don't copy Onyx's hidden
   single-slot limit).
3. **Attached-context truth = one staged-chip row** (Open Design pattern,
   Apache Tier A): a single wrapping row above the input for files/knowledge/
   pinned tools; chips have two sibling buttons (open/details + remove) for
   a11y; hover-reveal remove; collapse to "N files ×" badge at >3; per-chip
   upload spinner. If inline tokens are used, keep chip-state and token-text
   bidirectionally synced from one insert/remove function.
4. **File upload:** paperclip popover (Upload + Recent quick-list + full modal
   overflow), drag-drop on the composer root, paste. Wire to the existing
   upload/session-document path (`api/documents` / intake — verify in repo).
5. **Composer stays modular:** editor, pickers, chip row, and send
   state-machine are separate components. The 1,000–2,200-line God-component
   composer is the documented cross-product anti-pattern — reviewers reject it.

## Constraints (non-negotiable)
- Design bans: no gradients, no emoji, no left-stripe accent cards, no
  Inter/Roboto; dark operator theme via existing tokens; reduced-motion
  alternatives for any animation.
- Every new interactive control covered in `window.__sonikAgentUI` (actions,
  disabledReasons) — run `bun scripts/check-agent-ui-coverage.ts` and the
  design gates before claiming done.
- Renderer stays execution-inert; nothing in the composer grants capability;
  chat text is never approval.
- License discipline: port freely from Onyx (non-`ee/`) and Open Design
  (Apache) with notices retained; OpenWebUI and Odysseus are
  reimplement/technique-only — zero verbatim code.
- Subagents pinned sonnet/haiku. Booking-service: reads only.

## Acceptance criteria
- [ ] `$` opens the skills picker filtered from the live skill catalog;
  selection stages the skill for the turn and shows a chip.
- [ ] `/` popup merges commands + skills, keyboard-complete.
- [ ] Plugin/MCP drill-down popover: search → per-server toggle list; enable
  state persists (AgentRuntimeSettings), pin state is per-conversation; pinned
  tools render as removable toolbar pills (multiple allowed).
- [ ] File upload via paperclip popover, drag-drop, and paste; chips with
  per-chip progress; collapse-to-badge at >3; remove works mid-upload.
- [ ] One staged-context row shows ALL attached context kinds; every chip has
  open + remove as separate focusable controls.
- [ ] Composer split into ≥4 components (editor / pickers / chips / send);
  no single file over ~400 lines.
- [ ] Design gates + agent-ui coverage checks pass; `pnpm build` and
  `pnpm test` green; keyboard-only walkthrough of every picker recorded in
  the PR notes.

## Deliberately out of scope (main plan owns these)
Agent definitions-as-data, the definition→runtime adapter, workflow-builder
mode, drafting agent, knowledge store implementation (stub the `#` source),
capability-registry changes, admin routes, embed hardening.
