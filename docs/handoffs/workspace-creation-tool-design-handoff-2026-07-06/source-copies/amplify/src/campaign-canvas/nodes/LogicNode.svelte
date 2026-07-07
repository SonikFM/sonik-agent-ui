<script lang="ts">
import Icon from "@iconify/svelte";
import { Handle, Position } from "@xyflow/svelte";
import { NODE_ACCENT_CLASSES } from "@/design-system/patterns/CampaignFlow/edges/shared/edge-styles";
import type {
	DelayConfig,
	FlowNodeData,
	LogicNodeData,
} from "@/design-system/patterns/CampaignFlow/types/nodes";
import NodeChip from "@/svelte-design-system/primitives/NodeChip.svelte";
import NodeValidationBadge from "../components/NodeValidationBadge.svelte";
import { canvasState } from "../stores/canvas-store.svelte";

interface Props {
	id: string;
	data: FlowNodeData;
}

const { id, data }: Props = $props();

const LOGIC_CONFIG: Record<string, { icon: string; label: string }> = {
	delay: { icon: "mdi:timer-sand", label: "Delay" },
	condition: { icon: "mdi:call-split", label: "Condition" },
	"ab-split": { icon: "mdi:scale-balance", label: "A/B Split" },
	"audience-filter": { icon: "mdi:target", label: "Filter" },
};
const DEFAULT_LOGIC = { icon: "mdi:cog", label: "Logic" };
const LOGIC_HANDLE_CLASS = "flow-handle-logic";
const TRUE_BRANCH_HANDLE_CLASS = "flow-handle-branch-true";
const FALSE_BRANCH_HANDLE_CLASS = "flow-handle-branch-false";

let nodeData = $derived(data as LogicNodeData);
let config = $derived(LOGIC_CONFIG[nodeData.logicType] ?? DEFAULT_LOGIC);
let hasConditionOutputs = $derived(
	nodeData.logicType === "condition" || nodeData.logicType === "ab-split",
);
let conditionConfig = $derived(
	(nodeData.logicType === "condition"
		? (nodeData.config as {
				field?: string;
				operator?: string;
				value?: string;
			})
		: null) ?? null,
);
let delayText = $derived.by(() => {
	if (nodeData.logicType !== "delay") return null;
	const c = nodeData.config as DelayConfig;
	return `${c.duration}${c.unit.charAt(0)}`;
});
let summaryText = $derived.by(() => {
	if (nodeData.logicType === "delay") {
		const c = nodeData.config as DelayConfig;
		return `Wait ${c.duration} ${c.unit} before the next action.`;
	}
	if (nodeData.logicType === "condition" && conditionConfig) {
		return `${conditionConfig.field || "Field"} ${
			conditionConfig.operator || "equals"
		} ${conditionConfig.value || "value"}`;
	}
	if (nodeData.logicType === "ab-split") {
		return "Split recipients into test variants before continuing.";
	}
	if (nodeData.logicType === "audience-filter") {
		return "Narrow the audience using saved segment rules.";
	}
	return "Configure how this branch should behave.";
});

function updateLogicConfig(patch: Record<string, unknown>, event?: Event) {
	event?.stopPropagation();
	canvasState.updateNodeData(id, {
		config: {
			...(nodeData.config as Record<string, unknown>),
			...patch,
		},
	});
}
</script>

<div class="relative">
	<NodeValidationBadge {data} />
	<Handle
		type="target"
		position={Position.Top}
		id="{id}-in"
		class={LOGIC_HANDLE_CLASS}
	/>

	<NodeChip label="{config.label}: {nodeData.label}" accentClass={NODE_ACCENT_CLASSES.logic}>
		{#snippet icon()}
			<Icon icon={config.icon} />
		{/snippet}
		{#snippet children()}
			{#if delayText}
				<span class="ml-auto text-xs text-base-content/60">{delayText}</span>
			{/if}
		{/snippet}
	</NodeChip>

	{#if nodeData.logicType === "delay"}
		<div
			class="mt-2 flex items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-2 py-2 text-xs"
			role="presentation"
			onpointerdown={(event) => event.stopPropagation()}
		>
			<input
				type="number"
				min="1"
				value={(nodeData.config as DelayConfig).duration}
				class="input input-bordered input-xs w-16"
				oninput={(event) =>
					updateLogicConfig(
						{
							duration: Math.max(
								1,
								Number(
									(event.currentTarget as HTMLInputElement | null)?.value ?? 1,
								) || 1,
							),
						},
						event,
					)}
			/>
			<select
				class="select select-bordered select-xs"
				value={(nodeData.config as DelayConfig).unit}
				onchange={(event) =>
					updateLogicConfig(
						{
							unit: (event.currentTarget as HTMLSelectElement | null)?.value,
						},
						event,
					)}
			>
				<option value="minutes">Minutes</option>
				<option value="hours">Hours</option>
				<option value="days">Days</option>
			</select>
		</div>
	{:else if nodeData.logicType === "condition" && conditionConfig}
		<div
			class="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-base-300 bg-base-100 px-2 py-2 text-xs"
			role="presentation"
			onpointerdown={(event) => event.stopPropagation()}
		>
			<input
				type="text"
				value={conditionConfig.field ?? ""}
				placeholder="field"
				class="input input-bordered input-xs w-full"
				oninput={(event) =>
					updateLogicConfig(
						{
							field: (event.currentTarget as HTMLInputElement | null)?.value,
						},
						event,
					)}
			/>
			<select
				class="select select-bordered select-xs w-full"
				value={conditionConfig.operator ?? "equals"}
				onchange={(event) =>
					updateLogicConfig(
						{
							operator: (event.currentTarget as HTMLSelectElement | null)?.value,
						},
						event,
					)}
			>
				<option value="equals">Equals</option>
				<option value="not-equals">Not equals</option>
				<option value="contains">Contains</option>
				<option value="gt">Greater</option>
				<option value="lt">Lower</option>
			</select>
			<input
				type="text"
				value={conditionConfig.value ?? ""}
				placeholder="value"
				class="input input-bordered input-xs w-full"
				oninput={(event) =>
					updateLogicConfig(
						{
							value: (event.currentTarget as HTMLInputElement | null)?.value,
						},
						event,
					)}
			/>
		</div>
	{:else if nodeData.logicType === "ab-split" || nodeData.logicType === "audience-filter"}
		<div class="mt-2 rounded-lg border border-dashed border-base-300 bg-base-100 px-2 py-2 text-[11px] text-base-content/60">
			<span class="font-semibold uppercase tracking-wide text-base-content/45">
				Draft rule
			</span>
			<p class="mt-1 leading-tight">{summaryText}</p>
		</div>
	{/if}

	<div class="mt-2 rounded-lg border border-base-300 bg-base-200/50 px-2 py-1.5 text-[11px] leading-tight text-base-content/60">
		{summaryText}
	</div>

	{#if hasConditionOutputs}
		<Handle
			type="source"
			position={Position.Bottom}
			id="{id}-true-out"
			class={TRUE_BRANCH_HANDLE_CLASS}
			style="left: 33%"
		/>
		<Handle
			type="source"
			position={Position.Bottom}
			id="{id}-false-out"
			class={FALSE_BRANCH_HANDLE_CLASS}
			style="left: 66%"
		/>
	{:else}
		<Handle
			type="source"
			position={Position.Bottom}
			id="{id}-out"
			class={LOGIC_HANDLE_CLASS}
		/>
	{/if}
</div>
