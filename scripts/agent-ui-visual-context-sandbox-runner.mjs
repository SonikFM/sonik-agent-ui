#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const PLAYWRIGHT_SMOKE_IMAGE = "mcr.microsoft.com/playwright:v1.61.1-noble";
export const SANDBOX_WORKSPACE = "/vercel/sandbox/workspace";

export function sandboxSmokeDockerArgs(root = process.cwd()) {
  return [
    "run", "--rm", "--ipc=host", "-v", `${root}:/src:ro`, PLAYWRIGHT_SMOKE_IMAGE,
    "bash", "-lc", `set -e
mkdir -p ${SANDBOX_WORKSPACE}
tar -C /src --exclude=.git --exclude=.omx --exclude=node_modules --exclude='*/node_modules' -cf - . | tar -C ${SANDBOX_WORKSPACE} -xf -
cd ${SANDBOX_WORKSPACE}
corepack enable
corepack prepare pnpm@11.1.3 --activate
pnpm install --frozen-lockfile
pnpm smoke:agent-ui:visual-context:sandbox:internal`,
  ];
}

export function runSandboxSmoke(root = process.cwd()) {
  const command = root === SANDBOX_WORKSPACE
    ? ["pnpm", ["smoke:agent-ui:visual-context:sandbox:internal"]]
    : ["docker", sandboxSmokeDockerArgs(root)];
  const result = spawnSync(command[0], command[1], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runSandboxSmoke();
}
