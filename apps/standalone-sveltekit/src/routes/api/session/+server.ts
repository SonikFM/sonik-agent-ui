import { DEFAULT_WORKSPACE_SESSION_NAME } from "@sonik-agent-ui/workspace-session";
import { json } from "@sveltejs/kit";
import { createRequestWorkspaceSession } from "$lib/server/workspace-request-store";
import { WorkspaceRuntimeResolutionError, createWorkspaceRuntimeDiagnosticHeaders } from "$lib/server/workspace-services";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  try {
    const contentType = event.request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await event.request.json();
      return json(await createRequestWorkspaceSession(event, { name: typeof body.name === "string" ? body.name : DEFAULT_WORKSPACE_SESSION_NAME, mode: body.mode === "artifact" || body.mode === "document" || body.mode === "research" ? body.mode : "chat" }), { headers: createWorkspaceRuntimeDiagnosticHeaders(event) });
    }

    const form = await event.request.formData();
    const formName = form.get("name");
    const name = typeof formName === "string" && formName.trim() ? formName.trim() : "Workspace document session";
    return json(await createRequestWorkspaceSession(event, { name, mode: "document" }), { headers: createWorkspaceRuntimeDiagnosticHeaders(event) });
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
  return { ok: false, error: "Workspace session request failed" };
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
