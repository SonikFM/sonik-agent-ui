import { createSign } from "node:crypto";
import { DEV_WORKBENCH_STATE_ROOT } from "../contracts/workbench";
import { redactDiagnostic } from "./vercel-sandbox";

// The credential file lives under the sandbox state root (never inside a repo
// checkout, never an env var, never a command argv). git reads it via
// `credential.helper=store --file=<this path>` configured per-clone.
export const GIT_CREDENTIAL_FILE_PATH = `${DEV_WORKBENCH_STATE_ROOT}/.git-credentials` as const;

// GitHub rejects App JWTs whose lifetime exceeds 10 minutes; stay under with margin.
const APP_JWT_TTL_SECONDS = 540;
const APP_JWT_CLOCK_DRIFT_SECONDS = 60;

export type InstallationToken = { token: string; expiresAt: string };

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Minimal RS256 App JWT signer via node:crypto — avoids adding a JWT dependency. */
export function signAppJwt(input: { appId: string; privateKey: string; now: Date }): string {
  const issuedAt = Math.floor(input.now.getTime() / 1_000) - APP_JWT_CLOCK_DRIFT_SECONDS;
  const signingInput = [
    base64url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64url(JSON.stringify({ iat: issuedAt, exp: issuedAt + APP_JWT_TTL_SECONDS, iss: input.appId })),
  ].join(".");
  const signature = createSign("RSA-SHA256").update(signingInput).sign(input.privateKey);
  return `${signingInput}.${base64url(signature)}`;
}

export async function mintInstallationToken(input: {
  appId: string;
  privateKey: string;
  installationId: string;
  repositories: readonly string[];
  now?: () => Date;
  signJwt?: (jwtInput: { appId: string; privateKey: string; now: Date }) => string;
  fetchImpl?: typeof fetch;
}): Promise<InstallationToken> {
  const now = (input.now ?? (() => new Date()))();
  const signJwt = input.signJwt ?? signAppJwt;
  const fetchImpl = input.fetchImpl ?? fetch;

  let jwt: string;
  try {
    jwt = signJwt({ appId: input.appId, privateKey: input.privateKey, now });
  } catch {
    // Never interpolate the underlying error here: a crypto/PEM-parsing
    // failure can embed the raw private key in its message, and
    // redactDiagnostic's token/url patterns don't cover PEM material.
    throw new Error("GitHub App JWT signing failed.");
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.github.com/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        // Least privilege: scope the minted token to contents:write, never
        // the App's full permission set (GitHub's default when omitted).
        body: JSON.stringify({ repositories: input.repositories, permissions: { contents: "write" } }),
      },
    );
  } catch (error) {
    throw new Error(redactDiagnostic(`GitHub App installation token request failed: ${error instanceof Error ? error.message : "unknown error"}`));
  }
  if (!response.ok) {
    throw new Error(redactDiagnostic(`GitHub App installation token request returned ${response.status}`));
  }
  const body = (await response.json()) as { token?: unknown; expires_at?: unknown };
  if (typeof body.token !== "string" || typeof body.expires_at !== "string") {
    throw new Error("GitHub App installation token response was malformed");
  }
  return { token: body.token, expiresAt: body.expires_at };
}

export function buildGitCredentialFileContent(input: { token: string; host?: string }): string {
  return `https://x-access-token:${input.token}@${input.host ?? "github.com"}\n`;
}

/** Shaped for the existing sandbox.writeFiles seam — never delivered via env or command argv. */
export function buildGitCredentialWriteFile(input: { token: string; host?: string }): { path: string; content: string } {
  return { path: GIT_CREDENTIAL_FILE_PATH, content: buildGitCredentialFileContent(input) };
}
