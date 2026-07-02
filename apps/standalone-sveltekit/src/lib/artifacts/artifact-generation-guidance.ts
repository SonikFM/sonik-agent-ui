import { formatSpecIssues, validateSpec, type Spec } from "@json-render/core";
import { explorerCatalog } from "../render/catalog.ts";

export const JSON_ARTIFACT_ALLOWED_COMPONENTS = explorerCatalog.componentNames as [string, ...string[]];
export const JSON_ARTIFACT_COMPONENT_HINT = JSON_ARTIFACT_ALLOWED_COMPONENTS.join(", ");

export const JSON_ARTIFACT_STARTER_SPEC = {
  root: "main",
  elements: {
    main: {
      type: "Card",
      props: {
        title: "UltraTest Artifact",
        description: "Artifact smoke passed.",
      },
      children: [],
    },
  },
  state: {},
} satisfies Spec;

export const JSON_ARTIFACT_DASHBOARD_SPEC = {
  root: "main",
  elements: {
    main: {
      type: "Stack",
      props: { direction: "vertical", gap: "md", wrap: null },
      children: ["title", "metrics", "rows", "notes"],
    },
    title: {
      type: "Heading",
      props: { text: "Live Artifact Dashboard", level: "h1" },
      children: [],
    },
    metrics: {
      type: "Grid",
      props: { columns: "3", gap: "md" },
      children: ["metric-a", "metric-b", "metric-c"],
    },
    "metric-a": {
      type: "Metric",
      props: { label: "Artifacts", value: "1", detail: "Created in this turn", trend: "up" },
      children: [],
    },
    "metric-b": {
      type: "Metric",
      props: { label: "Renderer", value: "JSON", detail: "Catalog validated", trend: "neutral" },
      children: [],
    },
    "metric-c": {
      type: "Metric",
      props: { label: "Mode", value: "Canvas", detail: "Promoted artifact", trend: "neutral" },
      children: [],
    },
    rows: {
      type: "Table",
      props: {
        data: [
          { capability: "Flat root element", status: "Present" },
          { capability: "Catalog components", status: "Present" },
          { capability: "Inline data", status: "Present" },
        ],
        columns: [
          { key: "capability", label: "Capability" },
          { key: "status", label: "Status" },
        ],
        emptyMessage: "No rows",
      },
      children: [],
    },
    notes: {
      type: "Accordion",
      props: {
        type: "multiple",
        items: [
          { title: "Generation rule", content: "Use object-form tool input for createJsonArtifact, not JSONL patch fences." },
          { title: "Validation rule", content: "Every child id must exist in elements, and every component type must come from the catalog." },
        ],
      },
      children: [],
    },
  },
  state: {},
} satisfies Spec;

const EXAMPLE_SPECS = [
  ["starter", JSON_ARTIFACT_STARTER_SPEC],
  ["dashboard", JSON_ARTIFACT_DASHBOARD_SPEC],
] as const;

function assertValidExampleSpec(name: string, spec: Spec): void {
  const structural = validateSpec(spec);
  if (!structural.valid) {
    throw new Error(`Invalid ${name} artifact example: ${formatSpecIssues(structural.issues)}`);
  }
  const catalog = explorerCatalog.validate(spec);
  const catalogError = catalog.success ? undefined : catalog.error;
  if (catalogError) {
    throw new Error(`Invalid ${name} artifact catalog example: ${catalogError.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
  }
}

export function assertJsonArtifactGuidanceExamplesValid(): void {
  for (const [name, spec] of EXAMPLE_SPECS) {
    assertValidExampleSpec(name, spec);
  }
}

const starterToolInput = {
  title: "UltraTest Artifact",
  spec: JSON_ARTIFACT_STARTER_SPEC,
};

const dashboardToolInput = {
  title: "Live Artifact Dashboard",
  spec: JSON_ARTIFACT_DASHBOARD_SPEC,
};

export const JSON_ARTIFACT_TOOL_OBJECT_GUIDANCE = `CREATE JSON ARTIFACT TOOL FORMAT:
- createJsonArtifact is a TOOL CALL, not an inline \`\`\`spec fence.
- Tool input is one JSON object: { "title": string, "spec": { "root": string, "elements": object, "state": object } }.
- NEVER call createJsonArtifact with { "elements": {} }.
- root must be exactly "main".
- elements.main is required and must be the root element.
- For simple artifacts, use a single root Card with children: [] and put the body text in description. Card requires props.title and props.description.
- Only use children when every child id is also defined as a key in elements.
- Every child id listed in children must exist as a key in elements.
- Component props must match the component catalog schema; never omit required props.
- In createJsonArtifact tool input, put dashboard table/chart/accordion data directly in props; do not use { "$state": "/path" } for this strict tool schema yet.
- createJsonArtifact supports interactive renderer actions on element-level event bindings: use on.press/on.change/etc. with { "action": "setState", "params": { "statePath": "/path", "value": ... } } or an array of those action objects. Put event bindings on the element, not inside props.
- Component type must be one of: ${JSON_ARTIFACT_COMPONENT_HINT}.
- Prefer a one-element Card for first-pass text artifacts; use Stack/Grid/Table/Metric only when the user needs a dashboard.
- For explicit artifact/canvas/dashboard/report/page/workspace requests, call createJsonArtifact once with a complete object-form spec.

Minimal working createJsonArtifact input:
${JSON.stringify(starterToolInput, null, 2)}

Dashboard createJsonArtifact input with inline data:
${JSON.stringify(dashboardToolInput, null, 2)}`;

export function getJsonArtifactToolDescription(): string {
  return `Create or replace the live canvas artifact with a COMPLETE json-render flat spec. Use this whenever the user explicitly asks to create an artifact, canvas, dashboard, report, page, or workspace. The spec must be renderable on the first call: elements cannot be empty; spec.root must be "main"; elements.main is required; child ids must exist; component types must be one of: ${JSON_ARTIFACT_COMPONENT_HINT}. Element-level on.* bindings may use renderer action objects such as { "action": "setState", "params": { "statePath": "/path", "value": true } } or arrays of those objects. createJsonArtifact takes object-form tool input, not JSONL patch lines. Use this one-element Card shape when uncertain: ${JSON.stringify(starterToolInput)}. Never call this with { "elements": {} }.`;
}
