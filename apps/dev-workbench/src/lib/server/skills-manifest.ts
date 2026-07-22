import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Seed of R2's skills-manifest.json bootstrap artifact (see TDD plan). Full bootstrap wiring
// (writing skills-manifest.json, comparing installed digests) is out of scope here -- this just
// pins the skills-CLI version so it can't silently drift from the ownership doc that documents it.

const OWNERSHIP_DOC_URL = new URL(
  "../../../../../docs/architecture/dev-workbench-runtime-ownership-2026-07-20.md",
  import.meta.url,
);

export type SkillsManifest = {
  skillsCliVersion: string;
};

export function buildSkillsManifest(): SkillsManifest {
  const doc = readFileSync(fileURLToPath(OWNERSHIP_DOC_URL), "utf8");
  const version = doc.match(/npx skills@(\d+\.\d+\.\d+) add/)?.[1];
  if (!version) throw new Error("ownership doc no longer documents a pinned skills-CLI version");
  return { skillsCliVersion: version };
}
