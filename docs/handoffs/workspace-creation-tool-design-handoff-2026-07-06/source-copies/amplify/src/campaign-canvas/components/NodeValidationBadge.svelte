<script lang="ts">
import Icon from "@iconify/svelte";
import type {
	AIActionNodeData,
	ChannelNodeData,
	EventNodeData,
	FlowNodeData,
	LogicNodeData,
} from "@/design-system/patterns/CampaignFlow/types/nodes";

interface Props {
	data: FlowNodeData;
}

const { data }: Props = $props();

/**
 * Compute missing required fields per node kind.
 * - Channel: provider + title
 * - Logic:   config object (non-empty)
 * - Event:   eventType
 * - AIAction: aiType
 *
 * Keep this in sync with the backend schema (`campaign-flow.ts` zod schemas)
 * and the save-time validation that rejects drafts missing these fields.
 */
const missing = $derived.by<string[]>(() => {
	const issues: string[] = [];

	switch (data.kind) {
		case "channel": {
			const c = data as ChannelNodeData;
			if (!c.provider) issues.push("provider");
			if (!c.title || c.title.trim().length === 0) issues.push("title");
			break;
		}
		case "logic": {
			const l = data as LogicNodeData;
			const cfg = l.config as Record<string, unknown> | undefined;
			const hasConfig =
				cfg != null && typeof cfg === "object" && Object.keys(cfg).length > 0;
			if (!hasConfig) issues.push("config");
			break;
		}
		case "event": {
			const e = data as EventNodeData;
			if (!e.eventType) issues.push("eventType");
			break;
		}
		case "ai-action": {
			const a = data as AIActionNodeData;
			if (!a.aiType) issues.push("aiType");
			break;
		}
	}

	return issues;
});

let hasIssues = $derived(missing.length > 0);
let tooltip = $derived(hasIssues ? `Missing: ${missing.join(", ")}` : "");
</script>

{#if hasIssues}
	<div
		class="absolute -top-1.5 -right-1.5 z-10 inline-flex size-[18px] items-center justify-center rounded-full border-2 bg-warning text-warning-content shadow-sm pointer-events-auto"
		style:border-color="var(--flow-chip-bg)"
		role="status"
		aria-label={tooltip}
		title={tooltip}
		data-testid="node-validation-badge"
	>
		<Icon icon="mdi:alert" class="text-sm" />
	</div>
{/if}
