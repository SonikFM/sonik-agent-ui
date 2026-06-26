/**
 * Shared component types ported from the React Amplify design system
 * (SonikFM/amplify src/design-system/types.ts), translated to be
 * Svelte-native (no React imports, no JSX dependency).
 */

import type {
	bgColors,
	brandColors,
	componentColors,
	componentLayouts,
	componentPositions,
	componentShapes,
	componentSizes,
	componentStatuses,
	componentVariants,
} from "./constants.js";

export type DataTheme = "light" | "dark" | (string & {});

export interface IComponentBaseProps {
	dataTheme?: DataTheme;
	/** Extra class names to merge onto the root element. */
	class?: string;
}

export type ComponentColor = (typeof componentColors)[number];
export type ComponentLayout = (typeof componentLayouts)[number];
export type ComponentPosition = (typeof componentPositions)[number];
export type ComponentShape = (typeof componentShapes)[number];
export type ComponentSize = (typeof componentSizes)[number];
export type ComponentStatus = (typeof componentStatuses)[number];
export type ComponentVariant = (typeof componentVariants)[number];
export type ComponentBrandColors = (typeof brandColors)[number];
export type ComponentBgColors = (typeof bgColors)[number];

export type ListOrItem<T> = T[] | T | Array<T | T[]>;
