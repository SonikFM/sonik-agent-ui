// Host-context helpers for the persona conversation harness against the
// DEPLOYED agent-ui + booking app. Mirrors the base64url envelope encoding in
// apps/standalone-sveltekit/src/lib/server/workspace-services.ts
// (encodeTrustedHostContextHeader).
//
// Verified live path (confirmed by hand before this harness was written):
//   1. POST {bookingUrl}/api/auth/sign-in/email {email,password} -> cookie
//   2. GET  {bookingUrl}/api/v1/booking/agent-ui/host-context (with cookie)
//      -> signed envelope JSON {authenticated, organizationId, scopes,
//         hostSession, signatureVersion, issuedAt, expiresAt, signature}
//   3. header x-sonik-agent-ui-host-context = base64url(JSON.stringify(envelope))
//
// The envelope expires ~10 minutes after issuedAt (expiresAt). This module
// caches a login on disk and refreshes it proactively before expiry so a
// long persona batch run doesn't have to re-auth on every turn.

export function encodeTrustedHostContextHeader(context) {
  const json = JSON.stringify(context);
  const base64 = Buffer.from(json, "utf8").toString("base64");
  return base64.replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Login to the deployed booking app and mint a signed agent-ui host-context
 * envelope from its session cookie, over plain HTTP (no browser). Requires
 * TEST_EMAIL/TEST_PASSWORD (or AMPLIFY_TEST_EMAIL/AMPLIFY_TEST_PASSWORD).
 */
export async function loginDeployedHostContext(input) {
  const { bookingUrl, email, password, fetchImpl = fetch } = input;
  if (!email || !password) {
    throw new Error("Deployed target requires TEST_EMAIL/TEST_PASSWORD (or AMPLIFY_TEST_EMAIL/AMPLIFY_TEST_PASSWORD).");
  }
  const loginResponse = await fetchImpl(`${bookingUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", origin: bookingUrl, referer: `${bookingUrl}/dashboard` },
    body: JSON.stringify({ email, password, callbackURL: "/dashboard" }),
  });
  if (loginResponse.status >= 400) {
    throw new Error(`Booking login failed: ${loginResponse.status} ${await loginResponse.text().catch(() => "")}`);
  }
  const cookie = loginResponse.headers.get("set-cookie");
  if (!cookie) throw new Error("Booking login response did not return a session cookie.");
  // Only the cookie name=value pair is needed on subsequent requests; strip
  // the Set-Cookie attributes (Path, HttpOnly, Secure, SameSite, Max-Age).
  const cookiePair = cookie.split(";")[0];

  const envelopeResponse = await fetchImpl(`${bookingUrl}/api/v1/booking/agent-ui/host-context`, {
    method: "GET",
    headers: { accept: "application/json", cookie: cookiePair },
  });
  if (!envelopeResponse.ok) {
    throw new Error(`Booking agent-ui host-context envelope request failed: ${envelopeResponse.status} ${await envelopeResponse.text().catch(() => "")}`);
  }
  const body = await envelopeResponse.json();
  const envelope = body?.context ?? body?.envelope ?? body;
  if (!envelope || typeof envelope !== "object" || envelope.authenticated !== true) {
    throw new Error("Booking agent-ui host-context envelope response had no usable authenticated envelope field.");
  }
  return { envelope, cookie: cookiePair };
}

export function deployedHeaders(envelope) {
  return {
    "x-sonik-agent-ui-host-context": encodeTrustedHostContextHeader(envelope),
  };
}

/** True when `envelope.expiresAt` is within `marginMs` of now (default 90s). */
export function isEnvelopeNearExpiry(envelope, marginMs = 90_000) {
  if (!envelope?.expiresAt) return true;
  const expiresAtMs = Date.parse(envelope.expiresAt);
  if (Number.isNaN(expiresAtMs)) return true;
  return expiresAtMs - Date.now() <= marginMs;
}
