import { tool } from "ai";
import { formatSpecIssues, validateSpec, type Spec } from "@json-render/core";
import { z } from "zod";
import { logArtifactTelemetry, summarizeSpec } from "../artifacts/artifact-telemetry";
import { normalizeJsonArtifactSpec } from "../artifacts/json-artifact-spec";
import { explorerCatalog } from "../render/catalog";
import { getJsonArtifactToolDescription, JSON_ARTIFACT_ALLOWED_COMPONENTS } from "../artifacts/artifact-generation-guidance";

const catalogComponentNames = JSON_ARTIFACT_ALLOWED_COMPONENTS;
type CatalogComponentDefinition = {
  props?: z.ZodTypeAny;
  slots?: string[];
};

// Intentional contract mirror: createJsonArtifact uses the same catalog prop schemas that the renderer uses, so catalog edits are agent tool-contract edits too.
const catalogComponents = (explorerCatalog.data as { components: Record<string, CatalogComponentDefinition> }).components;
const elementControlSchema = {
  children: z.array(z.string()).optional().describe("Child element ids. Use [] for simple artifacts; if an id is listed here, it must also exist in spec.elements."),
  visible: z.unknown().optional(),
  on: z.record(z.string(), z.unknown()).optional(),
  repeat: z.object({ statePath: z.string(), key: z.string().optional() }).optional(),
  watch: z.record(z.string(), z.unknown()).optional(),
};

const catalogElementSchemas = catalogComponentNames.map((name) => {
  const propsSchema = catalogComponents[name]?.props ?? z.record(z.string(), z.unknown());
  return z.object({
    type: z.literal(name),
    props: propsSchema.describe(`Required props for ${name}. Use the catalog example when uncertain.`),
    ...elementControlSchema,
  }).passthrough();
});

const uiElementSchema = z.discriminatedUnion("type", catalogElementSchemas as [typeof catalogElementSchemas[number], typeof catalogElementSchemas[number], ...Array<typeof catalogElementSchemas[number]>]);

const specSchema = z.object({
  root: z.literal("main").describe("Root element key. Use the stable value \"main\" for all createJsonArtifact tool calls."),
  elements: z.object({
    main: uiElementSchema.describe("Required root element. This makes empty element maps impossible."),
  })
    .catchall(uiElementSchema)
    .refine((elements) => Object.keys(elements).length > 0, "spec.elements must contain at least the root element; empty element maps are invalid.")
    .describe("Non-empty flat json-render element map keyed by element id. Must include the required main root element."),
  state: z.record(z.string(), z.unknown()).optional().describe("Initial state object used by $state bindings."),
}).superRefine((spec, ctx) => {
  if (!spec.elements[spec.root]) {
    ctx.addIssue({
      code: "custom",
      path: ["elements", spec.root],
      message: `spec.elements must include the root key "${spec.root}". Use root: "main" and elements.main for createJsonArtifact.`,
    });
    return;
  }

  const structural = validateSpec(spec as Spec);
  for (const issue of structural.issues.filter((entry) => entry.severity === "error")) {
    ctx.addIssue({
      code: "custom",
      path: issue.elementKey ? ["elements", issue.elementKey] : ["elements"],
      message: issue.message,
    });
  }

  const catalog = explorerCatalog.validate(spec);
  const catalogError = catalog.success ? undefined : catalog.error;
  if (catalogError) {
    for (const issue of catalogError.issues) {
      ctx.addIssue({
        code: "custom",
        path: issue.path,
        message: issue.message,
      });
    }
  }
});

/**
 * Agent-facing canvas creation seam.
 *
 * This intentionally does not persist to disk/database yet. It creates a typed
 * tool-result envelope that the Svelte workspace promotes into the live
 * artifact pane. Long-term persistence belongs behind the artifact warehouse.
 */
export const createJsonArtifact = tool({
  description: getJsonArtifactToolDescription(),
  inputSchema: z.object({
    title: z.string().describe("Short human-readable title for the artifact."),
    spec: specSchema.describe("Complete json-render flat spec to render in the artifact canvas."),
  }),
  execute: async ({ title, spec }) => {
    const normalized = normalizeJsonArtifactSpec(spec, title);
    if (normalized.recovered) {
      logArtifactTelemetry({
        source: "server",
        event: "tool.createJsonArtifact.rejected_invalid_spec",
        title,
        reason: normalized.reason,
        ...summarizeSpec(normalized.spec),
        ok: false,
        error: `Invalid JSON-render artifact spec: ${normalized.reason ?? "invalid_spec"}`,
      });
      throw new Error(`Invalid JSON-render artifact spec: ${normalized.reason ?? "invalid_spec"}. createJsonArtifact requires root: "main" and a non-empty elements map containing elements.main.`);
    }

    const structural = validateSpec(normalized.spec);
    const catalog = explorerCatalog.validate(normalized.spec);
    const catalogError = catalog.success ? undefined : catalog.error;
    if (!structural.valid || catalogError) {
      const structuralMessage = structural.valid ? "" : formatSpecIssues(structural.issues);
      const catalogMessage = catalogError ? catalogError.issues.map((issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`).join("; ") : "";
      const message = [structuralMessage, catalogMessage].filter(Boolean).join("; ") || "invalid_spec";
      logArtifactTelemetry({
        source: "server",
        event: "tool.createJsonArtifact.rejected_invalid_spec",
        title,
        reason: message,
        ...summarizeSpec(normalized.spec),
        ok: false,
        error: message,
      });
      throw new Error(`Invalid JSON-render artifact spec: ${message}`);
    }

    logArtifactTelemetry({
      source: "server",
      event: "tool.createJsonArtifact",
      title,
      ...summarizeSpec(normalized.spec),
      ok: true,
    });

    return {
      kind: "json-render-artifact" as const,
      title,
      spec: normalized.spec,
      createdAt: new Date().toISOString(),
    };
  },
});
