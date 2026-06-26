/**
 * Single source of truth for document `data-theme` IDs and Storybook toolbar.
 * Custom CSS themes live under `./custom/*.css`; built-ins come from DaisyUI.
 */

/** DaisyUI built-in theme names (bundled when `themes: all` in daisy.css). */
export const DAISY_BUILTIN_THEME_IDS = [
	"light",
	"dark",
	"cupcake",
	"bumblebee",
	"emerald",
	"corporate",
	"synthwave",
	"retro",
	"cyberpunk",
	"valentine",
	"halloween",
	"garden",
	"forest",
	"aqua",
	"lofi",
	"pastel",
	"fantasy",
	"wireframe",
	"black",
	"luxury",
	"dracula",
	"cmyk",
	"autumn",
	"business",
	"acid",
	"lemonade",
	"night",
	"coffee",
	"winter",
	"dim",
	"nord",
	"sunset",
] as const;

/** Registered via `@plugin "daisyui/theme"` in `custom/*.css`. */
export const CUSTOM_DOCUMENT_THEME_IDS = [
	"gunmetal-dark",
	"gunmetal-light",
	"light",
	"amplify-dark",
	"neumorphic-dark",
	"neumorphic-light",
] as const;

export type DaisyBuiltinThemeId = (typeof DAISY_BUILTIN_THEME_IDS)[number];
export type CustomDocumentThemeId = (typeof CUSTOM_DOCUMENT_THEME_IDS)[number];
export type DocumentThemeId = DaisyBuiltinThemeId | CustomDocumentThemeId;
export type ThemeColorScheme = "light" | "dark";
export type ThemeSource = "custom" | "daisyui";
export type ThemeGroupId = "product" | "experimental" | "other";

export interface DocumentThemeGroup {
	id: ThemeGroupId;
	title: "Product" | "Experimental" | "Other themes";
	description: string;
}

export interface DocumentThemeOption {
	id: DocumentThemeId;
	title: string;
	group: ThemeGroupId;
	source: ThemeSource;
	colorScheme: ThemeColorScheme;
	description: string;
	isDefault?: boolean;
}

/** Default `<html data-theme>` — matches gunmetal-dark.css default. */
export const DEFAULT_DOCUMENT_THEME_ID: CustomDocumentThemeId = "gunmetal-dark";

export const THEME_GROUPS = [
	{
		id: "product",
		title: "Product",
		description: "Amplify-maintained themes for the production app shell.",
	},
	{
		id: "experimental",
		title: "Experimental",
		description:
			"Token-disciplined visual explorations, including neumorphism.",
	},
	{
		id: "other",
		title: "Other themes",
		description: "Bundled DaisyUI themes exposed for fast comparison.",
	},
] as const satisfies readonly DocumentThemeGroup[];

/** CSS variables tunable at runtime (e.g. Leva) — see font-variables.css */
export const APP_FONT_CSS_VARIABLES = [
	"--app-font-sans",
	"--app-font-display",
	"--app-font-mono",
] as const;

/**
 * Daisy themes that skew light UI (for `data-color-scheme` / Storybook).
 * Others default to dark.
 */
const DAISY_LIGHT_DOCUMENT_THEMES = new Set<string>([
	"light",
	"cupcake",
	"bumblebee",
	"emerald",
	"corporate",
	"retro",
	"cyberpunk",
	"valentine",
	"garden",
	"forest",
	"aqua",
	"lofi",
	"pastel",
	"fantasy",
	"wireframe",
	"cmyk",
	"autumn",
	"business",
	"acid",
	"lemonade",
	"winter",
]);

const CUSTOM_THEME_OPTIONS = [
	{
		id: "gunmetal-dark",
		title: "Gunmetal Dark",
		group: "product",
		source: "custom",
		colorScheme: "dark",
		description: "Default dark app theme with cool steel surfaces.",
		isDefault: true,
	},
	{
		id: "gunmetal-light",
		title: "Gunmetal Light",
		group: "product",
		source: "custom",
		colorScheme: "light",
		description: "Light companion for the gunmetal product palette.",
	},
	{
		id: "light",
		title: "Light (Sonik)",
		group: "product",
		source: "custom",
		colorScheme: "light",
		description: "Amplify’s current semantic light theme override.",
	},
	{
		id: "amplify-dark",
		title: "Amplify Dark",
		group: "product",
		source: "custom",
		colorScheme: "dark",
		description: "Legacy Amplify dark theme retained for comparison.",
	},
	{
		id: "neumorphic-dark",
		title: "Neumorphic Dark",
		group: "experimental",
		source: "custom",
		colorScheme: "dark",
		description: "Dark tactile theme with scoped OKLCH neumorphic tokens.",
	},
	{
		id: "neumorphic-light",
		title: "Neumorphic Light",
		group: "experimental",
		source: "custom",
		colorScheme: "light",
		description: "Light tactile theme with scoped OKLCH neumorphic tokens.",
	},
] as const satisfies readonly DocumentThemeOption[];

const CUSTOM_THEME_ID_SET = new Set<string>(CUSTOM_DOCUMENT_THEME_IDS);

function titleCaseTheme(id: string): string {
	return id
		.split(/[-_]/)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

const DAISY_THEME_OPTIONS = DAISY_BUILTIN_THEME_IDS.filter(
	(id) => !CUSTOM_THEME_ID_SET.has(id),
).map(
	(id): DocumentThemeOption => ({
		id,
		title: titleCaseTheme(id),
		group: "other",
		source: "daisyui",
		colorScheme: DAISY_LIGHT_DOCUMENT_THEMES.has(id) ? "light" : "dark",
		description: "Bundled DaisyUI theme exposed for comparison.",
	}),
);

export const DOCUMENT_THEME_OPTIONS: readonly DocumentThemeOption[] = [
	...CUSTOM_THEME_OPTIONS,
	...DAISY_THEME_OPTIONS,
];

const DOCUMENT_THEME_ID_SET = new Set<string>(
	DOCUMENT_THEME_OPTIONS.map((option) => option.id),
);
const DOCUMENT_THEME_OPTION_BY_ID = new Map<string, DocumentThemeOption>(
	DOCUMENT_THEME_OPTIONS.map((option) => [option.id, option]),
);

export function isDocumentThemeId(value: string): value is DocumentThemeId {
	return DOCUMENT_THEME_ID_SET.has(value);
}

export function getDocumentThemeOption(
	themeId: string,
): DocumentThemeOption | undefined {
	return DOCUMENT_THEME_OPTION_BY_ID.get(themeId);
}

export function getDocumentThemeOptionsByGroup() {
	return THEME_GROUPS.map((group) => ({
		...group,
		options: DOCUMENT_THEME_OPTIONS.filter(
			(option) => option.group === group.id,
		),
	}));
}

export function documentColorSchemeForTheme(themeId: string): ThemeColorScheme {
	return getDocumentThemeOption(themeId)?.colorScheme ?? "dark";
}

export interface StorybookThemeToolbarItem {
	value: string;
	title: string;
}

/** Toolbar: product themes, experimental themes, then DaisyUI built-ins. */
export function buildStorybookThemeToolbarItems(): StorybookThemeToolbarItem[] {
	return DOCUMENT_THEME_OPTIONS.map((option) => ({
		value: option.id,
		title: `${
			THEME_GROUPS.find((group) => group.id === option.group)?.title ?? "Theme"
		} / ${option.title}`,
	}));
}
