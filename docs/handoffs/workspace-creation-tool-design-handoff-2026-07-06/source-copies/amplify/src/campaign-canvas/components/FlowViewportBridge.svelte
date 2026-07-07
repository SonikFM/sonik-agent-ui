<script lang="ts">
import { useSvelteFlow } from "@xyflow/svelte";
import type { FlowViewport } from "@/design-system/patterns/CampaignFlow/types/flow";
import { DEFAULT_FLOW_CONFIG } from "@/design-system/patterns/CampaignFlow/types/flow";

interface Props {
	fitViewRequestId?: number;
	onViewportSync?: (viewport: FlowViewport) => void;
}

const { fitViewRequestId = 0, onViewportSync }: Props = $props();

const { fitView, getViewport } = useSvelteFlow();

let lastFitViewRequestId = $state(0);

$effect(() => {
	if (fitViewRequestId === 0 || fitViewRequestId === lastFitViewRequestId) {
		return;
	}

	lastFitViewRequestId = fitViewRequestId;

	void fitView(DEFAULT_FLOW_CONFIG.fitViewOptions).then(() => {
		const viewport = getViewport();
		onViewportSync?.({
			x: viewport.x,
			y: viewport.y,
			zoom: viewport.zoom,
		});
	});
});
</script>
