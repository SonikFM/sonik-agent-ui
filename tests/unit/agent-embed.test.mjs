import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SONIK_AGENT_UI_HOST_MESSAGE_SOURCE,
  SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE,
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

const message = {
  source: SONIK_AGENT_UI_HOST_MESSAGE_SOURCE,
  type: SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE,
  sentAt: "2026-06-21T00:00:00.000Z",
  payload: {
    route: "/booking/bookings/booking_123",
    surface: "booking-console",
    pageType: "event-booking-detail",
    title: "Summer Jazz Night",
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
assert.equal(merged.activeSessionId, "sess-local", "local app session state should be retained when host does not override it");
assert.equal(merged.activeEntity?.id, "booking_123", "merged context should include active entity id");
assert.equal(merged.organizationId, "org-trusted", "trusted context should be appended explicitly");
assert.deepEqual(merged.scopes, ["booking:read"], "trusted scopes should come from trusted context only");

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
    metadata: { token: "vck_SHOULDNOTSURVIVE123456" },
  },
});
assert.equal(trustedSession?.authenticated, true, "trusted host authentication flag should survive sanitization");
assert.equal(trustedSession?.hostSession?.source, "amplify-embedded", "known host session source should survive sanitization");
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
assert.equal(signedTrustedSession?.signatureVersion, "sonik.agent_ui.host_context.hmac.v1", "signed host-context signature version must survive the embed sanitizer");
assert.equal(signedTrustedSession?.signature, "abc123_signature", "signed host-context signature must survive postMessage donation");
assert.equal(signedTrustedSession?.issuedAt, "2026-06-24T22:00:00.000Z", "signed host-context issuedAt must survive postMessage donation");
assert.equal(signedTrustedSession?.expiresAt, "2026-06-24T22:10:00.000Z", "signed host-context expiresAt must survive postMessage donation");

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
    metadata: { authAuthority: "amplify-org-context", sessionMode: "production" },
  },
});
assert.deepEqual(
  signedTrustedSessionWithMetadata?.hostSession?.metadata,
  { authAuthority: "amplify-org-context", sessionMode: "production" },
  "signed host-context metadata must survive unchanged when it is part of the HMAC payload",
);

assert.deepEqual(
  normalizeAgentEmbedIntent({ embedMode: "chat" }),
  { mode: "chat", railMode: "hidden" },
  "chat embed mode should default to hidden rail",
);
assert.deepEqual(
  normalizeAgentEmbedIntent({ embedMode: "canvas" }),
  { mode: "canvas", railMode: "collapsed" },
  "canvas embed mode should default to collapsed rail",
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
  })[selector] ?? null,
};
fakeWindow.document = fakeDocument;

const controller = mountSonikAgentUI({
  agentUrl: "https://agent.sonik.local/",
  hostOrigin: "https://booking.sonik.local",
  theme: "lemonade",
  smokeMockStream: "1",
  smokeRunId: "mount-test",
  getPageContext: () => ({ surface: "booking-console", organizationId: "forged-org", scopes: ["admin:*"], signatureVersion: "sonik.agent_ui.host_context.hmac.v1", issuedAt: "2026-06-24T22:00:00.000Z", expiresAt: "2026-06-24T22:10:00.000Z", signature: "abc123_signature", activeEntity: { type: "booking", id: "booking_123", label: "Summer Jazz Night" } }),
  elements: { iframe: "#agent-frame", chatSlot: "#chat-slot", canvasSlot: "#canvas-slot", sidecar: "#sidecar", canvasWindow: "#canvas" },
  window: fakeWindow,
  document: fakeDocument,
});
assert.equal(fakeIframe.parentElement, fakeChatSlot, "mount should park iframe in chat slot before a mode opens");
assert.equal(fakeWindow.__sonikAgentHost?.schemaVersion, "sonik.agent_ui.host_controller.v1", "mount should expose a stable host controller for embed automation and release gates");
assert.equal(fakeIframe.dataset.sonikAgentUiControl, "iframe", "mount should annotate iframe with a stable Agent UI control attribute");
assert.equal(fakeIframe.getAttribute("data-testid"), "sonik-agent-ui-iframe", "mount should annotate iframe with a stable test id");
fakeIframe.dispatch("load");
assert.equal(fakeIframe.contentWindow.messages.length, 0, "parked about:blank iframe must not receive host context before it is navigated to the agent origin");
fakeWindow.__sonikAgentHost.openChat();
assert.equal(controller.getMode(), "chat", "host controller should open and track chat mode");
assert.equal(fakeBody.dataset.agentUiOpen, "chat", "controller should expose host body open mode");
assert.equal(fakeSidecar.dataset.open, "true", "controller should open sidecar dataset state");
assert.match(fakeIframe.src, /embedMode=chat/, "controller should set iframe src for chat mode");
await controller.postContext();
assert.equal(fakeIframe.contentWindow.messages.at(-1).message.payload.organizationId, "forged-org", "browser postMessage payload should carry sanitized host-asserted organization context");
assert.deepEqual(fakeIframe.contentWindow.messages.at(-1).message.payload.scopes, ["admin:*"], "browser postMessage payload should carry sanitized host-asserted scopes");
assert.equal(fakeIframe.contentWindow.messages.at(-1).message.payload.signature, "abc123_signature", "browser postMessage payload should preserve signed host-context fields for the cloud runtime header");
assert.equal(fakeIframe.contentWindow.messages.at(-1).targetOrigin, "https://agent.sonik.local", "cross-origin embeds should post page context to the agent iframe origin, not the host origin");
fakeWindow.__sonikAgentHost.openCanvas();
assert.equal(fakeIframe.parentElement, fakeCanvasSlot, "host controller should move iframe into canvas slot");
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

const amplifySmokeSource = await readFile("scripts/agent-ui-amplify-smoke.mjs", "utf8");
assert.equal(amplifySmokeSource.includes("page.mouse.click"), false, "authenticated release gate should not use coordinate-click fallback to open embeds");
assert.equal(amplifySmokeSource.includes("__sonikAgentHost"), true, "authenticated release gate should prefer the deterministic host controller when available");
assert.equal(amplifySmokeSource.includes("usedDeterministicHostController"), true, "authenticated release gate should report and require deterministic host-controller opening");
assert.equal(amplifySmokeSource.includes("Amplify embed did not open through window.__sonikAgentHost"), true, "authenticated release gate should fail if the host controller is unavailable after Amplify consumes the SDK seam");

console.log("agent-embed tests passed");
