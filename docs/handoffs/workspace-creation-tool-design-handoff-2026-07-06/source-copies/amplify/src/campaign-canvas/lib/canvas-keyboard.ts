/**
 * Pure helpers for the campaign-canvas keyboard shortcut handler.
 *
 * These are intentionally free of any Svelte or DOM side effects so they can
 * be unit-tested directly. `CampaignCanvas.svelte` composes them with the
 * singleton stores (`canvasState`, `canvasHistory`) inside its own
 * `handleKeydown` — this module only answers "what did the user press?" and
 * "should this event be ignored because the user is typing?".
 */

/**
 * Return true when the keyboard event originated from an editable surface
 * (text input, textarea, select, contenteditable) or from an in-progress IME
 * composition. The canvas-level shortcut handler must bail out in those cases
 * so users can type normally in drawers, inline node editors, or CJK IMEs.
 *
 * We check both `event.isComposing` and the legacy `keyCode === 229` fallback
 * because some older browsers (and several Linux IMEs) only expose composition
 * state through the legacy signal.
 */
export function isEditableEventTarget(event: KeyboardEvent): boolean {
	if (event.isComposing || event.keyCode === 229) return true;
	const target = event.target as HTMLElement | null;
	if (!target) return false;
	const tag = target.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	if (target.isContentEditable) return true;
	return false;
}

/**
 * Logical action produced by matching a keyboard event against the canvas
 * shortcut table. `"none"` means the event should pass through untouched.
 */
export type CanvasShortcutAction =
	| "undo"
	| "redo"
	| "copy"
	| "paste"
	| "delete"
	| "selectAll"
	| "fitView"
	| "none";

/**
 * Map a raw keyboard event to a canvas shortcut action.
 *
 * Shortcut table:
 *   Cmd/Ctrl+Z        -> undo
 *   Cmd/Ctrl+Shift+Z  -> redo
 *   Delete/Backspace  -> delete (remove selected nodes + connected edges)
 *   Cmd/Ctrl+A        -> selectAll
 *   (anything else)   -> none
 *
 * Both `metaKey` (macOS Cmd) and `ctrlKey` (Windows/Linux Ctrl) count as the
 * "mod" modifier. `event.key` is normalized to lowercase for single-character
 * keys so that Shift-held combinations still match.
 */
export function matchCanvasShortcut(
	event: KeyboardEvent,
): CanvasShortcutAction {
	const isMod = event.metaKey || event.ctrlKey;
	const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

	if (isMod && key === "z") {
		return event.shiftKey ? "redo" : "undo";
	}
	if (isMod && key === "a") {
		return "selectAll";
	}
	if (isMod && key === "c") {
		return "copy";
	}
	if (isMod && key === "v") {
		return "paste";
	}
	if (isMod && key === "0") {
		return "fitView";
	}
	if (event.key === "Delete" || event.key === "Backspace") {
		return "delete";
	}
	return "none";
}

/**
 * Collect the ids of all "selected" nodes from a canvas-like state object.
 * Considers both the scalar `selectedNodeId` (React-page selection) and the
 * per-node `selected` flag (multi-select via @xyflow/svelte).
 */
export function collectSelectedNodeIds(state: {
	selectedNodeId: string | null;
	nodes: ReadonlyArray<{ id: string; selected?: boolean }>;
}): string[] {
	const ids = new Set<string>();
	if (state.selectedNodeId) {
		ids.add(state.selectedNodeId);
	}
	for (const node of state.nodes) {
		if (node.selected) {
			ids.add(node.id);
		}
	}
	return [...ids];
}
