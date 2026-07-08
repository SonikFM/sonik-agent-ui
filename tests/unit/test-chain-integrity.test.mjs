import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Guards against the "test lane silently skips a file" failure mode: every
// tests/unit/*.test.mjs file must be referenced by the root package.json
// "test" script, or pnpm test never runs it and a regression there ships
// unseen. Add new tests/unit files to the "test" script chain (or add an
// explicit, commented skip-list entry here) or this fails and lists the gap.

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const unitTestDir = path.join(repoRoot, "tests", "unit");
const packageJsonPath = path.join(repoRoot, "package.json");

const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const testScript = pkg.scripts?.test;
assert.ok(typeof testScript === "string" && testScript.length > 0, "package.json must define a non-empty \"test\" script");

const filesOnDisk = readdirSync(unitTestDir)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort();
assert.ok(filesOnDisk.length > 0, "tests/unit must contain at least one *.test.mjs file");

const missing = filesOnDisk.filter((name) => !testScript.includes(name));

assert.deepEqual(
  missing,
  [],
  `tests/unit files missing from package.json "test" script chain (silently skipped by pnpm test):\n  - ${missing.join("\n  - ")}`,
);

console.log("test chain integrity: all tests/unit/*.test.mjs files are wired into pnpm test");
