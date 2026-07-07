/**
 * Edge & node color tokens.
 * All colors reference CSS custom properties declared in theme/flow-tokens.css.
 * Zero hardcoded hex values — your global theme owns the palette.
 */

import type { EdgeStatus } from "../../types/edges";

// --- Primary flow edge colors (status-driven) ---
export const STATUS_COLORS: Record<EdgeStatus, string> = {
	idle: "var(--flow-edge-idle)",
	active: "var(--flow-edge-active)",
	error: "var(--flow-edge-error)",
	blocked: "var(--flow-edge-blocked)",
};

// --- Conditional branch colors ---
export const BRANCH_COLORS: Record<string, string> = {
	true: "var(--flow-branch-true)",
	false: "var(--flow-branch-false)",
	"variant-a": "var(--flow-branch-a)",
	"variant-b": "var(--flow-branch-b)",
	"variant-c": "var(--flow-branch-c)",
};

// --- Sub-connection accent colors ---
export const SUB_CONNECTION_ACCENTS: Record<string, string> = {
	"logic-hook": "var(--flow-accent-logic)",
	"event-trigger": "var(--flow-accent-event)",
	"ai-action": "var(--flow-accent-ai)",
	"conditional-branch": "var(--flow-accent-conditional)",
};

// --- Node accent CSS class lookup ---
// Used by NodeChip to apply accent via className instead of inline style
export const NODE_ACCENT_CLASSES: Record<string, string> = {
	channel: "flow-accent-channel",
	logic: "flow-accent-logic",
	event: "flow-accent-event",
	"ai-action": "flow-accent-ai",
	conditional: "flow-accent-conditional",
};
