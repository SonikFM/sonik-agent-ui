import type {
	FlowEdge,
	FlowNode,
	FlowViewport,
} from "@/design-system/patterns/CampaignFlow/types/flow";
import { canvasState } from "./canvas-store.svelte";

/**
 * Document-level snapshot used by the history manager.
 *
 * Only the graph + viewport are included. Ephemeral UI state
 * (`selectedNodeId`, `isDragging`) is deliberately excluded so that
 * undoing a structural change never reverts an unrelated selection.
 */
export interface CanvasHistorySnapshot {
	nodes: FlowNode[];
	edges: FlowEdge[];
	viewport: FlowViewport;
}

/** Max number of snapshots retained in the past stack. */
export const MAX_HISTORY_DEPTH = 50;

/**
 * `CanvasHistoryManager` wraps `canvasState` via composition.
 *
 * It never reaches into canvas internals directly: callers invoke
 * `commitGraphChange()` *before* mutating `canvasState`, and the manager
 * captures a snapshot of the current graph + viewport. `undo()`/`redo()`
 * restore snapshots by reassigning the top-level reactive properties
 * (keeping `$state.raw` semantics intact).
 *
 * The `isDirty` flag flips true on any commit and only clears via
 * `markClean()` (called after a successful save) or `replaceGraph()`
 * (external reloads).
 */
class CanvasHistoryManager {
	#past: CanvasHistorySnapshot[] = $state.raw([]);
	#future: CanvasHistorySnapshot[] = $state.raw([]);
	#dirty = $state(false);

	readonly canUndo = $derived(this.#past.length > 0);
	readonly canRedo = $derived(this.#future.length > 0);
	readonly isDirty = $derived(this.#dirty);

	#snapshot(): CanvasHistorySnapshot {
		return {
			nodes: canvasState.nodes,
			edges: canvasState.edges,
			viewport: { ...canvasState.viewport },
		};
	}

	#apply(snapshot: CanvasHistorySnapshot) {
		canvasState.nodes = snapshot.nodes;
		canvasState.edges = snapshot.edges;
		canvasState.viewport = { ...snapshot.viewport };
		canvasState.bumpGraphRevision();
	}

	/**
	 * Capture the current graph state BEFORE a mutation is applied.
	 * Drops the oldest entry when the stack exceeds MAX_HISTORY_DEPTH
	 * and clears the redo stack (standard undo/redo semantics).
	 */
	commitGraphChange(): void {
		const snapshot = this.#snapshot();
		const next = this.#past.concat(snapshot);
		this.#past =
			next.length > MAX_HISTORY_DEPTH
				? next.slice(next.length - MAX_HISTORY_DEPTH)
				: next;
		this.#future = [];
		this.#dirty = true;
	}

	/** Pop the most recent snapshot and restore it; push current onto future. */
	undo(): boolean {
		if (this.#past.length === 0) return false;
		const previous = this.#past[this.#past.length - 1];
		const current = this.#snapshot();
		this.#past = this.#past.slice(0, -1);
		this.#future = this.#future.concat(current);
		this.#apply(previous);
		this.#dirty = true;
		return true;
	}

	/** Pop the most recent future snapshot; push current onto past. */
	redo(): boolean {
		if (this.#future.length === 0) return false;
		const next = this.#future[this.#future.length - 1];
		const current = this.#snapshot();
		this.#future = this.#future.slice(0, -1);
		this.#past = this.#past.concat(current);
		this.#apply(next);
		this.#dirty = true;
		return true;
	}

	/**
	 * Replace the entire graph WITHOUT pushing history.
	 * Used by external loads (oRPC hydration, save round-trip).
	 * Clears both stacks and resets the dirty flag.
	 */
	replaceGraph(snapshot: CanvasHistorySnapshot): void {
		this.#past = [];
		this.#future = [];
		this.#dirty = false;
		this.#apply(snapshot);
	}

	/** Mark the current state as saved (called after a successful persist). */
	markClean(): void {
		this.#dirty = false;
	}

	/** Hard reset — used only in tests. */
	clear(): void {
		this.#past = [];
		this.#future = [];
		this.#dirty = false;
	}
}

export const canvasHistory = new CanvasHistoryManager();
