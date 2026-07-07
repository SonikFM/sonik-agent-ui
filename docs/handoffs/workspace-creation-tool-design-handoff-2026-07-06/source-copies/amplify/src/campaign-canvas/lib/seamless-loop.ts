import { gsap } from "./gsap-setup";

/**
 * Controls a horizontally tiled strip of elements with wrap-around index and GSAP motion.
 */
export interface SeamlessLoop {
	/** Advances to the next item (wraps). */
	next(): void;
	/** Moves to the previous item (wraps). */
	previous(): void;
	/**
	 * Animates to an item by index (negative indices wrap).
	 *
	 * @param index - Target item index.
	 */
	toIndex(index: number): void;
	/** @returns Zero-based index of the current item. */
	current(): number;
	/** Stops all tweens on the loop elements. */
	destroy(): void;
}

/**
 * Builds a carousel-style loop: items are positioned on the X axis and animated with GSAP.
 *
 * @param items - DOM nodes whose `x` transform is driven by the loop.
 * @param options - `spacing` between items (px), optional `speed`, `snapDuration` for GSAP tweens.
 * @returns API to step the loop, read index, and cancel tweens.
 */
export function createSeamlessLoop(
	items: HTMLElement[],
	options: {
		spacing?: number;
		speed?: number;
		snapDuration?: number;
	} = {},
): SeamlessLoop {
	const { spacing = 400, snapDuration = 0.3 } = options;
	let currentIndex = 0;

	function animateToIndex(index: number): void {
		const clamped = ((index % items.length) + items.length) % items.length;
		const offset = -clamped * spacing;

		for (let i = 0; i < items.length; i++) {
			gsap.to(items[i], {
				x: offset + i * spacing,
				duration: snapDuration,
				ease: "power2.out",
			});
		}

		currentIndex = clamped;
	}

	animateToIndex(0);

	return {
		next() {
			animateToIndex(currentIndex + 1);
		},
		previous() {
			animateToIndex(currentIndex - 1);
		},
		toIndex(index: number) {
			animateToIndex(index);
		},
		current() {
			return currentIndex;
		},
		destroy() {
			for (const item of items) {
				gsap.killTweensOf(item);
			}
		},
	};
}
