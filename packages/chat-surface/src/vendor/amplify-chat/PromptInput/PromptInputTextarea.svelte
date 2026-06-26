<script lang="ts" module>
	import type { IComponentBaseProps } from "../types.js";
	import type { HTMLTextareaAttributes } from "svelte/elements";
	export type PromptInputTextareaProps = HTMLTextareaAttributes & IComponentBaseProps & { value?: string };
</script>
<script lang="ts">
	import { cn } from "../utils.js";
	let { value = $bindable(""), class: className, placeholder = "What would you like to know?", rows = 1, ...rest }: PromptInputTextareaProps = $props();
	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		const form = (event.currentTarget as HTMLTextAreaElement).form;
		form?.requestSubmit();
	}
</script>
<textarea {...rest} bind:value name="message" {placeholder} {rows} onkeydown={handleKeydown} class={cn("textarea w-full resize-none border-none bg-transparent p-2 outline-none focus:outline-none", "min-h-10 max-h-48 field-sizing-content", className)}></textarea>
