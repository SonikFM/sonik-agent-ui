<script lang="ts" module>
	import type { IComponentBaseProps } from "../types.js";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	export type ConversationProps = HTMLAttributes<HTMLDivElement> &
		IComponentBaseProps & {
			children?: Snippet;
		};
</script>

<script lang="ts">
	import { cn } from "../utils.js";
	import { setConversationContext } from "./conversation-context.svelte.js";

	let { class: className, dataTheme, children, ...rest }: ConversationProps = $props();
	setConversationContext();
</script>

<div
	{...rest}
	data-theme={dataTheme}
	role="log"
	class={cn("relative flex h-full min-h-0 flex-col overflow-hidden", className)}
>
	{#if children}{@render children()}{/if}
</div>
