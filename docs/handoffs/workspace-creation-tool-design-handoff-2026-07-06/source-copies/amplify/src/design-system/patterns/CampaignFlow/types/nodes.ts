/** Channel provider identifiers for campaign touchpoints */
export const ChannelProvider = {
	WHATSAPP: "whatsapp",
	EMAIL: "email",
	SMS: "sms",
	TIKTOK: "tiktok",
	GOOGLE_ADS: "google-ads",
	META_ADS: "meta-ads",
	TIKTOK_ADS: "tiktok-ads",
	INSTAGRAM: "instagram",
} as const;

export type ChannelProvider =
	(typeof ChannelProvider)[keyof typeof ChannelProvider];

/** Logic hook sub-connection types */
export const LogicType = {
	DELAY: "delay",
	CONDITION: "condition",
	AB_SPLIT: "ab-split",
	AUDIENCE_FILTER: "audience-filter",
} as const;

export type LogicType = (typeof LogicType)[keyof typeof LogicType];

/** Event trigger sub-connection types */
export const EventType = {
	ON_OPEN: "on-open",
	ON_CLICK: "on-click",
	ON_REPLY: "on-reply",
	ON_BOUNCE: "on-bounce",
	ON_UNSUBSCRIBE: "on-unsubscribe",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

/** AI action sub-connection types */
export const AIActionType = {
	GENERATE: "generate",
	PERSONALIZE: "personalize",
	OPTIMIZE_TIMING: "optimize-timing",
	SENTIMENT: "sentiment",
} as const;

export type AIActionType = (typeof AIActionType)[keyof typeof AIActionType];

/** Lifecycle status for all node types */
export const NodeStatus = {
	DRAFT: "draft",
	SCHEDULED: "scheduled",
	ACTIVE: "active",
	PAUSED: "paused",
	COMPLETED: "completed",
	ERROR: "error",
} as const;

export type NodeStatus = (typeof NodeStatus)[keyof typeof NodeStatus];

export type AdsNetworkProvider = "meta" | "google" | "tiktok";

export type AdsSpecialAdCategory =
	| "NONE"
	| "CREDIT"
	| "EMPLOYMENT"
	| "HOUSING"
	| "ISSUES_ELECTIONS_POLITICS";

export type AdsCampaignObjective =
	| "OUTCOME_AWARENESS"
	| "OUTCOME_TRAFFIC"
	| "OUTCOME_ENGAGEMENT"
	| "OUTCOME_LEADS"
	| "OUTCOME_APP_PROMOTION"
	| "OUTCOME_SALES";

export interface AdsCreationDraft {
	familyId: "growth.ads";
	provider: AdsNetworkProvider;
	commandId?: string;
	readiness: "draft" | "dry-run-ready" | "host-deferred";
	campaign: {
		name: string;
		objective: AdsCampaignObjective;
		specialAdCategories: AdsSpecialAdCategory[];
		status: "PAUSED" | "ACTIVE";
		buyingType?: "AUCTION" | "RESERVED";
	};
	adSet: {
		name: string;
		budgetType: "daily" | "lifetime";
		budgetMinorUnits: number;
		billingEvent:
			| "IMPRESSIONS"
			| "LINK_CLICKS"
			| "POST_ENGAGEMENT"
			| "THRUPLAY";
		optimizationGoal:
			| "REACH"
			| "IMPRESSIONS"
			| "LINK_CLICKS"
			| "LANDING_PAGE_VIEWS"
			| "LEAD_GENERATION"
			| "OFFSITE_CONVERSIONS"
			| "POST_ENGAGEMENT"
			| "THRUPLAY"
			| "VALUE";
		startTime?: string;
		endTime?: string;
		targeting: {
			geoCountries: string[];
			ageMin?: number;
			ageMax?: number;
			customAudienceIds?: string[];
		};
		status: "PAUSED" | "ACTIVE";
	};
	creative: {
		name: string;
		cmsAssetId?: string;
		pageId?: string;
		instagramActorId?: string;
		destinationUrl?: string;
		primaryText?: string;
		headline?: string;
		description?: string;
		ctaType?: string;
	};
	ad: {
		name: string;
		status: "PAUSED" | "ACTIVE";
	};
	requiredFields: string[];
}

/** Data payload for channel nodes (WhatsApp, Email, SMS, TikTok, Google Ads) */
export interface ChannelNodeData {
	kind: "channel";
	provider: ChannelProvider;
	title: string;
	status: NodeStatus;
	statusLabel?: string;
	subtitle?: string;
	scheduledAt?: string;
	templateId?: string;
	metricLabel?: string;
	metricValue?: string;
	previewImageUrl?: string;
	previewVideoUrl?: string;
	confidence?: number;
	adsDraft?: AdsCreationDraft;
	[key: string]: unknown;
}

/** Configuration for delay logic hooks */
export interface DelayConfig {
	duration: number;
	unit: "minutes" | "hours" | "days";
	[key: string]: unknown;
}

/** Configuration for condition/branch logic hooks */
export interface ConditionConfig {
	field: string;
	operator: "equals" | "not-equals" | "contains" | "gt" | "lt";
	value: string;
	[key: string]: unknown;
}

/** Configuration for A/B split logic hooks */
export interface ABSplitConfig {
	variants: Array<{ id: string; label: string; percentage: number }>;
	[key: string]: unknown;
}

/** Configuration for audience filter logic hooks */
export interface AudienceFilterConfig {
	segmentId?: string;
	rules: Array<{ field: string; operator: string; value: string }>;
	[key: string]: unknown;
}

/** Data payload for logic hook sub-connection nodes */
export interface LogicNodeData {
	kind: "logic";
	logicType: LogicType;
	label: string;
	config: DelayConfig | ConditionConfig | ABSplitConfig | AudienceFilterConfig;
	[key: string]: unknown;
}

/** Data payload for event trigger sub-connection nodes */
export interface EventNodeData {
	kind: "event";
	eventType: EventType;
	label: string;
	action?: string;
	keywordPattern?: string;
	[key: string]: unknown;
}

/** Data payload for AI action sub-connection nodes */
export interface AIActionNodeData {
	kind: "ai-action";
	aiType: AIActionType;
	label: string;
	modelId?: string;
	promptTemplate?: string;
	confidence?: number;
	[key: string]: unknown;
}

/** Discriminated union of all node data types. Discriminator: 'kind' field. */
export type FlowNodeData =
	| ChannelNodeData
	| LogicNodeData
	| EventNodeData
	| AIActionNodeData;
