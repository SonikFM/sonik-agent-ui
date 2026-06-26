import { json } from "@sveltejs/kit";

let value: unknown = null;

export function GET() {
  return json({ value });
}

export async function PUT({ request }) {
  const body = await request.json().catch(() => ({}));
  value = body.value ?? null;
  return json({ ok: true, value });
}
