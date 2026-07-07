<script lang="ts">
import Icon from "@iconify/svelte";
import { Handle, Position } from "@xyflow/svelte";
import type { Attachment } from "svelte/attachments";
import type {
	ChannelNodeData,
	FlowNodeData,
} from "@/design-system/patterns/CampaignFlow/types/nodes";
import NodeValidationBadge from "../components/NodeValidationBadge.svelte";
import { haptic } from "../lib/haptics";
import {
	loadVideo,
	observeVideoVisibility,
	pauseVideo,
	playVideo,
	unloadVideo,
} from "../lib/video-manager";
import DepthCard from "./DepthCard.svelte";
import SpotlightModal from "./SpotlightModal.svelte";

interface Props {
	id: string;
	data: FlowNodeData;
}

const { id, data }: Props = $props();

let nodeData = $derived(data as ChannelNodeData);

const PROVIDER_ICONS: Record<
	string,
	{ icon: string; label: string; cssClass: string; previewLabel: string }
> = {
	whatsapp: {
		icon: "mdi:whatsapp",
		label: "WhatsApp",
		cssClass: "flow-provider-whatsapp",
		previewLabel: "Message draft",
	},
	email: {
		icon: "mdi:email",
		label: "Email",
		cssClass: "flow-provider-email",
		previewLabel: "Subject + body",
	},
	sms: {
		icon: "mdi:cellphone-message",
		label: "SMS",
		cssClass: "flow-provider-sms",
		previewLabel: "Text message",
	},
	tiktok: {
		icon: "ic:baseline-tiktok",
		label: "TikTok",
		cssClass: "flow-provider-tiktok",
		previewLabel: "Video post",
	},
	"google-ads": {
		icon: "mdi:google-ads",
		label: "Google Ads",
		cssClass: "flow-provider-google-ads",
		previewLabel: "Ad touchpoint",
	},
	"meta-ads": {
		icon: "simple-icons:meta",
		label: "Meta Ads",
		cssClass: "flow-provider-meta-ads",
		previewLabel: "Paid campaign draft",
	},
	"tiktok-ads": {
		icon: "ic:baseline-tiktok",
		label: "TikTok Ads",
		cssClass: "flow-provider-tiktok-ads",
		previewLabel: "Paid campaign draft",
	},
	instagram: {
		icon: "mdi:instagram",
		label: "Instagram",
		cssClass: "flow-provider-instagram",
		previewLabel: "Reel preview",
	},
};

const DEFAULT_CONFIG = {
	icon: "mdi:package-variant",
	label: "Channel",
	cssClass: "flow-provider-default",
	previewLabel: "Touchpoint draft",
};

let config = $derived(PROVIDER_ICONS[nodeData.provider] ?? DEFAULT_CONFIG);
let previewText = $derived(
	nodeData.subtitle ||
		nodeData.metricValue ||
		"Draft touchpoint ready to configure",
);
let statusClass = $derived(
	nodeData.status === "active"
		? "bg-success/20 text-success"
		: nodeData.status === "error"
			? "bg-error/20 text-error"
			: "bg-base-200 text-base-content/60",
);

let isHolding = $state(false);
let spotlightOpen = $state(false);
let spotlightRect = $state<DOMRect | null>(null);
let pointerDownTime = $state(0);
let videoContainerEl: HTMLDivElement;

function videoLifecycle(src: string | undefined): Attachment {
	return (el) => {
		if (!src) return;
		return observeVideoVisibility(id, el);
	};
}

function handlePointerDown(_e: PointerEvent) {
	pointerDownTime = Date.now();
	isHolding = true;
	haptic("select");
	if (nodeData.previewVideoUrl) {
		loadVideo(id, nodeData.previewVideoUrl, videoContainerEl);
		playVideo(id);
	}
}

function handlePointerUp(e: PointerEvent) {
	const elapsed = Date.now() - pointerDownTime;
	isHolding = false;
	pauseVideo(id);

	if (elapsed < 300) {
		e.stopPropagation(); // Only stop propagation for short-tap → spotlight
		spotlightRect = videoContainerEl?.getBoundingClientRect() ?? null;
		spotlightOpen = true;
		haptic("modal");
	}
}

function handleMouseEnter() {
	if (nodeData.previewVideoUrl && videoContainerEl) {
		loadVideo(id, nodeData.previewVideoUrl, videoContainerEl);
		playVideo(id);
	}
}

function handleMouseLeave() {
	if (!isHolding) {
		pauseVideo(id);
		unloadVideo(id);
	}
}
</script>

<div class="relative">
<NodeValidationBadge {data} />
<DepthCard width="var(--flow-node-card-width)">
	{#snippet children()}
		<Handle type="target" position={Position.Left} id="{id}-flow-in" />
		<Handle type="source" position={Position.Right} id="{id}-flow-out" />
		<Handle type="source" position={Position.Bottom} id="{id}-sub-out" />

		<div
			class={["flow-channel-node__header", config.cssClass, "flex items-center gap-2 rounded-t-xl px-3 py-1.5"]}
		>
			<Icon icon={config.icon} class="text-base" />
			<span class="flow-channel-node__label text-xs font-bold">{config.label}</span>
			<span class={["ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none", statusClass]}>
				{nodeData.statusLabel ?? nodeData.status}
			</span>
		</div>

		<div
			class="relative"
			bind:this={videoContainerEl}
			{@attach videoLifecycle(nodeData.previewVideoUrl)}
			onpointerdown={handlePointerDown}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
			onmouseenter={handleMouseEnter}
			onmouseleave={handleMouseLeave}
			role="presentation"
		>
			{#if nodeData.previewImageUrl && !isHolding}
				<img
					src={nodeData.previewImageUrl}
					alt={nodeData.title}
					class="w-full object-cover"
					style:height="var(--flow-node-preview-height)"
				/>
			{:else}
				<div
					class="flex w-full flex-col justify-between bg-base-200 px-3 py-2"
					style:height="var(--flow-node-preview-height)"
				>
					<div class="flex items-center justify-between gap-2">
						<span class="text-[10px] font-semibold uppercase tracking-[0.16em] text-base-content/45">
							{config.previewLabel}
						</span>
						<span class="size-1.5 rounded-full bg-primary/70"></span>
					</div>
					<div class="space-y-1">
						<div class="h-2 w-3/4 rounded-full bg-base-content/18"></div>
						<div class="h-2 w-1/2 rounded-full bg-base-content/12"></div>
					</div>
					<p class="line-clamp-2 text-[11px] leading-tight text-base-content/60">
						{previewText}
					</p>
				</div>
			{/if}
		</div>

		<div class="px-3 py-2">
			<p class="truncate text-xs font-semibold text-base-content">{nodeData.title}</p>
			{#if nodeData.subtitle}
				<p class="truncate text-[11px] text-base-content/60">{nodeData.subtitle}</p>
			{/if}
			{#if nodeData.metricLabel}
				<div class="mt-2 flex items-center justify-between text-xs">
					<span class="text-base-content/60">{nodeData.metricLabel}</span>
					<span class="font-mono font-semibold">{nodeData.metricValue}</span>
				</div>
			{/if}
		</div>
		<SpotlightModal
			open={spotlightOpen}
			sourceRect={spotlightRect}
			onClose={() => { spotlightOpen = false; }}
		>
			{#snippet children()}
				{#if nodeData.previewVideoUrl}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={nodeData.previewVideoUrl}
						autoplay
						loop
						playsinline
						class="w-full rounded-lg"
					></video>
				{:else if nodeData.previewImageUrl}
					<img
						src={nodeData.previewImageUrl}
						alt={nodeData.title}
						class="w-full rounded-lg"
					/>
				{:else}
					<div class="flex h-64 items-center justify-center rounded-lg bg-base-200">
						<p class="text-base-content/45">
							{config.previewLabel} will appear here when configured.
						</p>
					</div>
				{/if}
			{/snippet}
		</SpotlightModal>
	{/snippet}
</DepthCard>
</div>
