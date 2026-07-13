# Composer Context-Adding UI — Exact-Interface Retrofit Analysis (2026-07-13)

Feeds spec AC-8 (composer context tools: dynamic skills picker, file upload,
plugin/MCP selector) in `.omc/specs/deep-interview-agent-creation-tool.md`.
Per-product briefs land here as researchers report; synthesis section last.

---

## Onyx (`~/Documents/GitHub/onyx`) — Tier A (MIT outside `ee/`)

### Composer anatomy — `web/src/sections/input/AppInputBar.tsx` (1078 lines)
One `contentEditable` div (not textarea) with a per-message toolbar:
- `(+)` paperclip → `FilePickerPopover` (attach/upload)
- Sliders icon → `ActionsPopover` (tools/actions/MCP/knowledge manager) — rendered only if the agent has tools
- "Deep Research" toggleable pill / "Read this tab" toggle (mutually exclusive slot)
- Forced-tool pills: one `SelectButton` per pinned tool inline in the toolbar; click to unpin
- Mic (STT) with waveform overlay; TTS mute/stop while agent speaks
- Send button state-machines: submit / stop-generating / enqueue by `chatState`
- Slash-command popover: `/` triggers `showPrompts` filtering `activePromptShortcuts`; arrows/Tab cycle, Enter selects; last row = "Create New Prompt" deep-link; `Popover.Anchor` wraps the textbox itself
- Paste-as-tile: pasted text becomes an inline "tile" chip inside the content-editable (`useContentEditable`/`PasteTilePopover`); click to expand
- `QueuedMessageBar` above input: messages typed during streaming are queued with edit/discard + arrow-key nav

### Picker UX — `web/src/refresh-components/popovers/ActionsPopover/index.tsx` (1022 lines) — the standout
- One button opens a **searchable drill-down popover** (`InputTypeIn` search pinned at top)
- Primary view: built-in tools as `ActionLineItem` rows, each with TWO independent states — a persisted enable/disable toggle (per-agent, `agentPreferences`) AND a "force" pin (pins a chip in the toolbar; max 1 forced, always replaces)
- MCP servers as `MCPLineItem` rows w/ auth status → click drills into a secondary `SwitchList` view scoped to that server's tools: per-tool toggle, enable/disable-all, back button, "Re-Authenticate" footer when needed
- Knowledge sources get their own secondary `SwitchList` via a manage-sources affordance in the search-tool row
- Scope model: forced tools = per-conversation (localStorage `useForcedTools`); enable/disable = per-agent persisted; MCP auth = per-server (OAuth or `MCPApiKeyModal`)
- `FilePickerPopover.tsx`: Upload Files action + Recent Files quick list (capped `MAX_FILES_TO_SHOW`) + "All Recent Files" → full `UserFilesModal`; one popover both attaches new and re-picks recent

### Context display / removal
- Files → `FileCard.tsx` chips above the input in an animated-height wrapper (`AppInputBar.tsx:862-885`); hover-reveal `X` via `Removable`/`Hoverable` group (absolute `-left-2 -top-2`)
- Forced tools → toolbar pills (no separate chip row); click unpins
- Pasted text → inline tiles in the editable; click expands
- `InputChipStrip.tsx` (228 lines) exists as a generic chip strip used elsewhere

### Steals
1. **Drill-down popover: search → toggle → manage** (flat list → per-server SwitchList) — scales from a few tools to many MCP servers × many tools with no modal.
2. **"Enabled" vs "forced/pinned" as two independent states on one tool row** — configure the agent's toolbox once (persistent), force a tool for just this message (per-turn).
3. **Hover-reveal remove on chips** — no persistent clutter.

### Anti-patterns
- `AppInputBar.tsx` is a 1078-line God component (voice/TTS/drafts/queue/DnD/prompts all mixed) — copy patterns, never the file.
- Forced-tool silently limited to exactly one (`setForcedToolIds([toolId])` replaces) — hidden constraint not surfaced in UI copy.

### License
Root LICENSE = MIT (Expat) outside `ee/`; `backend/ee`, `web/src/app/ee`, `web/src/ee` are proprietary Onyx Enterprise. All files above are outside `ee/` → **Tier A port-safe**; re-classify Tier C if a port touches `ee/`.

---

## OpenWebUI (`~/Documents/GitHub/open-webui`) — Tier B (BSD-3 + branding clause)

### Composer anatomy — `src/lib/components/chat/MessageInput.svelte` (2222 lines)
- `InputMenu.svelte` = "+" attach menu; `IntegrationsMenu.svelte` = tools/skills/filters button
- Inline pill toggles in the composer row for web-search / image-gen / code-interpreter (filled pill when active, count badge for selected tools)
- Model picker above the composer (`ModelSelector.svelte`), not in the input row
- File/image chips in a flex-wrap row above the textarea via `FileItem.svelte`

### Picker UX — the standout: one editor, five trigger characters
One Tiptap instance with five registered mention triggers, each rendering a
different picker in the same `CommandSuggestionList.svelte` popup (w-72 card,
keyboard-navigable, 200ms debounced backend search):
- `@` → models · `/` → saved prompts · `#` → knowledge (KBs, files, folders, AND pasted-URL auto-detect: YouTube vs webpage offered as attachable source) · `$` → **skills** (dynamic skill invocation) · `:` → emoji
- Dropdown menus use a nested-tab-in-one-panel pattern (row with chevron swaps a sub-list into the SAME panel, fly transition + back arrow) — no modal stacking
- MCP-like "tool servers" merge into the same tools list as `direct_server:{idx}` entries; tools/filters are Switch rows, per-conversation scope (`selectedToolIds`)
- Scope nuance: `#` selection attaches to the whole chat's file list (session), not just the message

### Steals
1. **Multi-trigger mention system**: adding a new context type = one trigger char + one picker component, zero new plumbing.
2. **Nested-tab-in-one-dropdown** — everything ≤2 clicks, no modal stacks.
3. `#`-picker pasted-URL auto-detection.

### Anti-patterns
- 500-600-line menu components mixing chrome + permission tooltips + logic.
- Five near-verbatim duplicate trigger blocks (`onUpload` copy-pasted) — don't reproduce.

### License
BSD-3 **plus a 4th clause**: "Open WebUI" branding must be retained in deployments >50 users/30 days without a written exception. Sonik exceeds that → **Tier B: reimplement from spec, never paste source.**

---

## Odysseus (`~/Documents/GitHub/odysseus`) — Tier C (AGPL-3.0, technique only)

### Composer anatomy — `static/index.html:1010-1157`, vanilla JS
- Textarea + ghost-text overlay for inline suggestions; hidden multi-file input
- Model picker top-right: searchable dropdown w/ live filter + refresh + add-endpoint
- `#attach-strip` chips row; "+" overflow menu (Attach/Documents/RAG/Workspace/Persona rows w/ active-dot); always-visible Web-search + Shell toggles
- **Toggle-becomes-inline-pill**: activating a mode (RAG/Workspace/Research/Persona…) promotes it from menu item to a visible `.tool-indicator` pill in the bar with inline "×" to deactivate

### Picker UX
- **Slash-commands-as-search-index** (`slashAutocomplete.js` + `slashCommands.js`, ~6500 lines): `/` opens a fuzzy popup over a flattened registry, and **dynamic skills merge into the same popup** via live fetch of `/api/skills/slash-catalog` — skills ARE slash rows, ranked by the same scorer. Entirely text-driven, no modal.
- MCP tool selection is global-only (Settings page checkboxes, "N/M enabled", All/None) — NOT in the composer.
- No @-mention system for docs/tools.

### Context display — `static/js/fileHandler.js:184-265`
1-3 files = individual thumb chips (preview or name + ×); **4+ collapse into a single "N files ×" badge** expanding on click; per-chip upload spinner instead of global loading; mobile tap-to-crop before upload.

### Steals (reimplement only)
1. Skills merged into the slash popup (dynamic-skill invocation with zero new surface).
2. Chip collapse-to-badge at >3 attachments; per-chip spinners.
3. Toggle-becomes-pill active-mode indicators.

### Anti-patterns
Global-only MCP scoping (no per-conversation control); `#pinned-tools-bar` shipped as a dead DOM stub.

### License
**AGPL-3.0-or-later** — network copyleft. **Tier C: read-for-technique only, port nothing.**

---

## Open Design (`~/Documents/GitHub/open-design`) — Tier A (Apache-2.0)

### Composer anatomy
`ChatComposer.tsx` + `LexicalComposerInput.tsx` — Lexical rich-text with @-mention/slash triggers and a **caret-anchored popover** (`CaretFloatingLayer.tsx`: the picker floats at the text caret, not pinned to the input frame).

### Picker UX
Single "+" menu (`ComposerPlusMenu.tsx`) grouping Files / Code / Designs / Other, with **nested flyout submenus for Connectors / Plugins / Skills / MCP / Toolbox**, each with its own searchable panel.

### Context display
Everything attached for a turn renders in ONE wrapping **`StagedRunContexts` chip row** — open-button + remove-button per chip — **synced bidirectionally with inline `@token` text** (delete the token, the chip goes; remove the chip, the token goes).

### Steals
1. **Unified staged-context chip row** — one truthful place showing everything on this turn.
2. Caret-anchored picker popover.
3. Two-sibling-button chip a11y pattern (open + remove as separate focusables).

### Anti-pattern
MCP "insert" is just a text hint, not real tool binding — looks wired, isn't.

### License
Apache-2.0 → **Tier A port-safe.**

---

## Recommended composer anatomy for Sonik (synthesis)

Target: the Svelte `chat-surface` composer gains dynamic skills, file upload,
and a plugin/MCP selector (spec AC-8). Ranked composition:

1. **One editor, registered triggers** (OpenWebUI pattern, Tier B reimplement):
   `@` pages/docs · `/` commands+prompts · `$` skills · `#` knowledge — one
   suggestion popup, one keyboard model, new context types are one trigger +
   one picker. Merge the skill catalog into `/` too (Odysseus's
   slash-catalog move) so skills are reachable both ways.
2. **Plugin/MCP selector = Onyx's drill-down ActionsPopover** (Tier A):
   searchable flat list → per-server SwitchList → manage/auth footer. Map the
   dual state to OUR contract: the persistent enable/disable toggle IS
   `toolPolicy` allow/off on the agent definition; the per-turn "force" pin is
   a session-scoped hint — and unlike Onyx, gating stays server-side in the
   capability registry (the popover reflects grants, never grants them).
3. **Attached-context truth = Open Design's StagedRunContexts row** (Tier A):
   one wrapping chip row above the input for files/knowledge/pinned tools,
   bidirectionally synced with inline tokens; hover-reveal remove (Onyx);
   collapse-to-badge at >3 (Odysseus); per-chip upload spinners (Odysseus).
4. **File upload**: paperclip popover with Upload + Recent quick-list + full
   modal overflow (Onyx `FilePickerPopover`), plus drag-drop and paste.
5. **Active-mode pills**: web-search-class toggles render as filled pills in
   the bar when on (OpenWebUI/Odysseus convergence).

Anti-patterns to enforce in review: no God-component composer (split editor /
pickers / chips / send state-machine); no global-only tool scoping; no
hidden single-slot constraints without UI copy; no dead placeholder bars; no
fake MCP binding; zero verbatim OpenWebUI (branding clause) or Odysseus
(AGPL) code.

License ledger: Onyx MIT (non-ee) = A · Open Design Apache-2.0 = A ·
OpenWebUI BSD-3+branding = B · Odysseus AGPL = C.
