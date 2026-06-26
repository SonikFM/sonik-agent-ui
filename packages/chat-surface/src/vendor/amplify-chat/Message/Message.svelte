<script lang="ts" module>
	import type { IComponentBaseProps } from "../types.js";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	import type { MessageRole } from "./message-context.svelte.js";

	export type MessageProps = HTMLAttributes<HTMLDivElement> &
		IComponentBaseProps & {
			from: MessageRole;
			children?: Snippet;
		};
</script>

<script lang="ts">
	import { cn } from "../utils.js";
	import { setMessageContext } from "./message-context.svelte.js";

	let {
		from,
		class: className,
		dataTheme,
		children,
		...rest
	}: MessageProps = $props();

	const messageContext = $state({ from: "assistant" as MessageRole });
	setMessageContext(messageContext);

	$effect(() => {
		messageContext.from = from;
	});

	const placementClass = $derived(from === "user" ? "chat-end" : "chat-start");
</script>

<div
	{...rest}
	data-theme={dataTheme}
	data-role={from}
	class={cn("chat", placementClass, className)}
>
	{#if children}{@render children()}{/if}
</div>
