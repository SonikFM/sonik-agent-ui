import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const sdkRoot = resolve(import.meta.dirname, "..");
const registryPath = join(sdkRoot, "docs/sonik-command-registry.generated.json");
const packageJsonPath = join(sdkRoot, "package.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const failures = [];

if (registry.version !== "sonik-agent-ui.global-command-registry.v1")
  failures.push("Unexpected global command registry version");
if (registry.provider !== "sonik-global-command-registry")
  failures.push("Unexpected global command registry provider");
if (registry.summary?.providerCount !== 1) failures.push("Expected exactly one promoted provider");
if (registry.summary?.commandCount !== 71) failures.push("Expected 71 generated booking commands");
if (registry.summary?.familyCount !== 12)
  failures.push("Expected 12 generated booking command families");
if (registry.summary?.cliProjectionCount !== 71) failures.push("Expected 71 CLI projections");
if (registry.summary?.mcpProjectionCount !== 71) failures.push("Expected 71 MCP projections");
if (registry.providers?.[0]?.provider !== "sonik-booking-openapi-fixture")
  failures.push("Missing promoted Sonik booking provider");
if (registry.providers?.[0]?.source?.sourceRepo !== "sonik-booking-service")
  failures.push("Promoted provider sourceRepo must be normalized to a stable repo slug");
if (!registry.providers?.[0]?.source?.sourceSha256)
  failures.push("Promoted provider source hash is required");
const registryText = JSON.stringify(registry);
if (registryText.includes("/Users/"))
  failures.push("Generated command registry must not contain local absolute /Users paths");
if (/[A-Za-z]:\\\\Users\\/.test(registryText))
  failures.push("Generated command registry must not contain local absolute Windows user paths");

const commands = registry.catalog?.commands ?? [];
const commandIds = new Set(commands.map((command) => command.id));
if (commandIds.size !== commands.length) failures.push("Generated command ids must be unique");
if (!commands.every((command) => command.source === "openapi"))
  failures.push("Generated booking commands must remain OpenAPI descriptors");
if (!commands.every((command) => command.transport?.runtimeStatus === "shadow"))
  failures.push("Generated booking commands must remain shadow until host runtime mount");
if (commands.some((command) => command.metadata?.liveExecution === true))
  failures.push("Generated booking commands must not advertise live execution");

const familyIds = new Set((registry.registry?.families ?? []).map((family) => family.id));
for (const command of commands) {
  if (!familyIds.has(command.familyId))
    failures.push(`Unknown command family: ${command.familyId}`);
}

const exportedRegistry = packageJson.exports?.["./sonik-command-registry.json"]?.default;
if (exportedRegistry !== "./docs/sonik-command-registry.generated.json")
  failures.push("Package must export ./sonik-command-registry.json to the generated docs artifact");
if (!packageJson.files?.includes("docs"))
  failures.push("Package files must include docs so the registry JSON is packaged");

if (failures.length > 0) {
  console.error("Sonik SDK command registry check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Sonik SDK command registry check passed");
