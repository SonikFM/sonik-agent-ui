import { json } from "@sveltejs/kit";
import { listRequestWorkspaceSessions } from "$lib/server/workspace-request-store";
import { WorkspaceRuntimeResolutionError, createWorkspaceRuntimeDiagnosticHeaders } from "$lib/server/workspace-services";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  try {
    return json(await listRequestWorkspaceSessions(event, { archived: true }), { headers: createWorkspaceRuntimeDiagnosticHeaders(event) });
  } catch (caught) {
    logWorkspaceRouteError(caught);
    return json(createWorkspaceRouteErrorBody(caught), {
      status: caught instanceof WorkspaceRuntimeResolutionError ? 503 : 500,
      headers: createWorkspaceRuntimeDiagnosticHeaders(event),
    });
  }
};

function createWorkspaceRouteErrorBody(caught: unknown): { ok: false; error: string; code?: string } {
  if (caught instanceof WorkspaceRuntimeResolutionError) return { ok: false, error: "Workspace cloud runtime is not available.", code: caught.code };
  return { ok: false, error: "Workspace archived sessions request failed" };
}

function logWorkspaceRouteError(caught: unknown): void {
  console.error("sonik_agent_ui_workspace_route_error", {
    code: caught instanceof WorkspaceRuntimeResolutionError ? caught.code : "workspace-route-error",
    error: getWorkspaceRouteErrorMessage(caught),
  });
}

function getWorkspaceRouteErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
