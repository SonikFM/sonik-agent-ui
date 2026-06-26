/**
 * Shared utilities for the Svelte design system.
 *
 * The React Amplify `utils.ts` depends on React primitives
 * (cloneElement, Fragment, isValidElement) which do not translate to
 * Svelte. The Svelte equivalent surface is intentionally smaller:
 *
 * - `cn()` merges class names and resolves Tailwind conflicts, matching
 *   the `clsx + twMerge` pattern used in the React codebase.
 * - `toTitleCase()` is ported verbatim since it's framework-agnostic.
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names with clsx and resolve Tailwind class conflicts via
 * tailwind-merge. The canonical helper for the whole design system.
 */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/**
 * Convert an arbitrary string to Title Case.
 * Ported verbatim from the React Amplify `utils.ts`.
 */
export function toTitleCase(str: string): string {
	return str
		.toLowerCase()
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}
