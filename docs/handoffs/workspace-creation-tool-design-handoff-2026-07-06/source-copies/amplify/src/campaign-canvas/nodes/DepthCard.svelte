<script lang="ts">
import type { Snippet } from "svelte";
import type { Attachment } from "svelte/attachments";
import { gsap } from "../lib/gsap-setup";
import { haptic } from "../lib/haptics";

interface Props {
	width?: number | string;
	height?: number | string;
	disabled?: boolean;
	children?: Snippet;
}

const { width = 375, height, disabled = false, children }: Props = $props();
const widthValue = $derived(typeof width === "number" ? `${width}px` : width);
const heightValue = $derived(
	height === undefined
		? "auto"
		: typeof height === "number"
			? `${height}px`
			: height,
);

let isHolding = $state(false);
let isHovered = $state(false);
let cardEl: HTMLDivElement | null = null;
let spotlightEl: HTMLDivElement | null = null;
let contentOverlayEl: HTMLDivElement | null = null;

const DEFAULT_PARALLAX_INTENSITY = 12;
const DEFAULT_TRANSLATE_INTENSITY = 4;

let quickToRotateX: ReturnType<typeof gsap.quickTo> | null = null;
let quickToRotateY: ReturnType<typeof gsap.quickTo> | null = null;
let quickToTranslateX: ReturnType<typeof gsap.quickTo> | null = null;
let quickToTranslateY: ReturnType<typeof gsap.quickTo> | null = null;

function parallaxAttach(isDisabled: boolean): Attachment {
	return (el) => {
		cardEl = el as HTMLDivElement;

		if (isDisabled) {
			return () => {
				cardEl = null;
			};
		}

		quickToRotateX = gsap.quickTo(el, "rotateX", {
			duration: 0.3,
			ease: "power2.out",
		});
		quickToRotateY = gsap.quickTo(el, "rotateY", {
			duration: 0.3,
			ease: "power2.out",
		});
		quickToTranslateX = gsap.quickTo(el, "x", {
			duration: 0.4,
			ease: "power2.out",
		});
		quickToTranslateY = gsap.quickTo(el, "y", {
			duration: 0.4,
			ease: "power2.out",
		});

		gsap.set(el, {
			transformPerspective: 800,
			transformStyle: "preserve-3d",
		});

		return () => {
			gsap.killTweensOf(el);
			quickToRotateX = null;
			quickToRotateY = null;
			quickToTranslateX = null;
			quickToTranslateY = null;
			cardEl = null;
		};
	};
}

function spotlightAttach(): Attachment {
	return (el) => {
		spotlightEl = el as HTMLDivElement;
		return () => {
			spotlightEl = null;
		};
	};
}

function contentOverlayAttach(): Attachment {
	return (el) => {
		contentOverlayEl = el as HTMLDivElement;
		gsap.set(el, { opacity: 1, y: 0 });
		return () => {
			contentOverlayEl = null;
		};
	};
}

function handlePointerEnter() {
	if (disabled) return;
	isHovered = true;
}

function handlePointerMove(e: PointerEvent) {
	if (disabled || isHolding || !cardEl) return;

	const rect = cardEl.getBoundingClientRect();
	const centerX = rect.left + rect.width / 2;
	const centerY = rect.top + rect.height / 2;
	const normalX = (e.clientX - centerX) / (rect.width / 2);
	const normalY = (e.clientY - centerY) / (rect.height / 2);

	const computedStyle = getComputedStyle(cardEl);
	const parsedParallaxIntensity = Number.parseFloat(
		computedStyle.getPropertyValue("--flow-depth-card-rotate"),
	);
	const parsedTranslateIntensity = Number.parseFloat(
		computedStyle.getPropertyValue("--flow-depth-card-translate"),
	);
	const parallaxIntensity = Number.isFinite(parsedParallaxIntensity)
		? parsedParallaxIntensity
		: DEFAULT_PARALLAX_INTENSITY;
	const translateIntensity = Number.isFinite(parsedTranslateIntensity)
		? parsedTranslateIntensity
		: DEFAULT_TRANSLATE_INTENSITY;

	quickToRotateX?.(-normalY * parallaxIntensity);
	quickToRotateY?.(normalX * parallaxIntensity);
	quickToTranslateX?.(normalX * translateIntensity);
	quickToTranslateY?.(normalY * translateIntensity);

	if (spotlightEl) {
		const x = ((e.clientX - rect.left) / rect.width) * 100;
		const y = ((e.clientY - rect.top) / rect.height) * 100;
		spotlightEl.style.background = `radial-gradient(circle at ${x}% ${y}%, var(--flow-spotlight-highlight) 0%, transparent 60%)`;
	}
}

function handlePointerLeave() {
	if (disabled) return;
	isHovered = false;

	quickToRotateX?.(0);
	quickToRotateY?.(0);
	quickToTranslateX?.(0);
	quickToTranslateY?.(0);
	if (spotlightEl) spotlightEl.style.background = "transparent";

	if (contentOverlayEl) gsap.set(contentOverlayEl, { scale: 1 });
}

function handleForceHold() {
	if (!cardEl) return;
	isHolding = true;
	haptic("select", cardEl);
	gsap.to(cardEl, {
		rotateX: 0,
		rotateY: 0,
		x: 0,
		y: 0,
		scale: 0.97,
		duration: 0.2,
		ease: "power2.out",
	});
}

function handleForceRelease() {
	if (!cardEl) return;
	isHolding = false;
	gsap.to(cardEl, {
		scale: 1,
		duration: 0.3,
		ease: "elastic.out(1, 0.5)",
	});
}
</script>

<div
	class={[
		"depth-card relative overflow-hidden rounded-xl border border-base-300 bg-base-100",
		"transition-shadow duration-300 ease-out",
		isHovered ? "shadow-xl" : "shadow-md",
	]}
	style:width={widthValue}
	style:height={heightValue}
	role="presentation"
	onpointerenter={handlePointerEnter}
	onpointermove={handlePointerMove}
	onpointerleave={handlePointerLeave}
	onpointerdown={handleForceHold}
	onpointerup={handleForceRelease}
	onpointercancel={handleForceRelease}
	{@attach parallaxAttach(disabled)}
>
	<div
		class="pointer-events-none absolute inset-0 z-10"
		style:mix-blend-mode="screen"
		{@attach spotlightAttach()}
	></div>
	<div
		class="relative z-0"
		{@attach contentOverlayAttach()}
	>
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>
