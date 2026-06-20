import { json } from "@sveltejs/kit";
import { listOdysseusSessions } from "$lib/server/odysseus-document-store";

export function GET({ url }) {
  const archived = url.searchParams.get("archived") === "true";
  return json(listOdysseusSessions({ archived }));
}
