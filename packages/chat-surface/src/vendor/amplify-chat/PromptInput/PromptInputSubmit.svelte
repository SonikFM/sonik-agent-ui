<script lang="ts" module>
	import type { IComponentBaseProps } from "../types.js";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import type { ChatStatus } from "./PromptInput.svelte";
	export type PromptInputSubmitProps = Omit<HTMLButtonAttributes, "type"> & IComponentBaseProps & { status?: ChatStatus; onStop?: () => void; children?: Snippet };
</script>
<script lang="ts">
	import { cn } from "../utils.js";
	let { status = "ready", onStop, class: className, children, ...rest }: PromptInputSubmitProps = $props();
	const isGenerating = $derived(status === "submitted" || status === "streaming");
	function handleClick(event: MouseEvent) {
		if (!isGenerating) return;
		event.preventDefault();
		onStop?.();
	}
</script>
<button {...rest} type={isGenerating ? "button" : "submit"} aria-label={isGenerating ? "Stop" : "Submit"} class={cn("btn btn-primary btn-sm", className)} onclick={handleClick}>
	{#if children}{@render children()}{:else}{isGenerating ? "Stop" : "Send"}{/if}
</button>
