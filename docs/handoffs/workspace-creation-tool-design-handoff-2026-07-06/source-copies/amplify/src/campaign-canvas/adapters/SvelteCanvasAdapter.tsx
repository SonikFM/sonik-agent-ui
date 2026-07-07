import { useEffect, useRef } from "react";
import { mount, unmount } from "svelte";
import type {
	FlowEdge,
	FlowNode,
	FlowPaletteDropItem,
	FlowPosition,
	FlowViewport,
	SvelteCanvasProps,
} from "@/design-system/patterns/CampaignFlow/types/flow";
import CampaignCanvas from "../CampaignCanvas.svelte";
import { canvasState } from "../stores/canvas-store.svelte";

const DEBUG_CAMPAIGN_CANVAS =
	import.meta.env.DEV && import.meta.env.VITE_CAMPAIGN_WIZARD_DEBUG === "true";

export function SvelteCanvasAdapter({
	nodes,
	edges,
	viewport,
	selectedNodeId,
	onNodeSelect,
	onFlowChange,
	onViewportChange,
	onStatusChange,
	onContextAddNode,
	onContextPaste,
	onCopySelection,
	onPaletteItemDrop,
	onFitView,
	fitViewRequestId,
	className,
}: SvelteCanvasProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const componentRef = useRef<ReturnType<typeof mount> | null>(null);
	// Hold the latest callbacks in refs so the Svelte component — which is only
	// mounted once — always sees the current functions without a remount.
	const onNodeSelectRef = useRef(onNodeSelect);
	const onFlowChangeRef = useRef(onFlowChange);
	const onViewportChangeRef = useRef(onViewportChange);
	const onStatusChangeRef = useRef(onStatusChange);
	const onContextAddNodeRef = useRef(onContextAddNode);
	const onContextPasteRef = useRef(onContextPaste);
	const onCopySelectionRef = useRef(onCopySelection);
	const onPaletteItemDropRef = useRef(onPaletteItemDrop);
	const onFitViewRef = useRef(onFitView);

	useEffect(() => {
		onNodeSelectRef.current = onNodeSelect;
	}, [onNodeSelect]);

	useEffect(() => {
		onFlowChangeRef.current = onFlowChange;
	}, [onFlowChange]);

	useEffect(() => {
		onViewportChangeRef.current = onViewportChange;
	}, [onViewportChange]);

	useEffect(() => {
		onStatusChangeRef.current = onStatusChange;
	}, [onStatusChange]);

	useEffect(() => {
		onContextAddNodeRef.current = onContextAddNode;
	}, [onContextAddNode]);

	useEffect(() => {
		onContextPasteRef.current = onContextPaste;
	}, [onContextPaste]);

	useEffect(() => {
		onCopySelectionRef.current = onCopySelection;
	}, [onCopySelection]);

	useEffect(() => {
		onPaletteItemDropRef.current = onPaletteItemDrop;
	}, [onPaletteItemDrop]);

	useEffect(() => {
		onFitViewRef.current = onFitView;
	}, [onFitView]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: mount/unmount lifecycle runs once
	useEffect(() => {
		if (!containerRef.current) return;

		canvasState.nodes = nodes;
		canvasState.edges = edges;
		canvasState.viewport = viewport;
		canvasState.selectedNodeId = selectedNodeId;

		const component = mount(CampaignCanvas, {
			target: containerRef.current,
			props: {
				onNodeSelect: (nodeId: string | null) => {
					onNodeSelectRef.current?.(nodeId);
				},
				onFlowChange: (nextNodes: FlowNode[], nextEdges: FlowEdge[]) => {
					onFlowChangeRef.current?.(nextNodes, nextEdges);
				},
				onViewportChange: (nextViewport: FlowViewport) => {
					onViewportChangeRef.current?.(nextViewport);
				},
				onStatusChange: (status: {
					canUndo: boolean;
					canRedo: boolean;
					isDirty: boolean;
				}) => {
					onStatusChangeRef.current?.(status);
				},
				onContextAddNode: (position: FlowPosition) => {
					onContextAddNodeRef.current?.(position);
				},
				onContextPaste: (position?: FlowPosition) => {
					onContextPasteRef.current?.(position);
				},
				onCopySelection: () => {
					onCopySelectionRef.current?.();
				},
				onPaletteItemDrop: (
					item: FlowPaletteDropItem,
					position: FlowPosition,
				) => {
					onPaletteItemDropRef.current?.(item, position);
				},
				onFitView: () => {
					onFitViewRef.current?.();
				},
				className,
			},
		});
		componentRef.current = component;

		return () => {
			if (componentRef.current) {
				unmount(componentRef.current);
				componentRef.current = null;
			}
		};
	}, []);

	const _nodesSyncCount = useRef(0);
	useEffect(() => {
		// Normalize selection: SvelteFlow treats `node.selected: true` as part
		// of its multi-selection set, so any stale `selected` flag left over
		// from paste/duplicate/undo causes unrelated nodes to drag together.
		// Enforce single-select by matching the page-owned selectedNodeId.
		const next = nodes.map((node) => {
			const shouldBeSelected = node.id === selectedNodeId;
			return (node.selected ?? false) === shouldBeSelected
				? node
				: { ...node, selected: shouldBeSelected };
		});
		// Skip reassignment when nothing actually changed — same length and
		// same per-node references mean no consumer needs to re-evaluate.
		const prev = canvasState.nodes;
		const unchanged =
			next.length === prev.length && next.every((n, i) => n === prev[i]);
		_nodesSyncCount.current += 1;
		if (
			DEBUG_CAMPAIGN_CANVAS &&
			(_nodesSyncCount.current <= 5 || _nodesSyncCount.current % 25 === 0)
		) {
			console.debug(
				`[wizard:adapter-nodes-sync] fire #${_nodesSyncCount.current} — len=${next.length} selected=${selectedNodeId} unchanged=${unchanged}`,
			);
		}
		if (unchanged) return;
		canvasState.nodes = next;
	}, [nodes, selectedNodeId]);

	const _edgesSyncCount = useRef(0);
	useEffect(() => {
		_edgesSyncCount.current += 1;
		if (
			DEBUG_CAMPAIGN_CANVAS &&
			(_edgesSyncCount.current <= 5 || _edgesSyncCount.current % 25 === 0)
		) {
			console.debug(
				`[wizard:adapter-edges-sync] fire #${_edgesSyncCount.current} — len=${edges.length}`,
			);
		}
		if (edges === canvasState.edges) return;
		canvasState.edges = edges;
	}, [edges]);

	const _viewportSyncCount = useRef(0);
	useEffect(() => {
		_viewportSyncCount.current += 1;
		if (
			DEBUG_CAMPAIGN_CANVAS &&
			(_viewportSyncCount.current <= 5 || _viewportSyncCount.current % 25 === 0)
		) {
			console.debug(
				`[wizard:adapter-viewport-sync] fire #${_viewportSyncCount.current} — vp=${JSON.stringify(viewport)}`,
			);
		}
		const cur = canvasState.viewport;
		if (
			cur &&
			cur.x === viewport.x &&
			cur.y === viewport.y &&
			cur.zoom === viewport.zoom
		) {
			return;
		}
		canvasState.viewport = viewport;
	}, [viewport]);

	useEffect(() => {
		canvasState.fitViewRequestId = fitViewRequestId ?? 0;
	}, [fitViewRequestId]);

	useEffect(() => {
		canvasState.selectedNodeId = selectedNodeId;
	}, [selectedNodeId]);

	return (
		<div
			ref={containerRef}
			className={`relative h-full w-full ${className ?? ""}`}
		/>
	);
}
