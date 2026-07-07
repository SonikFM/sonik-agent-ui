<script lang="ts">
import {
	BaseEdge,
	EdgeLabel,
	getSmoothStepPath,
	type Position,
} from "@xyflow/svelte";
import { STATUS_COLORS } from "@/design-system/patterns/CampaignFlow/edges/shared/edge-styles";
import type {
	EdgeStatus,
	FlowEdgeData,
} from "@/design-system/patterns/CampaignFlow/types/edges";

interface Props {
	id: string;
	sourceX: number;
	sourceY: number;
	targetX: number;
	targetY: number;
	sourcePosition: Position;
	targetPosition: Position;
	data?: FlowEdgeData;
	style?: Record<string, string>;
}

const {
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	data,
	style,
}: Props = $props();

let status: EdgeStatus = $derived(data?.status ?? "idle");
let pathResult = $derived(
	getSmoothStepPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		borderRadius: 12,
	}),
);
let edgePath = $derived(pathResult[0]);
let labelX = $derived(pathResult[1]);
let labelY = $derived(pathResult[2]);
let markerId = $derived(`flow-arrow-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`);
let edgeColor = $derived(STATUS_COLORS[status]);
let edgeWidth = $derived(
	status === "active"
		? "var(--flow-edge-selected-stroke-width)"
		: "var(--flow-edge-stroke-width)",
);
</script>

<defs>
	<marker
		id={markerId}
		markerWidth="10"
		markerHeight="10"
		refX="8.5"
		refY="5"
		orient="auto"
		markerUnits="strokeWidth"
	>
		<path d="M 0 0 L 10 5 L 0 10 z" fill={edgeColor}></path>
	</marker>
</defs>
<BaseEdge
	{id}
	path={edgePath}
	style={{
		...style,
		stroke: edgeColor,
		strokeWidth: edgeWidth,
		strokeDasharray: status === "blocked" ? "8,4" : undefined,
	}}
/>
<path
	d={edgePath}
	fill="none"
	stroke={edgeColor}
	stroke-width={edgeWidth}
	stroke-dasharray={status === "blocked" ? "8,4" : undefined}
	stroke-linecap="round"
	stroke-linejoin="round"
	marker-end={`url(#${markerId})`}
	opacity="0.72"
	pointer-events="none"
></path>
{#if data?.label}
	<EdgeLabel x={labelX} y={labelY}>
		<div class="nodrag nopan rounded-full border border-base-300 bg-[var(--flow-edge-label-bg)] px-2.5 py-1 text-xs font-semibold text-base-content/75 shadow-sm">
			{data.label}
		</div>
	</EdgeLabel>
{/if}
