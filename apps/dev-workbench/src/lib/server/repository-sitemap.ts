import { createHash } from "node:crypto";
import { posix } from "node:path";
import {
  DEV_WORKBENCH_SCHEMA_VERSION,
  repositorySitemapInputSchema,
  repositorySitemapSchema,
  type RepositorySitemap,
  type RepositorySitemapInput,
  type RepositoryManifest,
  type RepositoryRouteInput,
} from "../contracts/workbench";

const IMPORTANT_FILE_NAMES = new Set([
  "AGENTS.md",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "svelte.config.js",
  "svelte.config.ts",
  "vercel.json",
  "vite.config.js",
  "vite.config.ts",
]);

function normalizeRepositoryPath(path: string): string {
  const normalized = posix.normalize(path.replaceAll("\\", "/").replace(/^\.\//, ""));
  if (normalized === "." || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Repository path must stay relative: ${path}`);
  }
  return normalized;
}

function stableUnique<T>(items: readonly T[], key: (item: T) => string): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const itemKey = key(item);
    const existing = byKey.get(itemKey);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(item)) {
      throw new Error(`Conflicting repository sitemap entry: ${itemKey}`);
    }
    byKey.set(itemKey, item);
  }
  return [...byKey.values()].sort((left, right) => key(left).localeCompare(key(right)));
}

export function createRepositorySitemap(input: RepositorySitemapInput): RepositorySitemap {
  const parsed = repositorySitemapInputSchema.parse(input);
  const files = stableUnique(
    parsed.files.map((file) => ({ ...file, path: normalizeRepositoryPath(file.path) })),
    (file) => file.path,
  );
  const packages = stableUnique(
    parsed.packages.map((pkg) => ({
      ...pkg,
      path: pkg.path === "." ? "." : normalizeRepositoryPath(pkg.path),
      scripts: [...new Set(pkg.scripts)].sort(),
      workspaceDependencies: [...new Set(pkg.workspaceDependencies)].sort(),
    })),
    (pkg) => `${pkg.path}\0${pkg.name}`,
  );
  const routes = stableUnique(
    parsed.routes.map((route) => ({
      ...route,
      route: route.route.startsWith("/") ? posix.normalize(route.route) : `/${posix.normalize(route.route)}`,
      file: normalizeRepositoryPath(route.file),
    })),
    (route) => `${route.route}\0${route.kind}\0${route.file}`,
  );
  const importantFiles = files
    .map((file) => file.path)
    .filter((path) => IMPORTANT_FILE_NAMES.has(posix.basename(path)) || path.includes("/src/routes/"));
  const canonical = JSON.stringify({
    repositoryId: parsed.repositoryId,
    revision: parsed.revision,
    files,
    packages,
    routes,
    importantFiles,
  });

  return repositorySitemapSchema.parse({
    schemaVersion: DEV_WORKBENCH_SCHEMA_VERSION,
    repositoryId: parsed.repositoryId,
    revision: parsed.revision,
    digest: createHash("sha256").update(canonical).digest("hex"),
    files,
    packages,
    routes,
    importantFiles,
  });
}

export function createRepositorySitemapFromTrackedFiles(
  repository: RepositoryManifest,
  trackedFiles: readonly string[],
): RepositorySitemap {
  const files = trackedFiles.filter(Boolean).map((path) => ({ path }));
  const routes: RepositoryRouteInput[] = trackedFiles.flatMap((file): RepositoryRouteInput[] => {
    const marker = "/src/routes/";
    const markerIndex = file.indexOf(marker);
    const relative = file.startsWith("src/routes/")
      ? file.slice("src/routes/".length)
      : markerIndex >= 0
        ? file.slice(markerIndex + marker.length)
        : null;
    if (relative === null) return [];
    const fileName = posix.basename(relative);
    const kind = fileName === "+page.svelte"
      ? "page"
      : fileName === "+layout.svelte"
        ? "layout"
        : fileName === "+server.ts" || fileName === "+server.js"
          ? "endpoint"
          : fileName === "+error.svelte"
            ? "error"
            : null;
    if (!kind) return [];
    const routePath = posix.dirname(relative);
    const route = routePath === "." ? "/" : `/${routePath}`;
    return [{ route, file, kind }];
  });
  return createRepositorySitemap({
    repositoryId: repository.repositoryId,
    revision: repository.revision,
    files,
    packages: [],
    routes,
  });
}
