// Caches the signed x-sonik-agent-ui-host-context envelope on disk across
// separate `persona-run.mjs` CLI invocations (Path A drives one HTTP turn
// per process call), refreshing it before its ~10-minute expiry.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loginDeployedHostContext, isEnvelopeNearExpiry } from "./host-context.mjs";

function cachePath(repoRoot) {
  return path.join(repoRoot, ".omx", "logs", "persona-runs", "_host-context.json");
}

export async function getOrRefreshHostContext(repoRoot, { bookingUrl, email, password }) {
  const target = cachePath(repoRoot);
  const cachedText = await readFile(target, "utf8").catch(() => null);
  if (cachedText) {
    try {
      const cached = JSON.parse(cachedText);
      if (!isEnvelopeNearExpiry(cached.envelope)) return cached.envelope;
    } catch {
      // fall through to a fresh login
    }
  }
  const { envelope } = await loginDeployedHostContext({ bookingUrl, email, password });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify({ envelope, cachedAt: new Date().toISOString() }, null, 2));
  return envelope;
}
