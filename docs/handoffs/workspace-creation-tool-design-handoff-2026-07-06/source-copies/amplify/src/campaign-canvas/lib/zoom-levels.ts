import type {
	FlowViewport,
	Layer,
} from "@/design-system/patterns/CampaignFlow/types/flow";

export interface ZoomLevelConfig {
	layer: Layer;
	zoom: number;
	label: string;
}

export const ZOOM_LEVELS: ZoomLevelConfig[] = [
	{ layer: "node-lock", zoom: 1.2, label: "Node Lock" },
	{ layer: "full-board", zoom: 0.7, label: "Full Board" },
];

export interface ZoomState {
	currentZoom: number;
	currentLayer: Layer;
	viewport: FlowViewport;
}

export function createZoomState(): ZoomState {
	return {
		currentZoom: 0.7,
		currentLayer: "full-board",
		viewport: { x: 0, y: 0, zoom: 0.7 },
	};
}

export function getZoomConfig(layer: Layer): ZoomLevelConfig {
	return ZOOM_LEVELS.find((z) => z.layer === layer) ?? ZOOM_LEVELS[1];
}

export function nextZoomLevel(current: number): number {
	const idx = ZOOM_LEVELS.findIndex((z) => z.zoom === current);
	if (idx === -1) return ZOOM_LEVELS[0].zoom;
	const next = (idx + 1) % ZOOM_LEVELS.length;
	return ZOOM_LEVELS[next].zoom;
}
