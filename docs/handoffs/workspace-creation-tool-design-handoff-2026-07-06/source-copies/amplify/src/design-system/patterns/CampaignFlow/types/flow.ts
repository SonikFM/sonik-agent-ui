import type { FlowEdgeDataUnion } from "./edges";
import type { FlowNodeData } from "./nodes";

/** View layers for the campaign flow canvas */
export const Layer = {
	NODE_LOCK: "node-lock",
	FULL_BOARD: "full-board",
} as const;

export type Layer = (typeof Layer)[keyof typeof Layer];

/** Framework-agnostic viewport position */
export interface FlowViewport {
	x: number;
	y: number;
	zoom: number;
}

/** Framework-agnostic position */
export interface FlowPosition {
	x: number;
	y: number;
}

/** Serialized node-palette payload used for drag/drop and context insertion. */
export interface FlowPaletteDropItem {
	category: string;
	kindId: string;
	label: string;
	description?: string;
}

/** Framework-agnostic fit-view options */
export interface FlowFitViewOptions {
	padding?: number;
	duration?: number;
	nodes?: Array<{ id: string }>;
}

/** State machine for layer transitions */
export interface LayerState {
	activeLayer: Layer;
	focusedNodeId: string | null;
	viewport: FlowViewport;
	previousViewport: FlowViewport | null;
}

/** Configuration constants for the flow canvas */
export interface FlowConfig {
	fitViewOptions: FlowFitViewOptions;
	minZoom: number;
	maxZoom: number;
	nodeLockPadding: number;
	fullBoardPadding: number;
	transitionDuration: number;
}

/** Default config values. Blue text = assumption cells in the spreadsheet model. */
export const DEFAULT_FLOW_CONFIG: FlowConfig = {
	fitViewOptions: { padding: 0.28, duration: 220 },
	minZoom: 0.3,
	maxZoom: 1.5,
	nodeLockPadding: 0.15,
	fullBoardPadding: 0.28,
	transitionDuration: 300,
};

/** Framework-agnostic node shape */
export interface FlowNode {
	id: string;
	type?: string;
	position: FlowPosition;
	data: FlowNodeData;
	selected?: boolean;
	draggable?: boolean;
	connectable?: boolean;
	parentId?: string;
	style?: Record<string, string | number>;
	className?: string;
	[key: string]: unknown;
}

/** Framework-agnostic edge shape */
export interface FlowEdge {
	id: string;
	source: string;
	target: string;
	sourceHandle?: string;
	targetHandle?: string;
	type?: string;
	animated?: boolean;
	label?: string;
	data?: FlowEdgeDataUnion;
	style?: Record<string, string | number>;
	[key: string]: unknown;
}

/** Portable workflow export format (n8n-style) */
export interface SerializedWorkflow {
	version: string;
	campaignId: string;
	createdAt: string;
	updatedAt: string;
	flow: {
		nodes: FlowNode[];
		edges: FlowEdge[];
		viewport: FlowViewport;
	};
}

/**
 * Reactive status surface published by the Svelte canvas to the React page.
 *
 * These are derived from `canvasHistory` inside the Svelte layer and mirrored
 * out via an `onStatusChange` callback so the React page can drive save
 * indicators, enable/disable undo buttons, and gate navigation — without
 * reaching across the bridge into Svelte runes.
 */
export interface CanvasStatus {
	canUndo: boolean;
	canRedo: boolean;
	isDirty: boolean;
}

/** Props for the Svelte canvas adapter (controlled, matches page contract) */
export interface SvelteCanvasProps {
	nodes: FlowNode[];
	edges: FlowEdge[];
	viewport: FlowViewport;
	selectedNodeId: string | null;
	onNodeSelect: (nodeId: string | null) => void;
	onFlowChange: (nodes: FlowNode[], edges: FlowEdge[]) => void;
	onViewportChange?: (viewport: FlowViewport) => void;
	onStatusChange?: (status: CanvasStatus) => void;
	onContextAddNode?: (position: FlowPosition) => void;
	onContextPaste?: (position?: FlowPosition) => void;
	onCopySelection?: () => void;
	onPaletteItemDrop?: (
		item: FlowPaletteDropItem,
		position: FlowPosition,
	) => void;
	onFitView?: () => void;
	fitViewRequestId?: number;
	className?: string;
}
