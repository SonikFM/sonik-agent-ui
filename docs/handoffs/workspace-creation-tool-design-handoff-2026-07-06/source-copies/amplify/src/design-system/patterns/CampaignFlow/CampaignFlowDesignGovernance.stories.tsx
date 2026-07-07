import { Icon } from "@iconify/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Leva, useControls } from "leva";
import type { CSSProperties } from "react";
import { useMemo } from "react";
import {
	buildCampaignFlowTokenStyle,
	CAMPAIGN_FLOW_TOKEN_GROUPS,
	type CampaignFlowCssVariable,
} from "./theme";
import "./theme/flow-tokens.css";
import {
	buildCampaignFlowControlsForGroup,
	type CampaignFlowTokenValues,
	getCampaignFlowLevaFolderName,
	mergeCampaignFlowTokenValues,
} from "./theme/campaign-flow-controls";

function CampaignFlowDesignGovernanceStory() {
	const canvasValues = useControls(
		getCampaignFlowLevaFolderName("canvas"),
		buildCampaignFlowControlsForGroup("canvas"),
	);
	const nodeValues = useControls(
		getCampaignFlowLevaFolderName("nodes"),
		buildCampaignFlowControlsForGroup("nodes"),
	);
	const handleValues = useControls(
		getCampaignFlowLevaFolderName("handles"),
		buildCampaignFlowControlsForGroup("handles"),
	);
	const providerValues = useControls(
		getCampaignFlowLevaFolderName("providers"),
		buildCampaignFlowControlsForGroup("providers"),
	);
	const shellValues = useControls(
		getCampaignFlowLevaFolderName("shell"),
		buildCampaignFlowControlsForGroup("shell"),
	);
	const motionValues = useControls(
		getCampaignFlowLevaFolderName("motion"),
		buildCampaignFlowControlsForGroup("motion"),
	);

	const tokenValues = useMemo<CampaignFlowTokenValues>(
		() =>
			mergeCampaignFlowTokenValues(
				canvasValues,
				nodeValues,
				handleValues,
				providerValues,
				shellValues,
				motionValues,
			),
		[
			canvasValues,
			nodeValues,
			handleValues,
			providerValues,
			shellValues,
			motionValues,
		],
	);
	const tokenStyle = useMemo(
		() => buildCampaignFlowTokenStyle(tokenValues),
		[tokenValues],
	);

	return (
		<div
			className="campaign-flow-token-scope min-h-screen bg-base-200 p-6 text-base-content"
			data-surface="campaign-wizard"
			style={tokenStyle as CSSProperties}
		>
			<Leva collapsed={false} titleBar={{ title: "Campaign Flow Tuning" }} />
			<div className="mx-auto flex max-w-7xl flex-col gap-4">
				<section className="campaign-wizard-panel overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
					<div className="campaign-wizard-panel__header border-b border-base-300 px-4 py-3">
						<p className="text-xs font-semibold uppercase tracking-[0.22em] text-base-content/50">
							Campaign Wizard design governance
						</p>
						<h1 className="mt-1 text-xl font-semibold">
							Leva controls scoped to the campaign flow surface
						</h1>
					</div>
					<div className="grid gap-4 p-4 xl:grid-cols-[16rem_1fr_20rem]">
						<PalettePreview />
						<CanvasPreview />
						<TokenGroupChecklist />
					</div>
				</section>
			</div>
		</div>
	);
}

function PalettePreview() {
	const entries = [
		["mdi:whatsapp", "WhatsApp", "flow-provider-whatsapp"],
		["mdi:email", "Email", "flow-provider-email"],
		["mdi:source-branch", "Condition", "flow-accent-logic"],
		["mdi:robot-outline", "AI Reply", "flow-accent-ai"],
	] as const;

	return (
		<aside className="campaign-wizard-palette flex min-h-[520px] flex-col rounded-box border border-base-300 bg-base-100 shadow-sm">
			<div className="border-b border-base-300 bg-base-200/60 px-3 py-2">
				<p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-base-content/50">
					Node palette
				</p>
				<p className="text-xs text-base-content/70">
					Scoped by shell + provider tokens
				</p>
			</div>
			<div className="campaign-wizard-palette__body flex flex-1 flex-col gap-2 overflow-y-auto p-2">
				{entries.map(([icon, label, accentClass]) => (
					<div
						key={label}
						className={`flow-node-chip ${accentClass} flex items-center gap-2 border bg-base-100 px-3 py-2`}
					>
						<Icon icon={icon} className="flow-node-chip__icon h-4 w-4" />
						<span className="text-xs font-semibold">{label}</span>
					</div>
				))}
			</div>
		</aside>
	);
}

function CanvasPreview() {
	return (
		<div className="svelte-flow relative min-h-[520px] overflow-hidden rounded-box border border-base-300 bg-[var(--flow-canvas-bg)]">
			<div
				className="absolute inset-0"
				style={{
					backgroundImage:
						"radial-gradient(var(--flow-canvas-grid) 1px, transparent 1px)",
					backgroundSize: "18px 18px",
				}}
			/>
			<div className="svelte-flow__panel flow-canvas-hint absolute right-4 top-4">
				<span>4 nodes</span>
				<span className="flow-canvas-hint__dot" />
				<span>Connect only when timing matters</span>
			</div>
			<div className="absolute left-12 top-20 flex w-[var(--flow-node-card-width)] flex-col overflow-hidden rounded-xl border bg-base-100 shadow-md depth-card">
				<div className="flow-provider-instagram flow-channel-node__header flex items-center gap-2 rounded-t-xl px-3 py-1.5">
					<Icon icon="mdi:instagram" className="text-base" />
					<span className="flow-channel-node__label text-xs font-bold">
						Instagram
					</span>
					<span className="ml-auto rounded-full bg-base-200 px-1.5 py-0.5 text-[10px]">
						draft
					</span>
				</div>
				<div
					className="flex flex-col justify-between bg-base-200 px-3 py-2"
					style={{ height: "var(--flow-node-preview-height)" }}
				>
					<span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-content/45">
						Reel preview
					</span>
					<div className="space-y-1">
						<div className="h-2 w-3/4 rounded-full bg-base-content/18" />
						<div className="h-2 w-1/2 rounded-full bg-base-content/12" />
					</div>
					<p className="text-[11px] text-base-content/60">
						Draft touchpoint ready to configure
					</p>
				</div>
			</div>
			<div className="absolute left-[24rem] top-32 flow-node-chip flow-accent-logic flex items-center gap-2 border bg-base-100 px-3 py-2">
				<Icon icon="mdi:call-split" className="flow-node-chip__icon h-5 w-5" />
				<span className="text-sm font-semibold">Condition</span>
			</div>
			<svg
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 h-full w-full"
			>
				<path
					d="M 330 190 C 390 190, 390 170, 455 170"
					fill="none"
					stroke="var(--flow-edge-active)"
					strokeWidth="var(--flow-edge-stroke-width)"
				/>
				<circle cx="330" cy="190" r="5" fill="var(--flow-provider-instagram)" />
				<circle cx="455" cy="170" r="5" fill="var(--flow-accent-logic)" />
			</svg>
			<div className="svelte-flow__controls flow-controls absolute bottom-4 left-4 flex flex-col">
				{["+", "−", "⌂"].map((label) => (
					<button key={label} type="button" aria-label={label}>
						{label}
					</button>
				))}
			</div>
			<div className="svelte-flow__minimap flow-minimap absolute bottom-4 right-4" />
		</div>
	);
}

function TokenGroupChecklist() {
	return (
		<div className="rounded-box border border-base-300 bg-base-100 p-4">
			<p className="text-xs font-semibold uppercase tracking-[0.2em] text-base-content/50">
				Governed groups
			</p>
			<ul className="mt-3 space-y-2 text-sm">
				{CAMPAIGN_FLOW_TOKEN_GROUPS.map((group) => (
					<li key={group.id} className="flex items-start gap-2">
						<span className="mt-1 size-2 rounded-full bg-primary" />
						<span>
							<span className="font-semibold">{group.label}</span>
							<span className="block text-xs text-base-content/60">
								{group.description}
							</span>
						</span>
					</li>
				))}
			</ul>
			<p className="mt-4 rounded-lg border border-base-300 bg-base-200/60 p-3 text-xs text-base-content/65">
				Changing Leva values writes CSS custom properties only inside this
				story's <code>{'data-surface="campaign-wizard"'}</code> scope.
			</p>
		</div>
	);
}

const meta = {
	title: "Flow/CampaignFlowDesignGovernance",
	component: CampaignFlowDesignGovernanceStory,
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				component:
					"Storybook-verifiable Leva surface for Campaign Wizard design tokens. " +
					"It uses the same token registry as the dev-only global Leva shell, " +
					"but applies overrides only under data-surface=campaign-wizard.",
			},
		},
	},
} satisfies Meta<typeof CampaignFlowDesignGovernanceStory>;

export default meta;

type Story = StoryObj<typeof meta>;

export const LevaGovernedSurface: Story = {};

export const HighContrastHandles: Story = {
	render: () => {
		const style = buildCampaignFlowTokenStyle({
			"--flow-handle-size": "7px",
			"--flow-edge-stroke-width": "2px",
			"--flow-edge-active": "oklch(0.78 0.18 152.6)",
			"--flow-canvas-grid": "oklch(var(--bc) / 0.14)",
		} satisfies Partial<Record<CampaignFlowCssVariable, string>>);

		return (
			<div
				className="campaign-flow-token-scope min-h-screen bg-base-200 p-6"
				data-surface="campaign-wizard"
				style={style as CSSProperties}
			>
				<CanvasPreview />
			</div>
		);
	},
};
