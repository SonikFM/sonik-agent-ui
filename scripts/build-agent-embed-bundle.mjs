#!/usr/bin/env node
// E5 (distribution root-cause experiment): bundles packages/agent-embed into a
// self-contained browser artifact instead of the hand-maintained vendor mirror.
// See .omc/plans/2026-07-21-dev-workbench-agent-tdd-plan.md, Epic E5.
//
// esbuild is not a direct dependency anywhere in this repo (pnpm-workspace.yaml
// marks it `allowBuilds: false` / `ignoredBuiltDependencies`), but it is a real
// transitive dependency of vite (apps/standalone-sveltekit). We resolve it
// through vite's own resolution scope rather than hardcoding a pnpm store path,
// so this keeps working across esbuild version bumps.
//
// Self-containment note: packages/agent-embed/src/visual-context-picker.ts pulls
// in the Impeccable live-DOM helper via a plain side-effect import
// (`import "./vendor/impeccable/.../live-browser-dom.js"`), not a bare/package
// import. esbuild's bundler follows that relative import like any other module
// and inlines it automatically -- no special-casing needed here for the
// "__IMPECCABLE_LIVE_DOM__" marker to end up in the bundle text.

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..");
const PACKAGE_DIR = path.join(REPO_ROOT, "packages/agent-embed");
const ENTRY_PATH = path.join(PACKAGE_DIR, "src/index.ts");
const VENDOR_DIR = path.join(REPO_ROOT, "apps/standalone-sveltekit/static/vendor/sonik-agent-ui");
const BUNDLE_PATH = path.join(VENDOR_DIR, "agent-embed.bundle.js");
const MANIFEST_PATH = path.join(VENDOR_DIR, "agent-embed.bundle.json");

function resolveEsbuild() {
  // Prefer resolving esbuild through vite's own dependency scope (vite is a
  // direct dependency of apps/standalone-sveltekit) rather than guessing a
  // pnpm store path, which changes across esbuild version bumps.
  const standaloneDir = path.join(REPO_ROOT, "apps/standalone-sveltekit");
  try {
    const vitePkgPath = require.resolve("vite/package.json", { paths: [standaloneDir] });
    const esbuildEntry = require.resolve("esbuild", { paths: [path.dirname(vitePkgPath)] });
    return require(esbuildEntry);
  } catch {
    // Fall back to plain resolution in case esbuild is ever hoisted directly.
  }
  try {
    return require("esbuild");
  } catch (error) {
    console.error(
      "build-agent-embed-bundle: could not resolve esbuild (checked via vite's dependency scope and directly). " +
        "No bundler is installed without adding a new dependency -- stopping rather than adding one silently.",
    );
    console.error(error.message);
    process.exit(1);
  }
}

async function main() {
  const esbuild = resolveEsbuild();

  const result = await esbuild.build({
    entryPoints: [ENTRY_PATH],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2020",
    write: false,
    metafile: true,
    logLevel: "warning",
  });

  const bundleText = result.outputFiles[0].text;
  const metaOutput = Object.values(result.metafile.outputs)[0];
  const exportsList = metaOutput.exports;

  const packageJson = JSON.parse(await readFile(path.join(PACKAGE_DIR, "package.json"), "utf8"));
  const sha256 = createHash("sha256").update(bundleText, "utf8").digest("hex");

  const manifest = {
    builtAt: new Date().toISOString(),
    sourcePackageVersion: packageJson.version,
    exports: exportsList,
    sha256,
  };

  await mkdir(VENDOR_DIR, { recursive: true });
  await writeFile(BUNDLE_PATH, bundleText, "utf8");
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`build-agent-embed-bundle: wrote ${BUNDLE_PATH} (${bundleText.length} bytes)`);
  console.log(`build-agent-embed-bundle: wrote ${MANIFEST_PATH} (${exportsList.length} exports, sha256 ${sha256})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
