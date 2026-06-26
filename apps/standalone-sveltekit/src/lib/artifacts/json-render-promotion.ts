import type { Spec } from "@json-render/core";
import {
  createJsonRenderArtifactSignature,
  type JsonRenderArtifact,
  upsertJsonRenderArtifact,
} from "@sonik-agent-ui/artifact-model";
import {
  decideArtifactPromotion,
  type ArtifactPromotionDecision,
} from "./artifact-promotion.ts";

export interface PromoteJsonRenderArtifactInput {
  current?: JsonRenderArtifact | null;
  messageArtifactId: string;
  spec: Spec;
  userPrompt?: string | null;
  title?: string;
  now?: string;
  forcePromote?: boolean;
}

export interface PromoteJsonRenderArtifactResult {
  artifact: JsonRenderArtifact | null;
  decision: ArtifactPromotionDecision;
  promoted: boolean;
  signature: string;
  changed: boolean;
  created: boolean;
  metadataChanged: boolean;
}

export function promoteJsonRenderArtifact({
  current,
  messageArtifactId,
  spec,
  userPrompt,
  title = "Latest JSON artifact",
  now,
  forcePromote = false,
}: PromoteJsonRenderArtifactInput): PromoteJsonRenderArtifactResult {
  const signature = createJsonRenderArtifactSignature(spec);
  const decision = forcePromote
    ? {
        mode: "artifact" as const,
        promoteToArtifact: true,
        reuseActiveArtifact: false,
        reason: "explicit_artifact_request" as const,
      }
    : decideArtifactPromotion({
        hasRenderableSpec: true,
        userPrompt,
        activeArtifactId: current?.id,
      });

  if (!decision.promoteToArtifact) {
    return {
      artifact: current ?? null,
      decision,
      promoted: false,
      signature,
      changed: false,
      created: false,
      metadataChanged: false,
    };
  }

  const artifactId = decision.reuseActiveArtifact && current
    ? current.id
    : messageArtifactId;
  const artifactTitle = decision.reuseActiveArtifact && current
    ? current.title
    : title;
  const previousForUpsert = current?.id === artifactId ? current : null;
  const upsert = upsertJsonRenderArtifact({
    previous: previousForUpsert,
    id: artifactId,
    title: artifactTitle,
    spec,
    now,
  });

  return {
    artifact: upsert.artifact,
    decision,
    promoted: true,
    signature: upsert.signature,
    changed: upsert.changed,
    created: upsert.created,
    metadataChanged: upsert.metadataChanged,
  };
}
