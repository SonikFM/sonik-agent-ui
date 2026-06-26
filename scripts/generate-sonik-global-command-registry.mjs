import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGlobalCommandRegistryArtifact } from "../packages/command-generator/src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bookingArtifactPath = resolve(root, "tests/fixtures/generated/sonik-booking-command-artifacts.generated.json");
const outputPath = resolve(root, "tests/fixtures/generated/sonik-global-command-registry.generated.json");
const runtimeOutputPath = resolve(root, "apps/standalone-sveltekit/src/lib/server/generated/sonik-global-command-registry.generated.json");
const checkMode = process.argv.includes("--check");
const sdkOutputPath = resolveOptionalPath(readFlagValue("--sdk-output") ?? process.env.SONIK_COMMAND_REGISTRY_SDK_OUTPUT);
const outputPaths = [outputPath, runtimeOutputPath, ...(sdkOutputPath ? [sdkOutputPath] : [])];

const bookingArtifact = JSON.parse(await readFile(bookingArtifactPath, "utf8"));
const registry = createGlobalCommandRegistryArtifact({
  provider: "sonik-global-command-registry",
  generatedAt: bookingArtifact.generatedAt,
  providers: [{
    provider: bookingArtifact.manifest.provider,
    generatedAt: bookingArtifact.generatedAt,
    source: normalizeProviderSource(bookingArtifact.source),
    summary: bookingArtifact.summary,
    manifest: bookingArtifact.manifest,
    registry: bookingArtifact.registry,
    catalog: bookingArtifact.catalog,
    projections: bookingArtifact.projections,
  }],
});
const serializedOutput = `${JSON.stringify(registry, null, 2)}\n`;

if (checkMode) {
  for (const currentOutputPath of outputPaths) {
    let existingOutput = "";
    try {
      existingOutput = await readFile(currentOutputPath, "utf8");
    } catch (error) {
      console.error(`Global command registry artifact is missing: ${currentOutputPath}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    if (existingOutput !== serializedOutput) {
      console.error(`Global command registry artifact is stale: ${currentOutputPath}`);
      console.error("Run pnpm generate:commands:sonik-global and commit the updated artifact.");
      process.exit(1);
    }

    console.log(`Checked ${currentOutputPath}`);
  }
} else {
  for (const currentOutputPath of outputPaths) {
    await mkdir(dirname(currentOutputPath), { recursive: true });
    await writeFile(currentOutputPath, serializedOutput);
    console.log(`Wrote ${currentOutputPath}`);
  }
}
console.log(JSON.stringify(registry.summary));

function readFlagValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${flag} requires a value`);
    process.exit(1);
  }
  return value;
}

function resolveOptionalPath(value) {
  if (!value) return undefined;
  return resolve(process.cwd(), value);
}

function normalizeProviderSource(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return source;
  const normalized = { ...source };
  if (typeof normalized.sourceRepo === "string") {
    normalized.sourceRepo = normalized.sourceRepo.split(/[\\/]/).filter(Boolean).at(-1) ?? normalized.sourceRepo;
  }
  return normalized;
}
