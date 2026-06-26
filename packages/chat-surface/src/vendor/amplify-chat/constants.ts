/**
 * Component constants ported from the React Amplify design system
 * (SonikFM/amplify src/design-system/constants.ts).
 *
 * Names, values, and ordering are kept identical so a developer moving
 * between amplify-react and amplify-svelte sees the same surface.
 */

export const componentLayouts = ["vertical", "horizontal"] as const;

export const componentPositions = [
	"top",
	"bottom",
	"left",
	"right",
	"start",
	"end",
] as const;

export const componentShapes = ["circle", "square"] as const;

export const componentSizes = ["xl", "lg", "md", "sm", "xs"] as const;

export const componentStatuses = [
	"info",
	"success",
	"warning",
	"error",
] as const;

export const componentVariants = ["soft", "dash", "outline"] as const;

export const brandColors = [
	"neutral",
	"primary",
	"secondary",
	"accent",
] as const;

export const componentColors = [
	...brandColors,
	"ghost",
	...componentStatuses,
] as const;

export const bgColors = [
	"base-100",
	"base-200",
	"base-300",
	"neutral",
] as const;

export const defaultTheme = "dark";
