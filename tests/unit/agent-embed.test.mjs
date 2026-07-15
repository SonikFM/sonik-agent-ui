import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SONIK_AGENT_UI_HOST_MESSAGE_SOURCE,
  SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE,
  SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST,
  createAgentEmbedUrl,
  createAgentHostPageContextMessage,
  isAgentHostPageContextMessage,
  isAgentOriginAllowed,
  parseAgentOriginAllowlist,
  mergeAgentHostPageContext,
  normalizeAgentEmbedIntent,
  mountSonikAgentUI,
  sanitizeAgentHostPageContext,
} from "../../packages/agent-embed/src/index.ts";
import { createInteractiveSurfaceJsonRenderSpec } from "../../packages/json-ui-runtime/src/intake.ts";
import { BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE } from "../../apps/standalone-sveltekit/src/lib/server/booking-workflows/context-intake.ts";
import { createAgentWorkflowSnapshot } from "../../apps/standalone-sveltekit/src/lib/agent-workflows/page-control-workflow.ts";

const message = {
  source: SONIK_AGENT_UI_HOST_MESSAGE_SOURCE,
  type: SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE,
  sentAt: "2026-06-21T00:00:00.000Z",
  payload: {
    route: "/booking/bookings/booking_123",
    surface: "booking-console",
    pageType: "event-booking-detail",
    title: "Summer Jazz Night",
    theme: "gunmetal-light",
    activeEntity: { type: "booking", id: "booking_123", label: "Summer Jazz Night" },
    commandFamilies: ["booking", "event", "", "booking"],
    skillFamilies: ["booking-ops"],
    organizationId: "forged-org",
    scopes: ["admin:*"],
  },
};

assert.equal(isAgentHostPageContextMessage(message), true, "valid host page-context messages should be recognized");
assert.equal(isAgentHostPageContextMessage({ ...message, source: "wrong" }), false, "wrong message source should be rejected");
assert.equal(isAgentHostPageContextMessage({ ...message, payload: null }), false, "missing object payload should be rejected");

const sanitized = sanitizeAgentHostPageContext(message.payload);
assert.equal(sanitized?.surface, "booking-console");
assert.equal(sanitized?.theme, "gunmetal-light", "host page theme should survive page-context sanitization");
assert.equal(sanitized?.activeEntity?.label, "Summer Jazz Night");
assert.equal(sanitized?.organizationId, "forged-org", "allowed hosts may donate sanitized org context for the host-asserted embed runtime");
assert.deepEqual(sanitized?.scopes, ["admin:*"], "allowed hosts may donate sanitized scopes for the host-asserted embed runtime");

const merged = mergeAgentHostPageContext(
  { route: "/", surface: "chat", commandFamilies: ["local-ui"], activeSessionId: "sess-local" },
  message.payload,
  { authenticated: true, organizationId: "org-trusted", scopes: ["booking:read"], hostSession: null },
);
assert.equal(merged.route, "/booking/bookings/booking_123", "host page context should overlay local route");
assert.equal(merged.surface, "booking-console", "host page context should overlay local surface");
assert.equal(merged.theme, "gunmetal-light", "host page context should overlay local theme");
assert.equal(merged.activeSessionId, "sess-local", "local app session state should be retained when host does not override it");
assert.equal(merged.activeEntity?.id, "booking_123", "merged context should include active entity id");
assert.equal(merged.organizationId, "org-trusted", "trusted context should be appended explicitly");
assert.deepEqual(merged.scopes, ["booking:read"], "trusted scopes should come from trusted context only");

const spoofedSupportDiagnostics = {
  route: "/hostile",
  correlation: {
    sessionId: "session-support",
    messageId: "message-support",
    requestId: "request-hostile",
    traceId: "0123456789abcdef0123456789abcdef",
    traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    agentUiRunId: "run-hostile",
    status: "success",
    capturedAt: "2026-07-10T12:00:00.000Z",
    rawHeaders: { cookie: "should-not-survive" },
  },
  deployment: {
    id: "deployment-hostile",
    tag: "release-hostile",
    timestamp: "2026-07-10T11:59:00.000Z",
    rawHeaders: { authorization: "Bearer should-not-survive" },
  },
};
const sanitizedSpoofedSupportDiagnostics = sanitizeAgentHostPageContext(spoofedSupportDiagnostics);
assert.equal(sanitizedSpoofedSupportDiagnostics?.correlation, undefined, "host-supplied correlation must be dropped");
assert.equal(sanitizedSpoofedSupportDiagnostics?.deployment, undefined, "host-supplied deployment must be dropped");
const mergedWithSpoofedSupportDiagnostics = mergeAgentHostPageContext(
  { activeSessionId: "session-support" },
  spoofedSupportDiagnostics,
);
assert.equal(mergedWithSpoofedSupportDiagnostics.correlation, undefined, "host merge must not accept spoofed correlation");
assert.equal(mergedWithSpoofedSupportDiagnostics.deployment, undefined, "host merge must not accept spoofed deployment");

// Regression: window.__sonikAgentUI.getPageContext() (the standalone route's createPageContextSnapshot)
// always routes the local snapshot through mergeAgentHostPageContext/sanitizeAgentHostPageContext before
// returning it, even with no embedding host present. The sanitizer's key allowlist previously omitted
// "workflow", so the agent-readable workflow snapshot (currentQuestion, phase, etc.) was silently dropped
// for every intake artifact, regardless of whether it was created via createBookingIntakeArtifact or a
// hand-built manifest. Build the workflow snapshot from the same generator the live agent tool uses.
const liveAgentIntakeSpec = createInteractiveSurfaceJsonRenderSpec(BOOKING_CONTEXT_INTAKE_SURFACE_TEMPLATE);
const liveAgentIntakeArtifact = { id: "artifact-live-agent-intake", title: "Booking intake", kind: "json-render", version: 1, content: liveAgentIntakeSpec };
const liveAgentWorkflow = createAgentWorkflowSnapshot({
  activeArtifact: liveAgentIntakeArtifact,
  pendingChangeCount: 0,
  isStreaming: false,
  approvalReadiness: { ready: false, visible: true, reason: "Answer setup type and inventory before previewing." },
});
const mergedWithWorkflow = mergeAgentHostPageContext(
  { route: "/", surface: "artifact", activeArtifactId: liveAgentIntakeArtifact.id, workflow: liveAgentWorkflow },
  null,
);
assert.ok(mergedWithWorkflow.workflow, "page context returned by getPageContext() must retain the workflow snapshot after merge/sanitize");
assert.equal(typeof mergedWithWorkflow.workflow?.phase, "string", "merged workflow snapshot must report a phase string");
assert.equal(mergedWithWorkflow.workflow?.currentQuestion?.id, "q_intake_mode", "merged workflow snapshot must retain the current unanswered question for page-control submitAnswer/markUnknown");

const redacted = sanitizeAgentHostPageContext({
  route: "/safe",
  activeEntity: { type: "booking", id: "booking_123", label: "leaked vck_TESTREDACTME123456789" },
});
assert.equal(redacted?.activeEntity?.label?.includes("vck_"), false, "active entity display labels should be redacted");
const trustedSession = sanitizeAgentHostPageContext({
  authenticated: true,
  organizationId: "org_123",
  scopes: ["booking:read", ""],
  hostSession: {
    source: "amplify-embedded",
    sessionId: "sess_123",
    userId: "user_123",
    principalId: "principal_123",
    organizationId: "org_123",
    authenticated: true,
    scopes: ["booking:read"],
    theme: "gunmetal-dark",
    metadata: { token: "vck_SHOULDNOTSURVIVE123456" },
  },
});
assert.equal(trustedSession?.authenticated, true, "trusted host authentication flag should survive sanitization");
assert.equal(trustedSession?.hostSession?.source, "amplify-embedded", "known host session source should survive sanitization");
assert.equal(trustedSession?.hostSession?.theme, "gunmetal-dark", "trusted host session theme should survive sanitization");
assert.deepEqual(trustedSession?.hostSession?.metadata, { token: "[REDACTED]" }, "host session metadata should preserve signed-envelope shape with redacted string values");


const signedTrustedSession = sanitizeAgentHostPageContext({
  authenticated: true,
  organizationId: "org_signed",
  scopes: ["workspace:read"],
  signatureVersion: "sonik.agent_ui.host_context.hmac.v1",
  issuedAt: "2026-06-24T22:00:00.000Z",
  expiresAt: "2026-06-24T22:10:00.000Z",
  signature: "abc123_signature",
  hostSession: {
    source: "amplify-embedded",
    userId: "user_signed",
    organizationId: "org_signed",
    authenticated: true,
    scopes: ["workspace:read"],
  },
});
assert.equal(signedTrustedSession?.signatureVersion, undefined, "display page context must drop reconstructable signature fields");
assert.equal(signedTrustedSession?.signature, undefined, "display page context never carries the opaque authority signature");
assert.equal(signedTrustedSession?.issuedAt, undefined, "display page context never carries authority issuance metadata");
assert.equal(signedTrustedSession?.expiresAt, undefined, "display page context never carries authority expiry metadata");
assert.equal(signedTrustedSession?.hostSession?.theme, undefined, "signed host-context sanitizer must not materialize display-only theme when the host did not sign it");

const signedTrustedSessionWithMetadata = sanitizeAgentHostPageContext({
  authenticated: true,
  organizationId: "org_signed",
  scopes: ["agent-ui.workspace.persistence"],
  signatureVersion: "sonik.agent_ui.host_context.hmac.v1",
  issuedAt: "2026-06-24T22:00:00.000Z",
  expiresAt: "2026-06-24T22:10:00.000Z",
  signature: "abc123_signature",
  hostSession: {
    source: "amplify-embedded",
    userId: "user_signed",
    principalId: "user_signed",
    organizationId: "org_signed",
    authenticated: true,
    scopes: ["agent-ui.workspace.persistence"],
    expiresAt: "2026-06-24T22:10:00.000Z",
    metadata: {
      authAuthority: "amplify-org-context",
      sessionMode: "production",
      approvedCommandIds: ["booking.create.hold", "booking.release.hold"],
    },
  },
});
const approvedCommandGrantList = Array.from({ length: 72 }, (_, index) => `booking.generated.${index + 1}`);
const signedTrustedSessionWithFullCommandMetadata = sanitizeAgentHostPageContext({
  authenticated: true,
  organizationId: "org_signed",
  scopes: ["agent-ui.workspace.persistence"],
  signatureVersion: "sonik.agent_ui.host_context.hmac.v1",
  issuedAt: "2026-06-24T22:00:00.000Z",
  expiresAt: "2026-06-24T22:10:00.000Z",
  signature: "abc123_signature",
  hostSession: {
    source: "amplify-embedded",
    userId: "user_signed",
    principalId: "user_signed",
    organizationId: "org_signed",
    authenticated: true,
    scopes: ["agent-ui.workspace.persistence"],
    expiresAt: "2026-06-24T22:10:00.000Z",
    metadata: {
      approvedCommandIds: approvedCommandGrantList,
    },
  },
});
assert.deepEqual(
  signedTrustedSessionWithMetadata?.hostSession?.metadata,
  {
    authAuthority: "amplify-org-context",
    sessionMode: "production",
    approvedCommandIds: ["booking.create.hold", "booking.release.hold"],
  },
  "sanitized host-session metadata remains available only as a display/readiness hint",
);
assert.deepEqual(
  signedTrustedSessionWithFullCommandMetadata?.hostSession?.metadata?.approvedCommandIds,
  approvedCommandGrantList,
  "full approvedCommandIds hints remain available without reconstructing the opaque authority header",
);

assert.deepEqual(
  normalizeAgentEmbedIntent({ embedMode: "chat" }),
  { mode: "chat", railMode: "hidden" },
  "chat embed mode should default to hidden rail",
);
assert.deepEqual(
  normalizeAgentEmbedIntent({ embedMode: "canvas" }),
  { mode: "canvas", railMode: "expanded" },
  "canvas embed mode should default to the expanded rail so pin/archive session management is reachable in embeds (host can override with railMode=collapsed)",
);
assert.deepEqual(
  normalizeAgentEmbedIntent({ agentUiMode: "workspace", rail: "expanded" }),
  { mode: "workspace", railMode: "expanded" },
  "workspace embed mode should accept explicit rail intent",
);
assert.deepEqual(
  normalizeAgentEmbedIntent({ embedMode: "bad", railMode: "bad" }),
  { mode: "workspace", railMode: "expanded" },
  "invalid embed intent should normalize to safe standalone defaults",
);

const chatUrl = createAgentEmbedUrl({
  agentUrl: "https://agent.sonik.local/workspace",
  hostOrigin: "https://booking.sonik.local",
  mode: "chat",
  theme: "lemonade",
  smokeMockStream: "1",
  smokeRunId: "run-123",
});
assert.equal(chatUrl, "https://agent.sonik.local/workspace?agentUiHostOrigin=https%3A%2F%2Fbooking.sonik.local&theme=lemonade&embedMode=chat&rail=hidden&smokeMockStream=1&smokeRunId=run-123", "chat URL should encode host origin, mode, rail, theme, and smoke parameters deterministically");
assert.equal(chatUrl.includes("publishedAgentId"), false, "config without publishedAgentId must stay byte-identical to today's embed URL");

// Phase 10 (agent-creation-tool-plan-2026-07-13.md): publishedAgentId selects WHICH published
// agent definition the embed runs -- a tiny additive query param, never a capability grant (those
// stay host-signed + registry-gated server-side via the signed host-context envelope, untouched here).
const publishedAgentUrl = createAgentEmbedUrl({
  agentUrl: "https://agent.sonik.local/workspace",
  hostOrigin: "https://booking.sonik.local",
  mode: "chat",
  publishedAgentId: "agent_campaign_landing_page",
});
assert.equal(
  publishedAgentUrl,
  "https://agent.sonik.local/workspace?agentUiHostOrigin=https%3A%2F%2Fbooking.sonik.local&embedMode=chat&rail=hidden&publishedAgentId=agent_campaign_landing_page",
  "embed URL should carry publishedAgentId as a small selector query param",
);

assert.deepEqual(parseAgentOriginAllowlist("https://*.workers.dev, https://*.sonik.fm"), ["https://*.workers.dev", "https://*.sonik.fm"], "origin allowlist should parse comma-separated wildcard patterns");
assert.equal(isAgentOriginAllowed("https://amplify-staging.liam-trampota.workers.dev", "https://*.workers.dev,https://*.sonik.fm"), true, "workers.dev staging hosts should match wildcard allowlist");
assert.equal(isAgentOriginAllowed("https://app.amplify.sonik.fm", "https://*.workers.dev,https://*.sonik.fm"), true, "sonik.fm hosts should match wildcard allowlist");
assert.equal(isAgentOriginAllowed("https://workers.dev", "https://*.workers.dev"), false, "wildcard should require a subdomain boundary");
assert.equal(isAgentOriginAllowed("https://evil.example", "https://*.workers.dev,https://*.sonik.fm"), false, "unlisted hosts should be rejected");
assert.equal(isAgentOriginAllowed("https://evil.example", "*"), true, "explicit star should allow all origins for temporary frictionless demos only");

const contextMessage = createAgentHostPageContextMessage({ surface: "booking-console" });
assert.equal(contextMessage.source, SONIK_AGENT_UI_HOST_MESSAGE_SOURCE, "message builder should use canonical source");
assert.equal(contextMessage.type, SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE, "message builder should use canonical type");
assert.equal(contextMessage.payload.surface, "booking-console", "message builder should carry page context payload");

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.listeners = new Map();
    this.parentElement = null;
    this.children = [];
    this.style = { values: {}, setProperty: (key, value) => { this.style.values[key] = value; } };
    this.attributes = new Map();
  }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type) { this.listeners.delete(type); }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  dispatch(type, event = {}) { this.listeners.get(type)?.(event); }
}

class FakeIframe extends FakeElement {
  set src(value) { this._src = value; this.setAttribute("src", value); }
  get src() { return this._src; }
  contentWindow = { messages: [], postMessage: (message, targetOrigin) => this.contentWindow.messages.push({ message, targetOrigin }) };
}

const fakeIframe = new FakeIframe("agent-frame");
const fakeChatSlot = new FakeElement("chat-slot");
const fakeCanvasSlot = new FakeElement("canvas-slot");
const fakeSidecar = new FakeElement("sidecar");
const fakeCanvas = new FakeElement("canvas");
const fakeLauncher = new FakeElement("launcher");
const fakeOpenChat = new FakeElement("open-chat");
const fakeOpenCanvas = new FakeElement("open-canvas");
const fakeDocumentElement = new FakeElement("html");
const fakeBody = new FakeElement("body");
const fakeWindow = {
  location: { origin: "https://booking.sonik.local" },
  document: null,
  innerWidth: 1280,
  setTimeout: (fn) => { fn(); return 1; },
  clearTimeout: () => undefined,
  requestAnimationFrame: (fn) => { fn(); return 1; },
  cancelAnimationFrame: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  getComputedStyle: () => ({ getPropertyValue: () => "520" }),
};
const fakeDocument = {
  body: fakeBody,
  documentElement: fakeDocumentElement,
  querySelector: (selector) => ({
    "#agent-frame": fakeIframe,
    "#chat-slot": fakeChatSlot,
    "#canvas-slot": fakeCanvasSlot,
    "#sidecar": fakeSidecar,
    "#canvas": fakeCanvas,
    "#launcher": fakeLauncher,
    "#open-chat": fakeOpenChat,
    "#open-canvas": fakeOpenCanvas,
  })[selector] ?? null,
};
fakeWindow.document = fakeDocument;

const controller = mountSonikAgentUI({
  agentUrl: "https://agent.sonik.local/",
  hostOrigin: "https://booking.sonik.local",
  theme: "lemonade",
  smokeMockStream: "1",
  smokeRunId: "mount-test",
  getPageContext: () => ({
    pageContext: { surface: "booking-console", organizationId: "forged-org", scopes: ["admin:*"], activeEntity: { type: "booking", id: "booking_123", label: "Summer Jazz Night" } },
    authority: { header: "opaque_signed_header_ABC123", revision: 7, expiresAt: "2099-06-24T22:10:00.000Z" },
  }),
  elements: { iframe: "#agent-frame", chatSlot: "#chat-slot", canvasSlot: "#canvas-slot", sidecar: "#sidecar", canvasWindow: "#canvas", launcher: "#launcher", openChat: "#open-chat", openCanvas: "#open-canvas" },
  window: fakeWindow,
  document: fakeDocument,
});
assert.equal(fakeIframe.parentElement, fakeChatSlot, "mount should park iframe in chat slot before a mode opens");
assert.equal(fakeWindow.__sonikAgentHost?.schemaVersion, "sonik.agent_ui.host_controller.v1", "mount should expose a stable host controller for embed automation and release gates");
assert.equal(fakeIframe.dataset.sonikAgentUiControl, "iframe", "mount should annotate iframe with a stable Agent UI control attribute");
assert.equal(fakeIframe.getAttribute("data-testid"), "sonik-agent-ui-iframe", "mount should annotate iframe with a stable test id");
assert.equal(fakeLauncher.dataset.sonikAgentUiControl, "launcher", "mount should annotate a host-owned launcher for deterministic embed discovery");
assert.equal(fakeLauncher.getAttribute("data-testid"), "sonik-agent-ui-launcher", "mount should annotate launcher with the release-gate test id");
assert.equal(fakeOpenChat.dataset.sonikAgentUiControl, "open-chat", "mount should annotate open-chat controls for deterministic embed discovery");
assert.equal(fakeOpenCanvas.dataset.sonikAgentUiControl, "open-canvas", "mount should annotate open-canvas controls for deterministic embed discovery");
fakeOpenChat.dispatch("click");
assert.equal(controller.getMode(), "chat", "annotated open-chat control should open chat via the SDK click handler");
controller.close();
fakeOpenCanvas.dispatch("click");
assert.equal(controller.getMode(), "canvas", "annotated open-canvas control should open canvas via the SDK click handler");
controller.close();
fakeIframe.dispatch("load");
assert.equal(fakeIframe.contentWindow.messages.length, 0, "parked about:blank iframe must not receive host context before it is navigated to the agent origin");
fakeWindow.__sonikAgentHost.openChat();
assert.equal(controller.getMode(), "chat", "host controller should open and track chat mode");
assert.equal(fakeIframe.src.includes("publishedAgentId"), false, "mount without publishedAgentId must not add the param to the iframe src");
assert.equal(fakeBody.dataset.agentUiOpen, "chat", "controller should expose host body open mode");
assert.equal(fakeSidecar.dataset.open, "true", "controller should open sidecar dataset state");
assert.match(fakeIframe.src, /embedMode=chat/, "controller should set iframe src for chat mode");
const chatFrameSrc = fakeIframe.src;
await controller.postContext();
assert.equal(fakeIframe.contentWindow.messages.at(-1).message.payload.mode, "chat", "chat postContext should donate the current active mode");
assert.equal(fakeIframe.contentWindow.messages.at(-1).message.payload.organizationId, "forged-org", "browser postMessage payload should carry sanitized host-asserted organization context");
assert.deepEqual(fakeIframe.contentWindow.messages.at(-1).message.payload.scopes, ["admin:*"], "browser postMessage payload should carry sanitized host-asserted scopes");
assert.equal(fakeIframe.contentWindow.messages.at(-1).message.payload.signature, undefined, "browser display payload must not carry reconstructable signed fields");
assert.equal(fakeIframe.contentWindow.messages.at(-1).message.authority.header, "opaque_signed_header_ABC123", "browser postMessage donates the opaque authority byte-for-byte outside display context");
assert.equal(fakeIframe.contentWindow.messages.at(-1).targetOrigin, "https://agent.sonik.local", "cross-origin embeds should post page context to the agent iframe origin, not the host origin");
fakeWindow.__sonikAgentHost.openCanvas();
assert.equal(fakeIframe.parentElement, fakeCanvasSlot, "host controller should move iframe into canvas slot");
assert.equal(fakeIframe.src, chatFrameSrc, "opening canvas should move the existing iframe without changing its src after chat opened");
await controller.postContext();
assert.equal(fakeIframe.contentWindow.messages.at(-1).message.payload.mode, "canvas", "canvas postContext should donate the updated active mode");
assert.equal(fakeCanvas.dataset.open, "true", "controller should open canvas dataset state");
controller.close();
assert.equal(controller.getMode(), null, "controller close should clear active mode");
assert.equal(fakeBody.dataset.agentUiOpen, undefined, "controller close should clear host body mode");
controller.destroy();
assert.equal(fakeWindow.__sonikAgentHost, undefined, "destroy should remove the host controller it installed");

const queuedTimers = [];
const clearedTimers = [];
const timerWindow = {
  ...fakeWindow,
  setTimeout: (fn, delay) => { const id = queuedTimers.length + 100; queuedTimers.push({ id, fn, delay }); return id; },
  clearTimeout: (id) => clearedTimers.push(id),
};
const timerIframe = new FakeIframe("timer-frame");
const timerChatSlot = new FakeElement("timer-chat");
const timerCanvasSlot = new FakeElement("timer-canvas");
const timerBody = new FakeElement("timer-body");
const timerDocumentElement = new FakeElement("timer-html");
const timerDocument = {
  body: timerBody,
  documentElement: timerDocumentElement,
  querySelector: (selector) => ({
    "#timer-frame": timerIframe,
    "#timer-chat": timerChatSlot,
    "#timer-canvas": timerCanvasSlot,
  })[selector] ?? null,
};
timerWindow.document = timerDocument;
const timerController = mountSonikAgentUI({
  agentUrl: "https://agent.sonik.local/",
  hostOrigin: "https://booking.sonik.local",
  initialMode: "workspace",
  getPageContext: () => ({ surface: "booking-console" }),
  elements: { iframe: "#timer-frame", chatSlot: "#timer-chat", canvasSlot: "#timer-canvas" },
  window: timerWindow,
  document: timerDocument,
});
assert.equal(timerController.getMode(), "canvas", "initialMode workspace should open the canvas/workspace view consistently with open('workspace')");
assert.equal(timerIframe.parentElement, timerCanvasSlot, "initialMode workspace should mount iframe into the canvas slot");
timerIframe.dispatch("load");
assert.deepEqual(queuedTimers.map((timer) => timer.delay), [250, 900, 1800, 3200, 5200, 8000], "iframe load should queue bounded context-post timers");
timerController.destroy();
assert.deepEqual(clearedTimers, queuedTimers.map((timer) => timer.id), "destroy should clear queued context-post timers");
assert.equal(timerController.getMode(), null, "destroy should close active mode");

const publishedAgentIframe = new FakeIframe("published-agent-frame");
const publishedAgentChatSlot = new FakeElement("published-agent-chat-slot");
const publishedAgentDocument = {
  body: new FakeElement("published-agent-body"),
  documentElement: new FakeElement("published-agent-html"),
  querySelector: (selector) => ({
    "#published-agent-frame": publishedAgentIframe,
    "#published-agent-chat-slot": publishedAgentChatSlot,
  })[selector] ?? null,
};
const publishedAgentWindow = { ...fakeWindow, document: publishedAgentDocument };
const publishedAgentController = mountSonikAgentUI({
  agentUrl: "https://agent.sonik.local/",
  hostOrigin: "https://booking.sonik.local",
  publishedAgentId: "agent_campaign_landing_page",
  getPageContext: () => ({ surface: "event-landing-page" }),
  elements: { iframe: "#published-agent-frame", chatSlot: "#published-agent-chat-slot" },
  window: publishedAgentWindow,
  document: publishedAgentDocument,
});
publishedAgentController.open("chat");
assert.match(publishedAgentIframe.src, /publishedAgentId=agent_campaign_landing_page/, "mount config carrying publishedAgentId should flow it through to the embedded iframe's request URL");
publishedAgentController.destroy();

// P1 #10 (production-readiness ledger): allowedOrigins narrows the existing
// exact-agentOrigin postMessage check further. A window that actually
// captures listeners is needed here (the shared fakeWindow above no-ops
// addEventListener) so a "message" event can be dispatched through it.
function createMessageCapableWindow(overrides = {}) {
  const listeners = new Map();
  return {
    location: { origin: "https://booking.sonik.local" },
    innerWidth: 1280,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => undefined,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame: () => undefined,
    getComputedStyle: () => ({ getPropertyValue: () => "520" }),
    addEventListener: (type, handler) => {
      const handlers = listeners.get(type) ?? [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    removeEventListener: (type, handler) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((existing) => existing !== handler));
    },
    dispatchMessage: (event) => {
      for (const handler of listeners.get("message") ?? []) handler(event);
    },
    ...overrides,
  };
}

function mountForOriginTest(allowedOrigins) {
  const iframe = new FakeIframe("origin-test-frame");
  const chatSlot = new FakeElement("origin-test-chat-slot");
  const document = {
    body: new FakeElement("origin-test-body"),
    documentElement: new FakeElement("origin-test-html"),
    querySelector: (selector) => ({ "#origin-test-frame": iframe, "#origin-test-chat-slot": chatSlot })[selector] ?? null,
  };
  const window = createMessageCapableWindow({ document });
  window.document = document;
  const controller = mountSonikAgentUI({
    agentUrl: "https://agent.sonik.local/",
    hostOrigin: "https://booking.sonik.local",
    ...(allowedOrigins !== undefined ? { allowedOrigins } : {}),
    getPageContext: () => ({ surface: "origin-test" }),
    elements: { iframe: "#origin-test-frame", chatSlot: "#origin-test-chat-slot" },
    window,
    document,
  });
  controller.open("chat"); // navigates iframe.src to the agent origin so resolveMountedAgentTargetOrigin resolves
  const agentOrigin = new URL(iframe.src).origin;
  return { controller, iframe, window, agentOrigin };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

{
  const { window, iframe, agentOrigin } = mountForOriginTest("https://trusted.example");
  iframe.contentWindow.messages.length = 0; // clear postContext-on-open noise
  window.dispatchMessage({ origin: agentOrigin, source: iframe.contentWindow, data: { source: "sonik-agent-ui", type: SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST } });
  await flushMicrotasks();
  assert.equal(iframe.contentWindow.messages.length, 0, "a message from the correct agentOrigin should still be rejected when allowedOrigins does not include that origin");
}

{
  const { window, iframe, agentOrigin } = mountForOriginTest("https://trusted.example,https://agent.sonik.local");
  iframe.contentWindow.messages.length = 0;
  window.dispatchMessage({ origin: agentOrigin, source: iframe.contentWindow, data: { source: "sonik-agent-ui", type: SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST } });
  await flushMicrotasks();
  assert.equal(iframe.contentWindow.messages.length, 1, "a message from an origin included in allowedOrigins should be processed");
}

{
  const { window, iframe, agentOrigin } = mountForOriginTest(undefined);
  iframe.contentWindow.messages.length = 0;
  window.dispatchMessage({ origin: agentOrigin, source: iframe.contentWindow, data: { source: "sonik-agent-ui", type: SONIK_AGENT_UI_PAGE_CONTEXT_REQUEST } });
  await flushMicrotasks();
  assert.equal(iframe.contentWindow.messages.length, 1, "omitting allowedOrigins must preserve today's behavior: only the exact-agentOrigin check applies");
}

const localEmbedSmokeSource = await readFile("scripts/agent-ui-embed-smoke.mjs", "utf8");
const bookingContextSmokeSource = await readFile("scripts/agent-ui-booking-context-pipeb-smoke.mjs", "utf8");
const bookingReservationSmokeSource = await readFile("scripts/agent-ui-booking-reservation-pipeb-smoke.mjs", "utf8");
const staticVendorEmbedSource = await readFile("apps/standalone-sveltekit/static/vendor/sonik-agent-ui/agent-embed.js", "utf8");
assert.equal(localEmbedSmokeSource.includes("session bootstrap reused stale active session"), true, "local embed smoke should prove a fresh session instead of accepting stale state");
assert.equal(localEmbedSmokeSource.includes("evidence.sessionBootstrap"), true, "local embed smoke should record explicit session bootstrap evidence");
assert.equal(localEmbedSmokeSource.includes("usedManualLauncher: false"), true, "local embed smoke should prove artifact creation auto-opens canvas without the manual #open-canvas launcher");
assert.equal(localEmbedSmokeSource.includes("Automatic canvas.open changed iframe src"), true, "local embed smoke should fail if automatic canvas opening reloads the iframe instead of moving it");
assert.equal(localEmbedSmokeSource.includes("Automatic canvas.open did not preserve active stream state"), true, "local embed smoke should prove stream state is preserved while the iframe moves to canvas");
assert.equal(localEmbedSmokeSource.includes("Canvas layout did not preserve expected artifact/chat ordering"), true, "local embed smoke should prove the artifact never follows compact chat in canvas mode");
assert.equal(localEmbedSmokeSource.includes("Canvas layout did not keep the AgentConversation header visible"), true, "local embed smoke should prove embedded canvas keeps the conversation header visible");
assert.equal(localEmbedSmokeSource.includes("Canvas layout did not hide the session rail while keeping the chat-history switcher visible"), true, "local embed smoke should prove embedded canvas hides the session rail while keeping chat history available");
assert.equal(localEmbedSmokeSource.includes("the conversation header and chat-history switcher visible, and the session rail hidden"), true, "local embed smoke PASS evidence should report all three canvas chrome facts");
assert.equal(bookingContextSmokeSource.includes("usedDeterministicHostController"), true, "booking context release gate should report deterministic host-controller opening");
assert.equal(bookingContextSmokeSource.includes("Booking embed did not open through window.__sonikAgentHost"), true, "booking context release gate should fail if host controller opening is unavailable");
assert.equal(bookingReservationSmokeSource.includes("usedDeterministicHostController"), true, "booking reservation release gate should report deterministic host-controller opening");
assert.equal(bookingReservationSmokeSource.includes("Booking reservation embed did not open through window.__sonikAgentHost"), true, "booking reservation release gate should fail if host controller opening is unavailable");
assert.equal(bookingReservationSmokeSource.includes("fake-booking-host.html?autoOpen=chat"), false, "booking reservation fake-host release gate should not auto-open before exercising host controller");
assert.equal(bookingReservationSmokeSource.indexOf("const openResult = await page.evaluate") < bookingReservationSmokeSource.indexOf("const frame = page.frames().find"), true, "booking reservation release gate should call host controller before accepting an iframe frame");
assert.equal(bookingContextSmokeSource.indexOf("const openResult = await page.evaluate") < bookingContextSmokeSource.indexOf("const frame = page.frames().find"), true, "booking context release gate should call host controller before accepting an iframe frame");
const amplifySmokeSource = await readFile("scripts/agent-ui-amplify-smoke.mjs", "utf8");
assert.equal(amplifySmokeSource.includes("page.mouse.click"), false, "authenticated release gate should not use coordinate-click fallback to open embeds");
assert.equal(amplifySmokeSource.includes("__sonikAgentHost"), true, "authenticated release gate should prefer the deterministic host controller when available");
assert.equal(amplifySmokeSource.includes("usedDeterministicHostController"), true, "authenticated release gate should report and require deterministic host-controller opening");
assert.equal(amplifySmokeSource.includes("Amplify embed did not open through window.__sonikAgentHost"), true, "authenticated release gate should fail if the host controller is unavailable after Amplify consumes the SDK seam");
assert.equal(staticVendorEmbedSource.includes("...(activeMode ? { mode: activeMode } : {})"), true, "static vendor embed should donate the active mode in postContext like package source");
assert.equal(staticVendorEmbedSource.includes('if (iframe.getAttribute("src")) {'), true, "static vendor embed should guard against iframe src reloads after initial navigation");
assert.equal(staticVendorEmbedSource.includes('if (iframe.getAttribute("src") !== nextSrc)'), false, "static vendor embed must not retain the old inequality reload check");
assert.equal(staticVendorEmbedSource.includes("onRequestHostAction"), true, "static vendor embed should handle iframe host-action requests in the fake browser host");
assert.equal(staticVendorEmbedSource.includes('request.actionKey === "canvas.open"'), true, "static vendor embed should execute safe canvas.open requests in the fake browser host");
assert.equal(staticVendorEmbedSource.includes("slot.moveBefore(iframe, null)"), true, "static vendor embed should use state-preserving iframe moves when the browser supports moveBefore");

console.log("agent-embed tests passed");
