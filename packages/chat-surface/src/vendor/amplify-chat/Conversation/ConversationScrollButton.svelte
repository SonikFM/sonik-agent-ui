<script lang="ts" module>
	import type { IComponentBaseProps } from "../types.js";
	import type { HTMLButtonAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	export type ConversationScrollButtonProps = HTMLButtonAttributes &
		IComponentBaseProps & {
			children?: Snippet;
		};
</script>

<script lang="ts">
	import { cn } from "../utils.js";
	import { getConversationContext } from "./conversation-context.svelte.js";

	let { class: className, children, ...rest }: ConversationScrollButtonProps = $props();
	const context = getConversationContext();
</script>

{#if context && !context.isAtBottom}
	<button
		{...rest}
		type="button"
		class={cn("btn btn-primary btn-sm absolute bottom-3 right-3 z-10", className)}
		onclick={() => context.scrollToBottom()}
	>
		{#if children}{@render children()}{:else}Scroll to bottom{/if}
	</button>
{/if}
