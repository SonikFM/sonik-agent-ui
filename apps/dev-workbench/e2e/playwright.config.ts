import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.SONIK_DEV_WORKBENCH_E2E_PORT ?? 5_178);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: appDir,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { DEV_WORKBENCH_ENABLED: "false" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
