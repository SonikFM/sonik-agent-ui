// Phase 4 (agent-creation-tool-plan-2026-07-13.md): draft CRUD + publish for
// agent definitions, following the api/command-registry precedent -- a thin
// handler delegating everything to $lib/server/agent-definition-store.

import {
  resolveAgentDefinitionStore,
} from "$lib/server/agent-definition-store";
import { agentDefinitionSchema, type MarketplaceManifest } from "@sonik-agent-ui/tool-contracts/marketplace";
import { agentDefinitionsRateLimiter, readJsonBodyWithSizeCap } from "$lib/server/request-abuse-guard";
import type { RequestHandler } from "./$types";

// P1 (verify-wave code review, 2026-07-13): this route fronts a shared MUTABLE
// store with no auth/tenant scoping — acceptable only while the store is the
// in-memory single-process demo tier. Before any multi-tenant deploy it MUST be
// gated behind the auth/org context (credentials lane) and drafts/published
// versions scoped per org. Global draft enumeration already removed below.
export const GET: RequestHandler = async ({ url, platform }) => {
  const agentId = url.searchParams.get("agentId");
  if (!agentId) {
    // No cross-session enumeration: drafts can carry prompts/overrides that
    // must not be disclosed across sessions. Fetch by explicit agentId only.
    return Response.json({ ok: false, error: "agentId_required" }, { status: 400 });
  }
  // P0 #1: Neon-backed when a DB env is configured, in-memory fallback otherwise.
  const agentDefinitionStore = resolveAgentDefinitionStore(platform?.env as Record<string, unknown> | undefined);
  return Response.json({
    draft: await agentDefinitionStore.getDraft(agentId),
    publishedVersions: await agentDefinitionStore.listPublishedVersions(agentId),
  });
};

export const POST: RequestHandler = async ({ request, getClientAddress, platform }) => {
  // P1 #6 (production-readiness ledger): abuse guards on this shared mutable
  // route -- per-process rate limit + payload cap ahead of any auth/org lane.
  if (!agentDefinitionsRateLimiter.tryConsume(getClientAddress())) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const parsedBody = await readJsonBodyWithSizeCap(request);
  if (!parsedBody.ok) {
    return Response.json({ ok: false, error: parsedBody.error }, { status: parsedBody.status });
  }
  const body = parsedBody.body;
  if (!body || typeof body !== "object") {
    return Response.json({ ok: false, error: "invalid_json_body" }, { status: 400 });
  }
  const action = (body as Record<string, unknown>).action;
  // P0 #1: Neon-backed when a DB env is configured, in-memory fallback otherwise.
  const agentDefinitionStore = resolveAgentDefinitionStore(platform?.env as Record<string, unknown> | undefined);

  if (action === "save_draft") {
    const parsed = agentDefinitionSchema.safeParse((body as Record<string, unknown>).definition);
    if (!parsed.success) {
      return Response.json({ ok: false, error: "invalid_agent_definition", issues: parsed.error.issues }, { status: 400 });
    }
    const draft = await agentDefinitionStore.saveDraft(parsed.data);
    return Response.json({ ok: true, draft });
  }

  if (action === "publish") {
    const { agentId, packageSemver, title } = body as Record<string, unknown>;
    if (typeof agentId !== "string" || typeof packageSemver !== "string") {
      return Response.json({ ok: false, error: "agentId_and_packageSemver_required" }, { status: 400 });
    }
    try {
      // Provenance is server-assigned (verify-wave P2): a client-supplied
      // publisher could claim first-party ("sonik") trust. Until the auth lane
      // provides a real org identity, everything published here is community.
      const serverAssignedPublisher: MarketplaceManifest["publisher"] = { publisherId: "workspace-internal", displayName: "Workspace (internal)", type: "creator" };
      const version = await agentDefinitionStore.publish({
        agentId,
        packageSemver,
        title: typeof title === "string" ? title : undefined,
        publisher: serverAssignedPublisher,
      });
      return Response.json({ ok: true, version });
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "publish_failed" }, { status: 400 });
    }
  }

  return Response.json({ ok: false, error: "unknown_action" }, { status: 400 });
};
