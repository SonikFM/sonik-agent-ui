import {
	CAMPAIGN_FLOW_TOKEN_DEFINITIONS,
	CAMPAIGN_FLOW_TOKEN_GROUPS,
	CAMPAIGN_FLOW_TOKEN_SCOPE_SELECTOR,
	type CampaignFlowCssVariable,
	type CampaignFlowTokenGroupId,
} from "./flow-token-registry";

type LevaStringControl = {
	value: string;
	label: string;
	hint: string;
};

export type CampaignFlowTokenValues = Partial<
	Record<CampaignFlowCssVariable, string>
>;

export function isCampaignWizardPath(pathname: string): boolean {
	return (
		pathname === "/campaign-wizard" || pathname.startsWith("/campaign-wizard/")
	);
}

export function buildCampaignFlowControlsForGroup(
	groupId: CampaignFlowTokenGroupId,
): Record<CampaignFlowCssVariable, LevaStringControl> {
	const controls = {} as Record<CampaignFlowCssVariable, LevaStringControl>;
	for (const token of CAMPAIGN_FLOW_TOKEN_DEFINITIONS) {
		if (token.group !== groupId) {
			continue;
		}
		controls[token.name] = {
			value: token.value,
			label: token.label,
			hint: token.description,
		};
	}
	return controls;
}

export function getCampaignFlowLevaFolderName(
	groupId: CampaignFlowTokenGroupId,
): string {
	const group = CAMPAIGN_FLOW_TOKEN_GROUPS.find((item) => item.id === groupId);
	return `Campaign Wizard · ${group?.label ?? groupId}`;
}

export function mergeCampaignFlowTokenValues(
	...records: Array<Record<string, unknown>>
): CampaignFlowTokenValues {
	const values: CampaignFlowTokenValues = {};
	for (const token of CAMPAIGN_FLOW_TOKEN_DEFINITIONS) {
		for (const record of records) {
			const value = record[token.name];
			if (typeof value === "string") {
				values[token.name] = value;
				continue;
			}
			if (
				typeof value === "object" &&
				value !== null &&
				"value" in value &&
				typeof value.value === "string"
			) {
				values[token.name] = value.value;
			}
		}
	}
	return values;
}

export function applyCampaignFlowTokenOverrides(options: {
	values: CampaignFlowTokenValues;
	root?: ParentNode;
}): () => void {
	const root = options.root ?? document;
	const scopes = Array.from(
		root.querySelectorAll<HTMLElement>(CAMPAIGN_FLOW_TOKEN_SCOPE_SELECTOR),
	);

	for (const scope of scopes) {
		for (const [property, value] of Object.entries(options.values)) {
			if (typeof value === "string" && value.trim().length > 0) {
				scope.style.setProperty(property, value);
			}
		}
	}

	return () => {
		for (const scope of scopes) {
			for (const property of Object.keys(options.values)) {
				scope.style.removeProperty(property);
			}
		}
	};
}
