import { spawn as nodeSpawn } from "node:child_process";

export type PreviewProcessHandle = { pid: number | undefined; kill(): void };
export type PreviewSpawn = (command: string, args: string[], options: { cwd?: string }) => PreviewProcessHandle;

export type PreviewRestartReceipt = {
  ok: boolean;
  status: "executed";
  pid: number;
  startedAt: number;
};

export type PreviewControllerOptions = {
  spawn?: PreviewSpawn;
  now?: () => number;
  command?: string;
  args?: string[];
  cwd?: string;
};

export type PreviewController = {
  restart(): Promise<PreviewRestartReceipt>;
};

// ponytail: default spawn shells out to `pnpm dev` in the given cwd; the
// Vercel Sandbox tmux restart plan (bootstrap-plan.ts createDevWindowRefreshPlan)
// is the real production seam but wiring a Sandbox handle through here is a
// separate integration, not needed to satisfy the injectable-spawn contract.
export function createPreviewController(options: PreviewControllerOptions = {}): PreviewController {
  const spawn = options.spawn ?? ((command, args, spawnOptions) => {
    const child = nodeSpawn(command, args, { cwd: spawnOptions.cwd, stdio: "ignore" });
    return { pid: child.pid, kill: () => child.kill() };
  });
  const now = options.now ?? Date.now;
  const command = options.command ?? "pnpm";
  const args = options.args ?? ["dev"];
  let current: PreviewProcessHandle | undefined;

  return {
    async restart(): Promise<PreviewRestartReceipt> {
      current?.kill();
      const next = spawn(command, args, { cwd: options.cwd });
      current = next;
      return {
        ok: true,
        status: "executed",
        pid: next.pid ?? -1,
        startedAt: now(),
      };
    },
  };
}
