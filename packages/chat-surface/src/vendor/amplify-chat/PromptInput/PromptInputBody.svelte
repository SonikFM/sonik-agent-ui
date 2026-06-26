<script lang="ts" module>
	import type { IComponentBaseProps } from "../types.js";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement> & IComponentBaseProps & { children?: Snippet };
</script>
<script lang="ts">
	import { cn } from "../utils.js";
	let { class: className, children, ...rest }: PromptInputBodyProps = $props();
</script>
<div {...rest} class={cn("p-2", className)}>{#if children}{@render children()}{/if}</div>
