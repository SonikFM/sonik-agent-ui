// Theme CSS is imported where the flow runtime mounts.
// The registry below is pure TypeScript and safe for devtools, Storybook,
// and tests that need to reason about campaign-flow design governance.

export type {
	CampaignFlowCssVariable,
	CampaignFlowTokenDefinition,
	CampaignFlowTokenGroup,
	CampaignFlowTokenGroupId,
} from "./flow-token-registry";
export {
	buildCampaignFlowTokenStyle,
	CAMPAIGN_FLOW_TOKEN_DEFAULTS,
	CAMPAIGN_FLOW_TOKEN_DEFINITIONS,
	CAMPAIGN_FLOW_TOKEN_GROUPS,
	CAMPAIGN_FLOW_TOKEN_SCOPE_SELECTOR,
	getCampaignFlowTokenDefinitionsByGroup,
} from "./flow-token-registry";
