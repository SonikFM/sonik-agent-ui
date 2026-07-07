import { Graph, layout } from "@dagrejs/dagre";

import type {
	FlowEdge,
	FlowNode,
	FlowPosition,
} from "@/design-system/patterns/CampaignFlow/types/flow";

/**
 * Default per-node bounding box used by dagre for collision avoidance.
 * These values match the approximate rendered size of the Sunset-themed
 * node components (ChannelNode, LogicNode, EventNode, AIActionNode) so
 * dagre's spacing is visually balanced.
 */
export const DEFAULT_NODE_WIDTH = 260;
export const DEFAULT_NODE_HEIGHT = 140;

/**
 * Per-kind overrides. Keep this list tight — dagre uses the width/height
 * purely for collision boxes, so values should approximate the rendered
 * component footprint, not be pixel-perfect.
 */
const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
	channel: { width: 280, height: 160 },
	logic: { width: 240, height: 120 },
	event: { width: 240, height: 120 },
	"ai-action": { width: 260, height: 140 },
};

export interface AutoLayoutOptions {
	/** Layout direction. "LR" = left-to-right timeline, "TB" = top-to-bottom. */
	direction?: "LR" | "RL" | "TB" | "BT";
	/** Horizontal spacing between ranks (in the rank direction). */
	rankSeparation?: number;
	/** Spacing between nodes within the same rank. */
	nodeSeparation?: number;
	/** Edge separation used to route parallel edges. */
	edgeSeparation?: number;
	/** Dagre ranker algorithm. "network-simplex" gives the cleanest timelines. */
	ranker?: "network-simplex" | "tight-tree" | "longest-path";
}

const DEFAULT_OPTIONS: Required<AutoLayoutOptions> = {
	direction: "LR",
	rankSeparation: 140,
	nodeSeparation: 80,
	edgeSeparation: 40,
	ranker: "network-simplex",
};

function getNodeDimensions(node: FlowNode): {
	width: number;
	height: number;
} {
	const kind = (node.data as { kind?: string } | undefined)?.kind;
	if (kind && NODE_DIMENSIONS[kind]) {
		return NODE_DIMENSIONS[kind];
	}
	return { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
}

/**
 * Framework-neutral adjacency lookup. Returns nodes directly downstream of
 * `node` based on the edge array — replaces `getOutgoers` from
 * framework-specific xyflow packages so this module stays framework-neutral.
 */
export function getOutgoingNeighbors(
	node: Pick<FlowNode, "id">,
	nodes: readonly FlowNode[],
	edges: readonly FlowEdge[],
): FlowNode[] {
	const targetIds = new Set<string>();
	for (const edge of edges) {
		if (edge.source === node.id) {
			targetIds.add(edge.target);
		}
	}
	if (targetIds.size === 0) return [];
	return nodes.filter((n) => targetIds.has(n.id));
}

/**
 * Compute updated positions for every node using dagre's hierarchical
 * layout algorithm. Works across all 4 node kinds (channel, logic, event,
 * ai-action) and any additional kinds the registry might add later.
 *
 * Framework-neutral: operates on `FlowNode[]` / `FlowEdge[]` DTOs and
 * returns fresh node objects with updated `position` fields. The returned
 * nodes are compatible with both `@xyflow/svelte` and any future xyflow surface.
 *
 * Dagre reports the *center* of each node; React Flow / XYFlow expect the
 * top-left corner, so we convert center → top-left using the same
 * width/height we fed in.
 *
 * Node order in the output matches the input order, so React/Svelte keyed
 * reconciliation stays stable.
 */
export function applyAutoLayout(
	nodes: readonly FlowNode[],
	edges: readonly FlowEdge[],
	options: AutoLayoutOptions = {},
): FlowNode[] {
	if (nodes.length === 0) return [];

	const opts: Required<AutoLayoutOptions> = {
		...DEFAULT_OPTIONS,
		...options,
	};

	const graph = new Graph({ multigraph: false, compound: false });
	graph.setDefaultEdgeLabel(() => ({}));
	graph.setGraph({
		rankdir: opts.direction,
		ranksep: opts.rankSeparation,
		nodesep: opts.nodeSeparation,
		edgesep: opts.edgeSeparation,
		ranker: opts.ranker,
		marginx: 40,
		marginy: 40,
	});

	const dimensionsById = new Map<string, { width: number; height: number }>();
	for (const node of nodes) {
		const dims = getNodeDimensions(node);
		dimensionsById.set(node.id, dims);
		graph.setNode(node.id, { width: dims.width, height: dims.height });
	}

	const nodeIds = new Set(nodes.map((n) => n.id));
	for (const edge of edges) {
		// Skip dangling edges — dagre would otherwise implicitly create
		// ghost nodes and corrupt the layout.
		if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
		graph.setEdge(edge.source, edge.target);
	}

	layout(graph);

	return nodes.map((node) => {
		const laidOut = graph.node(node.id) as { x: number; y: number } | undefined;
		if (!laidOut || typeof laidOut.x !== "number") {
			// Safety fallback: if dagre couldn't position the node (shouldn't
			// happen after setNode above), preserve the existing position.
			return node;
		}
		const dims = dimensionsById.get(node.id) ?? {
			width: DEFAULT_NODE_WIDTH,
			height: DEFAULT_NODE_HEIGHT,
		};
		const position: FlowPosition = {
			x: Math.round(laidOut.x - dims.width / 2),
			y: Math.round(laidOut.y - dims.height / 2),
		};
		return { ...node, position };
	});
}

/**
 * Diff helper: given the pre- and post-layout node arrays, return only the
 * nodes whose position actually changed. Useful when pushing individual
 * `canvasState.moveNode(...)` calls so we don't thrash history with
 * no-ops.
 */
export function diffLayoutMoves(
	before: readonly FlowNode[],
	after: readonly FlowNode[],
): Array<{ id: string; position: FlowPosition }> {
	const beforeById = new Map(before.map((n) => [n.id, n]));
	const moves: Array<{ id: string; position: FlowPosition }> = [];
	for (const node of after) {
		const prev = beforeById.get(node.id);
		if (
			!prev ||
			prev.position.x !== node.position.x ||
			prev.position.y !== node.position.y
		) {
			moves.push({ id: node.id, position: node.position });
		}
	}
	return moves;
}
