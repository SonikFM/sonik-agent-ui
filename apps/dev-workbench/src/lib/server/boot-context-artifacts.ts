import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCapabilityMatrix } from "@sonik-agent-ui/tool-contracts/capability-matrix";
import type { HostUiTargetRegistry } from "@sonik-agent-ui/tool-contracts/target-registry";
import { buildSkillsManifest } from "./skills-manifest";

export type BootContextArtifactPaths = {
  capabilityMatrixPath: string;
  skillsManifestPath: string;
};

/**
 * Registry-generated boot artifacts (R2): capability-matrix.json and
 * skills-manifest.json, each stamped with capturedAt so a stale mirror is
 * detectable. Plain fs so this is testable against a tmpdir; the sandbox
 * write path (sandbox.writeFiles) reads these same builders.
 */
export async function writeBootContextArtifacts(
  paths: BootContextArtifactPaths,
  input: { registry: HostUiTargetRegistry },
): Promise<void> {
  const capturedAt = new Date().toISOString();
  const capabilityMatrix = JSON.stringify(
    { capturedAt, entries: buildCapabilityMatrix(input.registry) },
    null,
    2,
  );
  const skillsManifest = JSON.stringify(
    { capturedAt, skillsCliVersion: buildSkillsManifest().skillsCliVersion },
    null,
    2,
  );
  await mkdir(path.dirname(paths.capabilityMatrixPath), { recursive: true });
  await mkdir(path.dirname(paths.skillsManifestPath), { recursive: true });
  await writeFile(paths.capabilityMatrixPath, capabilityMatrix, "utf8");
  await writeFile(paths.skillsManifestPath, skillsManifest, "utf8");
}
