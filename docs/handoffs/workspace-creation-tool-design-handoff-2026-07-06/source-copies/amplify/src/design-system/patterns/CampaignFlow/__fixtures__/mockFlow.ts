import { EdgeStatus } from "../types/edges";
import type { FlowEdge, FlowNode } from "../types/flow";
import {
	AIActionType,
	ChannelProvider,
	EventType,
	LogicType,
	NodeStatus,
} from "../types/nodes";

export const mockNodes: FlowNode[] = [
	// --- Channel nodes (primary flow) ---
	{
		id: "channel-1",
		type: "channel",
		position: { x: 100, y: 100 },
		data: {
			kind: "channel",
			provider: ChannelProvider.WHATSAPP,
			title: "Welcome Message",
			status: NodeStatus.ACTIVE,
			subtitle: "Triggered on signup",
			metricLabel: "Delivered",
			metricValue: "12,450",
		},
	},
	{
		id: "channel-2",
		type: "channel",
		position: { x: 500, y: 100 },
		data: {
			kind: "channel",
			provider: ChannelProvider.EMAIL,
			title: "Follow-up Email",
			status: NodeStatus.SCHEDULED,
			subtitle: "Onboarding sequence #2",
		},
	},
	// --- Sub-connection children of channel-1 ---
	{
		id: "logic-1",
		type: "logic",
		position: { x: 50, y: 300 },
		data: {
			kind: "logic",
			logicType: LogicType.CONDITION,
			label: "Opened within 24h?",
			config: { field: "last_open", operator: "gt", value: "24h" },
		},
	},
	{
		id: "event-1",
		type: "event",
		position: { x: 200, y: 300 },
		data: {
			kind: "event",
			eventType: EventType.ON_CLICK,
			label: "Link Clicked",
		},
	},
	{
		id: "ai-1",
		type: "ai-action",
		position: { x: 350, y: 300 },
		data: {
			kind: "ai-action",
			aiType: AIActionType.PERSONALIZE,
			label: "Personalize greeting",
			modelId: "gpt-4o-mini",
			confidence: 87,
		},
	},
	// --- Branch targets from logic-1 condition ---
	{
		id: "channel-3",
		type: "channel",
		position: { x: 0, y: 500 },
		data: {
			kind: "channel",
			provider: ChannelProvider.SMS,
			title: "Re-engage SMS",
			status: NodeStatus.DRAFT,
		},
	},
];

export const mockEdges: FlowEdge[] = [
	// Primary flow: channel-1 → channel-2
	{
		id: "e-flow-1-2",
		source: "channel-1",
		target: "channel-2",
		sourceHandle: "channel-1-flow-out",
		targetHandle: "channel-2-flow-in",
		type: "flow",
		data: { kind: "flow", status: EdgeStatus.ACTIVE, label: "Next step" },
	},
	// Sub-connection: channel-1 → logic-1 (logic-hook)
	{
		id: "e-logic-1",
		source: "channel-1",
		target: "logic-1",
		sourceHandle: "channel-1-sub-out",
		targetHandle: "logic-1-in",
		type: "logic-hook",
		data: {
			kind: "logic-hook",
			status: EdgeStatus.IDLE,
			logicType: LogicType.CONDITION,
			label: "Condition",
		},
	},
	// Sub-connection: channel-1 → event-1 (event-trigger)
	{
		id: "e-event-1",
		source: "channel-1",
		target: "event-1",
		sourceHandle: "channel-1-sub-out",
		targetHandle: "event-1-in",
		type: "event-trigger",
		data: {
			kind: "event-trigger",
			status: EdgeStatus.ACTIVE,
			eventType: EventType.ON_CLICK,
			label: "On Click",
		},
	},
	// Sub-connection: channel-1 → ai-1 (ai-action)
	{
		id: "e-ai-1",
		source: "channel-1",
		target: "ai-1",
		sourceHandle: "channel-1-sub-out",
		targetHandle: "ai-1-in",
		type: "ai-action",
		data: {
			kind: "ai-action",
			status: EdgeStatus.IDLE,
			aiType: AIActionType.PERSONALIZE,
			label: "Personalize",
		},
	},
	// Conditional branch: logic-1 true → channel-3
	{
		id: "e-branch-true",
		source: "logic-1",
		target: "channel-3",
		sourceHandle: "logic-1-true-out",
		targetHandle: "channel-3-flow-in",
		type: "conditional-branch",
		data: {
			kind: "conditional-branch",
			status: EdgeStatus.IDLE,
			branch: "true",
			label: "Yes",
		},
	},
];
