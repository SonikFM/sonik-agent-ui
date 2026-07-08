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

		return {
			destroy() {
				context?.setElement(null);
			},
		};
	}

	function handleScroll() {
		context?.checkPosition();
	}

	// Follow-while-streaming (ported from onyx's ChatScrollContainer): watch the
	// CONTENT growing inside the scroll box, not the scroll box's own (fixed)
	// bounding rect -- that's what let token-by-token growth escape the old
	// same-node ResizeObserver. A MutationObserver catches new nodes (tool
	// blocks, artifacts) and a ResizeObserver catches in-place height growth
	// from streamed text reflowing -- deliberately NOT observing characterData
	// so raw token mutations don't thrash this callback.
	function contentContainer(node: HTMLDivElement) {
		const followIfSticking = () => {
			if (context?.followMode ?? true) {
				requestAnimationFrame(() => context?.scrollToBottom("auto"));
			} else {
				context?.checkPosition();
			}
		};

		const resizeObserver = new ResizeObserver(followIfSticking);
		resizeObserver.observe(node);

		const mutationObserver = new MutationObserver(followIfSticking);
		mutationObserver.observe(node, { childList: true, subtree: true });

		return {
			destroy() {
				resizeObserver.disconnect();
				mutationObserver.disconnect();
			},
		};
	}
</script>

<div
	{...rest}
	use:scrollContainer
	onscroll={handleScroll}
	data-theme={dataTheme}
	class={cn("min-h-0 flex-1 overflow-auto p-4", className)}
>
	<div use:contentContainer>
		{#if children}{@render children()}{/if}
	</div>
</div>
