import type {
	FlowEdge,
	FlowNode,
	FlowPosition,
	FlowViewport,
	Layer,
} from "@/design-system/patterns/CampaignFlow/types/flow";
import { type AutoLayoutOptions, applyAutoLayout } from "../lib/auto-layout";
import { setGridSize } from "../lib/grid-snap";
import { canvasHistory } from "./canvas-history.svelte";

/**
 * Canvas state exported as a reactive $state object.
 * Property assignments trigger reactivity (e.g. canvasState.nodes = [...]).
 * Arrays use $state.raw internally via reassignment -- not mutated in place.
 *
 * Grid size changes are automatically synced to the GSAP InertiaPlugin
 * snap function via `setGridSize()`.
 *
 * Mutation convenience methods (`addNode`, `removeNode`, `moveNode`, etc.)
 * commit a history snapshot via `canvasHistory.commitGraphChange()` BEFORE
 * reassigning state, keeping `canvasHistory` as the single source of truth
 * for undo/redo.
 */
class CanvasStore {
	nodes: FlowNode[] = $state.raw([]);
	edges: FlowEdge[] = $state.raw([]);
	selectedNodeId: string | null = $state(null);
	activeLayer: Layer = $state("full-board");
	viewport: FlowViewport = $state({ x: 0, y: 0, zoom: 0.7 });
	fitViewRequestId = $state(0);
	isDragging = $state(false);
	graphRevision = $state(0);

	#gridSize = $state(20);

	get gridSize() {
		return this.#gridSize;
	}

	set gridSize(value: number) {
		this.#gridSize = value;
		setGridSize(value);
	}

	bumpGraphRevision(): void {
		this.graphRevision += 1;
	}

	/** Add a node, committing history before the mutation. */
	addNode(node: FlowNode): void {
		canvasHistory.commitGraphChange();
		this.nodes = this.nodes.concat(node);
		this.bumpGraphRevision();
	}

	/** Remove a node by id along with any connected edges. */
	removeNode(nodeId: string): void {
		canvasHistory.commitGraphChange();
		this.nodes = this.nodes.filter((n) => n.id !== nodeId);
		this.edges = this.edges.filter(
			(e) => e.source !== nodeId && e.target !== nodeId,
		);
		if (this.selectedNodeId === nodeId) {
			this.selectedNodeId = null;
		}
		this.bumpGraphRevision();
	}

	/** Remove multiple nodes atomically (single history entry). */
	removeNodes(nodeIds: readonly string[]): void {
		if (nodeIds.length === 0) return;
		canvasHistory.commitGraphChange();
		const idSet = new Set(nodeIds);
		this.nodes = this.nodes.filter((n) => !idSet.has(n.id));
		this.edges = this.edges.filter(
			(e) => !idSet.has(e.source) && !idSet.has(e.target),
		);
		if (this.selectedNodeId && idSet.has(this.selectedNodeId)) {
			this.selectedNodeId = null;
		}
		this.bumpGraphRevision();
	}

	/** Move a node to a new position, committing history before the mutation. */
	moveNode(nodeId: string, position: FlowPosition): void {
		canvasHistory.commitGraphChange();
		this.nodes = this.nodes.map((n) =>
			n.id === nodeId ? { ...n, position } : n,
		);
		this.bumpGraphRevision();
	}

	/** Add an edge, committing history before the mutation. */
	addEdge(edge: FlowEdge): void {
		canvasHistory.commitGraphChange();
		this.edges = this.edges.concat(edge);
		this.bumpGraphRevision();
	}

	/** Remove an edge by id. */
	removeEdge(edgeId: string): void {
		canvasHistory.commitGraphChange();
		this.edges = this.edges.filter((e) => e.id !== edgeId);
		this.bumpGraphRevision();
	}

	/**
	 * Shallow-merge a partial patch into the `data` payload of a single node,
	 * committing history before the mutation. Used by the context menu to
	 * toggle node status (Disable / Enable) without going around the store.
	 */
	updateNodeData(nodeId: string, patch: Record<string, unknown>): void {
		const index = this.nodes.findIndex((n) => n.id === nodeId);
		if (index === -1) return;
		canvasHistory.commitGraphChange();
		this.nodes = this.nodes.map((n) =>
			n.id === nodeId
				? { ...n, data: { ...n.data, ...patch } as FlowNode["data"] }
				: n,
		);
		this.bumpGraphRevision();
	}

	/**
	 * Duplicate a node, placing the clone at a diagonal offset from the
	 * original. Commits a single history entry and returns the cloned node
	 * id (or `null` if the source node does not exist).
	 */
	duplicateNode(
		nodeId: string,
		offset: FlowPosition = { x: 40, y: 40 },
	): string | null {
		const source = this.nodes.find((n) => n.id === nodeId);
		if (!source) return null;
		canvasHistory.commitGraphChange();
		const cloneId = `${source.id}-copy-${Date.now().toString(36)}`;
		const clone: FlowNode = {
			...source,
			id: cloneId,
			position: {
				x: source.position.x + offset.x,
				y: source.position.y + offset.y,
			},
			selected: false,
		};
		this.nodes = this.nodes.concat(clone);
		this.bumpGraphRevision();
		return cloneId;
	}

	/**
	 * Re-run dagre auto-layout over the full graph and atomically replace
	 * node positions. A single history commit is pushed so Undo reverts the
	 * entire layout in one step. No-op when the graph is empty.
	 */
	tidyLayout(options?: AutoLayoutOptions): void {
		if (this.nodes.length === 0) return;
		const next = applyAutoLayout(this.nodes, this.edges, options);
		// Skip history + reassignment if positions didn't move at all.
		let changed = false;
		for (let i = 0; i < next.length; i++) {
			const before = this.nodes[i];
			const after = next[i];
			if (
				!before ||
				before.position.x !== after.position.x ||
				before.position.y !== after.position.y
			) {
				changed = true;
				break;
			}
		}
		if (!changed) return;
		canvasHistory.commitGraphChange();
		this.nodes = next;
		this.bumpGraphRevision();
	}
}

export const canvasState = new CanvasStore();
