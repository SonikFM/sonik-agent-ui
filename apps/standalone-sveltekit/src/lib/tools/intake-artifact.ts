import { tool } from "ai";
import { validateSpec, formatSpecIssues, type Spec } from "@json-render/core";
import { createInteractiveSurfaceJsonRenderSpec } from "../../../../../packages/json-ui-runtime/src/intake.ts";
import { z } from "zod";
import { logArtifactTelemetry, summarizeSpec } from "../artifacts/artifact-telemetry.ts";
import { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE } from "../server/booking-workflows/context-intake.ts";
import { explorerCatalog } from "../render/catalog.ts";

function validatedBookingIntakeSpec(title?: string | null): Spec {
  const spec = createInteractiveSurfaceJsonRenderSpec(BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE) as Spec;
  const safeTitle = title?.trim();
  if (safeTitle) {
    const header = spec.elements["surface-header"];
    if (header?.type === "Card" && header.props && typeof header.props === "object") {
      header.props = { ...header.props, title: safeTitle };
    }
  }

  const structural = validateSpec(spec);
  if (!structural.valid) {
    throw new Error(formatSpecIssues(structural.issues));
  }
  const catalog = explorerCatalog.validate(spec);
  const catalogError = catalog.success ? undefined : catalog.error;
  if (catalogError) {
    throw new Error(catalogError.issues.map((issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`).join("; "));
  }
  return spec;
}

/**
 * Deterministic booking-intake canvas seam.
 *
 * The generic createJsonArtifact tool remains strict and useful for open-ended
 * dashboards. Booking setup/intake, however, has a registered contract and must
 * not rely on the model to synthesize every QuestionCard prop correctly before
 * the first user question can render.
 */
export const createBookingIntakeArtifact = tool({
  description:
    "Create the registered booking-context intake QuestionCard canvas from the Sonik runtime skill registry. Use this as the first and only artifact tool for venue setup, bookable inventory setup, restaurant/table schedule setup, tee-sheet setup, or booking context intake. It is preview-only: it does not execute booking commands or create bookings.",
  inputSchema: z.object({
    title: z.string().optional().describe("Optional title override for the intake canvas. Defaults to the registered booking intake title."),
  }),
  execute: async ({ title }) => {
    const spec = validatedBookingIntakeSpec(title);
    const artifactTitle = title?.trim() || BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE.title;
    logArtifactTelemetry({
      source: "server",
      event: "tool.createBookingIntakeArtifact",
      title: artifactTitle,
      ...summarizeSpec(spec),
      ok: true,
    });
    return {
      kind: "json-render-artifact" as const,
      title: artifactTitle,
      spec,
      createdAt: new Date().toISOString(),
    };
  },
});
