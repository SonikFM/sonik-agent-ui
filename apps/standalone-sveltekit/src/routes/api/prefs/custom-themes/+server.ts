import { json } from "@sveltejs/kit";

let value: Record<string, unknown> = {};

export function GET() {
  return json({ value });
}

export async function PUT({ request }) {
  const body = await request.json().catch(() => ({}));
  value = typeof body.value === "object" && body.value !== null ? body.value : {};
  return json({ ok: true, value });
}
