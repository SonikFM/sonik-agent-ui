#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((file) => /\.(svelte|ts|js|mjs|md|html)$/.test(file));

const idRe = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/i;
const badPrefixes = [/^booking\.context\./, /^booking\.command\./];
const matches = [];
const failures = [];

for (const file of files) {
  const text = readFileSync(join(root, file), "utf8");
  const patterns = [
    /data-sonik-target=["']([^"']+)["']/g,
    /targetId\s*:\s*["']([^"']+)["']/g,
    /"targetId"\s*:\s*"([^"]+)"/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const id = match[1];
      if (!id.startsWith("agent.") && !id.startsWith("artifact.") && !id.includes(".ui.")) {
        // ponytail: only enforce the known confusing namespace; broader taxonomy can wait.
        if (badPrefixes.some((prefix) => prefix.test(id))) failures.push(`${file}: target '${id}' must be UI-only; use booking.ui.* instead.`);
      }
      if (!idRe.test(id)) failures.push(`${file}: target '${id}' is not a stable semantic id.`);
      matches.push({ file: relative(root, join(root, file)), id });
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`target-registry audit passed (${matches.length} target references checked)`);
