import type { AgentPageContext, HostUiTarget } from "@sonik-agent-ui/tool-contracts";

const TARGET_SUMMARY_MAX_ITEMS = 12;

function cleanText(value: unknown, max = 160): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function summarizeTargets(context: AgentPageContext): string[] {
  const targets = context.hostUiTargetRegistry?.targets ?? context.hostUiTargets ?? [];
  return targets
    .slice(0, TARGET_SUMMARY_MAX_ITEMS)
    .map((target: HostUiTarget) => {
      const id = cleanText(target.targetId);
      const label = cleanText(target.label);
      if (!id || !label) return null;
      return `  - ${id}: ${label}`;
    })
    .filter((line): line is string => Boolean(line));
}

export function createCurrentPageContextSummary(input: {
  context?: AgentPageContext;
  trustedOrganizationDisplay?: string | null;
  productTourIntent?: boolean;
}): string {
  const { context, trustedOrganizationDisplay, productTourIntent = false } = input;
  const organization = cleanText(trustedOrganizationDisplay);
  if (!context && !organization) return "";
  const lines = ["CURRENT HOST/PAGE CONTEXT:"];
  if (organization) lines.push(`- organization: ${organization}`);
  if (context?.title) lines.push(`- title: ${context.title}`);
  if (context?.route) lines.push(`- route: ${context.route}`);
  if (context?.surface) lines.push(`- surface: ${context.surface}`);
  if (context?.pageType) lines.push(`- pageType: ${context.pageType}`);
  if (context?.activeEntity) {
    lines.push(`- activeEntity: ${context.activeEntity.type} ${context.activeEntity.label ?? context.activeEntity.id} (${context.activeEntity.id})`);
  }
  if (!productTourIntent && context?.commandFamilies?.length) lines.push(`- commandFamilies: ${context.commandFamilies.join(", ")}`);
  if (!productTourIntent && context?.skillFamilies?.length) lines.push(`- skillFamilies: ${context.skillFamilies.join(", ")}`);
  if (!productTourIntent && context?.visibleActions?.length) lines.push(`- visibleActions: ${context.visibleActions.join(", ")}`);
  const targetLines = productTourIntent && context ? summarizeTargets(context) : [];
  if (targetLines.length) lines.push("- semanticTargets:", ...targetLines);
  if (productTourIntent) {
    lines.push(
      "Product tour request: give a concise overview grounded in semanticTargets targetId/label only. Do not start a booking, reservation, intake, event, or campaign workflow. Do not mention or expose raw selectors, locators, DOM paths, or host-private implementation details.",
    );
  }
  lines.push("If the user asks where they are, what page this is, or what context is attached, answer directly from this block. Do not create an artifact or dashboard unless the user explicitly asks for one.");
  return lines.join("\n");
}
