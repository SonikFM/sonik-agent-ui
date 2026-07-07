import { Application, BlurFilter, Container, Graphics } from "pixi.js";
import type { EdgeStatus } from "@/design-system/patterns/CampaignFlow/types/edges";
import type { FlowEdge } from "@/design-system/patterns/CampaignFlow/types/flow";
import { gsap } from "../lib/gsap-setup";

const EDGE_STATUS_COLORS: Record<EdgeStatus, number> = {
	idle: 0x8b8fa3,
	active: 0x36d399,
	error: 0xf87272,
	blocked: 0xfbbd23,
};

const GLOW_STRENGTH = 6;
const GLOW_ALPHA = 0.35;
const CORE_WIDTH = 2;
const GLOW_WIDTH = 8;

interface EdgeGraphic {
	container: Container;
	core: Graphics;
	glow: Graphics;
	tween: gsap.core.Tween | null;
}

export interface EdgeCoordinates {
	sourceX: number;
	sourceY: number;
	targetX: number;
	targetY: number;
}

function bezierControlPoints(
	sx: number,
	sy: number,
	tx: number,
	ty: number,
): [number, number, number, number] {
	const midX = (sx + tx) * 0.5;
	return [midX, sy, midX, ty];
}

function drawEdgePath(
	g: Graphics,
	sx: number,
	sy: number,
	tx: number,
	ty: number,
	width: number,
	color: number,
	alpha: number,
): Graphics {
	const [c1x, c1y, c2x, c2y] = bezierControlPoints(sx, sy, tx, ty);
	return g
		.clear()
		.moveTo(sx, sy)
		.bezierCurveTo(c1x, c1y, c2x, c2y, tx, ty)
		.stroke({ width, color, alpha, cap: "round" });
}

interface OverlayState {
	app: Application | null;
	edgeGraphics: Map<string, EdgeGraphic>;
	isInitialized: boolean;
	currentEdges: FlowEdge[];
	overlayHostElement: HTMLElement | null;
	measurementRootElement: HTMLElement | null;
	refreshFrame: number;
}

export interface PixiOverlayAttachment {
	(el: HTMLElement): (() => void) | undefined;
	updateEdges: (edges: FlowEdge[]) => void;
	isReady: () => boolean;
}

export function resolveMeasurementRoot(element: HTMLElement): HTMLElement {
	return element.parentElement ?? element;
}

function escapeAttributeValue(value: string): string {
	if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
		return CSS.escape(value);
	}

	return value.replace(/(["\\])/g, "\\$1");
}

function measureElementCenter(
	element: HTMLElement,
	rootRect: DOMRect,
): { x: number; y: number } {
	const rect = element.getBoundingClientRect();
	return {
		x: rect.left - rootRect.left + rect.width / 2,
		y: rect.top - rootRect.top + rect.height / 2,
	};
}

function measureNodeAnchor(
	nodeElement: HTMLElement,
	rootRect: DOMRect,
	type: "source" | "target",
): { x: number; y: number } {
	const rect = nodeElement.getBoundingClientRect();
	return {
		x: rect.left - rootRect.left + rect.width / 2,
		y: type === "source" ? rect.bottom - rootRect.top : rect.top - rootRect.top,
	};
}

function queryHandle(
	root: HTMLElement,
	nodeId: string,
	handleId: string | undefined,
	type: "source" | "target",
): HTMLElement | null {
	const escapedNodeId = escapeAttributeValue(nodeId);
	const escapedHandleId = handleId ? escapeAttributeValue(handleId) : null;
	const selector = escapedHandleId
		? `.svelte-flow__handle.${type}[data-nodeid="${escapedNodeId}"][data-handleid="${escapedHandleId}"]`
		: `.svelte-flow__handle.${type}[data-nodeid="${escapedNodeId}"]`;

	return root.querySelector<HTMLElement>(selector);
}

function queryNode(root: HTMLElement, nodeId: string): HTMLElement | null {
	const escapedNodeId = escapeAttributeValue(nodeId);
	return root.querySelector<HTMLElement>(
		`.svelte-flow__node[data-id="${escapedNodeId}"]`,
	);
}

export function measureEdgeCoordinates(
	root: HTMLElement,
	edge: FlowEdge,
	rootRect?: DOMRect,
): EdgeCoordinates | null {
	const measuredRootRect = rootRect ?? root.getBoundingClientRect();

	const sourceHandle = queryHandle(
		root,
		edge.source,
		edge.sourceHandle,
		"source",
	);
	const targetHandle = queryHandle(
		root,
		edge.target,
		edge.targetHandle,
		"target",
	);
	const sourceNode = sourceHandle ? null : queryNode(root, edge.source);
	const targetNode = targetHandle ? null : queryNode(root, edge.target);

	const sourcePoint = sourceHandle
		? measureElementCenter(sourceHandle, measuredRootRect)
		: sourceNode
			? measureNodeAnchor(sourceNode, measuredRootRect, "source")
			: null;
	const targetPoint = targetHandle
		? measureElementCenter(targetHandle, measuredRootRect)
		: targetNode
			? measureNodeAnchor(targetNode, measuredRootRect, "target")
			: null;

	if (!sourcePoint || !targetPoint) {
		return null;
	}

	return {
		sourceX: sourcePoint.x,
		sourceY: sourcePoint.y,
		targetX: targetPoint.x,
		targetY: targetPoint.y,
	};
}

async function initApp(canvas: HTMLCanvasElement): Promise<Application> {
	const pixiApp = new Application();
	await pixiApp.init({
		canvas,
		backgroundAlpha: 0,
		antialias: true,
		resolution: window.devicePixelRatio,
		autoDensity: true,
		resizeTo: canvas.parentElement ?? undefined,
	});
	return pixiApp;
}

function createEdgeGraphic(edge: FlowEdge, stage: Container): EdgeGraphic {
	const container = new Container();
	container.label = `edge-${edge.id}`;

	const glow = new Graphics();
	glow.filters = [new BlurFilter({ strength: GLOW_STRENGTH, quality: 3 })];

	const core = new Graphics();

	container.addChild(glow, core);
	stage.addChild(container);

	return { container, core, glow, tween: null };
}

function updateEdgeGraphic(
	eg: EdgeGraphic,
	edge: FlowEdge,
	coordinates: EdgeCoordinates | null,
): void {
	const status = (edge.data?.status as EdgeStatus) ?? "idle";
	const color = EDGE_STATUS_COLORS[status] ?? EDGE_STATUS_COLORS.idle;

	if (!coordinates) {
		eg.container.visible = false;
		return;
	}

	eg.container.visible = true;

	const { sourceX, sourceY, targetX, targetY } = coordinates;

	drawEdgePath(
		eg.glow,
		sourceX,
		sourceY,
		targetX,
		targetY,
		GLOW_WIDTH,
		color,
		GLOW_ALPHA,
	);
	drawEdgePath(
		eg.core,
		sourceX,
		sourceY,
		targetX,
		targetY,
		CORE_WIDTH,
		color,
		0.9,
	);

	if (status === "active" && !eg.tween) {
		eg.tween = gsap.to(eg.glow, {
			pixi: { alpha: 0.15 },
			duration: 1,
			repeat: -1,
			yoyo: true,
			ease: "sine.inOut",
		});
	} else if (status !== "active" && eg.tween) {
		eg.tween.kill();
		eg.tween = null;
		eg.glow.alpha = 1;
	}
}

function syncEdgeGraphics(state: OverlayState, rootElement: HTMLElement): void {
	if (!state.app || !state.isInitialized) return;

	const rootRect = rootElement.getBoundingClientRect();
	const currentIds = new Set(state.currentEdges.map((e) => e.id));

	for (const [id, eg] of state.edgeGraphics) {
		if (!currentIds.has(id)) {
			cleanupEdge(eg);
			state.edgeGraphics.delete(id);
		}
	}

	for (const edge of state.currentEdges) {
		let eg = state.edgeGraphics.get(edge.id);
		if (!eg) {
			eg = createEdgeGraphic(edge, state.app.stage);
			state.edgeGraphics.set(edge.id, eg);
		}

		updateEdgeGraphic(
			eg,
			edge,
			measureEdgeCoordinates(rootElement, edge, rootRect),
		);
	}

	state.app.renderer.render(state.app.stage);
}

function scheduleRefresh(state: OverlayState): void {
	if (!state.measurementRootElement || state.refreshFrame) return;

	state.refreshFrame = requestAnimationFrame(() => {
		state.refreshFrame = 0;
		if (state.measurementRootElement) {
			syncEdgeGraphics(state, state.measurementRootElement);
		}
	});
}

function cleanupEdge(eg: EdgeGraphic): void {
	eg.tween?.kill();
	eg.container.destroy({ children: true });
}

/**
 * PixiJS overlay attachment factory.
 * Creates a real PixiJS v8 Application on the element
 * for decorative edge effects (glow, animated pulses).
 * Re-runs when edges change.
 */
export function pixiOverlay(): PixiOverlayAttachment {
	let overlayState: OverlayState | null = null;

	const attachment: PixiOverlayAttachment = (el: HTMLElement) => {
		const state: OverlayState = {
			app: null,
			edgeGraphics: new Map(),
			isInitialized: false,
			currentEdges: [],
			overlayHostElement: el,
			measurementRootElement: null,
			refreshFrame: 0,
		};
		overlayState = state;
		const measurementRoot = resolveMeasurementRoot(el);
		state.measurementRootElement = measurementRoot;
		const canvas = document.createElement("canvas");
		canvas.className = "pointer-events-none absolute inset-0";
		canvas.style.zIndex = "0";
		el.appendChild(canvas);

		let destroyed = false;
		const mutationObserver = new MutationObserver(() => {
			scheduleRefresh(state);
		});
		const resizeObserver = new ResizeObserver(() => {
			scheduleRefresh(state);
		});

		async function setup() {
			if (destroyed) return;

			try {
				state.app = await initApp(canvas);
				state.isInitialized = true;
				mutationObserver.observe(measurementRoot, {
					subtree: true,
					childList: true,
					attributes: true,
					attributeFilter: ["style", "class"],
				});
				resizeObserver.observe(measurementRoot);
				window.addEventListener("resize", onWindowResize);
				scheduleRefresh(state);
			} catch {
				state.isInitialized = false;
			}
		}

		function onWindowResize() {
			scheduleRefresh(state);
		}

		void setup();

		return () => {
			destroyed = true;
			mutationObserver.disconnect();
			resizeObserver.disconnect();
			window.removeEventListener("resize", onWindowResize);
			if (state.refreshFrame) {
				cancelAnimationFrame(state.refreshFrame);
				state.refreshFrame = 0;
			}
			for (const eg of state.edgeGraphics.values()) {
				cleanupEdge(eg);
			}
			state.edgeGraphics.clear();

			if (state.app) {
				state.app.destroy(
					{ removeView: true },
					{ children: true, texture: true },
				);
				state.app = null;
				state.isInitialized = false;
			}

			if (overlayState === state) {
				overlayState = null;
			}
		};
	};

	attachment.updateEdges = (edges: FlowEdge[]) => {
		if (!overlayState) {
			return;
		}

		overlayState.currentEdges = edges;
		scheduleRefresh(overlayState);
	};

	attachment.isReady = () => overlayState?.isInitialized ?? false;

	return attachment;
}
