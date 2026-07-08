import { tool } from "ai";
import { validateSpec, formatSpecIssues, type Spec } from "@json-render/core";
import { createInteractiveSurfaceJsonRenderSpec } from "../../../../../packages/json-ui-runtime/src/intake.ts";
import { repairSpec } from "../../../../../packages/json-ui-runtime/src/spec-repair.ts";
import { z } from "zod";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";
import type { AsyncWorkspacePersistenceAdapter } from "@sonik-agent-ui/workspace-session";
import { logArtifactTelemetry, summarizeSpec } from "../artifacts/artifact-telemetry.ts";
import { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE } from "../server/booking-workflows/context-intake.ts";
import { explorerCatalog } from "../render/catalog.ts";
import { getRequestWorkspacePersistence } from "../server/workspace-request-store.ts";
import { updateIntakeArtifactStateForPersistence } from "../server/intake-artifacts.ts";

function validatedBookingIntakeSpec(title?: string | null): Spec {
  const spec = createInteractiveSurfaceJsonRenderSpec(BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE) as Spec;
  const safeTitle = title?.trim();
  if (safeTitle) {
    const header = spec.elements["surface-header"];
    if (header?.type === "Card" && header.props && typeof header.props === "object") {
      header.props = { ...header.props, title: safeTitle };
    }
  }

  // The registered intake template is deterministic and always complete, so
  // a repair pass here is always a terminal (stream-complete) attempt.
  const repairAttempt = repairSpec(spec, { streamComplete: true });
  const repairedSpec = repairAttempt ? repairAttempt.spec : spec;
  if (repairAttempt?.repaired) {
    logArtifactTelemetry({
      source: "server",
      event: "artifact.spec.autofix_applied",
      title: safeTitle,
      lossy: repairAttempt.lossy,
      fixCount: repairAttempt.fixDetails.length,
      reason: repairAttempt.fixDetails.map((fix) => fix.message).join("; "),
      ok: true,
    });
  }

  const structural = repairAttempt ? repairAttempt.validation : validateSpec(repairedSpec);
  if (!structural.valid) {
    throw new Error(formatSpecIssues(structural.issues));
  }
  const catalog = explorerCatalog.validate(repairedSpec);
  const catalogError = catalog.success ? undefined : catalog.error;
  if (catalogError) {
    throw new Error(catalogError.issues.map((issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`).join("; "));
  }
  return repairedSpec;
}

/**
 * Deterministic booking-intake canvas seam.
 *
 * The generic createJsonArtifact tool remains strict and useful for open-ended
 * dashboards. Booking setup/intake, however, has a registered contract and must
 * not rely on the model to synthesize every QuestionCard prop correctly before
 * the first user question can render.
 */
export type CreateBookingIntakeArtifactToolContext = {
  pageContext?: AgentPageContext;
};

export function createBookingIntakeArtifactTool(context: CreateBookingIntakeArtifactToolContext = {}) {
  return tool({
  description:
    "Create the registered booking-context intake QuestionCard canvas from the Sonik runtime skill registry. Use this as the first and only artifact tool for venue setup, bookable inventory setup, restaurant/table schedule setup, tee-sheet setup, or booking context intake. It is preview-only: it does not execute booking commands or create bookings. Refuses while an intake canvas is already active — patch that one via submitIntakeAnswer instead; pass replaceActive only when the user explicitly asks to start over.",
  inputSchema: z.object({
    title: z.string().optional().describe("Optional title override for the intake canvas. Defaults to the registered booking intake title."),
    replaceActive: z.boolean().optional().describe("Set true ONLY when the user explicitly asked to discard the current intake and start over."),
  }),
  execute: async ({ title, replaceActive }) => {
    // Structural recreation guard: prompt steering alone did not stop models
    // from re-creating the canvas on answer turns (2026-07-08 smoke evidence).
    const activeArtifactId = context.pageContext?.activeArtifactId?.trim();
    if (activeArtifactId && replaceActive !== true) {
      logArtifactTelemetry({
        source: "server",
        event: "tool.createBookingIntakeArtifact",
        ok: false,
        reason: "active_intake_artifact_exists",
        artifactId: activeArtifactId,
      });
      return {
        kind: "intake-artifact-refusal" as const,
        ok: false as const,
        error: "active_intake_artifact_exists" as const,
        activeArtifactId,
        guidance: "An intake canvas is already active. Submit the user's answer with submitIntakeAnswer(questionId, value) against it. Only call createBookingIntakeArtifact with replaceActive:true if the user explicitly asked to start over.",
      };
    }
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
}

export type SubmitIntakeAnswerToolContext = {
  pageContext?: AgentPageContext;
  persistence?: AsyncWorkspacePersistenceAdapter | null;
};

type SubmitIntakeAnswerTargetResolution =
  | { ok: true; artifactId: string }
  | { ok: false; error: "missing_active_artifact" | "stale_artifact_selection"; message: string };

function resolveSubmitIntakeAnswerTarget(pageContext: AgentPageContext | undefined, requestedId: string | undefined): SubmitIntakeAnswerTargetResolution {
  const requested = requestedId?.trim();
  const active = pageContext?.activeArtifactId?.trim();
  if (requested && active && requested !== active) {
    return {
      ok: false,
      error: "stale_artifact_selection",
      message: `Refusing to patch artifact ${requested}; the active artifact is ${active}. Answer against the active intake artifact instead.`,
    };
  }
  const artifactId = active || requested;
  if (!artifactId) {
    return {
      ok: false,
      error: "missing_active_artifact",
      message: "No active intake artifact is selected. Call readActiveArtifactState or open the intake canvas before answering a question.",
    };
  }
  return { ok: true, artifactId };
}

function classifyIntakeAnswerError(message: string): "unknown_question_id" | "artifact_not_found" | "invalid_question_answer" {
  if (/was not found in persisted intake artifact/.test(message)) return "unknown_question_id";
  if (/was not found\.$/.test(message) || /must be a json-render artifact/.test(message)) return "artifact_not_found";
  return "invalid_question_answer";
}

/**
 * Model-callable patch tool for the booking.context.intake skill: records a natural-language
 * chat answer (given as {questionId, value}) into the ALREADY-ACTIVE intake artifact by wrapping
 * updateIntakeArtifactStateForPersistence -- the exact same question-answer state-patch function
 * the QuestionCard UI submit/skip action uses (see server/intake-artifacts.ts). It never creates
 * a new artifact and never touches state.surface/state.manifest.source, so the
 * booking.context.intake marker that resolveWorkflowId depends on always survives the patch.
 *
 * Trust/safety: this tool only reaches persistence.getArtifact/listArtifactVersions/updateArtifact
 * (a draft-state patch). It has no dependency on the command-execution runtime or on any
 * approval-grant list, so answering a question here can never commit a booking command -- that
 * still requires the separate, approval-gated preview/commit seam in tools/artifact-state.ts.
 */
export function createSubmitIntakeAnswerTool(context: SubmitIntakeAnswerToolContext = {}) {
  return tool({
    description:
      "Record a question answer the user gave in chat (natural language, not a QuestionCard click) into the ALREADY-ACTIVE booking-context intake artifact. Use this whenever the user states an answer conversationally instead of using the form. It patches the existing artifact's draft answer state only -- it does not create a new artifact, does not validate/preview/commit a booking command, and does not require or grant approval. Never call createBookingIntakeArtifact again just to record an answer; that recreates a blank canvas and loses prior answers.",
    inputSchema: z.object({
      artifactId: z.string().optional().describe("The active intake artifact id. Optional: defaults to the page context's active artifact. If provided, it must match the active artifact."),
      questionId: z.string().min(1).describe("The id of the QuestionCard question being answered, exactly as it appears in the active intake artifact (e.g. q_intake_mode)."),
      value: z.unknown().optional().describe("The answer value for this question. Omit only when skipped is true."),
      skipped: z.boolean().optional().describe("Set true when the user explicitly wants to skip/defer this question instead of answering it."),
    }),
    execute: async ({ artifactId, questionId, value, skipped }) => {
      const target = resolveSubmitIntakeAnswerTarget(context.pageContext, artifactId);
      if (!target.ok) {
        logArtifactTelemetry({
          source: "server",
          event: "tool.submitIntakeAnswer",
          ok: false,
          error: target.error,
          reason: questionId,
        });
        return { ok: false, error: target.error, message: target.message };
      }

      const persistence = context.persistence ?? getRequestWorkspacePersistence(null);
      try {
        const updated = await updateIntakeArtifactStateForPersistence(persistence, {
          artifactId: target.artifactId,
          submission: { questionId, value, skipped: skipped === true },
        });
        const state = updated.content && typeof updated.content === "object" ? (updated.content as Spec).state : undefined;
        const lastSubmission = state && typeof state === "object" ? (state as Record<string, unknown>).lastQuestionSubmission : undefined;
        logArtifactTelemetry({
          source: "server",
          event: "tool.submitIntakeAnswer",
          ok: true,
          artifactId: updated.id,
          artifactVersion: updated.version,
          reason: questionId,
          mode: skipped === true ? "skipped" : "answered",
        });
        return {
          ok: true,
          kind: "intake-answer-receipt" as const,
          artifact: { id: updated.id, title: updated.title, version: updated.version },
          questionId,
          skipped: skipped === true,
          receipt: lastSubmission ?? { questionId, lifecycle: skipped === true ? "skipped" : "answered" },
          execution: "none" as const,
          approval: "not_granted" as const,
          nextAction: "Answer saved on the existing intake artifact (no new artifact was created). Continue asking the next missing required question, or call previewActiveIntakeCommand once all required questions are answered.",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logArtifactTelemetry({
          source: "server",
          event: "tool.submitIntakeAnswer",
          ok: false,
          error: message,
          reason: questionId,
        });
        return { ok: false, error: classifyIntakeAnswerError(message), message };
      }
    },
  });
}
