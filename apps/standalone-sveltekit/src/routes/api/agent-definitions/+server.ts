// Phase 4 (agent-creation-tool-plan-2026-07-13.md): draft CRUD + publish for
// agent definitions, following the api/command-registry precedent -- a thin
// handler delegating everything to $lib/server/agent-definition-store.

import {
  agentDefinitionAuthorityFromHostSession,
  assertAgentDefinitionAuthorized,
  resolveAgentDefinitionStore,
  type AgentDefinitionAction,
  type AgentDefinitionAuthority,
} from "$lib/server/agent-definition-store";
import { agentDefinitionSchema, type MarketplaceManifest } from "@sonik-agent-ui/tool-contracts/marketplace";
import { agentDefinitionsRateLimiter, readJsonBodyWithSizeCap } from "$lib/server/request-abuse-guard";
import { createAgentHostSessionEnvelope } from "$lib/server/host-command-runtime";
import type { RequestEvent } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

function requireAuthority(event: RequestEvent, action: AgentDefinitionAction): AgentDefinitionAuthority | Response {
  const authority = agentDefinitionAuthorityFromHostSession(createAgentHostSessionEnvelope(event));
  try {
    assertAgentDefinitionAuthorized(authority, action);
    return authority;
  } catch (error) {
    const message = error instanceof Error ? error.message : "agent_definition_authorization_failed";
    return Response.json({ ok: false, error: message }, { status: message.endsWith("_forbidden") ? 403 : 401 });
  }
}

export const GET: RequestHandler = async (event) => {
  const { url, platform } = event;
  const authority = requireAuthority(event, "view");
  if (authority instanceof Response) return authority;
  const agentId = url.searchParams.get("agentId");
  if (!agentId) {
    // No cross-session enumeration: drafts can carry prompts/overrides that
    // must not be disclosed across sessions. Fetch by explicit agentId only.
    return Response.json({ ok: false, error: "agentId_required" }, { status: 400 });
  }
  // P0 #1: Neon-backed when a DB env is configured, in-memory fallback otherwise.
  const agentDefinitionStore = resolveAgentDefinitionStore(platform?.env as Record<string, unknown> | undefined);
  return Response.json({
    draft: await agentDefinitionStore.getDraft(authority, agentId),
    publishedVersions: await agentDefinitionStore.listPublishedVersions(authority, agentId),
  });
};

export const POST: RequestHandler = async (event) => {
  const { request, getClientAddress, platform } = event;
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
    const authority = requireAuthority(event, "edit_draft");
    if (authority instanceof Response) return authority;
    const parsed = agentDefinitionSchema.safeParse((body as Record<string, unknown>).definition);
    if (!parsed.success) {
      return Response.json({ ok: false, error: "invalid_agent_definition", issues: parsed.error.issues }, { status: 400 });
    }
    const draft = await agentDefinitionStore.saveDraft(authority, parsed.data);
    return Response.json({ ok: true, draft });
  }

  if (action === "publish") {
    const authority = requireAuthority(event, "publish");
    if (authority instanceof Response) return authority;
    const { agentId, packageSemver, title } = body as Record<string, unknown>;
    if (typeof agentId !== "string" || typeof packageSemver !== "string") {
      return Response.json({ ok: false, error: "agentId_and_packageSemver_required" }, { status: 400 });
    }
    try {
      const serverAssignedPublisher: MarketplaceManifest["publisher"] = {
        publisherId: authority.organizationId,
        displayName: authority.organizationId,
        type: "creator",
      };
      const version = await agentDefinitionStore.publish(authority, {
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
