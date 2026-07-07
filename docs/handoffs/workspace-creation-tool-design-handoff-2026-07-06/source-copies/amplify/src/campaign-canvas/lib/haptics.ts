/**
 * Named preset for vibration timing; each maps to a built-in millisecond pattern.
 */
type HapticPattern = "snap" | "select" | "modal" | "error" | "success";

const VIBRATION_PATTERNS: Record<HapticPattern, number[]> = {
	snap: [8],
	select: [12],
	modal: [15, 30, 10],
	error: [20, 50, 20, 50, 20],
	success: [10, 20, 15],
};

let hapticIntensity = 1.0;
let visualFallbackEnabled = true;

function supportsVibration(): boolean {
	return (
		typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
	);
}

function createVisualPulse(element: HTMLElement | null): void {
	if (!element || !visualFallbackEnabled) return;

	element.style.transition = "transform 80ms ease-out";
	element.style.transform = "scale(0.97)";
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			element.style.transform = "scale(1)";
		});
	});
}

/**
 * Triggers vibration for the given pattern, scaled by {@link getHapticIntensity}.
 * When vibration is unavailable, optionally runs a brief visual pulse on `element`.
 *
 * @param pattern - Which preset pattern to play.
 * @param element - Target for visual fallback when `navigator.vibrate` is missing.
 */
export function haptic(
	pattern: HapticPattern,
	element?: HTMLElement | null,
): void {
	if (hapticIntensity <= 0) return;

	if (supportsVibration()) {
		const vibrationPattern = VIBRATION_PATTERNS[pattern].map((ms) =>
			Math.round(ms * hapticIntensity),
		);
		navigator.vibrate(vibrationPattern);
	} else {
		createVisualPulse(element ?? null);
	}
}

/**
 * Sets the global scale applied to vibration durations (0 disables haptics).
 *
 * @param intensity - Clamped to the inclusive range 0–1.
 */
export function setHapticIntensity(intensity: number): void {
	hapticIntensity = Math.max(0, Math.min(1, intensity));
}

/**
 * Enables or disables the scale pulse used when hardware vibration is unsupported.
 *
 * @param enabled - When false, non-vibrating environments get no visual feedback.
 */
export function setVisualFallback(enabled: boolean): void {
	visualFallbackEnabled = enabled;
}

/**
 * @returns Current haptic intensity multiplier (0–1).
 */
export function getHapticIntensity(): number {
	return hapticIntensity;
}
