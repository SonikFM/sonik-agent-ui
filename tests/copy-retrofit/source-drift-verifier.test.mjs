import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = await mkdtemp(join(tmpdir(), "source-drift-"));
const upstream = join(root, "upstream");
const destination = join(root, "copied.txt");
const manifestPath = join(root, "manifest.json");
const verifier = resolve("scripts/verify-source-drift.mjs");
await mkdir(upstream);
execFileSync("git", ["init", "-q"], { cwd: upstream });
execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: upstream });
execFileSync("git", ["config", "user.name", "Source Drift Test"], { cwd: upstream });
await writeFile(join(upstream, "source.txt"), "pinned\n");
execFileSync("git", ["add", "source.txt"], { cwd: upstream });
execFileSync("git", ["commit", "-qm", "pinned"], { cwd: upstream });
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: upstream, encoding: "utf8" }).trim();
await writeFile(destination, "pinned\n");
await writeFile(join(upstream, "source.txt"), "mutable checkout\n");
execFileSync("git", ["commit", "-qam", "move checkout"], { cwd: upstream });
await writeFile(manifestPath, JSON.stringify({
  upstream: { repoPath: upstream, revision },
  entries: [{
    source: "source.txt",
    destination: "copied.txt",
    integrity: { files: [{ path: "", sha256: createHash("sha256").update("pinned\n").digest("hex") }] },
  }],
}));

const verified = execFileSync(process.execPath, [verifier, manifestPath], { cwd: root, encoding: "utf8" });
assert.match(verified, /mutable checkout differs from pinned revision/);
await writeFile(destination, "wrong\n");
assert.throws(() => execFileSync(process.execPath, [verifier, manifestPath], { cwd: root, stdio: "pipe" }), /Command failed/);
assert.throws(() => execFileSync(process.execPath, [verifier, manifestPath], {
  cwd: root,
  env: { ...process.env, COPY_RETROFIT_REQUIRE_SOURCE: "1" },
  stdio: "pipe",
}), /Command failed/);

console.log("source drift verifier: pinned integrity survives mutable checkout and rejects drift");
