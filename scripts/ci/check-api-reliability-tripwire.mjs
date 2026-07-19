#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const base = baseIndex >= 0 ? args[baseIndex + 1] : "";
const defaultPatterns = [
  "(^|/)(api|apis|controllers|routes|providers|contracts|schemas|webhooks?)(/|\\.|$)",
  "(^|/)(openapi|postman|amp\\.pkg)(/|\\.|$)",
  "(^|/)(tsoa|wrangler)\\.(json|toml)$",
];

function git(...gitArgs) {
  return execFileSync("git", gitArgs, { encoding: "utf8" }).trim();
}

function changedFiles() {
  const output = base
    ? git("diff", "--name-only", `${base}...HEAD`)
    : git("ls-files");
  return output ? output.split("\n").filter(Boolean) : [];
}

function patterns() {
  if (!process.env.API_RELIABILITY_PATHS_JSON) return defaultPatterns;
  const parsed = JSON.parse(process.env.API_RELIABILITY_PATHS_JSON);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    throw new Error("API_RELIABILITY_PATHS_JSON must be a JSON array of regex strings");
  }
  return parsed;
}

function workflowRisks() {
  const root = ".github/workflows";
  if (!existsSync(root)) return [];
  const risks = [];
  for (const name of readdirSync(root).filter((entry) => /\.ya?ml$/i.test(entry))) {
    const file = join(root, name);
    const activeLines = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    const pulls = /^\s*pull_request\s*:/m.test(activeLines) ||
      /^\s*on\s*:\s*\[[^\]]*pull_request[^\]]*\]/m.test(activeLines);
    const runsK6 = /\bk6\s+(run|cloud)\b/.test(activeLines) ||
      /grafana\/(run-k6-action|k6-action)/.test(activeLines);
    if (pulls && runsK6) risks.push(file);
  }
  return risks;
}

const files = changedFiles();
const matchers = patterns().map((pattern) => new RegExp(pattern, "i"));
const apiFiles = files.filter((file) => matchers.some((pattern) => pattern.test(file)));
const risks = workflowRisks();
const lines = [
  "## API reliability tripwire",
  "",
  apiFiles.length
    ? `API-facing change detected in ${apiFiles.length} file(s). Route bounded live proof through \`$api-reliability-testing\` only after host review and credentials are ready.`
    : "No API-facing change detected by the configured path patterns.",
  "",
  "Pull-request CI performed static safety checks only; it sent no k6 traffic.",
];
if (apiFiles.length) lines.push("", ...apiFiles.slice(0, 20).map((file) => `- \`${file}\``));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
if (apiFiles.length) console.log(`API reliability evidence required for ${apiFiles.length} changed file(s).`);
else console.log("API reliability tripwire: no API-facing change detected.");

if (risks.length) {
  console.error("Unsafe pull-request k6 execution detected:");
  for (const risk of risks) console.error(`- ${risk}`);
  console.error("Move live/load/fuzz/ingress/recovery execution to an explicitly authorized manual terminal lane.");
  process.exit(1);
}
console.log("API reliability tripwire passed: pull-request workflows contain no k6 execution.");
