export type CampaignFlowTokenGroupId =
	| "canvas"
	| "nodes"
	| "handles"
	| "providers"
	| "shell"
	| "motion";

export interface CampaignFlowTokenGroup {
	id: CampaignFlowTokenGroupId;
	label: string;
	description: string;
}

export interface CampaignFlowTokenDefinition {
	group: CampaignFlowTokenGroupId;
	name: `--flow-${string}`;
	label: string;
	value: string;
	description: string;
}

export type CampaignFlowCssVariable = CampaignFlowTokenDefinition["name"];

export const CAMPAIGN_FLOW_TOKEN_SCOPE_SELECTOR =
	'[data-surface="campaign-wizard"], .campaign-flow-token-scope';

export const CAMPAIGN_FLOW_TOKEN_GROUPS = [
	{
		id: "canvas",
		label: "Canvas",
		description: "Board, grid, selection, minimap, controls, and hints.",
	},
	{
		id: "nodes",
		label: "Nodes",
		description:
			"Card dimensions, previews, chips, status, borders, and rings.",
	},
	{
		id: "handles",
		label: "Handles + edges",
		description: "Connector size, edge width, labels, states, and branches.",
	},
	{
		id: "providers",
		label: "Provider accents",
		description: "Channel colors for real campaign/workflow semantics.",
	},
	{
		id: "shell",
		label: "Shell + panels",
		description:
			"Wizard shell, toolbar, palette, inspector, and drawer opinions.",
	},
	{
		id: "motion",
		label: "Motion + depth",
		description: "Spotlight, parallax, and safe depth tuning knobs.",
	},
] as const satisfies readonly CampaignFlowTokenGroup[];

export const CAMPAIGN_FLOW_TOKEN_DEFINITIONS = [
	{
		group: "handles",
		name: "--flow-edge-idle",
		label: "Edge idle",
		value: "oklch(var(--bc) / 0.3)",
		description: "Default execution edge color.",
	},
	{
		group: "handles",
		name: "--flow-edge-active",
		label: "Edge active",
		value: "oklch(var(--su))",
		description: "Active/success execution edge color.",
	},
	{
		group: "handles",
		name: "--flow-edge-error",
		label: "Edge error",
		value: "oklch(var(--er))",
		description: "Failed/error execution edge color.",
	},
	{
		group: "handles",
		name: "--flow-edge-blocked",
		label: "Edge blocked",
		value: "oklch(var(--wa))",
		description: "Blocked/warning execution edge color.",
	},
	{
		group: "handles",
		name: "--flow-branch-true",
		label: "Branch true",
		value: "oklch(0.723 0.191 142.5)",
		description: "True branch connector color.",
	},
	{
		group: "handles",
		name: "--flow-branch-false",
		label: "Branch false",
		value: "oklch(0.637 0.237 25.3)",
		description: "False branch connector color.",
	},
	{
		group: "handles",
		name: "--flow-branch-a",
		label: "Branch A",
		value: "oklch(0.623 0.214 259.1)",
		description: "A/B/AI alternate branch color A.",
	},
	{
		group: "handles",
		name: "--flow-branch-b",
		label: "Branch B",
		value: "oklch(0.702 0.183 55.1)",
		description: "A/B/AI alternate branch color B.",
	},
	{
		group: "handles",
		name: "--flow-branch-c",
		label: "Branch C",
		value: "oklch(0.627 0.208 292.7)",
		description: "A/B/AI alternate branch color C.",
	},
	{
		group: "nodes",
		name: "--flow-accent-logic",
		label: "Logic accent",
		value: "oklch(0.627 0.208 292.7)",
		description: "Logic node/chip accent color.",
	},
	{
		group: "nodes",
		name: "--flow-accent-event",
		label: "Event accent",
		value: "oklch(0.769 0.188 70.1)",
		description: "Event node/chip accent color.",
	},
	{
		group: "nodes",
		name: "--flow-accent-ai",
		label: "AI accent",
		value: "oklch(0.704 0.14 181.8)",
		description: "AI action node/chip accent color.",
	},
	{
		group: "nodes",
		name: "--flow-accent-conditional",
		label: "Conditional accent",
		value: "oklch(0.551 0.027 264.4)",
		description: "Conditional/neutral node accent color.",
	},
	{
		group: "nodes",
		name: "--flow-accent-channel",
		label: "Channel accent",
		value: "oklch(var(--p))",
		description: "Channel node/chip fallback accent color.",
	},
	{
		group: "nodes",
		name: "--flow-accent-ads",
		label: "Ads accent",
		value: "oklch(0.611 0.179 259.1)",
		description: "Paid ads palette accent color.",
	},
	{
		group: "providers",
		name: "--flow-provider-whatsapp",
		label: "WhatsApp",
		value: "oklch(0.723 0.191 152.6)",
		description: "WhatsApp provider accent.",
	},
	{
		group: "providers",
		name: "--flow-provider-email",
		label: "Email",
		value: "oklch(0.611 0.143 254.6)",
		description: "Email provider accent.",
	},
	{
		group: "providers",
		name: "--flow-provider-sms",
		label: "SMS",
		value: "oklch(0.668 0.19 41.6)",
		description: "SMS provider accent.",
	},
	{
		group: "providers",
		name: "--flow-provider-tiktok",
		label: "TikTok",
		value: "oklch(0.269 0 0)",
		description: "TikTok provider accent.",
	},
	{
		group: "providers",
		name: "--flow-provider-google-ads",
		label: "Google Ads",
		value: "oklch(0.611 0.179 259.1)",
		description: "Google Ads provider accent.",
	},
	{
		group: "providers",
		name: "--flow-provider-meta-ads",
		label: "Meta Ads",
		value: "oklch(0.611 0.143 254.6)",
		description: "Meta Ads provider accent.",
	},
	{
		group: "providers",
		name: "--flow-provider-tiktok-ads",
		label: "TikTok Ads",
		value: "oklch(0.269 0 0)",
		description: "TikTok Ads provider accent.",
	},
	{
		group: "providers",
		name: "--flow-provider-instagram",
		label: "Instagram",
		value: "oklch(0.637 0.237 340.5)",
		description: "Instagram provider accent.",
	},
	{
		group: "providers",
		name: "--flow-provider-default",
		label: "Default provider",
		value: "oklch(0.551 0.027 264.4)",
		description: "Fallback provider accent.",
	},
	{
		group: "motion",
		name: "--flow-spotlight-highlight",
		label: "Spotlight highlight",
		value: "oklch(1 0 0 / 0.08)",
		description: "DepthCard cursor spotlight gradient stop.",
	},
	{
		group: "motion",
		name: "--flow-motion-spotlight-strength",
		label: "Spotlight strength",
		value: "0.08",
		description:
			"Documented numeric strength for future generated spotlight colors.",
	},
	{
		group: "motion",
		name: "--flow-depth-card-rotate",
		label: "Depth rotate",
		value: "12",
		description: "DepthCard parallax rotation intensity.",
	},
	{
		group: "motion",
		name: "--flow-depth-card-translate",
		label: "Depth translate",
		value: "4",
		description: "DepthCard parallax translation intensity.",
	},
	{
		group: "motion",
		name: "--flow-depth-card-glow",
		label: "Depth glow",
		value: "0 18px 45px oklch(0 0 0 / 0.22)",
		description: "Hover shadow used by depth cards.",
	},
	{
		group: "nodes",
		name: "--flow-chip-bg",
		label: "Chip background",
		value: "oklch(var(--b1))",
		description: "Compact logic/event/AI chip background.",
	},
	{
		group: "nodes",
		name: "--flow-chip-text",
		label: "Chip text",
		value: "oklch(var(--bc))",
		description: "Compact chip text color.",
	},
	{
		group: "nodes",
		name: "--flow-chip-border-width",
		label: "Chip border width",
		value: "2px",
		description: "Compact chip border width.",
	},
	{
		group: "nodes",
		name: "--flow-chip-radius",
		label: "Chip radius",
		value: "0.5rem",
		description: "Compact chip border radius.",
	},
	{
		group: "nodes",
		name: "--flow-chip-shadow",
		label: "Chip shadow",
		value: "0 1px 2px oklch(0 0 0 / 0.05)",
		description: "Compact chip shadow.",
	},
	{
		group: "nodes",
		name: "--flow-node-card-width",
		label: "Channel card width",
		value: "282px",
		description: "Default channel/card width.",
	},
	{
		group: "nodes",
		name: "--flow-node-preview-height",
		label: "Preview height",
		value: "6rem",
		description: "Channel preview media/fallback height.",
	},
	{
		group: "nodes",
		name: "--flow-node-border",
		label: "Node border",
		value: "oklch(var(--bc) / 0.12)",
		description: "Shared node/card border color.",
	},
	{
		group: "nodes",
		name: "--flow-node-selected-ring",
		label: "Selected node ring",
		value: "0 0 0 3px oklch(var(--p) / 0.22)",
		description: "Selected/hover ring used for important node affordances.",
	},
	{
		group: "nodes",
		name: "--flow-node-status-opacity",
		label: "Status badge opacity",
		value: "0.2",
		description: "Documented status badge background alpha.",
	},
	{
		group: "canvas",
		name: "--flow-canvas-bg",
		label: "Canvas background",
		value: "oklch(var(--b2))",
		description: "Main board background.",
	},
	{
		group: "canvas",
		name: "--flow-canvas-grid",
		label: "Grid dots",
		value: "oklch(var(--bc) / 0.08)",
		description: "Background dot/grid color.",
	},
	{
		group: "canvas",
		name: "--flow-selection-ring",
		label: "Selection ring",
		value: "oklch(var(--p) / 0.4)",
		description: "Selection rectangle stroke.",
	},
	{
		group: "canvas",
		name: "--flow-selection-bg",
		label: "Selection fill",
		value: "oklch(var(--p) / 0.08)",
		description: "Selection rectangle fill.",
	},
	{
		group: "canvas",
		name: "--flow-minimap-bg",
		label: "Minimap background",
		value: "oklch(var(--b1) / 0.92)",
		description: "Minimap panel background.",
	},
	{
		group: "canvas",
		name: "--flow-minimap-border",
		label: "Minimap border",
		value: "oklch(var(--bc) / 0.12)",
		description: "Minimap panel border.",
	},
	{
		group: "canvas",
		name: "--flow-minimap-shadow",
		label: "Minimap shadow",
		value: "0 4px 16px oklch(0 0 0 / 0.18)",
		description: "Minimap panel shadow.",
	},
	{
		group: "canvas",
		name: "--flow-minimap-radius",
		label: "Minimap radius",
		value: "0.5rem",
		description: "Minimap panel radius.",
	},
	{
		group: "canvas",
		name: "--flow-controls-bg",
		label: "Controls background",
		value: "oklch(var(--b1) / 0.92)",
		description: "Svelte Flow control cluster background.",
	},
	{
		group: "canvas",
		name: "--flow-controls-border",
		label: "Controls border",
		value: "oklch(var(--bc) / 0.12)",
		description: "Svelte Flow control cluster border.",
	},
	{
		group: "canvas",
		name: "--flow-controls-radius",
		label: "Controls radius",
		value: "0.85rem",
		description: "Svelte Flow control cluster radius.",
	},
	{
		group: "canvas",
		name: "--flow-controls-shadow",
		label: "Controls shadow",
		value: "0 10px 30px oklch(0 0 0 / 0.16)",
		description: "Svelte Flow control cluster shadow.",
	},
	{
		group: "canvas",
		name: "--flow-control-size",
		label: "Control button size",
		value: "34px",
		description: "Svelte Flow control button square size.",
	},
	{
		group: "canvas",
		name: "--flow-canvas-hint-bg",
		label: "Hint background",
		value: "oklch(var(--b1) / 0.86)",
		description: "Top-right canvas hint background.",
	},
	{
		group: "canvas",
		name: "--flow-canvas-hint-border",
		label: "Hint border",
		value: "oklch(var(--bc) / 0.1)",
		description: "Top-right canvas hint border.",
	},
	{
		group: "canvas",
		name: "--flow-canvas-hint-radius",
		label: "Hint radius",
		value: "999px",
		description: "Top-right canvas hint radius.",
	},
	{
		group: "canvas",
		name: "--flow-canvas-hint-text",
		label: "Hint text",
		value: "oklch(var(--bc) / 0.56)",
		description: "Top-right canvas hint text color.",
	},
	{
		group: "canvas",
		name: "--flow-canvas-hint-shadow",
		label: "Hint shadow",
		value: "0 10px 30px oklch(0 0 0 / 0.12)",
		description: "Top-right canvas hint shadow.",
	},
	{
		group: "canvas",
		name: "--flow-canvas-hint-dot",
		label: "Hint dot",
		value: "oklch(var(--bc) / 0.28)",
		description: "Top-right canvas hint separator dot.",
	},
	{
		group: "handles",
		name: "--flow-handle-size",
		label: "Handle size",
		value: "9px",
		description: "Connector handle diameter.",
	},
	{
		group: "handles",
		name: "--flow-handle-border-width",
		label: "Handle border width",
		value: "1.5px",
		description: "Connector handle border width.",
	},
	{
		group: "handles",
		name: "--flow-handle-hover-scale",
		label: "Handle hover scale",
		value: "1.2",
		description: "Connector handle hover scale.",
	},
	{
		group: "handles",
		name: "--flow-handle-hover-ring",
		label: "Handle hover ring",
		value: "0 0 0 3px oklch(var(--p) / 0.22)",
		description: "Connector handle hover ring.",
	},
	{
		group: "handles",
		name: "--flow-edge-stroke-width",
		label: "Edge stroke width",
		value: "1.65px",
		description: "Default connector edge stroke width.",
	},
	{
		group: "handles",
		name: "--flow-edge-selected-stroke-width",
		label: "Selected edge stroke",
		value: "2.25px",
		description: "Selected connector edge stroke width.",
	},
	{
		group: "handles",
		name: "--flow-edge-selected-glow",
		label: "Selected edge glow",
		value: "drop-shadow(0 0 8px oklch(var(--p) / 0.22))",
		description: "Selected connector edge filter.",
	},
	{
		group: "handles",
		name: "--flow-edge-label-bg",
		label: "Edge label background",
		value: "oklch(var(--b1) / 0.88)",
		description: "Shared label background fallback.",
	},
	{
		group: "handles",
		name: "--flow-edge-label-radius",
		label: "Edge label radius",
		value: "999px",
		description: "Shared label radius fallback.",
	},
	{
		group: "shell",
		name: "--flow-shell-panel-radius",
		label: "Panel radius",
		value: "1rem",
		description: "Wizard shell/palette panel radius.",
	},
	{
		group: "shell",
		name: "--flow-shell-panel-border",
		label: "Panel border",
		value: "oklch(var(--bc) / 0.12)",
		description: "Wizard shell/palette panel border color.",
	},
	{
		group: "shell",
		name: "--flow-shell-panel-bg",
		label: "Panel background",
		value: "oklch(var(--b1))",
		description: "Wizard shell/palette panel background.",
	},
	{
		group: "shell",
		name: "--flow-shell-panel-elevated-bg",
		label: "Panel header background",
		value: "oklch(var(--b2) / 0.6)",
		description: "Wizard shell elevated/header panel background.",
	},
	{
		group: "shell",
		name: "--flow-shell-toolbar-gap",
		label: "Toolbar gap",
		value: "0.5rem",
		description: "Toolbar action cluster gap.",
	},
	{
		group: "shell",
		name: "--flow-shell-palette-width",
		label: "Palette width",
		value: "16rem",
		description: "Expanded node palette width.",
	},
	{
		group: "shell",
		name: "--flow-shell-palette-density",
		label: "Palette density",
		value: "0.5rem",
		description: "Palette list padding/density token.",
	},
	{
		group: "shell",
		name: "--flow-shell-drawer-width",
		label: "Drawer width",
		value: "720px",
		description:
			"Documented default drawer width token; React prop owns layout.",
	},
] as const satisfies readonly CampaignFlowTokenDefinition[];

export const CAMPAIGN_FLOW_TOKEN_DEFAULTS = Object.fromEntries(
	CAMPAIGN_FLOW_TOKEN_DEFINITIONS.map((token) => [token.name, token.value]),
) as Record<CampaignFlowCssVariable, string>;

export function getCampaignFlowTokenDefinitionsByGroup(
	groupId: CampaignFlowTokenGroupId,
): CampaignFlowTokenDefinition[] {
	return CAMPAIGN_FLOW_TOKEN_DEFINITIONS.filter(
		(token) => token.group === groupId,
	);
}

export function buildCampaignFlowTokenStyle(
	overrides: Partial<Record<CampaignFlowCssVariable, string>> = {},
): Record<CampaignFlowCssVariable, string> {
	const style: Record<CampaignFlowCssVariable, string> = {
		...CAMPAIGN_FLOW_TOKEN_DEFAULTS,
	};
	for (const token of CAMPAIGN_FLOW_TOKEN_DEFINITIONS) {
		const value = overrides[token.name];
		if (typeof value === "string") {
			style[token.name] = value;
		}
	}
	return style;
}
