<script lang="ts" module>
/**
 * Discriminated target descriptor for the flow context menu.
 *
 * The host (`CampaignCanvas.svelte`) decides which target kind the menu
 * is opened against based on which xyflow context-menu callback fired
 * (`onnodecontextmenu`, `onedgecontextmenu`, `onpanecontextmenu`).
 */
export type FlowContextMenuTarget =
	| { kind: "node"; nodeId: string }
	| { kind: "edge"; edgeId: string }
	| { kind: "canvas" };
</script>

<script lang="ts">
import type { FlowPosition } from "@/design-system/patterns/CampaignFlow/types/flow";
import { canvasState } from "../stores/canvas-store.svelte";

/**
 * Props for the flow canvas right-click menu.
 *
 * State-owning actions (delete / duplicate / disable / tidy) route
 * through `canvasState` methods directly so every mutation lands through
 * the single history pipeline in `canvas-history.svelte`.
 *
 * Higher-level actions that require host orchestration — Add Node
 * (requires palette state), Paste (requires clipboard state), Select All
 * — are exposed as optional callbacks so the React shell or the
 * containing Svelte component can wire them without forcing this
 * component to reach across layer boundaries.
 */
interface Props {
	open: boolean;
	target: FlowContextMenuTarget | null;
	/** Viewport-relative pixel position where the menu should render. */
	screenPosition: { x: number; y: number };
	/**
	 * Flow-coordinate position of the click, used when host callbacks
	 * (Add Node / Paste) need to insert content at the right-click origin.
	 * Defaults to `screenPosition` if the host cannot convert.
	 */
	flowPosition?: FlowPosition;
	onClose: () => void;
	onAddNode?: (position: FlowPosition) => void;
	onPaste?: (position: FlowPosition) => void;
	onSelectAll?: () => void;
}

const {
	open,
	target,
	screenPosition,
	flowPosition,
	onClose,
	onAddNode,
	onPaste,
	onSelectAll,
}: Props = $props();

const kind = $derived<FlowContextMenuTarget["kind"]>(target?.kind ?? "canvas");
const nodeId = $derived(target?.kind === "node" ? target.nodeId : null);
const edgeId = $derived(target?.kind === "edge" ? target.edgeId : null);

const selectedNode = $derived(
	nodeId ? (canvasState.nodes.find((n) => n.id === nodeId) ?? null) : null,
);

/**
 * A node counts as "disabled" when its data payload carries the `paused`
 * status. Only Channel nodes carry a `status` field; for logic / event /
 * ai-action nodes, the Disable toggle falls through to setting a generic
 * `disabled` boolean flag that downstream renderers can inspect.
 */
const isDisabled = $derived.by(() => {
	if (!selectedNode) return false;
	const data = selectedNode.data as Record<string, unknown>;
	if ("status" in data && data.status === "paused") return true;
	if ("disabled" in data && data.disabled === true) return true;
	return false;
});

const effectiveFlowPosition = $derived<FlowPosition>(
	flowPosition ?? { x: screenPosition.x, y: screenPosition.y },
);

function handleDelete() {
	if (nodeId) {
		canvasState.removeNode(nodeId);
	} else if (edgeId) {
		canvasState.removeEdge(edgeId);
	}
	onClose();
}

function handleDuplicate() {
	if (!nodeId) return;
	canvasState.duplicateNode(nodeId);
	onClose();
}

function handleToggleDisable() {
	if (!nodeId || !selectedNode) return;
	const data = selectedNode.data as Record<string, unknown>;
	if ("status" in data) {
		canvasState.updateNodeData(nodeId, {
			status: isDisabled ? "draft" : "paused",
		});
	} else {
		canvasState.updateNodeData(nodeId, { disabled: !isDisabled });
	}
	onClose();
}

function handleAddNode() {
	onAddNode?.(effectiveFlowPosition);
	onClose();
}

function handlePaste() {
	onPaste?.(effectiveFlowPosition);
	onClose();
}

function handleSelectAll() {
	onSelectAll?.();
	onClose();
}

function handleTidyLayout() {
	canvasState.tidyLayout();
	onClose();
}

function handleKeydown(event: KeyboardEvent) {
	if (!open) return;
	if (event.key === "Escape") {
		event.preventDefault();
		onClose();
	}
}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open && target}
	<!--
		Full-viewport capture layer — catches outside clicks and right-clicks
		to close the menu. `role="presentation"` because it is a purely
		decorative click target (real interactive controls live in the menu
		itself). `onclick` swallows left-clicks; `oncontextmenu` both
		prevents the native menu from re-opening and closes ours.
	-->
	<div
		role="presentation"
		class="fixed inset-0 z-[1000]"
		onclick={onClose}
		oncontextmenu={(event) => {
			event.preventDefault();
			onClose();
		}}
	>
		<ul
			role="menu"
			aria-label="Campaign canvas context menu"
			class="menu menu-sm absolute min-w-48 rounded-box border border-base-300 bg-base-100 p-2 text-base-content shadow-2xl backdrop-blur-sm"
			style="left: {screenPosition.x}px; top: {screenPosition.y}px;"
			onclick={(event) => event.stopPropagation()}
			onkeydown={(event) => event.stopPropagation()}
			oncontextmenu={(event) => event.stopPropagation()}
		>
			{#if kind === "node"}
				<li>
					<button type="button" onclick={handleDelete}>Delete</button>
				</li>
				<li>
					<button type="button" onclick={handleDuplicate}>Duplicate</button>
				</li>
				<li>
					<button type="button" onclick={handleToggleDisable}>
						{isDisabled ? "Enable" : "Disable"}
					</button>
				</li>
			{:else if kind === "edge"}
				<li>
					<button type="button" onclick={handleDelete}>Delete edge</button>
				</li>
			{:else}
				<li>
					<button
						type="button"
						onclick={handleAddNode}
						disabled={!onAddNode}
					>
						Add Node
					</button>
				</li>
				<li>
					<button type="button" onclick={handlePaste} disabled={!onPaste}>
						Paste
					</button>
				</li>
				<li>
					<button
						type="button"
						onclick={handleSelectAll}
						disabled={!onSelectAll}
					>
						Select All
					</button>
				</li>
				<li>
					<button type="button" onclick={handleTidyLayout}>
						Tidy Layout
					</button>
				</li>
			{/if}
		</ul>
	</div>
{/if}
