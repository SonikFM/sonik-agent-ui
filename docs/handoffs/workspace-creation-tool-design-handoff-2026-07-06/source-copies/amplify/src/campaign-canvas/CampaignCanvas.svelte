<script lang="ts">
import {
	Background,
	BackgroundVariant,
	type Connection,
	Controls,
	MiniMap,
	type Node,
	Panel,
	SvelteFlow,
	SvelteFlowProvider,
} from "@xyflow/svelte";
import { untrack } from "svelte";
import type { Attachment } from "svelte/attachments";
import type {
	FlowEdge,
	FlowNode,
	FlowPaletteDropItem,
	FlowPosition,
	FlowViewport,
} from "@/design-system/patterns/CampaignFlow/types/flow";
import "@/design-system/patterns/CampaignFlow/theme/flow-tokens.css";
import { DEFAULT_FLOW_CONFIG } from "@/design-system/patterns/CampaignFlow/types/flow";
import FlowContextMenu, {
	type FlowContextMenuTarget,
} from "./components/FlowContextMenu.svelte";
import FlowViewportBridge from "./components/FlowViewportBridge.svelte";
import AIActionEdge from "./edges/AIActionEdge.svelte";
import ConditionalBranchEdge from "./edges/ConditionalBranchEdge.svelte";
import EventTriggerEdge from "./edges/EventTriggerEdge.svelte";
import FlowEdgeSvelte from "./edges/FlowEdge.svelte";
import LogicHookEdge from "./edges/LogicHookEdge.svelte";
import { pixiOverlay } from "./edges/pixi-layer";
import {
	collectSelectedNodeIds,
	isEditableEventTarget,
	matchCanvasShortcut,
} from "./lib/canvas-keyboard";
import {
	buildEdgeFromConnection,
	hasMatchingEdge,
	isConnectionAllowed,
} from "./lib/connection-utils";
import { snapPosition } from "./lib/grid-snap";
import { haptic } from "./lib/haptics";
import AIActionNode from "./nodes/AIActionNode.svelte";
import ChannelNode from "./nodes/ChannelNode.svelte";
import EventNode from "./nodes/EventNode.svelte";
import LogicNode from "./nodes/LogicNode.svelte";
import { canvasHistory } from "./stores/canvas-history.svelte";
import { canvasState } from "./stores/canvas-store.svelte";

import "@xyflow/svelte/dist/style.css";

interface CanvasStatus {
	canUndo: boolean;
	canRedo: boolean;
	isDirty: boolean;
}

interface Props {
	onNodeSelect?: (nodeId: string | null) => void;
	onFlowChange?: (nodes: FlowNode[], edges: FlowEdge[]) => void;
	onViewportChange?: (viewport: FlowViewport) => void;
	onStatusChange?: (status: CanvasStatus) => void;
	/**
	 * Host-owned handler invoked from the right-click context menu when the
	 * user chooses Add Node over empty canvas. The host (React shell) is
	 * expected to open its NodePalette flow anchored at `position`.
	 */
	onContextAddNode?: (position: FlowPosition) => void;
	/** Host-owned paste handler; receives the right-click flow position. */
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

const {
	onNodeSelect,
	onFlowChange,
	onViewportChange,
	onStatusChange,
	onContextAddNode,
	onContextPaste,
	onCopySelection,
	onPaletteItemDrop,
	onFitView,
	className,
}: Props = $props();

const nodeTypes = {
	channel: ChannelNode,
	logic: LogicNode,
	event: EventNode,
	"ai-action": AIActionNode,
};

const edgeTypes = {
	flow: FlowEdgeSvelte,
	"logic-hook": LogicHookEdge,
	"event-trigger": EventTriggerEdge,
	"ai-action": AIActionEdge,
	"conditional-branch": ConditionalBranchEdge,
};

const DEBUG_CAMPAIGN_CANVAS =
	import.meta.env.DEV && import.meta.env.VITE_CAMPAIGN_WIZARD_DEBUG === "true";

/**
 * Map a flow node to the oklch token-backed color used in the MiniMap.
 * Delegates to CSS variables defined in flow-tokens.css so theme overrides
 * (Sunset / DaisyUI) automatically re-skin the minimap.
 */
function minimapNodeColor(node: Node): string {
	switch (node.type) {
		case "channel":
			return "var(--flow-accent-channel)";
		case "logic":
			return "var(--flow-accent-logic)";
		case "event":
			return "var(--flow-accent-event)";
		case "ai-action":
			return "var(--flow-accent-ai)";
		default:
			return "var(--flow-accent-conditional)";
	}
}

const isNodeLock = $derived(canvasState.activeLayer === "node-lock");

/**
 * Pixi overlay attachment for decorative edge effects.
 * Attaches a PixiJS canvas layer behind the SVG edges
 * for glow and animated pulse effects.
 */
const pixiAttach = pixiOverlay();

let _pixiTickCount = 0;
$effect(() => {
	pixiAttach.updateEdges(canvasState.edges);
	if (DEBUG_CAMPAIGN_CANVAS && ++_pixiTickCount % 50 === 0) {
		console.debug(
			`[wizard:pixi-effect] fired ${_pixiTickCount}x — edges=${canvasState.edges.length}`,
		);
	}
});

let _bridgeTickCount = 0;
$effect(() => {
	// graphRevision is the *only* tracked dependency: it bumps on user-driven
	// graph mutations (drag stop, paste, multi-delete) but does NOT bump when
	// React syncs `canvasState.nodes` back through SvelteCanvasAdapter. Reading
	// nodes/edges directly here would subscribe to them and create a
	// React→Svelte→React feedback loop (every adapter effect reassigns
	// `canvasState.nodes` to a new array reference, retriggering this effect,
	// which re-pushes the same array into React, repeat). `untrack` reads the
	// current values without registering them as deps.
	const rev = canvasState.graphRevision;
	// Skip while the user is mid-drag — otherwise every pointermove frame
	// re-enters React, which re-pushes nodes back through canvasState and
	// causes a per-frame ping-pong. `handleNodeDragStop` re-bumps
	// graphRevision when the drag ends, so final state still reaches React.
	if (untrack(() => canvasState.isDragging)) return;
	_bridgeTickCount += 1;
	if (
		DEBUG_CAMPAIGN_CANVAS &&
		(_bridgeTickCount <= 5 || _bridgeTickCount % 25 === 0)
	) {
		console.debug(
			`[wizard:bridge-effect] fire #${_bridgeTickCount} — graphRevision=${rev}`,
		);
	}
	onFlowChange?.(
		untrack(() => canvasState.nodes),
		untrack(() => canvasState.edges),
	);
});

function handleNodeClick({
	node,
}: {
	node: Node;
	event: MouseEvent | TouchEvent;
}) {
	canvasState.selectedNodeId = node.id;
	onNodeSelect?.(node.id);
	haptic("select");
}

function handlePaneClick(_args: { event: MouseEvent }) {
	canvasState.selectedNodeId = null;
	onNodeSelect?.(null);
}

function handleNodeDragStop({
	targetNode,
}: {
	targetNode: Node | null;
	nodes: Node[];
	event: MouseEvent | TouchEvent;
}) {
	if (!targetNode) {
		canvasState.isDragging = false;
		return;
	}
	// Snapshot BEFORE applying the snap so undo returns to the pre-drag position.
	// canvasState.nodes still holds the pre-drag positions because @xyflow/svelte
	// manages drag state internally and only surfaces the final position via the
	// onnodedragstop callback.
	canvasHistory.commitGraphChange();
	const snapped = snapPosition(targetNode.position.x, targetNode.position.y);
	canvasState.nodes = canvasState.nodes.map((n) =>
		n.id === targetNode.id ? { ...n, position: snapped } : n,
	);
	canvasState.bumpGraphRevision();
	canvasState.isDragging = false;
	haptic("snap");
}

function handleNodeDragStart(_args: {
	targetNode: Node | null;
	nodes: Node[];
	event: MouseEvent | TouchEvent;
}) {
	canvasState.isDragging = true;
}

function handleMove({
	viewport,
}: {
	viewport: { x: number; y: number; zoom: number };
}) {
	const nextViewport = {
		x: viewport.x,
		y: viewport.y,
		zoom: viewport.zoom,
	};
	canvasState.viewport = nextViewport;
	onViewportChange?.(nextViewport);
}

/**
 * Reactive bridge from `canvasHistory` (Svelte runes) to the React page layer.
 *
 * Fires whenever any of canUndo/canRedo/isDirty change. The host React page
 * uses this to drive save-status indicators and enable/disable undo buttons
 * without reaching into the Svelte store directly.
 */
let _statusTickCount = 0;
$effect(() => {
	const status = {
		canUndo: canvasHistory.canUndo,
		canRedo: canvasHistory.canRedo,
		isDirty: canvasHistory.isDirty,
	};
	_statusTickCount += 1;
	if (
		DEBUG_CAMPAIGN_CANVAS &&
		(_statusTickCount <= 5 || _statusTickCount % 25 === 0)
	) {
		console.debug(
			`[wizard:status-effect] fire #${_statusTickCount} — ${JSON.stringify(status)}`,
		);
	}
	onStatusChange?.(status);
});

function deleteSelectedNodes(): boolean {
	const selectedIds = collectSelectedNodeIds(canvasState);
	if (selectedIds.length === 0) return false;

	// Delegate the history snapshot + cascade-delete + selection clear to the
	// store so multi-select deletes land as a single undoable step.
	canvasState.removeNodes(selectedIds);
	if (canvasState.selectedNodeId === null) {
		onNodeSelect?.(null);
	}
	haptic("snap");
	return true;
}

function selectAllNodes(): boolean {
	if (canvasState.nodes.length === 0) return false;
	canvasState.nodes = canvasState.nodes.map((node) =>
		node.selected ? node : { ...node, selected: true },
	);
	return true;
}

/*
 * -----------------------------------------------------------------------
 * Right-click context menu state
 * -----------------------------------------------------------------------
 * Three state slots drive <FlowContextMenu>:
 *   - `contextMenuOpen`: visibility
 *   - `contextMenuTarget`: node / edge / canvas discriminator
 *   - `contextMenuScreen`: viewport-relative render position
 *
 * Flow coordinates are derived from the Svelte Flow canvas bounding box
 * plus current viewport transform so that the host `Add Node` / `Paste`
 * callbacks can insert content at the right-click origin without needing
 * a `useSvelteFlow()` hook (which would have to live inside the
 * `<SvelteFlowProvider>` subtree).
 */
let contextMenuOpen = $state(false);
let contextMenuTarget = $state<FlowContextMenuTarget | null>(null);
let contextMenuScreen = $state({ x: 0, y: 0 });
let contextMenuFlow = $state<FlowPosition>({ x: 0, y: 0 });
let canvasContainer: HTMLElement | null = $state(null);

/**
 * Convert a viewport-relative pixel position to flow coordinates using the
 * canvas container bounds and the current viewport transform stored on
 * `canvasState.viewport`. This mirrors xyflow's internal
 * `screenToFlowPosition` math without requiring provider context.
 */
function screenToFlowPosition(clientX: number, clientY: number): FlowPosition {
	if (!canvasContainer) return { x: clientX, y: clientY };
	const rect = canvasContainer.getBoundingClientRect();
	const localX = clientX - rect.left;
	const localY = clientY - rect.top;
	const { x: tx, y: ty, zoom } = canvasState.viewport;
	const safeZoom = zoom === 0 ? 1 : zoom;
	return {
		x: (localX - tx) / safeZoom,
		y: (localY - ty) / safeZoom,
	};
}

function openContextMenu(target: FlowContextMenuTarget, event: MouseEvent) {
	event.preventDefault();
	contextMenuTarget = target;
	contextMenuScreen = { x: event.clientX, y: event.clientY };
	contextMenuFlow = screenToFlowPosition(event.clientX, event.clientY);
	contextMenuOpen = true;
}

function closeContextMenu() {
	contextMenuOpen = false;
	contextMenuTarget = null;
}

function handleNodeContextMenu({
	node,
	event,
}: {
	node: Node;
	event: MouseEvent;
}) {
	openContextMenu({ kind: "node", nodeId: node.id }, event);
}

function handleEdgeContextMenu({
	edge,
	event,
}: {
	edge: { id: string };
	event: MouseEvent;
}) {
	openContextMenu({ kind: "edge", edgeId: edge.id }, event);
}

function handlePaneContextMenu({ event }: { event: MouseEvent | TouchEvent }) {
	if (!(event instanceof MouseEvent)) return;
	openContextMenu({ kind: "canvas" }, event);
}

/**
 * Global keyboard shortcut handler. The shortcut table is owned by
 * `matchCanvasShortcut` in ./lib/canvas-keyboard so it can be unit-tested
 * in isolation; this handler only wires actions to the live stores and
 * applies the two runtime guards (mid-drag, editable target).
 */
function handleKeydown(event: KeyboardEvent) {
	if (canvasState.isDragging) return;
	if (isEditableEventTarget(event)) return;

	const action = matchCanvasShortcut(event);
	if (action === "none") return;

	switch (action) {
		case "undo":
			event.preventDefault();
			canvasHistory.undo();
			onFlowChange?.(canvasState.nodes, canvasState.edges);
			return;
		case "redo":
			event.preventDefault();
			canvasHistory.redo();
			onFlowChange?.(canvasState.nodes, canvasState.edges);
			return;
		case "selectAll":
			if (selectAllNodes()) {
				event.preventDefault();
			}
			return;
		case "copy":
			event.preventDefault();
			onCopySelection?.();
			return;
		case "paste":
			event.preventDefault();
			onContextPaste?.();
			return;
		case "fitView":
			event.preventDefault();
			onFitView?.();
			return;
		case "delete":
			if (deleteSelectedNodes()) {
				event.preventDefault();
			}
			return;
	}
}

function parsePaletteDropPayload(event: DragEvent): FlowPaletteDropItem | null {
	const raw = event.dataTransfer?.getData("application/x-campaign-node");
	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as FlowPaletteDropItem;
		if (
			typeof parsed.category !== "string" ||
			typeof parsed.kindId !== "string" ||
			typeof parsed.label !== "string"
		) {
			return null;
		}
		return {
			category: parsed.category,
			kindId: parsed.kindId,
			label: parsed.label,
			description:
				typeof parsed.description === "string" ? parsed.description : undefined,
		};
	} catch {
		return null;
	}
}

function handleDragOver(event: DragEvent) {
	// Always allow drop. Chrome only exposes dataTransfer.types reliably during
	// `drop`, not `dragover` (the values are always redacted, but the type list
	// can also be hidden in some flows). Gating preventDefault on a type check
	// here means drops never get a chance to fire. The actual gating happens
	// in `handleDrop` via `parsePaletteDropPayload`, which returns null for
	// any non-palette drag and makes the drop a no-op.
	event.preventDefault();
	// stopPropagation prevents xyflow's pane/node handlers from re-deciding the
	// dropEffect on the same frame, which can flip the cursor to "no-drop" and
	// silently reject the eventual drop.
	event.stopPropagation();
	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = "copy";
	}
}

function handleDrop(event: DragEvent) {
	const item = parsePaletteDropPayload(event);
	if (!item) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();
	onPaletteItemDrop?.(item, screenToFlowPosition(event.clientX, event.clientY));
}

function handleConnect(connection: Connection) {
	if (hasMatchingEdge(connection, canvasState.edges)) {
		return;
	}

	const edge = buildEdgeFromConnection(connection, canvasState.nodes);
	if (!edge) {
		return;
	}

	canvasState.addEdge(edge);
	haptic("snap");
}
</script>

<svelte:window onkeydown={handleKeydown} />

<div
	class={["h-full w-full relative", className]}
	bind:this={canvasContainer}
	role="presentation"
	ondragenter={handleDragOver}
	ondragover={handleDragOver}
	ondrop={handleDrop}
>
	<SvelteFlowProvider>
		<div class="pointer-events-none absolute inset-0" {@attach pixiAttach}></div>
		<SvelteFlow
			nodes={canvasState.nodes}
			edges={canvasState.edges}
			viewport={canvasState.viewport}
			{nodeTypes}
			{edgeTypes}
			fitView={false}
			fitViewOptions={DEFAULT_FLOW_CONFIG.fitViewOptions}
			minZoom={DEFAULT_FLOW_CONFIG.minZoom}
			maxZoom={DEFAULT_FLOW_CONFIG.maxZoom}
			snapToGrid={canvasState.gridSize > 1}
			snapGrid={[canvasState.gridSize, canvasState.gridSize]}
			onmove={handleMove}
			onmoveend={handleMove}
			isValidConnection={(connection) =>
				isConnectionAllowed(connection, canvasState.nodes)
			}
			onconnect={handleConnect}
			onnodeclick={handleNodeClick}
			onpaneclick={handlePaneClick}
			onnodedragstart={handleNodeDragStart}
			onnodedragstop={handleNodeDragStop}
			onnodecontextmenu={handleNodeContextMenu}
			onedgecontextmenu={handleEdgeContextMenu}
			onpanecontextmenu={handlePaneContextMenu}
		>
			<FlowViewportBridge
				fitViewRequestId={canvasState.fitViewRequestId}
				onViewportSync={onViewportChange}
			/>
			{#if !isNodeLock}
				<Background variant={BackgroundVariant.Dots} gap={canvasState.gridSize} size={1} />
			{/if}
			<Controls
				position="bottom-left"
				class="flow-controls"
				showZoom
				showFitView
				showLock
				fitViewOptions={DEFAULT_FLOW_CONFIG.fitViewOptions}
			/>
			<Panel position="top-right" class="flow-canvas-hint">
				<span>{canvasState.nodes.length} nodes</span>
				<span class="flow-canvas-hint__dot"></span>
				<span>Connect steps that run in sequence</span>
			</Panel>
			{#if !isNodeLock && canvasState.nodes.length > 4}
				<MiniMap
					position="bottom-right"
					class="flow-minimap"
					ariaLabel="Campaign flow minimap"
					pannable
					zoomable
					nodeColor={minimapNodeColor}
					nodeStrokeColor="var(--flow-chip-bg)"
					nodeBorderRadius={4}
					nodeStrokeWidth={2}
					maskColor="oklch(var(--b1) / 0.55)"
					maskStrokeColor="var(--flow-selection-ring)"
					maskStrokeWidth={1}
					bgColor="var(--flow-canvas-bg)"
				/>
			{/if}
		</SvelteFlow>
	</SvelteFlowProvider>
	<FlowContextMenu
		open={contextMenuOpen}
		target={contextMenuTarget}
		screenPosition={contextMenuScreen}
		flowPosition={contextMenuFlow}
		onClose={closeContextMenu}
		onAddNode={onContextAddNode}
		onPaste={onContextPaste}
		onSelectAll={selectAllNodes}
	/>
</div>
