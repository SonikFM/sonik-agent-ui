<script lang="ts" module>
	import type { IComponentBaseProps } from "../types.js";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	export type PromptInputToolbarProps = HTMLAttributes<HTMLDivElement> & IComponentBaseProps & { children?: Snippet };
</script>
<script lang="ts">
	import { cn } from "../utils.js";
	let { class: className, children, ...rest }: PromptInputToolbarProps = $props();
</script>
<div {...rest} class={cn("flex items-center gap-2 border-t border-base-300 px-2 py-2", className)}>{#if children}{@render children()}{/if}</div>
