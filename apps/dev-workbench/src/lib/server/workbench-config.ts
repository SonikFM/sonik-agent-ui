import {
  DEFAULT_REPOSITORY_COMMANDS,
  DEV_WORKBENCH_ROOT,
  DEV_WORKBENCH_SCHEMA_VERSION,
  repositoryManifestSchema,
  repositoryProfileSchema,
  type RepositoryManifest,
  type RepositoryProfile,
  type RepositoryProfileId,
} from "../contracts/workbench";

export type DevWorkbenchGitHubAppConfig = {
  appId: string;
  privateKey: string;
  installationId: string;
};

export type DevWorkbenchServerConfig = {
  enabled: true;
  organizationId: string;
  timeoutMs: number;
  repository: RepositoryManifest;
  agentApiOrigin: string;
  // Read-write sandbox checkouts beyond the primary agent-ui repo. Empty/null until a
  // GitHub App is registered and its env vars are provisioned (see .env.example).
  additionalRepositories: RepositoryProfile[];
  githubApp: DevWorkbenchGitHubAppConfig | null;
};

// profileId -> env var prefix for that profile's clone URL / revision.
const ADDITIONAL_REPOSITORY_PROFILE_ENV_PREFIXES: Record<Exclude<RepositoryProfileId, "agent-ui">, string> = {
  "booking-service": "DEV_WORKBENCH_BOOKING_SERVICE",
  amplify: "DEV_WORKBENCH_AMPLIFY",
};

export type DevWorkbenchConfigResult =
  | { ok: true; value: DevWorkbenchServerConfig }
  | { ok: false; reason: string };

// Some platforms serialize an unset env var as the literal string
// "undefined" rather than omitting the key; treat that (and blank/whitespace)
// as unset so it can't pass a truthy check and enable an invalid profile or
// App credential.
function optionalEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "undefined" ? trimmed : undefined;
}

// Same "unset" detection as optionalEnvValue, but for values (like a PEM
// private key) whose exact original formatting -- including any trailing
// newline -- must be preserved rather than trimmed.
function isUnsetEnvValue(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return !trimmed || trimmed === "undefined";
}

const DEFAULT_TIMEOUT_MS = 45 * 60 * 1_000;
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_AGENT_API_ORIGIN = "https://sonik-agent-ui.liam-trampota.workers.dev";

export function readDevWorkbenchConfig(env: Record<string, string | undefined>): DevWorkbenchConfigResult {
  if (env.DEV_WORKBENCH_ENABLED !== "true") {
    return { ok: false, reason: "Dev Workbench is disabled by server configuration." };
  }

  const cloneUrl = optionalEnvValue(env.DEV_WORKBENCH_REPOSITORY_URL);
  const revision = optionalEnvValue(env.DEV_WORKBENCH_REPOSITORY_REVISION);
  const organizationId = optionalEnvValue(env.DEV_WORKBENCH_ORGANIZATION_ID);
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

  const additionalRepositories = readAdditionalRepositoryProfiles(env);
  if (!additionalRepositories.ok) {
    return additionalRepositories;
  }
  const githubApp = readGitHubAppConfig(env);
  if (additionalRepositories.value.length > 0 && !githubApp) {
    return { ok: false, reason: "DEV_WORKBENCH_GITHUB_APP_ID, DEV_WORKBENCH_GITHUB_APP_PRIVATE_KEY, and DEV_WORKBENCH_GITHUB_APP_INSTALLATION_ID are required when additional repository profiles are configured." };
  }

  return {
    ok: true,
    value: {
      enabled: true,
      organizationId,
      timeoutMs,
      repository: repository.data,
      agentApiOrigin,
      additionalRepositories: additionalRepositories.value,
      githubApp,
    },
  };
}

function readAdditionalRepositoryProfiles(
  env: Record<string, string | undefined>,
): { ok: true; value: RepositoryProfile[] } | { ok: false; reason: string } {
  const profiles: RepositoryProfile[] = [];
  for (const [profileId, envPrefix] of Object.entries(ADDITIONAL_REPOSITORY_PROFILE_ENV_PREFIXES) as [Exclude<RepositoryProfileId, "agent-ui">, string][]) {
    const cloneUrl = optionalEnvValue(env[`${envPrefix}_REPOSITORY_URL`]);
    const revision = optionalEnvValue(env[`${envPrefix}_REPOSITORY_REVISION`]);
    if (!cloneUrl && !revision) continue;
    if (!cloneUrl || !revision) {
      return { ok: false, reason: `${envPrefix}_REPOSITORY_URL and ${envPrefix}_REPOSITORY_REVISION must both be set to enable the ${profileId} repository profile.` };
    }
    const profile = repositoryProfileSchema.safeParse({
      profileId,
      cloneUrl,
      revision,
      checkoutPath: `${DEV_WORKBENCH_ROOT}/repos/${profileId}`,
    });
    if (!profile.success) {
      return { ok: false, reason: `The configured ${profileId} repository profile is invalid.` };
    }
    profiles.push(profile.data);
  }
  return { ok: true, value: profiles };
}

function readGitHubAppConfig(env: Record<string, string | undefined>): DevWorkbenchGitHubAppConfig | null {
  const appId = optionalEnvValue(env.DEV_WORKBENCH_GITHUB_APP_ID);
  const installationId = optionalEnvValue(env.DEV_WORKBENCH_GITHUB_APP_INSTALLATION_ID);
  const privateKeyEnv = env.DEV_WORKBENCH_GITHUB_APP_PRIVATE_KEY;
  if (!appId || !installationId || isUnsetEnvValue(privateKeyEnv)) return null;
  const privateKey = privateKeyEnv as string;
  return { appId, privateKey, installationId };
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
