/**
 * Human/agent-readable map of the json-render component surface.
 *
 * Runtime rendering still flows through `catalog.ts` (schemas) and
 * `registry.ts` (Svelte component bindings). Keep this file as the stable
 * orientation layer for docs, skills, tests, and future package extraction.
 */
export type JsonRenderComponentTier = "display" | "layout" | "input" | "intake" | "action";

export type JsonRenderComponentRegistryEntry = {
  id: string;
  tier: JsonRenderComponentTier;
  source: string;
  schema: string;
  description: string;
  stateful: boolean;
};

export type JsonRenderComponentGroup = {
  id: string;
  label: string;
  purpose: string;
  components: JsonRenderComponentRegistryEntry[];
};

const componentPath = (name: string) => `apps/standalone-sveltekit/src/lib/render/components/${name}.svelte`;

export const JSON_RENDER_COMPONENT_GROUPS = [
  {
    id: "layout",
    label: "Layout primitives",
    purpose: "Compose artifact structure without owning domain state.",
    components: [
      entry("Stack", "layout", "Flex stack container."),
      entry("Grid", "layout", "Responsive grid container."),
      entry("Card", "layout", "Card container with optional heading copy."),
      entry("Separator", "layout", "Visual section separator."),
      entry("Tabs", "layout", "Tabbed content shell; should become controlled by artifact state for persistent tab selection.", true),
      entry("TabContent", "layout", "Content pane for Tabs."),
    ],
  },
  {
    id: "display",
    label: "Display and dashboard primitives",
    purpose: "Render read-only dashboards, reports, and inline visual responses.",
    components: [
      entry("Heading", "display", "Section heading."),
      entry("Text", "display", "Text paragraph."),
      entry("Badge", "display", "Status badge."),
      entry("Alert", "display", "Alert/callout message."),
      entry("Metric", "display", "Single KPI metric."),
      entry("Table", "display", "Sortable table for structured rows.", true),
      entry("BarChart", "display", "Simple bar chart."),
      entry("LineChart", "display", "Simple line chart."),
      entry("PieChart", "display", "Simple pie/donut chart."),
      entry("Progress", "display", "Progress indicator."),
      entry("Skeleton", "display", "Loading placeholder."),
      entry("Callout", "display", "Rich note/tip/warning block."),
      entry("Accordion", "display", "Collapsible sections."),
      entry("Timeline", "display", "Ordered event/step timeline."),
      entry("Link", "display", "External link."),
    ],
  },
  {
    id: "input",
    label: "Generic input primitives",
    purpose: "Edit JSON-render artifact state through $bindState; persistence is owned by the host/controller seam.",
    components: [
      entry("TextInput", "input", "Single-line text input.", true),
      entry("EditableField", "input", "Scalar manifest field editor.", true),
      entry("TextareaField", "input", "Long-form text editor.", true),
      entry("SelectInput", "input", "Single select field.", true),
      entry("RadioGroup", "input", "Single choice radio group.", true),
      entry("ChoiceCards", "input", "Single or multiple choice-card selector.", true),
    ],
  },
  {
    id: "intake",
    label: "Intake and manifest components",
    purpose: "Render skill-driven intake artifacts and manifest previews without executing business mutations.",
    components: [
      entry("QuestionCard", "intake", "Ask-user-question lifecycle card that writes answer state only.", true),
      entry("ManifestPreview", "intake", "Read-only manifest preview."),
      entry("MissingFieldsList", "intake", "Readiness/missing-field list."),
      entry("ConfidenceTable", "intake", "Inferred/user-confirmed confidence table."),
      entry("ActionRail", "intake", "Read-only action/command preview rail."),
    ],
  },
  {
    id: "action",
    label: "Local action primitives",
    purpose: "Dispatch whitelisted renderer actions such as setState; durable effects require a trusted controller.",
    components: [entry("Button", "action", "Generic press emitter for json-render actions.", true)],
  },
] as const satisfies JsonRenderComponentGroup[];

export const JSON_RENDER_COMPONENT_IDS = JSON_RENDER_COMPONENT_GROUPS.flatMap((group) =>
  group.components.map((component) => component.id),
);

export const JSON_RENDER_STATEFUL_COMPONENT_IDS = JSON_RENDER_COMPONENT_GROUPS.flatMap((group) =>
  group.components.filter((component) => component.stateful).map((component) => component.id),
);

export const JSON_RENDER_COMPONENT_REGISTRY_PATHS = {
  catalog: "apps/standalone-sveltekit/src/lib/render/catalog.ts",
  registry: "apps/standalone-sveltekit/src/lib/render/registry.ts",
  componentRegistry: "apps/standalone-sveltekit/src/lib/render/component-registry.ts",
  components: "apps/standalone-sveltekit/src/lib/render/components/",
  runtimeRenderer: "packages/json-ui-runtime/src/renderer/JsonArtifactRenderer.svelte",
  coreRenderer: "packages/svelte/src/ElementRenderer.svelte",
  contracts: "packages/tool-contracts/src/index.ts",
  intakeArtifactFactory: "apps/standalone-sveltekit/src/lib/server/intake-artifacts.ts",
} as const;

function entry(
  id: string,
  tier: JsonRenderComponentTier,
  description: string,
  stateful = false,
): JsonRenderComponentRegistryEntry {
  return {
    id,
    tier,
    source: componentPath(id),
    schema: "apps/standalone-sveltekit/src/lib/render/catalog.ts",
    description,
    stateful,
  };
}
