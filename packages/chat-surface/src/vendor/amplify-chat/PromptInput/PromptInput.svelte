<script lang="ts" module>
	import type { IComponentBaseProps } from "../types.js";
	import type { HTMLAttributes } from "svelte/elements";
	import type { Snippet } from "svelte";
	export type ChatStatus = "ready" | "submitted" | "streaming" | "error";
	export interface PromptInputMessage { text: string; }
	export type PromptInputProps = Omit<HTMLAttributes<HTMLFormElement>, "onsubmit"> & IComponentBaseProps & { status?: ChatStatus; onSubmit?: (message: PromptInputMessage) => void; children?: Snippet };
</script>
<script lang="ts">
	import { cn } from "../utils.js";
	let { status = "ready", onSubmit, class: className, children, ...rest }: PromptInputProps = $props();
	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const data = new FormData(form);
		onSubmit?.({ text: String(data.get("message") ?? "") });
	}
</script>
<form {...rest} data-status={status} class={cn("rounded-box border border-base-300 bg-base-200", className)} onsubmit={handleSubmit}>
	{#if children}{@render children()}{/if}
</form>
