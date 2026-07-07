<script lang="ts">
import Icon from "@iconify/svelte";
import { Handle, Position } from "@xyflow/svelte";
import { NODE_ACCENT_CLASSES } from "@/design-system/patterns/CampaignFlow/edges/shared/edge-styles";
import type {
	EventNodeData,
	FlowNodeData,
} from "@/design-system/patterns/CampaignFlow/types/nodes";
import NodeChip from "@/svelte-design-system/primitives/NodeChip.svelte";
import NodeValidationBadge from "../components/NodeValidationBadge.svelte";

interface Props {
	id: string;
	data: FlowNodeData;
}

const { id, data }: Props = $props();

const EVENT_CONFIG: Record<
	string,
	{ icon: string; label: string; summary: string }
> = {
	"on-open": {
		icon: "mdi:email-open",
		label: "On Open",
		summary: "Branch when a recipient opens the message.",
	},
	"on-click": {
		icon: "mdi:link-variant",
		label: "On Click",
		summary: "React when a recipient clicks a tracked link.",
	},
	"on-reply": {
		icon: "mdi:message-reply",
		label: "On Reply",
		summary: "Route inbound replies into the next response.",
	},
	"on-bounce": {
		icon: "mdi:alert",
		label: "On Bounce",
		summary: "Handle delivery failures and suppressions.",
	},
	"on-unsubscribe": {
		icon: "mdi:cancel",
		label: "Unsubscribe",
		summary: "Stop follow-up when someone opts out.",
	},
};
const DEFAULT_EVENT = {
	icon: "mdi:flash",
	label: "Event",
	summary: "Wait for a recipient event before continuing.",
};

let nodeData = $derived(data as EventNodeData);
let config = $derived(EVENT_CONFIG[nodeData.eventType] ?? DEFAULT_EVENT);
</script>

<div class="relative">
	<NodeValidationBadge {data} />
	<Handle type="target" position={Position.Top} id="{id}-in" />
	<NodeChip label={config.label} accentClass={NODE_ACCENT_CLASSES.event}>
		{#snippet icon()}
			<Icon icon={config.icon} />
		{/snippet}
		{#snippet children()}
			<span class="ml-auto text-[10px] uppercase tracking-wide text-base-content/50">
				Trigger
			</span>
		{/snippet}
	</NodeChip>
	<div class="mt-2 rounded-lg border border-base-300 bg-base-200/50 px-2 py-1.5 text-[11px] leading-tight text-base-content/60">
		{config.summary}
	</div>
</div>
