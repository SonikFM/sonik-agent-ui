#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryEvents, readEvidenceEventsFromFile } from "./lib/agent-ui-evidence-query.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultLogPath = process.env.SONIK_AGENT_UI_TELEMETRY_LOG ?? path.join(repoRoot, ".omx", "logs", "agent-ui-telemetry.jsonl");

function parseArgs(argv) {
  const query = {};
  let logPath = defaultLogPath;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--log" || arg === "--logPath") {
      logPath = argv[++index] ?? logPath;
    } else if (arg.startsWith("--log=")) {
      logPath = arg.slice("--log=".length);
    } else if (arg.startsWith("--logPath=")) {
      logPath = arg.slice("--logPath=".length);
    } else if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
      query[rawKey] = inlineValue ?? argv[++index] ?? "";
    }
  }
  return { logPath, query };
}

async function main() {
  const { logPath, query } = parseArgs(process.argv.slice(2));
  const events = await readEvidenceEventsFromFile(logPath);
  const result = queryEvents(events, query);
  process.stdout.write(JSON.stringify({ ok: true, logPath, ...result }, null, 2));
  process.stdout.write("\n");
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.stdout.write("\n");
  process.exitCode = 1;
});
