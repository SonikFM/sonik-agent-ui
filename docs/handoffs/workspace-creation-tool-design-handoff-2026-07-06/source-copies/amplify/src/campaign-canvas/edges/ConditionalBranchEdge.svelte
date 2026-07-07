<script lang="ts">
import {
	BaseEdge,
	EdgeLabel,
	getSmoothStepPath,
	type Position,
} from "@xyflow/svelte";
import { BRANCH_COLORS } from "@/design-system/patterns/CampaignFlow/edges/shared/edge-styles";
import type { ConditionalBranchEdgeData } from "@/design-system/patterns/CampaignFlow/types/edges";

interface Props {
	id: string;
	sourceX: number;
	sourceY: number;
	targetX: number;
	targetY: number;
	sourcePosition: Position;
	targetPosition: Position;
	data?: ConditionalBranchEdgeData;
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

let branch = $derived(data?.branch ?? "true");
let color = $derived(BRANCH_COLORS[branch] ?? "var(--flow-accent-conditional)");
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

<BaseEdge
	{id}
	path={edgePath}
	style={{ ...style, stroke: color, strokeWidth: "var(--flow-edge-stroke-width)" }}
/>
{#if data?.label}
	<EdgeLabel x={labelX} y={labelY}>
		<div
			class="nodrag nopan flow-branch-label rounded-[var(--flow-edge-label-radius)] px-2 py-0.5 text-xs font-bold shadow-sm"
			style:background-color={color}
			style:color="var(--flow-chip-bg)"
		>
			{data.label}
		</div>
	</EdgeLabel>
{/if}
