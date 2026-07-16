// Programmatic Vite dev server for browser-mounting a real Svelte 5 component
// tree outside the standalone-sveltekit app's own build pipeline, so
// scenarios/renderer-no-ai.eval.mjs can drive packages/svelte's actual
// renderer (not a reimplementation of it) with Playwright.
//
// No new dependency is declared for this: `vite` and `@sveltejs/vite-plugin-svelte`
// are already installed in the workspace (apps/standalone-sveltekit depends on
// them transitively via @sveltejs/kit / its own devDependencies) — this module
// resolves them from there via Node's own `require.resolve`, exactly the way
// apps/standalone-sveltekit's own `vite dev` would.
//
// All files this module writes live under a fresh directory inside
// `tests/agent-eval/.tmp/`, created at run time and removed by `close()` —
// they are ephemeral test scaffolding, not repo deliverables.

import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// A workspace app that has `svelte` resolvable as a real dependency (directly
// or via @sveltejs/kit) — used purely as a `require.resolve` anchor, never
// imported from or modified.
const RESOLVE_ANCHOR = "apps/standalone-sveltekit/package.json";

async function resolveWorkspaceModule(repoRoot, specifier) {
  const anchorRequire = createRequire(path.join(repoRoot, RESOLVE_ANCHOR));
  return anchorRequire.resolve(specifier);
}

/**
 * Boot a Vite dev server rooted at a fresh temp directory (under
 * tests/agent-eval/.tmp/, inside the repo so filesystem access stays within
 * this task's allowed scope) that can mount packages/svelte components.
 *
 * `node_modules/svelte` and `node_modules/@json-render/core` are symlinked
 * into the temp root so Vite's bare-specifier resolution (and Node package
 * `exports` map enforcement, e.g. `@json-render/core/store-utils`) works
 * exactly as it would in a real consumer — no manual subpath aliasing, which
 * would have to reverse-engineer svelte's internal `exports` layout.
 * `@json-render/svelte` itself is never symlinked as a bare package: this
 * harness needs `RendererWithProvider.test.svelte`, which the package doesn't
 * export publicly, so callers reach packages/svelte/dist via a relative
 * filesystem path instead (relative imports aren't subject to `exports` map
 * enforcement).
 *
 * Returns `{ url, tmpDir, close() }`. Callers write their own `main.js` (and
 * any fixture components) into `tmpDir` before calling `start()`.
 */
export async function createSvelteMountWorkspace({ repoRoot, resolveAlias = {} }) {
  const parent = path.join(repoRoot, "tests/agent-eval/.tmp");
  await mkdir(parent, { recursive: true });
  const tmpDir = await mkdtemp(path.join(parent, "render-mount-"));

  const sveltePkgJson = await resolveWorkspaceModule(repoRoot, "svelte/package.json");
  const sveltePkgDir = path.dirname(sveltePkgJson);
  const corePkgDir = path.join(repoRoot, "packages/core");

  await mkdir(path.join(tmpDir, "node_modules", "@json-render"), { recursive: true });
  await symlink(sveltePkgDir, path.join(tmpDir, "node_modules", "svelte"), "dir");
  await symlink(corePkgDir, path.join(tmpDir, "node_modules", "@json-render", "core"), "dir");

  return {
    tmpDir,
    svelteDistDir: path.join(repoRoot, "packages/svelte/dist"),
    async writeFile(relPath, content) {
      const target = path.join(tmpDir, relPath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    },
    async start() {
      const vitePath = await resolveWorkspaceModule(repoRoot, "vite");
      const sveltePluginPath = await resolveWorkspaceModule(repoRoot, "@sveltejs/vite-plugin-svelte");
      const { createServer } = await import(pathToFileURL(vitePath).href);
      const { svelte } = await import(pathToFileURL(sveltePluginPath).href);

      const server = await createServer({
        configFile: false,
        root: tmpDir,
        logLevel: "warn",
        clearScreen: false,
        resolve: { alias: resolveAlias },
        server: { fs: { allow: [repoRoot] }, strictPort: false },
        plugins: [svelte()],
      });
      await server.listen();
      const address = server.httpServer?.address();
      const port = typeof address === "object" && address ? address.port : address;
      return {
        url: `http://localhost:${port}/`,
        async close() {
          await server.close().catch(() => undefined);
        },
      };
    },
    async cleanup() {
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}
