import { json } from "@sveltejs/kit";
import { createAgentHostSessionEnvelope } from "$lib/server/host-command-runtime";
import { getWorkflowHistory, hasExactWorkflowHistoryIdentifier, WORKFLOW_HISTORY_QUERY_KEYS } from "$lib/server/workflow-history";
import { resolveWorkflowRunJournalStore, resolveWorkflowRunStore } from "$lib/server/workflow-run-store";
import { workflowRunOwnerFromHostSession } from "$lib/server/workflow-runs";
import { getRequestWorkspacePersistence } from "$lib/server/workspace-request-store";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  const hostSession = createAgentHostSessionEnvelope(event);
  const owner = workflowRunOwnerFromHostSession(hostSession);
  if (!hostSession || !owner) return json({ ok: false, reason: "authenticated_workspace_owner_required" }, { status: 401 });
  const query = Object.fromEntries(WORKFLOW_HISTORY_QUERY_KEYS.flatMap((key) => {
    const value = event.url.searchParams.get(key);
    return value ? [[key, value]] : [];
  }));
  if (!query.sessionId && hostSession.sessionId && !hasExactWorkflowHistoryIdentifier(query)) query.sessionId = hostSession.sessionId;
  const env = event.platform?.env as Record<string, unknown> | undefined;
  const result = await getWorkflowHistory(query, {
    owner,
    workflowRuns: resolveWorkflowRunStore(env),
    journal: resolveWorkflowRunJournalStore(env),
    workspace: getRequestWorkspacePersistence(event),
  });
  return json(result, { status: result.ok ? 200 : 400 });
};
