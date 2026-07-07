<script lang="ts">
import type { Attachment } from "svelte/attachments";
import { canvasState } from "../stores/canvas-store.svelte";

let visible = $state(true);

let nodeCount = $derived(canvasState.nodes.length);
let edgeCount = $derived(canvasState.edges.length);

function tweakpaneSetup(): Attachment {
	return (el) => {
		el.dataset.debugPanel = "active";
		return () => {
			delete el.dataset.debugPanel;
		};
	};
}
</script>

{#if import.meta.env.DEV}
	{#if visible}
		<div
			class="fixed bottom-4 right-4 z-50 rounded-lg bg-base-300 p-3 shadow-xl"
			{@attach tweakpaneSetup()}
		>
			<div class="flex items-center justify-between gap-4 text-xs">
				<span>Nodes: {nodeCount}</span>
				<span>Edges: {edgeCount}</span>
				<span>Layer: {canvasState.activeLayer}</span>
				<span>Grid: {canvasState.gridSize}px</span>
				<button class="btn btn-ghost btn-xs" onclick={() => visible = false}>
					Hide
				</button>
			</div>
		</div>
	{:else}
		<button
			class="btn btn-xs fixed bottom-4 right-4 z-50 shadow-xl"
			onclick={() => visible = true}
		>
			Show debug
		</button>
	{/if}
{/if}
