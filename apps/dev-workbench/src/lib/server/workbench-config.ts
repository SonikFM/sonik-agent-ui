import {
  DEFAULT_REPOSITORY_COMMANDS,
  DEV_WORKBENCH_SCHEMA_VERSION,
  repositoryManifestSchema,
  type RepositoryManifest,
} from "../contracts/workbench";

export type DevWorkbenchServerConfig = {
  enabled: true;
  organizationId: string;
  timeoutMs: number;
  repository: RepositoryManifest;
  agentApiOrigin: string;
  cloudflareAccountId: string | null;
  cloudflareApiToken: string | null;
  pipeBWorker: string;
};

export type DevWorkbenchConfigResult =
  | { ok: true; value: DevWorkbenchServerConfig }
  | { ok: false; reason: string };

const DEFAULT_TIMEOUT_MS = 45 * 60 * 1_000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_AGENT_API_ORIGIN = "https://sonik-agent-ui.liam-trampota.workers.dev";
const DEFAULT_PIPE_B_WORKER = "sonik-dev-observability-pipe-b";

export function readDevWorkbenchConfig(env: Record<string, string | undefined>): DevWorkbenchConfigResult {
  if (env.DEV_WORKBENCH_ENABLED !== "true") {
    return { ok: false, reason: "Dev Workbench is disabled by server configuration." };
  }

  const cloneUrl = env.DEV_WORKBENCH_REPOSITORY_URL?.trim();
  const revision = env.DEV_WORKBENCH_REPOSITORY_REVISION?.trim();
  const organizationId = env.DEV_WORKBENCH_ORGANIZATION_ID?.trim();
  if (!cloneUrl || !revision || !organizationId) {
    return { ok: false, reason: "Repository, revision, and organization configuration are required." };
  }

  const timeoutMs = parseTimeout(env.DEV_WORKBENCH_TIMEOUT_MS);
  if (timeoutMs === null) {
    return { ok: false, reason: "DEV_WORKBENCH_TIMEOUT_MS must be a positive integer no greater than 24 hours." };
  }
  const agentApiOrigin = parseOrigin(env.DEV_WORKBENCH_AGENT_API_ORIGIN ?? DEFAULT_AGENT_API_ORIGIN);
  if (!agentApiOrigin) {
    return { ok: false, reason: "DEV_WORKBENCH_AGENT_API_ORIGIN must be an HTTPS origin without credentials or a path." };
  }
  const cloudflareAccountId = cleanOptionalSecret(env.DEV_WORKBENCH_CLOUDFLARE_ACCOUNT_ID);
  const cloudflareApiToken = cleanOptionalSecret(env.DEV_WORKBENCH_CLOUDFLARE_API_TOKEN);
  const pipeBWorker = cleanWorkerName(env.DEV_WORKBENCH_PIPE_B_WORKER ?? DEFAULT_PIPE_B_WORKER);
  if (!pipeBWorker) return { ok: false, reason: "DEV_WORKBENCH_PIPE_B_WORKER is invalid." };

  const repository = repositoryManifestSchema.safeParse({
    schemaVersion: DEV_WORKBENCH_SCHEMA_VERSION,
    repositoryId: repositoryIdFromUrl(cloneUrl),
    cloneUrl,
    revision,
    branch: revision,
    deployment: null,
    commands: DEFAULT_REPOSITORY_COMMANDS,
  });
  if (!repository.success) {
    return { ok: false, reason: "The configured repository manifest is invalid." };
  }

  return {
    ok: true,
    value: {
      enabled: true,
      organizationId,
      timeoutMs,
      repository: repository.data,
      agentApiOrigin,
      cloudflareAccountId,
      cloudflareApiToken,
      pipeBWorker,
    },
  };
}

function cleanOptionalSecret(value: string | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function cleanWorkerName(value: string): string | null {
  const cleaned = value.trim();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(cleaned) ? cleaned : null;
}

function parseOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseTimeout(value: string | undefined): number | null {
  if (!value) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_TIMEOUT_MS ? parsed : null;
}

function repositoryIdFromUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    return `${url.hostname}.${path}`.replace(/[^A-Za-z0-9._-]+/g, ".").slice(0, 128);
  } catch {
    return "invalid";
  }
}
