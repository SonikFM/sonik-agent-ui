<script lang="ts" module>
	import type { IComponentBaseProps } from "../types.js";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	export type MessageContentProps = HTMLAttributes<HTMLDivElement> &
		IComponentBaseProps & {
			children?: Snippet;
		};
</script>

<script lang="ts">
	import { cn } from "../utils.js";
	import { getMessageContext } from "./message-context.svelte.js";

	let {
		class: className,
		dataTheme,
		children,
		...rest
	}: MessageContentProps = $props();

	const context = getMessageContext();
	const bubbleTone = $derived(
		context?.from === "assistant"
			? "chat-bubble-primary"
			: context?.from === "tool"
				? "chat-bubble-accent"
				: ""
	);
</script>

<div
	{...rest}
	data-theme={dataTheme}
	class={cn("chat-bubble text-sm", bubbleTone, className)}
>
	{#if children}{@render children()}{/if}
</div>
