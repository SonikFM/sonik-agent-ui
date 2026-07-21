import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// (a) vendored packages exist with expected exports.
const devtoolsIndex = await readFile("packages/devtools/src/index.ts", "utf8");
const devtoolsPackageJson = JSON.parse(await readFile("packages/devtools/package.json", "utf8"));
assert.equal(devtoolsPackageJson.name, "@json-render/devtools", "packages/devtools must publish as @json-render/devtools");
for (const exportName of ["createEventStore", "isProduction", "createPanel", "startPicker", "tapJsonRenderStream"]) {
  assert.match(
    devtoolsIndex,
    new RegExp(`\\b${exportName}\\b`),
    `packages/devtools/src/index.ts must export ${exportName}`,
  );
}

const devtoolsSvelteIndex = await readFile("packages/devtools-svelte/src/index.ts", "utf8");
const devtoolsSveltePackageJson = JSON.parse(await readFile("packages/devtools-svelte/package.json", "utf8"));
assert.equal(devtoolsSveltePackageJson.name, "@json-render/devtools-svelte", "packages/devtools-svelte must publish as @json-render/devtools-svelte");
assert.match(
  devtoolsSvelteIndex,
  /export\s*\{\s*default as JsonRenderDevtools\s*\}\s*from\s*"\.\/JsonRenderDevtools\.svelte"/,
  "packages/devtools-svelte/src/index.ts must export the JsonRenderDevtools component",
);

const jsonRenderDevtoolsSvelte = await readFile("packages/devtools-svelte/src/JsonRenderDevtools.svelte", "utf8");
assert.match(jsonRenderDevtoolsSvelte, /isProduction\s*\(\s*\)/, "JsonRenderDevtools.svelte must call isProduction() so it no-ops in production builds");

// (b) +page.svelte mounts the panel behind the dev gate.
const pageSvelte = await readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");
assert.match(
  pageSvelte,
  /import\s*\{\s*JsonRenderDevtools\s*\}\s*from\s*"@json-render\/devtools-svelte"/,
  "+page.svelte must import JsonRenderDevtools from @json-render/devtools-svelte",
);
assert.match(
  pageSvelte,
  /import\s*\{\s*explorerCatalog\s*\}\s*from\s*"\$lib\/render\/catalog"/,
  "+page.svelte must import the catalog that validates rendered artifacts",
);
assert.match(
  pageSvelte,
  /<JsonRenderDevtools[^>]*catalog=\{explorerCatalog\}[^>]*\/>/,
  "+page.svelte must expose the real render catalog to development devtools",
);
assert.doesNotMatch(pageSvelte, /<JsonRenderDevtools[^>]*catalog=\{null\}/, "development devtools must not hide the available catalog");
assert.match(
  pageSvelte,
  /\{#if dev(?:\s*&&[^}]*)?\}[\s\S]*?<JsonRenderDevtools[^>]*\/>[\s\S]*?\{\/if\}/,
  "+page.svelte must mount <JsonRenderDevtools /> gated behind the dev flag from $app/environment",
);
// The panel calls getStateContext() unconditionally outside production, so it must be
// nested inside a StateProvider rather than mounted as a bare sibling of
// JsonArtifactRenderer's own provider (that crashed the instant an artifact first
// appeared -- see streaming-artifact tests / 2026-07-08 progressive-streaming fix).
assert.match(
  pageSvelte,
  /<JsonUIProvider[^>]*>\s*\n\s*<JsonRenderDevtools/,
  "+page.svelte must mount <JsonRenderDevtools /> inside a JsonUIProvider so getStateContext() does not throw",
);
assert.match(
  pageSvelte,
  /<JsonRenderDevtools[^>]*catalog=\{explorerCatalog\}[^>]*\/>/,
  "+page.svelte must pass the runtime JSON-render catalog to devtools",
);
assert.match(pageSvelte, /import\s*\{\s*browser,\s*dev\s*\}\s*from\s*"\$app\/environment"/, "+page.svelte must import dev from $app/environment for the devtools gate");

// devDependency wiring so the mount resolves at build time.
const appPackageJson = JSON.parse(await readFile("apps/standalone-sveltekit/package.json", "utf8"));
assert.equal(appPackageJson.dependencies?.["@json-render/devtools-svelte"], "workspace:*", "apps/standalone-sveltekit must depend on @json-render/devtools-svelte via workspace:*");

// (c) manifest exists and records the vendored upstream revision.
const manifest = JSON.parse(await readFile("manifests/copy-retrofit/jsonrender-devtools.json", "utf8"));
assert.equal(manifest.upstream.gitRemote, "https://github.com/vercel-labs/json-render.git", "manifest must record the vercel-labs/json-render upstream remote");
assert.match(manifest.upstream.revision, /^[0-9a-f]{40}$/, "manifest must record a full upstream commit SHA");
const destinations = manifest.entries.map((entry) => entry.destination).sort();
assert.deepEqual(destinations, ["packages/devtools", "packages/devtools-svelte"], "manifest must copy both packages/devtools and packages/devtools-svelte");

// root build/test chains build the vendored packages in dependency order (core -> svelte -> devtools -> devtools-svelte).
const rootPackageJson = JSON.parse(await readFile("package.json", "utf8"));
for (const scriptName of ["build", "test"]) {
  const script = rootPackageJson.scripts[scriptName];
  const coreIdx = script.indexOf("@json-render/core build");
  const svelteIdx = script.indexOf("@json-render/svelte build");
  const devtoolsIdx = script.indexOf("@json-render/devtools build");
  const devtoolsSvelteIdx = script.indexOf("@json-render/devtools-svelte build");
  assert.ok(coreIdx !== -1 && svelteIdx !== -1 && devtoolsIdx !== -1 && devtoolsSvelteIdx !== -1, `${scriptName} script must build core, svelte, devtools, and devtools-svelte`);
  assert.ok(coreIdx < svelteIdx && svelteIdx < devtoolsIdx && devtoolsIdx < devtoolsSvelteIdx, `${scriptName} script must build in order core -> svelte -> devtools -> devtools-svelte`);
}
assert.match(rootPackageJson.scripts["check:commands"], /check:copy-retrofit:jsonrender-devtools/, "check:commands must run the jsonrender-devtools copy-retrofit drift check");
assert.equal(
  rootPackageJson.scripts["check:copy-retrofit:jsonrender-devtools"],
  "node scripts/verify-source-drift.mjs manifests/copy-retrofit/jsonrender-devtools.json",
  "check:copy-retrofit:jsonrender-devtools must verify source drift against the manifest",
);

console.log(JSON.stringify({ ok: true, checked: "jsonrender-devtools-vendor" }));
