import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createAgentHostPageContextMessage,
  isAgentHostPageContextMessage,
  sanitizeAgentHostAuthorityDonation,
  sanitizeAgentHostPageContext,
} from "../../packages/agent-embed/src/index.ts";
import {
  acceptNewerOpaqueHostAuthority,
  humanMessageForAgentUiFailure,
  parseAgentUiPublicErrorEnvelope,
  selectOpaqueHostAuthority,
  shouldReplayForNewerHostAuthority,
} from "../../apps/standalone-sveltekit/src/lib/host-context-authority.ts";
import {
  AGENT_UI_HOST_CONTEXT_HEADER,
  createSignedTrustedHostContext,
  encodeTrustedHostContextHeader,
  resolveTrustedHostSessionSnapshot,
} from "../../apps/standalone-sveltekit/src/lib/server/workspace-services.ts";
import { createSmokeHostAuthority } from "../../apps/standalone-sveltekit/src/lib/server/smoke-host-authority.ts";

const issuedAt = new Date(Date.now() - 1_000);
const signed = createSignedTrustedHostContext({
  secret: "g018-real-signer-secret",
  issuedAt,
  ttlMs: 10 * 60_000,
  context: {
    authenticated: true,
    organizationId: "11111111-1111-4111-8111-111111111111",
    scopes: ["agent-ui.workspace.persistence"],
    hostSession: {
      source: "amplify-login-proxy",
      sessionId: "amplify-login-proxy-user-1",
      userId: "user-1",
      principalId: null,
      organizationId: "11111111-1111-4111-8111-111111111111",
      authenticated: true,
      scopes: ["agent-ui.workspace.persistence"],
      expiresAt: null,
      metadata: { authAuthority: "amplify-login-proxy" },
    },
  },
});
const header = encodeTrustedHostContextHeader(signed);
const authority = { header, revision: issuedAt.getTime(), expiresAt: signed.expiresAt };
assert.deepEqual(sanitizeAgentHostAuthorityDonation(authority), authority, "opaque header is bounded without normalization");
assert.deepEqual(createSmokeHostAuthority(signed), authority, "the real local smoke signer exposes the exact encoded authority with its issuance revision and expiry");

const message = createAgentHostPageContextMessage({ route: "/bookings", surface: "booking-console", hostSession: signed.hostSession }, authority);
assert.equal(isAgentHostPageContextMessage(message), true);
assert.equal(message.authority?.header, header, "embed message donates the signer output byte-for-byte");
assert.equal(JSON.stringify(message.payload).includes(header), false, "opaque authority is absent from display page context");
assert.equal(JSON.stringify(sanitizeAgentHostPageContext({ ...message.payload, authority })).includes(header), false, "page-context sanitizer never admits the authority header");
assert.equal("signature" in message.payload, false, "display context does not carry reconstructable signed fields");

const selected = selectOpaqueHostAuthority({ current: authority, cached: null, nowMs: issuedAt.getTime() + 1 });
assert.equal(selected?.header, header, "client selection forwards the exact opaque header");
const server = resolveTrustedHostSessionSnapshot({
  request: new Request("https://agent.example/api/files", { headers: { [AGENT_UI_HOST_CONTEXT_HEADER]: selected.header } }),
  platform: { env: { SONIK_AGENT_UI_HOST_CONTEXT_SECRET: "g018-real-signer-secret" } },
});
assert.equal(server.source, "amplify-login-proxy", "server sees the exact signed source after embed/client forwarding");
assert.equal(server.principalId, null, "an explicitly null signed principal is not reconstructed from userId");
assert.equal(server.userId, "user-1");

const expired = { ...authority, revision: authority.revision + 1, expiresAt: new Date(issuedAt.getTime() - 1).toISOString() };
assert.equal(selectOpaqueHostAuthority({ current: expired, cached: null, nowMs: issuedAt.getTime() }), null);
assert.equal(acceptNewerOpaqueHostAuthority({ current: authority, next: { ...authority, revision: authority.revision - 1 }, nowMs: issuedAt.getTime() + 1 })?.revision, authority.revision, "rollback is ignored");
assert.equal(acceptNewerOpaqueHostAuthority({ current: expired, next: { ...authority, revision: authority.revision - 1 }, nowMs: issuedAt.getTime() }), null, "an expired cache remains a monotonic revision floor even though its header is unusable");
const newer = { ...authority, header: `${header}A`, revision: authority.revision + 1 };
assert.equal(acceptNewerOpaqueHostAuthority({ current: authority, next: newer, nowMs: issuedAt.getTime() + 1 }), newer, "strictly newer valid authority is accepted");
const tampered = resolveTrustedHostSessionSnapshot({
  request: new Request("https://agent.example/api/files", { headers: { [AGENT_UI_HOST_CONTEXT_HEADER]: `${header}tampered` } }),
  platform: { env: { SONIK_AGENT_UI_HOST_CONTEXT_SECRET: "g018-real-signer-secret" } },
});
assert.equal(tampered.authenticated, false, "server HMAC verification still rejects tampering");

const hostFailure = parseAgentUiPublicErrorEnvelope({ ok: false, error: "Authenticated host session required", code: "host_auth_required", phase: "pre_write", safeToRetry: true, requestId: "req-1", traceId: "trace-1", private: "must-drop" });
assert.equal(shouldReplayForNewerHostAuthority({ method: "GET", url: "/api/files/id", responseStatus: 401, failure: hostFailure }), true);
assert.equal(shouldReplayForNewerHostAuthority({ method: "POST", url: "/api/files", responseStatus: 401, failure: hostFailure }), true);
assert.equal(shouldReplayForNewerHostAuthority({ method: "POST", url: "/api/session", responseStatus: 401, failure: hostFailure }), false, "generic POST is never replayed");
assert.equal(shouldReplayForNewerHostAuthority({ method: "PATCH", url: "/api/files", responseStatus: 401, failure: hostFailure }), false);
assert.equal(shouldReplayForNewerHostAuthority({ method: "DELETE", url: "/api/files/id", responseStatus: 401, failure: hostFailure }), false);
assert.equal(shouldReplayForNewerHostAuthority({ method: "POST", url: "/api/files", responseStatus: 500, failure: hostFailure }), false, "generic 5xx is never replayed");
assert.equal(shouldReplayForNewerHostAuthority({ method: "POST", url: "/api/files", responseStatus: 401, failure: { ...hostFailure, phase: "post_write" } }), false, "post-side-effect failures are never replayed");
assert.equal(shouldReplayForNewerHostAuthority({ method: "POST", url: "/api/generate", responseStatus: 401, failure: { ...hostFailure, phase: "pre_stream" } }), true);
assert.equal(humanMessageForAgentUiFailure(hostFailure), "Your secure workspace session expired. Reconnect and try again.");
assert.equal(humanMessageForAgentUiFailure({ ...hostFailure, code: "file_upload_failed", error: '{"private":"must-not-render"}' }), "The file could not be uploaded. Try again.", "the client maps approved codes instead of echoing server JSON/text");
assert.equal(JSON.stringify(hostFailure).includes("must-drop"), false, "public envelope parser drops private fields");

const pageSource = await readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");
assert.match(pageSource, /event\.source !== window\.parent/, "page-context donations require the configured parent window as source");
assert.match(pageSource, /hostAuthorityWaiters\.add\(waiter\)[\s\S]*requestHostPageContext\(reason\)/, "refresh waiter registers before requesting a donation");
assert.match(pageSource, /5_000/, "newer-authority wait is bounded to five seconds");
assert.doesNotMatch(pageSource, /encodeWorkspaceHostContextHeader|createSignedWorkspaceHostSession/, "client never reconstructs the HMAC-covered header");
assert.match(pageSource, /typedFailure \? humanMessageForAgentUiFailure\(typedFailure\) : "Generation failed\. Please try again\."/, "transport never projects a raw JSON error body into chat");
const smokeSigner = await readFile("apps/standalone-sveltekit/src/routes/api/dev/smoke-host-context/+server.ts", "utf8");
assert.match(smokeSigner, /createSmokeHostAuthority\(signed\)/);
assert.match(smokeSigner, /source: "amplify-login-proxy"/);
assert.match(smokeSigner, /principalId: null/);
const fakeHost = await readFile("apps/standalone-sveltekit/static/fake-booking-host.html", "utf8");
assert.match(fakeHost, /signedFixtureAuthority = body\?\.authority \?\? null/);
assert.match(fakeHost, /authority: signedFixtureAuthority/, "the fake host passes the signer result directly to the embed donation seam");
assert.doesNotMatch(fakeHost, /signatureVersion: pageContext|encodeWorkspaceHostContextHeader/, "the fake host never reconstructs opaque authority from display context");

console.log("host-authority-recovery.test.mjs: all assertions passed");
