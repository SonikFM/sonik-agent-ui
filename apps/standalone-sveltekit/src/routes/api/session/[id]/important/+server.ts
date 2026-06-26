import { error, json } from "@sveltejs/kit";
import { patchRequestWorkspaceSession } from "$lib/server/workspace-request-store";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const contentType = event.request.headers.get("content-type") ?? "";
  let rawValue = "";
  if (contentType.includes("application/json")) {
    const body = await event.request.json();
    rawValue = String(body.important ?? "");
  } else {
    const form = await event.request.formData();
    const raw = form.get("important");
    rawValue = typeof raw === "string" ? raw : "";
  }
  const is_important = rawValue === "true" || rawValue === "1" || rawValue === "on";
  const session = await patchRequestWorkspaceSession(event, event.params.id, { is_important });
  if (!session) error(404, "Session not found");
  return json(session);
};
