import { EDGE_KIND } from "./edges";
import { ChannelProvider } from "./nodes";

/** A single validation rule: what source node kind can connect to what target node kind */
export interface ConnectionRule {
	sourceKind: string;
	targetKind: string;
	allowedEdgeKinds: Array<(typeof EDGE_KIND)[keyof typeof EDGE_KIND]>;
}

/** Full connection rules matrix. If a pair is not listed, the connection is invalid. */
export const CONNECTION_RULES: ConnectionRule[] = [
	{
		sourceKind: "channel",
		targetKind: "channel",
		allowedEdgeKinds: [EDGE_KIND.FLOW],
	},
	{
		sourceKind: "channel",
		targetKind: "logic",
		allowedEdgeKinds: [EDGE_KIND.LOGIC_HOOK],
	},
	{
		sourceKind: "channel",
		targetKind: "event",
		allowedEdgeKinds: [EDGE_KIND.EVENT_TRIGGER],
	},
	{
		sourceKind: "channel",
		targetKind: "ai-action",
		allowedEdgeKinds: [EDGE_KIND.AI_ACTION],
	},
	{
		sourceKind: "logic",
		targetKind: "channel",
		allowedEdgeKinds: [EDGE_KIND.CONDITIONAL_BRANCH],
	},
	{
		sourceKind: "logic",
		targetKind: "logic",
		allowedEdgeKinds: [EDGE_KIND.CONDITIONAL_BRANCH],
	},
	{
		sourceKind: "logic",
		targetKind: "event",
		allowedEdgeKinds: [EDGE_KIND.CONDITIONAL_BRANCH],
	},
	{
		sourceKind: "logic",
		targetKind: "ai-action",
		allowedEdgeKinds: [EDGE_KIND.CONDITIONAL_BRANCH],
	},
];

/** Providers that support on-reply events. Email does not. */
export const REPLY_ONLY_PROVIDERS: ChannelProvider[] = [
	ChannelProvider.WHATSAPP,
	ChannelProvider.SMS,
];
