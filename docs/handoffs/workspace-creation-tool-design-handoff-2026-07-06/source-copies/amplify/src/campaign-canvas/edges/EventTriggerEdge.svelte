<script lang="ts">
import Icon from "@iconify/svelte";
import {
	BaseEdge,
	EdgeLabel,
	getSmoothStepPath,
	type Position,
} from "@xyflow/svelte";
import { SUB_CONNECTION_ACCENTS } from "@/design-system/patterns/CampaignFlow/edges/shared/edge-styles";
import type { EventTriggerEdgeData } from "@/design-system/patterns/CampaignFlow/types/edges";

interface Props {
	id: string;
	sourceX: number;
	sourceY: number;
	targetX: number;
	targetY: number;
	sourcePosition: Position;
	targetPosition: Position;
	data?: EventTriggerEdgeData;
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

let isActive = $derived(data?.status === "active");
let pathResult = $derived(
	getSmoothStepPath({
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		borderRadius: 8,
	}),
);
let edgePath = $derived(pathResult[0]);
let labelX = $derived(pathResult[1]);
let labelY = $derived(pathResult[2]);
</script>

<style>
	@keyframes -global-flow-edge-pulse {
		0%,
		100% {
			stroke-opacity: 1;
		}

		50% {
			stroke-opacity: 0.35;
		}
	}
</style>

<BaseEdge
	{id}
	path={edgePath}
	style={{
		...style,
		stroke: SUB_CONNECTION_ACCENTS["event-trigger"],
		strokeWidth: "var(--flow-edge-stroke-width)",
		strokeDasharray: "2,4",
		animation: isActive ? "flow-edge-pulse 2s infinite" : undefined,
	}}
/>
{#if data?.label}
	<EdgeLabel x={labelX} y={labelY}>
		<div class="nodrag nopan flow-event-edge-label flex items-center gap-1 rounded-[var(--flow-edge-label-radius)] px-2 py-0.5 text-xs font-medium">
			<Icon icon="mdi:flash" class="text-xs" /> {data.label}
		</div>
	</EdgeLabel>
{/if}
