import assert from "node:assert/strict";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const fixtureRoot = resolve(".omx/tmp/artifact-tool-contract-node");
const fixtureAppRoot = join(fixtureRoot, "apps/standalone-sveltekit/src/lib");
const repoRoot = process.cwd();

async function listTsFiles(dir) {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

async function rewriteLocalTsImportsForNode(dir) {
  const files = await listTsFiles(dir);
  for (const file of files) {
    let source = await readFile(file, "utf8");
    source = source.replace(/from "(\.\.?\/[^".][^"]*)"/g, (match, specifier) => {
      const candidate = resolve(dirname(file), `${specifier}.ts`);
      return existsSync(candidate) ? `from "${specifier}.ts"` : match;
    });
    source = source.replace(/import\("(\.\.?\/[^".][^"]*)"\)/g, (match, specifier) => {
      const candidate = resolve(dirname(file), `${specifier}.ts`);
      return existsSync(candidate) ? `import("${specifier}.ts")` : match;
    });
    await writeFile(file, source);
  }
}


await rm(fixtureRoot, { recursive: true, force: true });
await mkdir(dirname(fixtureAppRoot), { recursive: true });
await cp(resolve("apps/standalone-sveltekit/src/lib"), fixtureAppRoot, { recursive: true });
await rewriteLocalTsImportsForNode(fixtureAppRoot);
await symlink(resolve("apps/standalone-sveltekit/node_modules"), join(fixtureRoot, "apps/standalone-sveltekit/node_modules"), "dir");

try {
  const artifactModuleUrl = new URL("./apps/standalone-sveltekit/src/lib/tools/artifact.ts", `file://${fixtureRoot}/`).href;
  const guidanceModuleUrl = new URL("./apps/standalone-sveltekit/src/lib/artifacts/artifact-generation-guidance.ts", `file://${fixtureRoot}/`).href;
  const { createJsonArtifact } = await import(artifactModuleUrl);
  const {
    JSON_ARTIFACT_STARTER_SPEC,
    JSON_ARTIFACT_DASHBOARD_SPEC,
    assertJsonArtifactGuidanceExamplesValid,
  } = await import(guidanceModuleUrl);

  assertJsonArtifactGuidanceExamplesValid();

  const validStarter = createJsonArtifact.inputSchema.safeParse({ title: "Starter", spec: JSON_ARTIFACT_STARTER_SPEC });
  assert.equal(validStarter.success, true, validStarter.success ? "" : JSON.stringify(validStarter.error.issues));

  const validDashboard = createJsonArtifact.inputSchema.safeParse({ title: "Dashboard", spec: JSON_ARTIFACT_DASHBOARD_SPEC });
  assert.equal(validDashboard.success, true, validDashboard.success ? "" : JSON.stringify(validDashboard.error.issues));

  const interactiveSetStateArtifact = {
    title: "Interactive",
    spec: {
      root: "main",
      elements: {
        main: {
          type: "Button",
          props: { label: "Save", variant: "default", size: "default", disabled: false },
          on: {
            press: {
              action: "setState",
              params: { statePath: "/saved", value: true },
            },
          },
          children: [],
        },
      },
      state: { saved: false },
    },
  };
  const validInteractive = createJsonArtifact.inputSchema.safeParse(interactiveSetStateArtifact);
  assert.equal(validInteractive.success, true, validInteractive.success ? "" : JSON.stringify(validInteractive.error.issues));
  const storedInteractive = await createJsonArtifact.execute(validInteractive.data);
  assert.deepEqual(
    storedInteractive.spec.elements.main.on,
    interactiveSetStateArtifact.spec.elements.main.on,
    "on.press setState binding must survive createJsonArtifact validation into the stored spec",
  );

  const validActionArray = createJsonArtifact.inputSchema.safeParse({
    title: "Interactive array",
    spec: {
      root: "main",
      elements: {
        main: {
          type: "Button",
          props: { label: "Save", variant: "default", size: "default", disabled: false },
          on: {
            press: [
              { action: "setState", params: { statePath: "/saved", value: true } },
              { action: "setState", params: { statePath: "/submitted", value: true } },
            ],
          },
          children: [],
        },
      },
      state: { saved: false, submitted: false },
    },
  });
  assert.equal(validActionArray.success, true, validActionArray.success ? "" : JSON.stringify(validActionArray.error.issues));

  const arbitraryOnObject = createJsonArtifact.inputSchema.safeParse({
    title: "Bad",
    spec: {
      root: "main",
      elements: {
        main: {
          type: "Button",
          props: { label: "Bad", variant: "default", size: "default", disabled: false },
          on: { press: { arbitrary: true } },
          children: [],
        },
      },
      state: {},
    },
  });
  assert.equal(arbitraryOnObject.success, false, "on.* values must be action objects or arrays, not arbitrary objects");

  const emptyElements = createJsonArtifact.inputSchema.safeParse({ title: "Bad", spec: { root: "main", elements: {}, state: {} } });
  assert.equal(emptyElements.success, false, "empty element maps must be rejected");

  const missingCardProps = createJsonArtifact.inputSchema.safeParse({ title: "Bad", spec: { root: "main", elements: { main: { type: "Card", props: {}, children: [] } }, state: {} } });
  assert.equal(missingCardProps.success, false, "catalog-derived props must reject empty Card props");

  const danglingChild = createJsonArtifact.inputSchema.safeParse({ title: "Bad", spec: { root: "main", elements: { main: { type: "Card", props: { title: "Bad", description: "Bad" }, children: ["missing"] } }, state: {} } });
  assert.equal(danglingChild.success, false, "dangling child ids must be rejected");
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}

assert.equal(repoRoot, process.cwd(), "contract test should not change cwd");
console.log("artifact-tool-contract tests passed");
