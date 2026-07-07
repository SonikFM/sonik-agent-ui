<script lang="ts">
import type { Snippet } from "svelte";
import type { Attachment } from "svelte/attachments";
import { Flip, gsap } from "../lib/gsap-setup";
import { haptic } from "../lib/haptics";

interface Props {
	open: boolean;
	sourceRect: DOMRect | null;
	children?: Snippet;
	onClose?: () => void;
}

const { open, sourceRect, children, onClose }: Props = $props();

let dialogEl = $state<HTMLDivElement | null>(null);

$effect(() => {
	if (open && dialogEl) {
		dialogEl.focus();
	}
});

function flipMorph(isOpen: boolean, rect: DOMRect | null): Attachment {
	return (el) => {
		if (!isOpen || !rect) return;

		gsap.set(el, {
			x: rect.left,
			y: rect.top,
			width: rect.width,
			height: rect.height,
			position: "fixed",
		});

		const state = Flip.getState(el);

		gsap.set(el, {
			x: "",
			y: "",
			width: "",
			height: "",
			position: "",
			clearProps: "transform",
		});

		Flip.from(state, {
			duration: 0.4,
			ease: "power2.out",
			absolute: true,
		});

		haptic("modal", el);

		return () => {
			gsap.killTweensOf(el);
		};
	};
}

function handleBackdropClick(e: MouseEvent) {
	if (e.target === e.currentTarget) {
		onClose?.();
	}
}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		bind:this={dialogEl}
		class="modal modal-open"
		onclick={handleBackdropClick}
		onkeydown={(e) => { if (e.key === "Escape") onClose?.(); }}
		role="dialog"
		aria-modal="true"
		aria-label="Video spotlight preview"
		tabindex="-1"
	>
		<div
			class="modal-box"
			{@attach flipMorph(open, sourceRect)}
		>
			{@render children?.()}
		</div>
	</div>
{/if}
