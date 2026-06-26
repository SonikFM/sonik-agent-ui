import { json } from "@sveltejs/kit";

const settings: Record<string, unknown> = {
  tts_enabled: false,
  keybinds: {},
};

export function GET() {
  return json(settings);
}

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  if (body && typeof body === "object") Object.assign(settings, body);
  return json(settings);
}
