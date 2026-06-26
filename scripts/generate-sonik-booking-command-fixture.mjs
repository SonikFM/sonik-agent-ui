import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateCommandArtifactsFromOpenApi } from "../packages/command-generator/src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const documentPath = resolve(root, "tests/fixtures/sonik-booking/booking-openapi.fixture.json");
const configPath = resolve(root, "tests/fixtures/sonik-booking/generator.config.json");
const outputPath = resolve(root, "tests/fixtures/generated/sonik-booking-command-artifacts.generated.json");
const runtimeOutputPath = resolve(root, "apps/standalone-sveltekit/src/lib/server/generated/sonik-booking-command-artifacts.generated.json");
const outputPaths = [outputPath, runtimeOutputPath];
const checkMode = process.argv.includes("--check");

const document = JSON.parse(await readFile(documentPath, "utf8"));
const config = JSON.parse(await readFile(configPath, "utf8"));
const artifacts = generateCommandArtifactsFromOpenApi({ document, config });
const operationCount = Object.values(document.paths ?? {}).reduce((count, pathItem) => count + Object.keys(pathItem ?? {}).filter((method) => ["get", "post", "put", "patch", "delete", "head", "options"].includes(method.toLowerCase())).length, 0);

const output = {
  version: "sonik-agent-ui.generated-command-artifacts.v1",
  generatedAt: config.generatedAt,
  source: document["x-fixture-provenance"],
  summary: {
    operationCount,
    commandCount: artifacts.catalog.commands.length,
    familyCount: artifacts.registry.families.length,
    cliProjectionCount: artifacts.projections.cli?.commands.length ?? 0,
    mcpProjectionCount: artifacts.projections.mcp?.commands.length ?? 0,
  },
  manifest: artifacts.manifest,
  registry: artifacts.registry,
  catalog: artifacts.catalog,
  projections: artifacts.projections,
};

const serializedOutput = `${JSON.stringify(output, null, 2)}\n`;

if (checkMode) {
  for (const currentOutputPath of outputPaths) {
    let existingOutput = "";
    try {
      existingOutput = await readFile(currentOutputPath, "utf8");
    } catch (error) {
      console.error(`Generated command artifact is missing: ${currentOutputPath}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    if (existingOutput !== serializedOutput) {
      console.error(`Generated command artifact is stale: ${currentOutputPath}`);
      console.error("Run pnpm generate:commands:sonik-booking and commit the updated artifact.");
      process.exit(1);
    }

    console.log(`Checked ${currentOutputPath}`);
  }
} else {
  for (const currentOutputPath of outputPaths) {
    await writeFile(currentOutputPath, serializedOutput);
    console.log(`Wrote ${currentOutputPath}`);
  }
}
console.log(JSON.stringify(output.summary));
