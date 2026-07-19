import type { Sandbox } from "@vercel/sandbox";
import {
  assertVisualContextResultMatchesRequest,
  visualContextRequestSchema,
  visualContextResultSchema,
  type VisualContextRequest,
  type VisualContextResult,
} from "@sonik-agent-ui/tool-contracts/visual-context";
import { DEV_WORKBENCH_REPOSITORY_ROOT, DEV_WORKBENCH_STATE_ROOT } from "../contracts/workbench";

type CaptureSandbox = Pick<Sandbox, "runCommand">;

export const PLAYWRIGHT_VISUAL_CONTEXT_SCRIPT = "apps/dev-workbench/scripts/capture-visual-context.mjs";

export function playwrightPreviewCapturePaths(requestId: string): { request: string; screenshot: string } {
  return {
    request: `${DEV_WORKBENCH_STATE_ROOT}/tmp/visual-context/${requestId}.json`,
    screenshot: `${DEV_WORKBENCH_STATE_ROOT}/screenshots/requests/${requestId}.png`,
  };
}

export async function capturePlaywrightPreview(input: {
  sandbox: CaptureSandbox;
  request: VisualContextRequest;
  previewUrl?: string;
  signal?: AbortSignal;
}): Promise<VisualContextResult> {
  const request = visualContextRequestSchema.parse(input.request);
  const preview = input.previewUrl ? new URL(input.previewUrl) : null;
  if (preview && (!/^https?:$/.test(preview.protocol) || preview.username || preview.password)) throw new TypeError("Invalid controlled Preview URL.");
  if (request.operation === "capture" && (request.provider !== "playwright" || !preview)) {
    throw new TypeError("Playwright capture requires its controlled Preview URL.");
  }
  if (request.operation !== "capture" && request.operation !== "get-capabilities" && request.operation !== "setup-browser") {
    throw new TypeError("Unsupported Playwright visual context operation.");
  }
  const paths = playwrightPreviewCapturePaths(request.requestId);
  const encodedRequest = Buffer.from(JSON.stringify(request)).toString("base64");
  try {
    const execution = await input.sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", 'printf "%s" "$2" | base64 -d | SONIK_VISUAL_CONTEXT_PREVIEW_URL="$3" node "$1"', "_", PLAYWRIGHT_VISUAL_CONTEXT_SCRIPT, encodedRequest, preview?.origin ?? ""],
      cwd: DEV_WORKBENCH_REPOSITORY_ROOT,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (execution.exitCode !== 0) throw new Error("Controlled Preview operation failed.");
    const result = visualContextResultSchema.parse(JSON.parse(await execution.stdout(input.signal ? { signal: input.signal } : undefined)));
    assertVisualContextResultMatchesRequest(request, result);
    return result;
  } catch (error) {
    await input.sandbox.runCommand({ cmd: "rm", args: ["-f", paths.screenshot], ...(input.signal ? { signal: input.signal } : {}) }).catch(() => undefined);
    throw error;
  }
}
