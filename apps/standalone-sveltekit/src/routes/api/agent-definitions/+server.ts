// Phase 4 (agent-creation-tool-plan-2026-07-13.md): draft CRUD + publish for
// agent definitions, following the api/command-registry precedent -- a thin
// handler delegating everything to $lib/server/agent-definition-store.

import {
  agentDefinitionStore,
} from "$lib/server/agent-definition-store";
import { agentDefinitionSchema, type MarketplaceManifest } from "@sonik-agent-ui/tool-contracts/marketplace";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
  const agentId = url.searchParams.get("agentId");
  if (agentId) {
    return Response.json({
      draft: agentDefinitionStore.getDraft(agentId),
      publishedVersions: agentDefinitionStore.listPublishedVersions(agentId),
    });
  }
  return Response.json({ drafts: agentDefinitionStore.listDrafts() });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "invalid_json_body" }, { status: 400 });
  }
  const action = (body as Record<string, unknown>).action;

  if (action === "save_draft") {
    const parsed = agentDefinitionSchema.safeParse((body as Record<string, unknown>).definition);
    if (!parsed.success) {
      return Response.json({ ok: false, error: "invalid_agent_definition", issues: parsed.error.issues }, { status: 400 });
    }
    const draft = agentDefinitionStore.saveDraft(parsed.data);
    return Response.json({ ok: true, draft });
  }

  if (action === "publish") {
    const { agentId, packageSemver, title, publisher } = body as Record<string, unknown>;
    if (typeof agentId !== "string" || typeof packageSemver !== "string") {
      return Response.json({ ok: false, error: "agentId_and_packageSemver_required" }, { status: 400 });
    }
    try {
      const version = agentDefinitionStore.publish({
        agentId,
        packageSemver,
        title: typeof title === "string" ? title : undefined,
        publisher: publisher && typeof publisher === "object" ? publisher as MarketplaceManifest["publisher"] : undefined,
      });
      return Response.json({ ok: true, version });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "publish_failed" }, { status: 400 });
    }
  }

  return Response.json({ ok: false, error: "unknown_action" }, { status: 400 });
};
