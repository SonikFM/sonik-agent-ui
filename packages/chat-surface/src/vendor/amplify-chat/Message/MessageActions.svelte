<script lang="ts" module>
	import type { IComponentBaseProps } from "../types.js";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	export type MessageActionsProps = HTMLAttributes<HTMLDivElement> &
		IComponentBaseProps & { children?: Snippet };
</script>

<script lang="ts">
	import { cn } from "../utils.js";
	let { class: className, children, ...rest }: MessageActionsProps = $props();
</script>

<div {...rest} class={cn("chat-footer mt-1 flex gap-1 opacity-70", className)}>
	{#if children}{@render children()}{/if}
</div>
