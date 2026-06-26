import type { JsonRenderArtifact } from "@sonik-agent-ui/artifact-model";
import type { PromoteJsonRenderArtifactResult } from "./json-render-promotion.ts";

export type ArtifactObservationEventType =
  | "inline_rendered"
  | "artifact_promoted"
  | "artifact_updated"
  | "artifact_unchanged";

export interface CreateArtifactObservationEventInput {
  result: PromoteJsonRenderArtifactResult;
  sourceMessageId: string;
  sourceUserMessageId?: string | null;
  userPrompt?: string | null;
  observationIndex?: number;
  observedAt?: string;
}

export interface ArtifactObservationEvent {
  id: string;
  type: ArtifactObservationEventType;
  artifactId?: string;
  artifactVersion?: number;
  promotionReason: PromoteJsonRenderArtifactResult["decision"]["reason"];
  sourceMessageId: string;
  sourceUserMessageId?: string;
  userPrompt: string;
  observationIndex: number;
  observedAt: string;
}

export interface ArtifactStatus {
  artifactId: string;
  artifactVersion: number;
  kind: JsonRenderArtifact["kind"];
  promotionReason: PromoteJsonRenderArtifactResult["decision"]["reason"];
  sourceMessageId: string;
  sourceUserMessageId?: string;
  sourcePrompt: string;
  updatedAt: string;
}

export function createArtifactObservationEvent({
  result,
  sourceMessageId,
  sourceUserMessageId,
  userPrompt,
  observationIndex = 0,
  observedAt = new Date().toISOString(),
}: CreateArtifactObservationEventInput): ArtifactObservationEvent {
  const type = getObservationType(result);
  const artifact = result.promoted ? result.artifact : null;

  return Object.freeze({
    id: [
      sourceMessageId,
      type,
      String(observationIndex),
      artifact?.id ?? "inline",
      result.decision.reason,
    ].join("::"),
    type,
    artifactId: artifact?.id,
    artifactVersion: artifact?.version,
    promotionReason: result.decision.reason,
    sourceMessageId,
    sourceUserMessageId: sourceUserMessageId?.trim() || undefined,
    userPrompt: userPrompt?.trim() ?? "",
    observationIndex,
    observedAt,
  });
}

export function createArtifactStatus(
  artifact: JsonRenderArtifact,
  event: ArtifactObservationEvent,
): ArtifactStatus {
  return Object.freeze({
    artifactId: artifact.id,
    artifactVersion: artifact.version,
    kind: artifact.kind,
    promotionReason: event.promotionReason,
    sourceMessageId: event.sourceMessageId,
    sourceUserMessageId: event.sourceUserMessageId,
    sourcePrompt: event.userPrompt,
    updatedAt: artifact.updatedAt,
  });
}

export function appendArtifactObservationEvent(
  events: readonly ArtifactObservationEvent[],
  event: ArtifactObservationEvent,
  limit = 8,
): ArtifactObservationEvent[] {
  const withoutDuplicate = events.filter((existing) => existing.id !== event.id);
  return [event, ...withoutDuplicate].slice(0, limit);
}

function getObservationType(
  result: PromoteJsonRenderArtifactResult,
): ArtifactObservationEventType {
  if (!result.promoted) {
    return "inline_rendered";
  }

  if (result.created) {
    return "artifact_promoted";
  }

  if (result.changed || result.metadataChanged) {
    return "artifact_updated";
  }

  return "artifact_unchanged";
}
