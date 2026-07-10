import assert from "node:assert/strict";
import {
  createDeploymentMetadataHeaders,
  DEPLOYMENT_METADATA_HEADERS,
  resolveDeploymentMetadata,
} from "../../apps/standalone-sveltekit/src/lib/server/deployment-metadata.ts";

assert.equal(resolveDeploymentMetadata(undefined), null, "local/non-Cloudflare requests should not expose deployment metadata");
assert.equal(resolveDeploymentMetadata({ env: {} }), null, "missing binding should return null");
assert.equal(
  resolveDeploymentMetadata({
    env: {
      CF_VERSION_METADATA: {
        tag: "release-1",
        timestamp: "2026-07-10T03:00:00Z",
      },
    },
  }),
  null,
  "missing required id should return null",
);
assert.equal(
  resolveDeploymentMetadata({
    env: {
      CF_VERSION_METADATA: {
        id: "version-1\nmalicious-header: injected",
        tag: "release-1",
        timestamp: "2026-07-10T03:00:00Z",
      },
    },
  }),
  null,
  "malformed required id should return null",
);
assert.equal(
  resolveDeploymentMetadata({
    env: {
      CF_VERSION_METADATA: {
        id: "v".repeat(257),
        tag: "release-1",
        timestamp: "2026-07-10T03:00:00Z",
      },
    },
  }),
  null,
  "over-bounded required id should return null",
);

const idOnly = resolveDeploymentMetadata({
  env: {
    CF_VERSION_METADATA: {
      id: "version-only",
    },
  },
});
assert.deepEqual(idOnly, { id: "version-only" }, "valid version identity should not require tag or timestamp");
assert.deepEqual(createDeploymentMetadataHeaders(idOnly), {
  [DEPLOYMENT_METADATA_HEADERS.id]: "version-only",
}, "id-only metadata should emit only the id header");

const optionalMalformed = resolveDeploymentMetadata({
  env: {
    CF_VERSION_METADATA: {
      id: "version-abc",
      tag: "release-prod\nmalicious-header: injected",
      timestamp: "t".repeat(257),
    },
  },
});
assert.deepEqual(optionalMalformed, { id: "version-abc" }, "malformed optional fields should be omitted without discarding a valid id");
assert.deepEqual(createDeploymentMetadataHeaders(optionalMalformed), {
  [DEPLOYMENT_METADATA_HEADERS.id]: "version-abc",
});

const platform = {
  env: {
    CF_VERSION_METADATA: {
      id: " version-abc ",
      tag: " release-prod ",
      timestamp: " 2026-07-10T03:00:00Z ",
      accountId: "must-not-leak",
      service: "must-not-leak",
      build: "must-not-leak",
    },
    ACCOUNT_ID: "must-not-leak",
    SERVICE_NAME: "must-not-leak",
  },
};

const metadata = resolveDeploymentMetadata(platform);
assert.deepEqual(metadata, {
  id: "version-abc",
  tag: "release-prod",
  timestamp: "2026-07-10T03:00:00Z",
});

const headers = createDeploymentMetadataHeaders(metadata);
assert.deepEqual(Object.keys(headers).sort(), [
  "x-sonik-agent-ui-deployment-id",
  "x-sonik-agent-ui-deployment-tag",
  "x-sonik-agent-ui-deployment-timestamp",
].sort(), "deployment response headers should be the exact allowlist only");
assert.deepEqual(headers, {
  [DEPLOYMENT_METADATA_HEADERS.id]: "version-abc",
  [DEPLOYMENT_METADATA_HEADERS.tag]: "release-prod",
  [DEPLOYMENT_METADATA_HEADERS.timestamp]: "2026-07-10T03:00:00Z",
});
assert.equal(Object.values(headers).some((value) => value.includes("must-not-leak")), false, "non-version metadata must not leak into headers");
assert.deepEqual(createDeploymentMetadataHeaders(null), {}, "no binding means no deployment headers");

console.log("deployment-metadata tests passed");
