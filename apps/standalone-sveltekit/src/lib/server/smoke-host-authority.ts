import {
  encodeTrustedHostContextHeader,
  type WorkspaceTrustedHostContext,
} from "./workspace-services.ts";

/** Build the browser donation metadata from the signer output without
 * decoding, normalizing, or reconstructing its encoded header. */
export function createSmokeHostAuthority(context: WorkspaceTrustedHostContext) {
  const expiresAt = context.expiresAt;
  const revision = Date.parse(context.issuedAt ?? "");
  if (!expiresAt || !Number.isSafeInteger(revision)) {
    throw new Error("Signed smoke authority requires issuedAt and expiresAt");
  }
  return { header: encodeTrustedHostContextHeader(context), revision, expiresAt };
}
