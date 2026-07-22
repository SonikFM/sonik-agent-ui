import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// E5 (Epic 5 - Distribution root-cause EXPERIMENT) red acceptance suite.
// Pinned wished-for build contract (.omc/plans/2026-07-21-dev-workbench-agent-tdd-plan.md, Epic E5):
//   scripts/build-agent-embed-bundle.mjs bundles packages/agent-embed (today TS-only --
//   package.json "build": "tsc -p tsconfig.json", no bundler) into a NEW artifact
//   apps/standalone-sveltekit/static/vendor/sonik-agent-ui/agent-embed.bundle.js
//   plus a manifest agent-embed.bundle.json {builtAt, sourcePackageVersion, exports, sha256}.
// Real hosts today consume a HAND-MAINTAINED mirror at
// apps/standalone-sveltekit/static/vendor/sonik-agent-ui/agent-embed.js (488 lines) that
// silently dropped mountVisualContextPicker (zero "visualContext" occurrences) and is kept
// in sync only by substring assertions in tests/unit/agent-embed.test.mjs. None of the
// build script / bundle / manifest exist yet -- every test below must FAIL cleanly (via
// assert, not a crash) except the deliberately today-true half of E5.5.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, "..", "..");
const BUILD_SCRIPT_PATH = path.join(REPO_ROOT, "scripts/build-agent-embed-bundle.mjs");
const VENDOR_DIR = path.join(REPO_ROOT, "apps/standalone-sveltekit/static/vendor/sonik-agent-ui");
const BUNDLE_PATH = path.join(VENDOR_DIR, "agent-embed.bundle.js");
const MANIFEST_PATH = path.join(VENDOR_DIR, "agent-embed.bundle.json");
const LEGACY_MIRROR_PATH = path.join(VENDOR_DIR, "agent-embed.js");

// ponytail: memoized so the (currently nonexistent) build only gets spawned once across
// this file's tests instead of once per assertion.
let buildResultCache;

function runBuildScript() {
  if (!buildResultCache) {
    buildResultCache = spawnSync(process.execPath, [BUILD_SCRIPT_PATH], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
  }
  return buildResultCache;
}

async function loadBuiltArtifacts() {
  const result = runBuildScript();
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : `exit code ${result.status}: ${result.stderr}`;
    assert.fail(`not implemented: scripts/build-agent-embed-bundle.mjs must exist and build the bundle+manifest (${detail})`);
  }
  let bundleText;
  try {
    bundleText = await readFile(BUNDLE_PATH, "utf8");
  } catch (error) {
    assert.fail(`not implemented: build script must produce ${BUNDLE_PATH} (${error.message})`);
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch (error) {
    assert.fail(`not implemented: build script must produce ${MANIFEST_PATH} (${error.message})`);
  }
  return { bundleText, manifest };
}

test("E5.1: build script exists and runs, producing the bundle + manifest artifacts", async () => {
  const result = runBuildScript();
  assert.equal(
    result.error,
    undefined,
    `not implemented: scripts/build-agent-embed-bundle.mjs is missing or failed to spawn (${result.error?.message})`,
  );
  assert.equal(
    result.status,
    0,
    `not implemented: scripts/build-agent-embed-bundle.mjs must exit 0 (stderr: ${result.stderr})`,
  );
  const bundleStat = await stat(BUNDLE_PATH).catch(() => null);
  assert.ok(bundleStat, `not implemented: build script must produce ${BUNDLE_PATH}`);
  const manifestStat = await stat(MANIFEST_PATH).catch(() => null);
  assert.ok(manifestStat, `not implemented: build script must produce ${MANIFEST_PATH}`);
});

test("E5.2: parity -- manifest.exports is a superset of the package's public API, including mountVisualContextPicker", async () => {
  const { manifest } = await loadBuiltArtifacts();
  assert.ok(Array.isArray(manifest.exports), "not implemented: manifest.exports must be an array of export names");
  assert.ok(manifest.exports.includes("mountSonikAgentUI"), "manifest.exports must include mountSonikAgentUI");
  assert.ok(
    manifest.exports.includes("mountVisualContextPicker"),
    "manifest.exports must include mountVisualContextPicker -- the export the hand-mirror silently dropped",
  );
});

test("E5.3: bundle self-containment -- bundle ships the live-DOM helper so the picker cannot throw its version check alone", async () => {
  const { bundleText } = await loadBuiltArtifacts();
  assert.ok(
    bundleText.includes("__IMPECCABLE_LIVE_DOM__"),
    "not implemented: bundle text must include the __IMPECCABLE_LIVE_DOM__ marker so the visual-context-picker version check (packages/agent-embed/src/vendor/impeccable/visual-context-picker) passes when the bundle ships alone",
  );
});

test("E5.4: drift guard -- manifest.sha256 matches the actual sha256 of the built bundle file", async () => {
  const { bundleText, manifest } = await loadBuiltArtifacts();
  assert.equal(typeof manifest.sha256, "string", "not implemented: manifest.sha256 must be a string");
  const actualSha256 = createHash("sha256").update(bundleText, "utf8").digest("hex");
  assert.equal(
    manifest.sha256,
    actualSha256,
    "manifest.sha256 must match the actual sha256 of the built bundle file -- a hand-edit after build must break this",
  );
});

// E5 FALSIFICATION GUARD (plan D5): this test documents the experiment, it does not just
// assert a requirement. The first half is TODAY-TRUE and must keep passing forever -- it is
// the evidence for the historical distribution gap. The second half is the wished-for fix
// and fails red today. NOTE FOR THE GREEN LANE: if the second half goes green but an actual
// host fixture still cannot mount the picker end-to-end, STOP per the plan -- root cause was
// NOT distribution, re-diagnose before any Amplify picker work.
test("E5.5: falsification check -- legacy mirror lacks visualContext (today-true), new bundle carries mountVisualContextPicker (red today)", async () => {
  const legacyMirrorSource = await readFile(LEGACY_MIRROR_PATH, "utf8");
  assert.ok(
    !legacyMirrorSource.includes("visualContext"),
    "TODAY-TRUE: the legacy hand-mirror must contain zero 'visualContext' occurrences -- this is the historical gap the experiment exists to explain",
  );

  const { bundleText } = await loadBuiltArtifacts();
  assert.ok(
    bundleText.includes("mountVisualContextPicker"),
    "not implemented: the new bundle must contain mountVisualContextPicker -- the fix half of the falsification pair",
  );
});
