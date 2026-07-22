import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, createPrivateKey } from "node:crypto";

import {
  GIT_CREDENTIAL_FILE_PATH,
  buildGitCredentialFileContent,
  buildGitCredentialWriteFile,
  mintInstallationToken,
} from "../../apps/dev-workbench/src/lib/server/github-app-token-broker.ts";
import { repositoryProfileSchema } from "../../apps/dev-workbench/src/lib/contracts/workbench.ts";
import { readDevWorkbenchConfig } from "../../apps/dev-workbench/src/lib/server/workbench-config.ts";
import {
  createDevWorkbenchBootstrapPlan,
  createTmuxWindows,
} from "../../apps/dev-workbench/src/lib/server/bootstrap-plan.ts";
import {
  DEFAULT_REPOSITORY_COMMANDS,
  DEV_WORKBENCH_SCHEMA_VERSION,
  repositoryManifestSchema,
} from "../../apps/dev-workbench/src/lib/contracts/workbench.ts";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const TEST_PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs1", format: "pem" });
assert.ok(createPrivateKey(TEST_PRIVATE_KEY_PEM), "sanity: generated test key parses as a private key");

const repository = repositoryManifestSchema.parse({
  schemaVersion: DEV_WORKBENCH_SCHEMA_VERSION,
  repositoryId: "sonikfm.sonik-agent-ui",
  cloneUrl: "https://github.com/sonikfm/sonik-agent-ui.git",
  revision: "abc123def456",
  branch: "main",
  deployment: null,
  commands: DEFAULT_REPOSITORY_COMMANDS,
});

// --- 1. mintInstallationToken calls GitHub's installation-token endpoint with a Bearer App JWT ---

test("mintInstallationToken requests a repo-scoped installation token with a Bearer App JWT", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ token: "ghs_minted-token-value", expires_at: "2026-07-22T00:10:00Z" }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  const signJwt = ({ appId }) => `fake-jwt-for-${appId}`;

  const result = await mintInstallationToken({
    appId: "app-123",
    privateKey: TEST_PRIVATE_KEY_PEM,
    installationId: "install-456",
    repositories: ["booking-service", "amplify"],
    signJwt,
    fetchImpl,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.github.com/app/installations/install-456/access_tokens");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers.Authorization, "Bearer fake-jwt-for-app-123");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    repositories: ["booking-service", "amplify"],
    permissions: { contents: "write" },
  }, "the request must ask GitHub for a least-privilege token (contents:write only), not the App's full permission set");
  assert.deepEqual(result, { token: "ghs_minted-token-value", expiresAt: "2026-07-22T00:10:00Z" });
});

test("mintInstallationToken signs a real RS256 App JWT when no signJwt override is supplied", async () => {
  let capturedAuthorization = null;
  const fetchImpl = async (_url, init) => {
    capturedAuthorization = init.headers.Authorization;
    return new Response(JSON.stringify({ token: "ghs_x", expires_at: "2026-07-22T00:10:00Z" }), { status: 201 });
  };

  await mintInstallationToken({
    appId: "app-123",
    privateKey: TEST_PRIVATE_KEY_PEM,
    installationId: "install-456",
    repositories: ["booking-service"],
    now: () => new Date("2026-07-22T00:00:00Z"),
    fetchImpl,
  });

  assert.match(capturedAuthorization, /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "default signJwt produces a well-formed compact JWT");
  const [, payloadSegment] = capturedAuthorization.replace("Bearer ", "").split(".");
  const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8"));
  assert.equal(payload.iss, "app-123");
  assert.ok(payload.exp - payload.iat <= 600, "GitHub rejects App JWTs whose expiry exceeds 10 minutes");
  assert.ok(payload.iat < Math.floor(new Date("2026-07-22T00:00:00Z").getTime() / 1000), "iat is backdated for clock drift");
});

// --- 2. no private key leakage; redaction on any leaked diagnostic ---

test("mintInstallationToken never returns or logs the private key", async () => {
  const logs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => logs.push(args.join(" "));
  try {
    const fetchImpl = async () => new Response(JSON.stringify({ token: "ghs_x", expires_at: "2026-07-22T00:10:00Z" }), { status: 201 });
    const result = await mintInstallationToken({
      appId: "app-123",
      privateKey: TEST_PRIVATE_KEY_PEM,
      installationId: "install-456",
      repositories: ["booking-service"],
      fetchImpl,
    });
    assert.deepEqual(Object.keys(result), ["token", "expiresAt"], "the resolved value carries no private key field");
    assert.equal(JSON.stringify(result).includes("PRIVATE KEY"), false);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(logs.join("\n").includes("PRIVATE KEY"), false, "no incidental console.error call leaked the private key");
});

test("a diagnostic error path redacts any token/@host that leaks into the thrown message", async () => {
  const fetchImpl = async () => {
    throw new Error("connect ECONNREFUSED for https://x-access-token:ghs_supersecrettoken@github.com/sonikfm/booking-service.git");
  };
  await assert.rejects(
    () => mintInstallationToken({
      appId: "app-123",
      privateKey: TEST_PRIVATE_KEY_PEM,
      installationId: "install-456",
      repositories: ["booking-service"],
      fetchImpl,
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("ghs_supersecrettoken"), false, "the redacted message must not carry the raw token");
      assert.equal(error.message.includes("x-access-token:ghs_supersecrettoken@"), false);
      return true;
    },
  );
});

test("a non-2xx GitHub response is surfaced without leaking response body secrets", async () => {
  const fetchImpl = async () => new Response("Bearer token=ghs_leaked-body-secret rejected", { status: 401 });
  await assert.rejects(
    () => mintInstallationToken({
      appId: "app-123",
      privateKey: TEST_PRIVATE_KEY_PEM,
      installationId: "install-456",
      repositories: ["booking-service"],
      fetchImpl,
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("ghs_leaked-body-secret"), false);
      return true;
    },
  );
});

test("a JWT signing failure never leaks key material via the thrown message", async () => {
  const badSignJwt = () => {
    throw new Error(`unsupported key format: ${TEST_PRIVATE_KEY_PEM}`);
  };
  const fetchImpl = async () => {
    throw new Error("fetchImpl must not be called when JWT signing fails");
  };
  await assert.rejects(
    () => mintInstallationToken({
      appId: "app-123",
      privateKey: TEST_PRIVATE_KEY_PEM,
      installationId: "install-456",
      repositories: ["booking-service"],
      signJwt: badSignJwt,
      fetchImpl,
    }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("PRIVATE KEY"), false, "the rejection must not carry raw PEM key material");
      assert.equal(error.message.includes(TEST_PRIVATE_KEY_PEM), false);
      return true;
    },
  );
});

// --- 3. credential-delivery helper produces a writeFiles-shaped payload, never env/argv ---

test("buildGitCredentialFileContent embeds the token in git-credentials store format", () => {
  const content = buildGitCredentialFileContent({ token: "ghs_abc123" });
  assert.equal(content, "https://x-access-token:ghs_abc123@github.com\n");
});

test("buildGitCredentialWriteFile is shaped for the existing sandbox.writeFiles seam", () => {
  const file = buildGitCredentialWriteFile({ token: "ghs_abc123" });
  assert.deepEqual(Object.keys(file).sort(), ["content", "path"], "matches the {path, content} shape sandbox.writeFiles accepts");
  assert.equal(file.path, GIT_CREDENTIAL_FILE_PATH);
  assert.equal(typeof file.content, "string");
  assert.ok(file.content.includes("ghs_abc123"));
  assert.ok(GIT_CREDENTIAL_FILE_PATH.startsWith("/vercel/sandbox/workspace/.sonik/"), "the credential file lives under the sandbox state root, never a repo checkout");
});

// --- 4. security regression lock: the token must never touch tmux windows or sandbox commands ---

test("SECURITY REGRESSION LOCK: a bootstrap plan with additional repo profiles never exposes the token in a command", () => {
  const additionalRepositories = [
    repositoryProfileSchema.parse({
      profileId: "booking-service",
      cloneUrl: "https://github.com/sonikfm/booking-service.git",
      revision: "main",
      checkoutPath: "/vercel/sandbox/workspace/repos/booking-service",
    }),
    repositoryProfileSchema.parse({
      profileId: "amplify",
      cloneUrl: "https://github.com/sonikfm/amplify.git",
      revision: "main",
      checkoutPath: "/vercel/sandbox/workspace/repos/amplify",
    }),
  ];
  const plan = createDevWorkbenchBootstrapPlan({
    sessionId: "session_token_lock",
    repository,
    additionalRepositories,
    gitCredentialFilePath: GIT_CREDENTIAL_FILE_PATH,
  });

  const windowText = plan.windows.flatMap((window) => window.command).join(" ");
  assert.doesNotMatch(windowText, /GITHUB|token|x-access-token|ghs_|github_pat/, "tmux window commands stay free of the installation token, extending the existing :349 guard to the repo-profile path");

  const commandText = plan.commands.flatMap((command) => [command.cmd, ...command.args]).join(" ");
  assert.doesNotMatch(commandText, /ghs_|x-access-token:[^@\s]+@|github_pat/, "sandbox command argv never carries the literal token; auth rides the credential file");

  const cloneCommands = plan.commands.filter((command) => command.id.startsWith("clone-") && command.id !== "clone-repository");
  assert.equal(cloneCommands.length, 2, "each additional repository profile gets its own bare clone step");
  for (const command of cloneCommands) {
    assert.doesNotMatch(command.args.join(" "), /@/, "clone command args carry a bare https URL, never an embedded-credential URL");
  }
});

// --- 5. repo-profile plumbing across contracts + config ---

test("repositoryProfileSchema rejects embedded-credential clone URLs for every profile", () => {
  assert.throws(
    () => repositoryProfileSchema.parse({
      profileId: "booking-service",
      cloneUrl: "https://ghs_x@github.com/sonikfm/booking-service.git",
      revision: "main",
      checkoutPath: "/vercel/sandbox/workspace/repos/booking-service",
    }),
    /embedded credentials/,
  );
  assert.doesNotThrow(() => repositoryProfileSchema.parse({
    profileId: "amplify",
    cloneUrl: "https://github.com/sonikfm/amplify.git",
    revision: "main",
    checkoutPath: "/vercel/sandbox/workspace/repos/amplify",
  }));
});

test("workbench-config supports multiple repository profiles (agent-ui + booking-service + amplify)", () => {
  const baseEnv = {
    DEV_WORKBENCH_ENABLED: "true",
    DEV_WORKBENCH_REPOSITORY_URL: "https://github.com/sonikfm/sonik-agent-ui.git",
    DEV_WORKBENCH_REPOSITORY_REVISION: "main",
    DEV_WORKBENCH_ORGANIZATION_ID: "sonikfm",
  };

  const withoutAdditionalRepos = readDevWorkbenchConfig(baseEnv);
  assert.equal(withoutAdditionalRepos.ok, true);
  assert.deepEqual(withoutAdditionalRepos.value.additionalRepositories, [], "existing single-repo deployments stay unaffected");
  assert.equal(withoutAdditionalRepos.value.githubApp, null, "no GitHub App wiring is required until an additional profile is configured");

  const missingAppCreds = readDevWorkbenchConfig({
    ...baseEnv,
    DEV_WORKBENCH_BOOKING_SERVICE_REPOSITORY_URL: "https://github.com/sonikfm/booking-service.git",
    DEV_WORKBENCH_BOOKING_SERVICE_REPOSITORY_REVISION: "main",
  });
  assert.equal(missingAppCreds.ok, false, "an additional repo profile without GitHub App credentials must fail closed, not silently run without auth");

  const withBothProfiles = readDevWorkbenchConfig({
    ...baseEnv,
    DEV_WORKBENCH_BOOKING_SERVICE_REPOSITORY_URL: "https://github.com/sonikfm/booking-service.git",
    DEV_WORKBENCH_BOOKING_SERVICE_REPOSITORY_REVISION: "main",
    DEV_WORKBENCH_AMPLIFY_REPOSITORY_URL: "https://github.com/sonikfm/amplify.git",
    DEV_WORKBENCH_AMPLIFY_REPOSITORY_REVISION: "main",
    DEV_WORKBENCH_GITHUB_APP_ID: "app-123",
    DEV_WORKBENCH_GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_KEY_PEM,
    DEV_WORKBENCH_GITHUB_APP_INSTALLATION_ID: "install-456",
  });
  assert.equal(withBothProfiles.ok, true);
  assert.deepEqual(
    withBothProfiles.value.additionalRepositories.map((profile) => profile.profileId).sort(),
    ["amplify", "booking-service"],
  );
  assert.deepEqual(withBothProfiles.value.githubApp, {
    appId: "app-123",
    privateKey: TEST_PRIVATE_KEY_PEM,
    installationId: "install-456",
  });
  for (const profile of withBothProfiles.value.additionalRepositories) {
    assert.doesNotThrow(() => repositoryProfileSchema.parse(profile), "config-derived profiles must satisfy the same strict contract as hand-built ones");
  }
});

test("workbench-config treats a literal \"undefined\" repository profile URL/revision as unset, not as an enabled profile", () => {
  const baseEnv = {
    DEV_WORKBENCH_ENABLED: "true",
    DEV_WORKBENCH_REPOSITORY_URL: "https://github.com/sonikfm/sonik-agent-ui.git",
    DEV_WORKBENCH_REPOSITORY_REVISION: "main",
    DEV_WORKBENCH_ORGANIZATION_ID: "sonikfm",
    // Simulates the real-world footgun: a platform serializes an unset env var
    // as the literal string "undefined" rather than omitting the key.
    DEV_WORKBENCH_BOOKING_SERVICE_REPOSITORY_URL: "undefined",
    DEV_WORKBENCH_BOOKING_SERVICE_REPOSITORY_REVISION: "undefined",
  };
  const result = readDevWorkbenchConfig(baseEnv);
  assert.equal(result.ok, true, "a literal 'undefined' url/revision pair must be treated as the profile being absent, not as an invalid config");
  assert.deepEqual(result.value.additionalRepositories, [], "no repository profile may be enabled from 'undefined' env values");
  assert.equal(result.value.githubApp, null);
});

test("workbench-config treats literal \"undefined\" GitHub App credentials as unset, not as valid App wiring", () => {
  const result = readDevWorkbenchConfig({
    DEV_WORKBENCH_ENABLED: "true",
    DEV_WORKBENCH_REPOSITORY_URL: "https://github.com/sonikfm/sonik-agent-ui.git",
    DEV_WORKBENCH_REPOSITORY_REVISION: "main",
    DEV_WORKBENCH_ORGANIZATION_ID: "sonikfm",
    DEV_WORKBENCH_GITHUB_APP_ID: "undefined",
    DEV_WORKBENCH_GITHUB_APP_PRIVATE_KEY: "undefined",
    DEV_WORKBENCH_GITHUB_APP_INSTALLATION_ID: "undefined",
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.githubApp, null, "an all-'undefined' GitHub App credential set must be treated as absent, never wired in as a real App config");
});

test("createTmuxWindows is unaffected by repository profiles (sanity: existing behavior untouched)", () => {
  const windows = createTmuxWindows(repository);
  assert.deepEqual(windows.map((window) => window.name), ["codex", "dev", "shell", "logs"]);
});
