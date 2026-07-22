import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// R2 (context inherited at boot) red acceptance suite.
// Pinned wished-for API (.omc/plans/2026-07-21-dev-workbench-agent-tdd-plan.md R2):
//   apps/dev-workbench/src/lib/contracts/workbench.ts: DEV_WORKBENCH_MIRROR_PATHS.capabilityMatrix/.skillsManifest
//   apps/dev-workbench/src/lib/server/bootstrap-plan.ts: SONIK_CAPABILITY_MATRIX_PATH/SONIK_SKILLS_MANIFEST_PATH env
//   apps/dev-workbench/src/lib/server/boot-context-artifacts.ts exporting writeBootContextArtifacts
//   apps/dev-workbench/src/lib/server/workspace-service.ts exporting createSandboxContextGuide, generated from
//     DEV_WORKBENCH_MIRROR_PATHS constants rather than hand-typed prose
// None of these exist/are wired yet -- every test below must FAIL with a clear "not implemented: ..."
// message (via assert.fail) rather than crash with an opaque import error.

async function importOrFail(specifier, what) {
  try {
    return await import(specifier);
  } catch (error) {
    assert.fail(`not implemented: ${what} (import of ${specifier} failed: ${error.message})`);
  }
}

async function loadWorkbenchContracts() {
  return importOrFail(
    "../../apps/dev-workbench/src/lib/contracts/workbench.ts",
    "apps/dev-workbench/src/lib/contracts/workbench.ts",
  );
}

async function loadBootstrapPlan() {
  return importOrFail(
    "../../apps/dev-workbench/src/lib/server/bootstrap-plan.ts",
    "apps/dev-workbench/src/lib/server/bootstrap-plan.ts",
  );
}

async function loadBootContextArtifacts() {
  const mod = await importOrFail(
    "../../apps/dev-workbench/src/lib/server/boot-context-artifacts.ts",
    "apps/dev-workbench/src/lib/server/boot-context-artifacts.ts exporting writeBootContextArtifacts",
  );
  if (typeof mod.writeBootContextArtifacts !== "function") {
    assert.fail("not implemented: writeBootContextArtifacts export from apps/dev-workbench/src/lib/server/boot-context-artifacts.ts");
  }
  return mod;
}

async function loadWorkspaceService() {
  return importOrFail(
    "../../apps/dev-workbench/src/lib/server/workspace-service.ts",
    "apps/dev-workbench/src/lib/server/workspace-service.ts",
  );
}

async function loadCapabilityMatrix() {
  const mod = await importOrFail(
    "../../packages/tool-contracts/src/capability-matrix.ts",
    "packages/tool-contracts/src/capability-matrix.ts exporting buildCapabilityMatrix",
  );
  if (typeof mod.buildCapabilityMatrix !== "function") {
    assert.fail("not implemented: buildCapabilityMatrix export from packages/tool-contracts/src/capability-matrix.ts");
  }
  return mod;
}

async function loadTargetRegistry() {
  return importOrFail(
    "../../packages/tool-contracts/src/target-registry.ts",
    "packages/tool-contracts/src/target-registry.ts (fixture source for capability matrix)",
  );
}

async function loadSkillsManifest() {
  const mod = await importOrFail(
    "../../apps/dev-workbench/src/lib/server/skills-manifest.ts",
    "apps/dev-workbench/src/lib/server/skills-manifest.ts exporting buildSkillsManifest",
  );
  if (typeof mod.buildSkillsManifest !== "function") {
    assert.fail("not implemented: buildSkillsManifest export from apps/dev-workbench/src/lib/server/skills-manifest.ts");
  }
  return mod;
}

function fixtureRegistry(targetRegistryMod) {
  return targetRegistryMod.createHostUiTargetRegistry({
    provider: "boot-context-artifacts-red-suite",
    generatedAt: "2026-07-22T00:00:00.000Z",
    targets: [
      targetRegistryMod.normalizeHostUiTarget({
        targetId: "observe.console.read",
        label: "Console read",
        description: "Redacted host console ring buffer.",
        surface: "observability",
        capabilities: ["describe"],
      }),
      targetRegistryMod.normalizeHostUiTarget({
        targetId: "workspace.preview.restart",
        label: "Preview restart",
        description: "Restart the preview server.",
        surface: "dev-loop",
        capabilities: ["run"],
        enabled: false,
        disabledReason: "Preview restart is a permanent stub today.",
        policy: { actionMode: "block", reason: "Preview restart is a permanent stub today." },
      }),
    ],
  });
}

test("R2.1: DEV_WORKBENCH_MIRROR_PATHS declares capabilityMatrix + skillsManifest paths", async () => {
  const contracts = await loadWorkbenchContracts();
  assert.equal(
    contracts.DEV_WORKBENCH_MIRROR_PATHS.capabilityMatrix,
    `${contracts.DEV_WORKBENCH_STATE_ROOT}/capability-matrix.json`,
    "not implemented: DEV_WORKBENCH_MIRROR_PATHS.capabilityMatrix",
  );
  assert.equal(
    contracts.DEV_WORKBENCH_MIRROR_PATHS.skillsManifest,
    `${contracts.DEV_WORKBENCH_STATE_ROOT}/skills-manifest.json`,
    "not implemented: DEV_WORKBENCH_MIRROR_PATHS.skillsManifest",
  );
});

test("R2.2: bootstrap env carries SONIK_CAPABILITY_MATRIX_PATH/SONIK_SKILLS_MANIFEST_PATH", async () => {
  const bootstrapPlanMod = await loadBootstrapPlan();
  const workbenchContracts = await loadWorkbenchContracts();
  const repository = workbenchContracts.repositoryManifestSchema.parse({
    schemaVersion: workbenchContracts.DEV_WORKBENCH_SCHEMA_VERSION,
    repositoryId: "sonikfm.sonik-agent-ui",
    cloneUrl: "https://github.com/sonikfm/sonik-agent-ui.git",
    revision: "abc123def456",
    branch: "main",
    deployment: null,
    commands: workbenchContracts.DEFAULT_REPOSITORY_COMMANDS,
  });

  const plan = bootstrapPlanMod.createDevWorkbenchBootstrapPlan({
    sessionId: "boot-context-artifacts-red-suite",
    repository,
  });
  const flattened = JSON.stringify(plan);
  assert.equal(flattened.includes("SONIK_CAPABILITY_MATRIX_PATH"), true, "bootstrap plan env must include SONIK_CAPABILITY_MATRIX_PATH");
  assert.equal(flattened.includes("SONIK_SKILLS_MANIFEST_PATH"), true, "bootstrap plan env must include SONIK_SKILLS_MANIFEST_PATH");
});

test("R2.3: writeBootContextArtifacts writes schema-valid capability-matrix.json equal to buildCapabilityMatrix", async () => {
  const { writeBootContextArtifacts } = await loadBootContextArtifacts();
  const { buildCapabilityMatrix } = await loadCapabilityMatrix();
  const targetRegistryMod = await loadTargetRegistry();
  const registry = fixtureRegistry(targetRegistryMod);

  const dir = await mkdtemp(path.join(tmpdir(), "sonik-boot-context-"));
  const capabilityMatrixPath = path.join(dir, "capability-matrix.json");
  const skillsManifestPath = path.join(dir, "skills-manifest.json");
  try {
    await writeBootContextArtifacts({ capabilityMatrixPath, skillsManifestPath }, { registry });
    const parsed = JSON.parse(await readFile(capabilityMatrixPath, "utf8"));
    assert.match(parsed.capturedAt, /^\d{4}-\d{2}-\d{2}T/, "capability-matrix.json must carry an ISO capturedAt stamp");
    assert.ok(Array.isArray(parsed.entries), "capability-matrix.json must carry an entries array");
    for (const entry of parsed.entries) {
      assert.equal(typeof entry.commandId, "string", "every capability-matrix entry must carry a commandId");
      assert.equal(typeof entry.enabled, "boolean", "every capability-matrix entry must carry an enabled flag");
      if (!entry.enabled) {
        assert.equal(typeof entry.reason, "string", "disabled capability-matrix entries must carry a reason");
      }
    }
    assert.deepEqual(
      parsed.entries,
      JSON.parse(JSON.stringify(buildCapabilityMatrix(registry))),
      "capability-matrix.json entries must programmatically equal buildCapabilityMatrix over the same registry input",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("R2.4: writeBootContextArtifacts writes schema-valid skills-manifest.json equal to buildSkillsManifest", async () => {
  const { writeBootContextArtifacts } = await loadBootContextArtifacts();
  const skillsManifestMod = await loadSkillsManifest();
  const targetRegistryMod = await loadTargetRegistry();
  const registry = fixtureRegistry(targetRegistryMod);

  const dir = await mkdtemp(path.join(tmpdir(), "sonik-boot-context-"));
  const capabilityMatrixPath = path.join(dir, "capability-matrix.json");
  const skillsManifestPath = path.join(dir, "skills-manifest.json");
  try {
    await writeBootContextArtifacts({ capabilityMatrixPath, skillsManifestPath }, { registry });
    const parsed = JSON.parse(await readFile(skillsManifestPath, "utf8"));
    assert.match(parsed.capturedAt, /^\d{4}-\d{2}-\d{2}T/, "skills-manifest.json must carry an ISO capturedAt stamp");
    assert.equal(
      parsed.skillsCliVersion,
      skillsManifestMod.buildSkillsManifest().skillsCliVersion,
      "skills-manifest.json skillsCliVersion must equal buildSkillsManifest()'s",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("R2.5: sandbox context guide is generated from DEV_WORKBENCH_MIRROR_PATHS constants (parity, not hand-typed prose)", async () => {
  const workspaceServiceMod = await loadWorkspaceService();
  if (typeof workspaceServiceMod.createSandboxContextGuide !== "function") {
    assert.fail("not implemented: createSandboxContextGuide export from apps/dev-workbench/src/lib/server/workspace-service.ts");
  }
  const workbenchContracts = await loadWorkbenchContracts();
  const guide = workspaceServiceMod.createSandboxContextGuide();
  for (const [key, value] of Object.entries(workbenchContracts.DEV_WORKBENCH_MIRROR_PATHS)) {
    assert.equal(
      guide.includes(value),
      true,
      `context guide must mention DEV_WORKBENCH_MIRROR_PATHS.${key} (${value}) -- generated from the constant, not hand-typed prose`,
    );
  }
});
