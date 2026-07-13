// Phase 7 (agent-creation-tool-plan-2026-07-13.md): the Amplify campaign wow demo's
// preview/commit implementation. Preview assembles campaign content deterministically
// from the brief -- no model call, mirroring previewBookingReservationCommand staying a
// pure preview. Commit persists the assembled content to the Knowledge v1 store
// (writeArtifactFile) and returns a receiptRef -- the artifact IS the commit's semantic
// receipt (D004/D006), never a model-drawn success surface. Callers wire these into
// WorkflowControllerCallbacks keyed by the campaign fixture's "preview"/"commit" nodeIds
// (see amplify-campaign-workflow-integration.test.mjs).

import type { KnowledgeStore } from "../knowledge/knowledge-store.ts";

export type AmplifyCampaignBrief = {
  productName: string;
  audience: string;
  offer: string;
  launchDate: string;
};

export type AmplifyCampaignContent = {
  title: string;
  contentPieces: string[];
  schedule: { launchDate: string };
  segments: string[];
};

export function assembleAmplifyCampaignContent(brief: AmplifyCampaignBrief): AmplifyCampaignContent {
  return {
    title: `${brief.productName} — ${brief.offer}`,
    contentPieces: [
      `Email: Introducing ${brief.productName} for ${brief.audience}.`,
      `SMS: ${brief.offer} — ends soon.`,
      `Push: Don't miss ${brief.productName}.`,
    ],
    schedule: { launchDate: brief.launchDate },
    segments: [brief.audience],
  };
}

export async function commitAmplifyCampaignArtifact(
  knowledgeStore: KnowledgeStore,
  storeId: string,
  content: AmplifyCampaignContent,
): Promise<{ receiptRef: string }> {
  const { fileRef } = await knowledgeStore.writeArtifactFile(storeId, content.title, JSON.stringify(content, null, 2));
  return { receiptRef: fileRef.path };
}
