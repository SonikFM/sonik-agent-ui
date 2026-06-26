import { json } from "@sveltejs/kit";
import { listRequestWorkspaceDocumentLibrary } from "$lib/server/workspace-request-store";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async (event) => {
  return json(await listRequestWorkspaceDocumentLibrary(event, {
    search: event.url.searchParams.get("search") ?? event.url.searchParams.get("q"),
    language: event.url.searchParams.get("language"),
    sort: event.url.searchParams.get("sort"),
    offset: Number(event.url.searchParams.get("offset") ?? 0),
    limit: Number(event.url.searchParams.get("limit") ?? 20),
    archived: event.url.searchParams.get("archived") === "true",
  }));
};
