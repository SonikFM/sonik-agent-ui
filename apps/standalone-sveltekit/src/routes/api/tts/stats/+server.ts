import { json } from "@sveltejs/kit";

export function GET() {
  return json({ available: false, ready: false, provider: "disabled", speed: 1 });
}
