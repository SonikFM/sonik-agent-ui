import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// E7 (Half-assed-work exposure) red acceptance suite.
// Companion to .omc/plans/2026-07-22-e7-tautology-inventory.md.
//
// The inventory audited all 8 tests in tests/unit/pr61-contract-hardening.test.mjs plus the
// static-mirror substring-sync block in tests/unit/agent-embed.test.mjs. Six of the eight are
// tautological (assert doc prose / source-text regex, not runtime behavior). For five of those
// six, and for the agent-embed static-mirror block, real behavioral coverage was FOUND already
// existing elsewhere (host-authority-recovery.test.mjs, dev-workbench-server.test.mjs,
// target-registry-contracts.test.mjs, apps/dev-workbench/e2e/embedded-workbench.spec.ts,
// tests/unit/agent-embed-bundle-parity.test.mjs) -- see the inventory for exact pointers. That
// is an honest surprise, not a gap: writing another copy of an already-proven assertion here
// would be redundant filler, the exact sin E7 exists to remove.
//
// Exactly one claim survived the audit with NO real coverage anywhere and a concrete,
// plan-pinned seam to test against: pr61-contract-hardening's "runtime ownership pins
// installers" test asserts the ownership doc *mentions* a pinned skills-CLI version
// (npx skills@1.5.19 add) but nothing in the codebase enforces that the pin is honored --
// there is no skills-manifest module at all. R2 of the TDD plan names the wished-for artifact
// directly ("skills-manifest.json (new)"), so this is a pinned target, not an invented one.

async function importOrFail(specifier, what) {
  try {
    return await import(specifier);
  } catch (error) {
    assert.fail(`not implemented: ${what} (import of ${specifier} failed: ${error.message})`);
  }
}

test("E7.1: skills-manifest module pins the same skills-CLI version the ownership doc documents", async () => {
  const ownershipDoc = readFileSync("docs/architecture/dev-workbench-runtime-ownership-2026-07-20.md", "utf8");
  const documentedVersion = ownershipDoc.match(/npx skills@(\d+\.\d+\.\d+) add/)?.[1];
  assert.ok(documentedVersion, "ownership doc must document a pinned skills-CLI version to check against");

  const mod = await importOrFail(
    "../../apps/dev-workbench/src/lib/server/skills-manifest.ts",
    "R2 skills-manifest.json generator (apps/dev-workbench/src/lib/server/skills-manifest.ts exporting buildSkillsManifest)",
  );
  if (typeof mod.buildSkillsManifest !== "function") {
    assert.fail("not implemented: buildSkillsManifest export from apps/dev-workbench/src/lib/server/skills-manifest.ts");
  }
  const manifest = mod.buildSkillsManifest();
  assert.equal(
    manifest.skillsCliVersion,
    documentedVersion,
    "the generated skills-manifest.json must pin the exact skills-CLI version the ownership doc documents, so the two cannot drift apart silently",
  );
});
