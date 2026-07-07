import type { AIActionType, EventType, LogicType } from "./nodes";

/** Semantic status for edge coloring */
export const EdgeStatus = {
	IDLE: "idle",
	ACTIVE: "active",
	ERROR: "error",
	BLOCKED: "blocked",
} as const;

export type EdgeStatus = (typeof EdgeStatus)[keyof typeof EdgeStatus];

/** Branch path identifiers for condition/AB split edges */
export const BranchType = {
	TRUE: "true",
	FALSE: "false",
	VARIANT_A: "variant-a",
	VARIANT_B: "variant-b",
	VARIANT_C: "variant-c",
} as const;

export type BranchType = (typeof BranchType)[keyof typeof BranchType];

/** Data for primary flow edges between channel nodes */
export interface FlowEdgeData {
	kind: "flow";
	status: EdgeStatus;
	label?: string;
	[key: string]: unknown;
}

/** Data for logic hook sub-connection edges */
export interface LogicHookEdgeData {
	kind: "logic-hook";
	status: EdgeStatus;
	logicType: LogicType;
	label: string;
	[key: string]: unknown;
}

/** Data for event trigger sub-connection edges */
export interface EventTriggerEdgeData {
	kind: "event-trigger";
	status: EdgeStatus;
	eventType: EventType;
	label: string;
	[key: string]: unknown;
}

/** Data for AI action sub-connection edges */
export interface AIActionEdgeData {
	kind: "ai-action";
	status: EdgeStatus;
	aiType: AIActionType;
	label: string;
	[key: string]: unknown;
}

/** Data for conditional branch output edges */
export interface ConditionalBranchEdgeData {
	kind: "conditional-branch";
	status: EdgeStatus;
	branch: BranchType;
	label: string;
	[key: string]: unknown;
}

/** Discriminated union of all edge data types. Discriminator: 'kind' field. */
export type FlowEdgeDataUnion =
	| FlowEdgeData
	| LogicHookEdgeData
	| EventTriggerEdgeData
	| AIActionEdgeData
	| ConditionalBranchEdgeData;

/** String constants matching edge type registry keys */
export const EDGE_KIND = {
	FLOW: "flow",
	LOGIC_HOOK: "logic-hook",
	EVENT_TRIGGER: "event-trigger",
	AI_ACTION: "ai-action",
	CONDITIONAL_BRANCH: "conditional-branch",
} as const;

/** All edge kinds that are sub-connections (not primary flow) */
export const SUB_CONNECTION_KINDS = [
	EDGE_KIND.LOGIC_HOOK,
	EDGE_KIND.EVENT_TRIGGER,
	EDGE_KIND.AI_ACTION,
	EDGE_KIND.CONDITIONAL_BRANCH,
] as const;

export type SubConnectionKind = (typeof SUB_CONNECTION_KINDS)[number];
