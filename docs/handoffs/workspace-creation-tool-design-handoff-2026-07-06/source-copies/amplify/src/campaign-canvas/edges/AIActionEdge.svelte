<script lang="ts">
import Icon from "@iconify/svelte";
import {
	BaseEdge,
	EdgeLabel,
	getSmoothStepPath,
	type Position,
} from "@xyflow/svelte";
import type { AIActionEdgeData } from "@/design-system/patterns/CampaignFlow/types/edges";

interface Props {
	id: string;
	sourceX: number;
	sourceY: number;
	targetX: number;
	targetY: number;
	sourcePosition: Position;
	targetPosition: Position;
	data?: AIActionEdgeData;
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

let gradientId = $derived(`ai-gradient-${id}`);
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

<defs>
	<linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
		<stop offset="0%" style:stop-color="var(--flow-accent-ai)" />
		<stop offset="100%" style:stop-color="var(--flow-branch-a)" />
	</linearGradient>
</defs>
<BaseEdge
	{id}
	path={edgePath}
	style={{
		...style,
		stroke: `url(#${gradientId})`,
		strokeWidth: "var(--flow-edge-stroke-width)",
		animation: isActive ? "flow-edge-pulse 2s infinite" : undefined,
	}}
/>
{#if data?.label}
	<EdgeLabel x={labelX} y={labelY}>
		<div class="nodrag nopan flow-ai-edge-label flex items-center gap-1 rounded-[var(--flow-edge-label-radius)] px-2 py-0.5 text-xs font-medium">
			<Icon icon="mdi:auto-fix" class="text-xs" /> {data.label}
		</div>
	</EdgeLabel>
{/if}
