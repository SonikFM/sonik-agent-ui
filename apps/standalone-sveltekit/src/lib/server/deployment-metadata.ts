export type CloudflareVersionMetadataBinding = {
  id?: unknown;
  tag?: unknown;
  timestamp?: unknown;
};

export type DeploymentMetadataPlatform = {
  env?: {
    CF_VERSION_METADATA?: CloudflareVersionMetadataBinding | null;
  } | null;
} | null | undefined;

export type DeploymentMetadata = {
  id: string;
  tag?: string;
  timestamp?: string;
};

export const DEPLOYMENT_METADATA_HEADERS = {
  id: "x-sonik-agent-ui-deployment-id",
  tag: "x-sonik-agent-ui-deployment-tag",
  timestamp: "x-sonik-agent-ui-deployment-timestamp",
} as const;

const DEPLOYMENT_METADATA_VALUE_MAX_CHARS = 256;

function readBoundedHeaderValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > DEPLOYMENT_METADATA_VALUE_MAX_CHARS) return null;
  // Keep the resolver safe for direct response-header use. Reject control chars
  // rather than rewriting deployment identifiers supplied by the runtime binding.
  if (/[^\t\x20-\x7e]/.test(trimmed)) return null;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveDeploymentMetadata(platform: DeploymentMetadataPlatform): DeploymentMetadata | null {
  const env = platform?.env;
  if (!isRecord(env)) return null;

  const metadata = env.CF_VERSION_METADATA;
  if (!isRecord(metadata)) return null;

  const id = readBoundedHeaderValue(metadata.id);
  if (!id) return null;

  const tag = readBoundedHeaderValue(metadata.tag);
  const timestamp = readBoundedHeaderValue(metadata.timestamp);

  return {
    id,
    ...(tag ? { tag } : {}),
    ...(timestamp ? { timestamp } : {}),
  };
}

export function createDeploymentMetadataHeaders(metadata: DeploymentMetadata | null): Record<string, string> {
  if (!metadata) return {};
  return {
    [DEPLOYMENT_METADATA_HEADERS.id]: metadata.id,
    ...(metadata.tag ? { [DEPLOYMENT_METADATA_HEADERS.tag]: metadata.tag } : {}),
    ...(metadata.timestamp ? { [DEPLOYMENT_METADATA_HEADERS.timestamp]: metadata.timestamp } : {}),
  };
}
