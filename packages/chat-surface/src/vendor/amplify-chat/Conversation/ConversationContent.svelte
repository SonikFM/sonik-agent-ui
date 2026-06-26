<script lang="ts" module>
	import type { IComponentBaseProps } from "../types.js";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";

	export type ConversationContentProps = HTMLAttributes<HTMLDivElement> &
		IComponentBaseProps & {
			children?: Snippet;
		};
</script>

<script lang="ts">
	import { cn } from "../utils.js";
	import { getConversationContext } from "./conversation-context.svelte.js";

	let { class: className, dataTheme, children, ...rest }: ConversationContentProps = $props();
	const context = getConversationContext();

	function scrollContainer(node: HTMLDivElement) {
		context?.setElement(node);
		queueMicrotask(() => context?.scrollToBottom("auto"));

		const observer = new ResizeObserver(() => {
			const shouldStick = context?.isAtBottom ?? true;
			if (shouldStick) {
				requestAnimationFrame(() => context?.scrollToBottom("auto"));
				return;
			}

			context?.checkPosition();
		});

		observer.observe(node);

		return {
			destroy() {
				observer.disconnect();
				context?.setElement(null);
			},
		};
	}

	function handleScroll() {
		context?.checkPosition();
	}
</script>

<div
	{...rest}
	use:scrollContainer
	onscroll={handleScroll}
	data-theme={dataTheme}
	class={cn("min-h-0 flex-1 overflow-auto p-4", className)}
>
	{#if children}{@render children()}{/if}
</div>
