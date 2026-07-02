import type { Spec } from "@json-render/core";
import {
  createAskUserQuestionSpec,
  createInteractiveSurfaceSpec,
  createQuestionAnswerStateUpdates,
  exportIntakeManifestPayload as createExportPayload,
  validateIntakeManifest as validateManifest,
  type InteractiveSurfaceSpec,
  type IntakeManifestExportPayload,
  type IntakeManifestValidationResult,
  questionAnswerSubmissionSchema,
  type AskUserQuestionSpec,
  type QuestionAnswerSubmission,
} from "@sonik-agent-ui/tool-contracts";
import { normalizeRenderedMaxSelections } from "../render/question-max-selections.ts";
import {
  createRequestWorkspaceArtifact,
  getRequestWorkspaceArtifact,
  getRequestWorkspacePersistence,
  listRequestWorkspaceArtifactVersions,
  updateRequestWorkspaceArtifact,
  type RequestWorkspaceEvent,
  type WorkspaceArtifactRecord,
  type WorkspaceArtifactVersionRecord,
} from "./workspace-request-store.ts";

export type IntakeArtifactRecord = WorkspaceArtifactRecord;

export type CreateIntakeArtifactInput = {
  sessionId?: string | null;
  artifactId?: string | null;
  title?: string | null;
  surface: InteractiveSurfaceSpec | unknown;
  requestId?: string | null;
};

export type RecordIntakeQuestionAskedInput = {
  artifactId: string;
  questionId: string;
  requestId?: string | null;
};

export type IntakeQuestionAskedReceipt = {
  artifact: IntakeArtifactRecord;
  version: WorkspaceArtifactVersionRecord;
  question: AskUserQuestionSpec;
  execution: "none";
  approval: "not_granted";
};

export type UpdateIntakeArtifactStateInput = {
  artifactId: string;
  /** Deprecated compatibility input. The persisted artifact question contract is authoritative. */
  question?: unknown;
  submission: QuestionAnswerSubmission | unknown;
  requestId?: string | null;
};

export type ValidateIntakeManifestInput = {
  artifactId: string;
  requestId?: string | null;
};

export type ExportIntakeManifestInput = {
  artifactId: string;
  requestId?: string | null;
  exportedAt?: string | Date;
};

export type IntakeManifestValidationReceipt = {
  artifact: IntakeArtifactRecord;
  version: WorkspaceArtifactVersionRecord;
  manifest: unknown;
  validation: IntakeManifestValidationResult;
  commandPreview: IntakeManifestValidationResult["commandPreview"];
  execution: "none";
  approval: "not_granted";
};

export type IntakeManifestExportReceipt = IntakeManifestValidationReceipt & {
  exportPayload: IntakeManifestExportPayload;
};

export async function createIntakeArtifact(event: RequestWorkspaceEvent | null | undefined, input: CreateIntakeArtifactInput): Promise<IntakeArtifactRecord> {
  const surface = createInteractiveSurfaceSpec(input.surface);
  const content = createIntakeSurfaceSpec(surface);
  const artifactId = input.artifactId?.trim() || surface.artifactId || surface.id;
  const title = input.title?.trim() || surface.title;

  const existing = await getRequestWorkspaceArtifact(event as RequestWorkspaceEvent, artifactId);
  const artifact = existing
    ? await updateRequestWorkspaceArtifact(event as RequestWorkspaceEvent, artifactId, {
        title,
        content,
        source: "ai",
        summary: `Updated intake artifact for ${surface.skillId ?? surface.id}`,
      })
    : await createRequestWorkspaceArtifact(event as RequestWorkspaceEvent, {
        id: artifactId,
        session_id: input.sessionId ?? null,
        kind: "json-render",
        title,
        content,
        source: "ai",
        summary: `Created intake artifact for ${surface.skillId ?? surface.id}`,
      });

  if (!artifact) throw new Error(`Intake artifact ${artifactId} could not be created or updated.`);
  await recordIntakeTelemetry(event, {
    sessionId: artifact.session_id,
    requestId: input.requestId,
    event: existing ? "artifact.intake.version_created" : "artifact.intake.created",
    ok: true,
    payload: { artifactId: artifact.id, version: artifact.version, skillId: surface.skillId ?? null, surfaceId: surface.id },
  });
  return artifact;
}

export async function recordIntakeQuestionAsked(event: RequestWorkspaceEvent | null | undefined, input: RecordIntakeQuestionAskedInput): Promise<IntakeQuestionAskedReceipt> {
  const artifact = await requireIntakeArtifact(event, input.artifactId);
  const version = latestArtifactVersion(await listRequestWorkspaceArtifactVersions(event as RequestWorkspaceEvent, artifact.id));
  if (!isSpec(version.content)) throw new Error(`Intake artifact ${artifact.id} latest version is not a JSON-render spec.`);
  const question = resolvePersistedQuestion(version.content, input.questionId);

  await recordIntakeTelemetry(event, {
    sessionId: artifact.session_id,
    requestId: input.requestId,
    event: "tool.askUserQuestion",
    ok: true,
    payload: {
      artifactId: artifact.id,
      version: version.version_number,
      questionId: question.id,
      answerType: question.answerType,
      required: question.required,
      writesTo: question.writesTo ?? null,
      execution: "none",
      approval: "not_granted",
    },
  });

  return { artifact, version, question, execution: "none", approval: "not_granted" };
}

export async function updateIntakeArtifactState(event: RequestWorkspaceEvent | null | undefined, input: UpdateIntakeArtifactStateInput): Promise<IntakeArtifactRecord> {
  const artifact = await requireIntakeArtifact(event, input.artifactId);
  const latest = latestArtifactVersion(await listRequestWorkspaceArtifactVersions(event as RequestWorkspaceEvent, artifact.id));
  const content = cloneSpec(latest.content);
  const submission = questionAnswerSubmissionSchema.parse(input.submission);
  const question = resolvePersistedQuestion(content, submission.questionId);
  const trustedSubmission = { ...submission, writesTo: question.writesTo };
  const updateResult = createQuestionAnswerStateUpdates(question, trustedSubmission);
  if (!updateResult.ok) {
    const message = updateResult.errors.map((error) => `${error.code}: ${error.message}`).join("; ");
    throw new Error(message || "Invalid question answer submission.");
  }

  content.state = content.state && typeof content.state === "object" ? content.state : {};
  for (const update of updateResult.updates) {
    writeJsonPointer(content.state, update.path, update.value);
  }

  const updated = await updateRequestWorkspaceArtifact(event as RequestWorkspaceEvent, artifact.id, {
    content,
    source: "user",
    summary: `Saved answer for ${updateResult.receipt.questionId}`,
  });
  if (!updated) throw new Error(`Intake artifact ${artifact.id} could not be updated.`);

  await recordIntakeTelemetry(event, {
    sessionId: updated.session_id,
    requestId: input.requestId,
    event: "tool.submitQuestionAnswer",
    ok: true,
    payload: { artifactId: updated.id, version: updated.version, receipt: updateResult.receipt },
  });
  await recordIntakeTelemetry(event, {
    sessionId: updated.session_id,
    requestId: input.requestId,
    event: "artifact.intake.version_created",
    ok: true,
    payload: { artifactId: updated.id, version: updated.version, questionId: updateResult.receipt.questionId },
  });
  return updated;
}

export async function validateIntakeManifest(event: RequestWorkspaceEvent | null | undefined, input: ValidateIntakeManifestInput): Promise<IntakeManifestValidationReceipt> {
  const { artifact, version, manifest } = await readLatestIntakeManifest(event, input.artifactId);
  const validation = validateManifest(manifest);
  await recordIntakeTelemetry(event, {
    sessionId: artifact.session_id,
    requestId: input.requestId,
    event: "manifest.validated",
    ok: validation.ok,
    payload: { artifactId: artifact.id, version: version.version_number, manifestType: validation.manifestType ?? null, blockingItems: validation.blockingItems, warningCount: validation.warnings.length },
  });
  if (validation.commandPreview.length > 0) {
    await recordIntakeTelemetry(event, {
      sessionId: artifact.session_id,
      requestId: input.requestId,
      event: "command.previewed",
      ok: true,
      payload: { artifactId: artifact.id, version: version.version_number, commandPreview: validation.commandPreview },
    });
  }
  return { artifact, version, manifest, validation, commandPreview: validation.commandPreview, execution: "none", approval: "not_granted" };
}

export async function exportIntakeManifest(event: RequestWorkspaceEvent | null | undefined, input: ExportIntakeManifestInput): Promise<IntakeManifestExportReceipt> {
  const validationReceipt = await validateIntakeManifest(event, input);
  const exportPayload = createExportPayload(validationReceipt.manifest, { exportedAt: input.exportedAt });
  return { ...validationReceipt, exportPayload };
}

function createIntakeSurfaceSpec(surface: InteractiveSurfaceSpec): Spec {
  const questionIds = surface.questions.map((question, index) => `question-${index}-${escapeJsonPointerSegment(question.id).replace(/[^a-zA-Z0-9_~.-]/g, "-")}`);
  const elements: Spec["elements"] = {
    main: {
      type: "Stack",
      props: { direction: "vertical", gap: "md", wrap: null },
      children: ["surface-header", ...questionIds],
    },
    "surface-header": {
      type: "Card",
      props: { title: surface.title, description: surface.description || null },
      children: [],
    },
  };

  if (surface.state.manifest && typeof surface.state.manifest === "object") {
    elements.main.children = [...(elements.main.children ?? []), "manifest-preview"];
    elements["manifest-preview"] = {
      type: "ManifestPreview",
      props: { title: "Manifest draft", manifest: { $bindState: "/manifest" }, emptyMessage: "No manifest draft yet." },
      children: [],
    };
  }

  const draftAnswers: Record<string, unknown> = {};
  const questionStates: Record<string, unknown> = {};
  for (const [index, question] of surface.questions.entries()) {
    const questionIdSegment = escapeJsonPointerSegment(question.id);
    draftAnswers[question.id] = question.defaultValue ?? null;
    questionStates[question.id] = "draft";
    elements[questionIds[index]] = {
      type: "QuestionCard",
      props: {
        questionId: question.id,
        title: question.title,
        body: question.body,
        whyThisMatters: question.whyThisMatters ?? null,
        answerType: question.answerType,
        choices: question.choices,
        value: { $bindState: `/draftAnswers/${questionIdSegment}` },
        required: question.required,
        allowSkip: question.allowSkip,
        skipValue: question.skipValue,
        writesTo: question.writesTo ?? null,
        minSelections: question.minSelections,
        maxSelections: normalizeRenderedMaxSelections(question.answerType, question.minSelections, question.maxSelections) ?? null,
        confidence: question.confidence ?? null,
        reviewRequired: question.reviewRequired,
        submitLabel: "Continue",
        skipLabel: "Mark unknown",
      },
      on: {
        // Submit/skip must read the SAME state pointer QuestionCard binds its
        // value to (/draftAnswers/<id>); any other path submits null forever.
        submit: {
          action: "submitAnswer",
          params: {
            questionId: question.id,
            value: { $state: `/draftAnswers/${questionIdSegment}` },
            skipped: false,
            writesTo: question.writesTo ?? null,
          },
        },
        skip: {
          action: "submitAnswer",
          params: {
            questionId: question.id,
            value: { $state: `/draftAnswers/${questionIdSegment}` },
            skipped: true,
            writesTo: question.writesTo ?? null,
          },
        },
      },
      children: [],
    };
  }

  return {
    root: "main",
    elements,
    state: {
      ...surface.state,
      surface: { id: surface.id, kind: surface.kind, title: surface.title, skillId: surface.skillId ?? null, artifactId: surface.artifactId ?? null },
      draftAnswers: { ...draftAnswers, ...(isRecord(surface.state.draftAnswers) ? surface.state.draftAnswers : {}) },
      answers: isRecord(surface.state.answers) ? surface.state.answers : {},
      questionStates: { ...questionStates, ...(isRecord(surface.state.questionStates) ? surface.state.questionStates : {}) },
      questionSubmissions: isRecord(surface.state.questionSubmissions) ? surface.state.questionSubmissions : {},
      answerWrites: isRecord(surface.state.answerWrites) ? surface.state.answerWrites : {},
    },
  } as Spec;
}

function resolvePersistedQuestion(content: Spec, questionId: string): AskUserQuestionSpec {
  for (const element of Object.values(content.elements ?? {})) {
    if (!element || typeof element !== "object" || Array.isArray(element)) continue;
    if ((element as { type?: unknown }).type !== "QuestionCard") continue;
    const props = (element as { props?: unknown }).props;
    if (!isRecord(props) || props.questionId !== questionId) continue;
    return createAskUserQuestionSpec({
      id: props.questionId,
      title: props.title,
      body: props.body,
      whyThisMatters: props.whyThisMatters === null ? undefined : props.whyThisMatters,
      answerType: props.answerType,
      choices: props.choices,
      required: props.required,
      allowSkip: props.allowSkip,
      skipValue: props.skipValue,
      writesTo: props.writesTo === null ? undefined : props.writesTo,
      minSelections: props.minSelections,
      maxSelections: normalizeRenderedMaxSelections(props.answerType, props.minSelections, props.maxSelections),
      confidence: props.confidence === null ? undefined : props.confidence,
      reviewRequired: props.reviewRequired,
    });
  }
  throw new Error(`Question ${questionId} was not found in persisted intake artifact.`);
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readLatestIntakeManifest(event: RequestWorkspaceEvent | null | undefined, artifactId: string): Promise<{ artifact: IntakeArtifactRecord; version: WorkspaceArtifactVersionRecord; manifest: unknown }> {
  const artifact = await requireIntakeArtifact(event, artifactId);
  const version = latestArtifactVersion(await listRequestWorkspaceArtifactVersions(event as RequestWorkspaceEvent, artifact.id));
  const content = version.content;
  if (!isSpec(content)) throw new Error(`Intake artifact ${artifact.id} latest version is not a JSON-render spec.`);
  const manifest = content.state?.manifest;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error(`Intake artifact ${artifact.id} latest version has no manifest object.`);
  return { artifact, version, manifest };
}

async function requireIntakeArtifact(event: RequestWorkspaceEvent | null | undefined, artifactId: string): Promise<IntakeArtifactRecord> {
  const artifact = await getRequestWorkspaceArtifact(event as RequestWorkspaceEvent, artifactId);
  if (!artifact) throw new Error(`Intake artifact ${artifactId} was not found.`);
  if (artifact.kind !== "json-render") throw new Error(`Intake artifact ${artifactId} must be a json-render artifact.`);
  return artifact;
}

function latestArtifactVersion(versions: WorkspaceArtifactVersionRecord[]): WorkspaceArtifactVersionRecord {
  const latest = [...versions].sort((a, b) => b.version_number - a.version_number)[0];
  if (!latest) throw new Error("Intake artifact has no persisted versions.");
  return latest;
}

function cloneSpec(value: unknown): Spec {
  if (!isSpec(value)) throw new Error("Intake artifact latest version content must be a JSON-render spec.");
  return structuredClone(value) as Spec;
}

function isSpec(value: unknown): value is Spec {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { root?: unknown }).root === "string" && Boolean((value as { elements?: unknown }).elements) && typeof (value as { elements?: unknown }).elements === "object";
}

function writeJsonPointer(root: Record<string, unknown>, pointer: string, value: unknown): void {
  if (!pointer.startsWith("/")) throw new Error(`State update path must be a JSON pointer: ${pointer}`);
  const segments = pointer.slice(1).split("/").map(decodeJsonPointerSegment);
  let cursor: Record<string, unknown> = root;
  for (const segment of segments.slice(0, -1)) {
    const existing = cursor[segment];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  const finalSegment = segments.at(-1);
  if (!finalSegment) throw new Error("State update path must not target the root object.");
  cursor[finalSegment] = value;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

async function recordIntakeTelemetry(event: RequestWorkspaceEvent | null | undefined, input: { sessionId?: string | null; requestId?: string | null; event: string; ok: boolean; payload: unknown }): Promise<void> {
  try {
    await getRequestWorkspacePersistence(event as RequestWorkspaceEvent).recordTelemetryEvent({
      session_id: input.sessionId ?? null,
      request_id: input.requestId ?? null,
      source: "server",
      event: input.event,
      payload: input.payload,
      ok: input.ok,
      error: null,
    });
  } catch (error) {
    // Intentional fail-soft telemetry boundary: artifact persistence, manifest validation, and export receipts
    // are the authoritative outputs for this seam; telemetry loss is preserved in request logs for operators.
    console.warn("sonik_agent_ui_intake_telemetry_failed", {
      event: input.event,
      requestId: input.requestId ?? null,
      sessionId: input.sessionId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
