import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export type ObservationEvent = { kind: "console" | "network"; [key: string]: unknown };

export async function appendObservationEvents(
  paths: { consolePath: string; networkPath: string },
  events: readonly ObservationEvent[],
): Promise<void> {
  const byPath = new Map<string, string>();
  for (const event of events) {
    const target = event.kind === "network" ? paths.networkPath : paths.consolePath;
    byPath.set(target, `${byPath.get(target) ?? ""}${JSON.stringify(event)}\n`);
  }
  for (const [target, lines] of byPath) {
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, lines, "utf8");
  }
}
