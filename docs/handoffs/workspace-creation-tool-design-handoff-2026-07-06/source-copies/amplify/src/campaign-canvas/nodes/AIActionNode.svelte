<script lang="ts">
import Icon from "@iconify/svelte";
import { Handle, Position } from "@xyflow/svelte";
import { NODE_ACCENT_CLASSES } from "@/design-system/patterns/CampaignFlow/edges/shared/edge-styles";
import type {
	AIActionNodeData,
	FlowNodeData,
} from "@/design-system/patterns/CampaignFlow/types/nodes";
import NodeChip from "@/svelte-design-system/primitives/NodeChip.svelte";
import NodeValidationBadge from "../components/NodeValidationBadge.svelte";

interface Props {
	id: string;
	data: FlowNodeData;
}

const { id, data }: Props = $props();

const AI_CONFIG: Record<
	string,
	{ icon: string; label: string; summary: string }
> = {
	generate: {
		icon: "mdi:auto-fix",
		label: "Generate",
		summary: "Draft copy from campaign context.",
	},
	personalize: {
		icon: "mdi:target",
		label: "Personalize",
		summary: "Tailor message variants for each audience.",
	},
	"optimize-timing": {
		icon: "mdi:clock-check",
		label: "Optimize Time",
		summary: "Suggest the best send window before scheduling.",
	},
	sentiment: {
		icon: "mdi:emoticon-happy",
		label: "Sentiment",
		summary: "Classify replies before routing follow-up.",
	},
};
const DEFAULT_AI = {
	icon: "mdi:robot",
	label: "AI",
	summary: "Use AI to assist the next workflow step.",
};

let nodeData = $derived(data as AIActionNodeData);
let config = $derived(AI_CONFIG[nodeData.aiType] ?? DEFAULT_AI);
let fullLabel = $derived(
	`${config.label}${nodeData.modelId ? `: ${nodeData.modelId}` : ""}`,
);
</script>

<div class="relative">
	<NodeValidationBadge {data} />
	<Handle type="target" position={Position.Top} id="{id}-in" />
	<NodeChip label={fullLabel} accentClass={NODE_ACCENT_CLASSES["ai-action"]}>
		{#snippet icon()}
			<Icon icon={config.icon} />
		{/snippet}
		{#snippet children()}
			{#if nodeData.confidence != null}
				<div class="ml-auto flex items-center gap-1">
					<div class="h-1.5 w-12 rounded-full bg-base-200">
						<div
							class="flow-confidence-bar h-full rounded-full"
							style:width="{nodeData.confidence}%"
						></div>
					</div>
					<span class="text-xs text-base-content/50">{nodeData.confidence}%</span>
				</div>
			{:else}
				<span class="ml-auto text-[10px] uppercase tracking-wide text-base-content/50">
					Assist
				</span>
			{/if}
		{/snippet}
	</NodeChip>
	<div class="mt-2 rounded-lg border border-base-300 bg-base-200/50 px-2 py-1.5 text-[11px] leading-tight text-base-content/60">
		{config.summary}
	</div>
	<Handle type="source" position={Position.Bottom} id="{id}-out" />
</div>
