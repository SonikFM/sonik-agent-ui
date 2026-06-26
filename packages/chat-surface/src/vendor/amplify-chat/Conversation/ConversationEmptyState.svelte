<script lang="ts" module>
	import type { IComponentBaseProps } from "../types.js";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	export type ConversationEmptyStateProps = HTMLAttributes<HTMLDivElement> &
		IComponentBaseProps & { children?: Snippet };
</script>

<script lang="ts">
	import { cn } from "../utils.js";
	let { class: className, children, ...rest }: ConversationEmptyStateProps = $props();
</script>

<div {...rest} class={cn("grid min-h-40 place-items-center text-sm text-base-content/50", className)}>
	{#if children}{@render children()}{:else}No messages yet.{/if}
</div>
