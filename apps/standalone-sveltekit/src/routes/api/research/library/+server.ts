import { json } from "@sveltejs/kit";

export function GET() {
  return json({ research: [], items: [], total: 0, note: "Deep research library is deferred for the Sonik workspace pass." });
}
