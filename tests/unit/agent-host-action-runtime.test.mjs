import assert from "node:assert/strict";
import {
  mountSonikAgentUI,
  requestAgentHostAction,
  sanitizeAgentHostPageContext,
} from "../../packages/agent-embed/src/index.ts";
import {
  createDefaultHostUiTargetRegistry,
  createHostActionResult,
} from "../../packages/tool-contracts/src/target-registry.ts";

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
}

class FakeIframe extends FakeElement {
  set src(value) { this._src = value; this.setAttribute("src", value); }
  get src() { return this._src; }
  contentWindow = { messages: [], postMessage: (message, targetOrigin) => this.contentWindow.messages.push({ message, targetOrigin }) };
}

function createChildWindow({ hostOrigin = "https://booking.sonik.local", respond } = {}) {
  const listeners = new Map();
  const child = {
    location: { origin: "https://agent.sonik.local", search: `?agentUiHostOrigin=${encodeURIComponent(hostOrigin)}` },
    parent: {
      postMessage: (message, targetOrigin) => {
        child.parent.lastMessage = { message, targetOrigin };
        respond?.({ message, targetOrigin, child });
      },
      lastMessage: null,
    },
    setTimeout: (fn, delay) => globalThis.setTimeout(fn, delay),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type, handler) => {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    dispatchMessage: (event) => listeners.get("message")?.(event),
  };
  return child;
}

const registry = createDefaultHostUiTargetRegistry({
  provider: "test-host",
  route: "/booking/contexts/ctx_123",
  surface: "booking-context",
  generatedAt: "2026-07-07T00:00:00.000Z",
  activeBookingContext: { id: "ctx_123", label: "Main Course" },
});
const sanitized = sanitizeAgentHostPageContext({ surface: "booking-context", hostUiTargetRegistry: registry });
assert.equal(sanitized?.hostUiTargetRegistry?.provider, "test-host", "embed sanitizer should preserve a valid host target registry");
assert.equal(sanitized?.hostUiTargetRegistry?.targets.some((target) => target.targetId === "booking.context.schedule"), true, "target registry should retain semantic booking targets");


const unsafeRegistry = {
  version: "sonik-agent-ui.target-registry.v0",
  generatedAt: "2026-07-07T00:00:00.000Z",
  provider: "unsafe-host",
  targets: Array.from({ length: 40 }, (_, index) => ({
    targetId: `booking.context.secret-${index}`,
    label: `Secret target ${index}`,
    description: `Target with private locator ${index}`,
    surface: "booking-context",
    capabilities: ["highlight"],
    locator: { kind: "host-private", ref: "sk-thisSecretMustNotLeak1234567890" },
    metadata: { apiKey: "sk-thisSecretMustNotLeak1234567890", selector: "#private-node" },
    policy: { actionMode: "ask", reason: "Bearer thisSecretMustNotLeak1234567890" },
  })),
};
const unsafeSanitized = sanitizeAgentHostPageContext({ surface: "booking-context", hostUiTargetRegistry: unsafeRegistry, hostUiTargets: unsafeRegistry.targets });
assert.equal(unsafeSanitized?.hostUiTargetRegistry?.targets.length, 32, "host target registry should be capped before exposure to the agent");
assert.deepEqual(unsafeSanitized?.hostUiTargetRegistry?.targets[0].metadata, {}, "host target metadata should not be exposed to the agent");
assert.equal(unsafeSanitized?.hostUiTargetRegistry?.targets[0].locator, undefined, "host-private locators should be stripped from agent-visible context");
assert.equal(unsafeSanitized?.hostUiTargetRegistry?.targets[0].policy.reason, "[REDACTED]", "secret-like policy reasons should be redacted");
assert.deepEqual(unsafeSanitized?.hostUiTargets?.[0].metadata, {}, "standalone hostUiTargets metadata should also be stripped");

const invalidRawTarget = {
  targetId: "booking.context.private-invalid",
  label: "Private invalid target",
  description: "This target should never leak through generic context sanitization",
  surface: "booking-context",
  capabilities: ["highlight"],
  locator: { kind: "host-private", ref: "sk-invalidSecretMustNotLeak1234567890" },
  metadata: { selector: "#raw-secret-node", token: "sk-invalidSecretMustNotLeak1234567890" },
  policy: { actionMode: "ask", reason: "Bearer invalidSecretMustNotLeak1234567890" },
};
const invalidRegistrySanitized = sanitizeAgentHostPageContext({
  surface: "booking-context",
  hostUiTargetRegistry: {
    version: "sonik-agent-ui.target-registry.invalid",
    generatedAt: "2026-07-07T00:00:00.000Z",
    provider: "invalid-host",
    targets: [invalidRawTarget],
  },
  hostUiTargets: [{ ...invalidRawTarget, capabilities: "not-an-array" }],
});
assert.equal(invalidRegistrySanitized?.hostUiTargetRegistry, undefined, "invalid host registries must fail closed rather than fall back to generic sanitized raw objects");
assert.equal(invalidRegistrySanitized?.hostUiTargets, undefined, "invalid host targets must fail closed rather than fall back to generic sanitized raw objects");
assert.equal(JSON.stringify(invalidRegistrySanitized).includes("invalidSecretMustNotLeak"), false, "invalid target sanitizer path must not leak secret-like target data");
assert.equal(JSON.stringify(invalidRegistrySanitized).includes("raw-secret-node"), false, "invalid target sanitizer path must not leak raw DOM selectors");

const happyChild = createChildWindow({
  respond: ({ message, targetOrigin, child }) => {
    child.dispatchMessage({
      origin: targetOrigin,
      source: child.parent,
      data: createHostActionResult({
        requestId: message.requestId,
        actionKey: message.actionKey,
        ok: true,
        status: "executed",
        policyMode: "allow",
        message: "Canvas opened.",
      }),
    });
  },
});
const happyResult = await requestAgentHostAction({ actionKey: "canvas.open", requestId: "req-happy" }, { window: happyChild, timeoutMs: 100 });
assert.equal(happyChild.parent.lastMessage.targetOrigin, "https://booking.sonik.local", "client should post host-action requests to the configured host origin");
assert.equal(happyResult.ok, true, "valid host action result should resolve as executed");
assert.equal(happyResult.status, "executed");

const malformedChild = createChildWindow({
  respond: ({ message, targetOrigin, child }) => {
    child.dispatchMessage({ origin: targetOrigin, source: child.parent, data: { requestId: message.requestId, source: "wrong" } });
  },
});
const malformedResult = await requestAgentHostAction({ actionKey: "canvas.open", requestId: "req-malformed" }, { window: malformedChild, timeoutMs: 100 });
assert.equal(malformedResult.ok, false, "malformed matching host results should not be accepted");
assert.equal(malformedResult.status, "invalid_request");
assert.equal(malformedResult.disabledReason, "host_action_result_invalid");

const timeoutChild = createChildWindow();
const timeoutResult = await requestAgentHostAction({ actionKey: "canvas.open", requestId: "req-timeout" }, { window: timeoutChild, timeoutMs: 1 });
assert.equal(timeoutResult.ok, false, "missing host replies should timeout deterministically");
assert.equal(timeoutResult.disabledReason, "host_action_timeout");

const standaloneWindow = { location: { origin: "https://agent.sonik.local", search: "" } };
standaloneWindow.parent = standaloneWindow;
const standaloneResult = await requestAgentHostAction({ actionKey: "canvas.open", requestId: "req-standalone" }, { window: standaloneWindow });
assert.equal(standaloneResult.ok, false, "standalone mode should return controlled host unavailable result");
assert.equal(standaloneResult.disabledReason, "host_action_parent_unavailable");

function createMountedHost({ handleHostAction, pageContext } = {}) {
  const listeners = new Map();
  const iframe = new FakeIframe("frame");
  const chatSlot = new FakeElement("chat");
  const canvasSlot = new FakeElement("canvas-slot");
  const body = new FakeElement("body");
  const documentElement = new FakeElement("html");
  const document = {
    body,
    documentElement,
    querySelector: (selector) => ({ "#frame": iframe, "#chat": chatSlot, "#canvas-slot": canvasSlot })[selector] ?? null,
  };
  const window = {
    location: { origin: "https://booking.sonik.local" },
    document,
    innerWidth: 1200,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => undefined,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame: () => undefined,
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: (type, handler) => { if (listeners.get(type) === handler) listeners.delete(type); },
    getComputedStyle: () => ({ getPropertyValue: () => "520" }),
    dispatchMessage: (event) => listeners.get("message")?.(event),
  };
  document.defaultView = window;
  const controller = mountSonikAgentUI({
    agentUrl: "https://agent.sonik.local/",
    hostOrigin: "https://booking.sonik.local",
    initialMode: "chat",
    getPageContext: () => pageContext ?? ({ surface: "booking-context", hostUiTargetRegistry: registry }),
    elements: { iframe: "#frame", chatSlot: "#chat", canvasSlot: "#canvas-slot" },
    handleHostAction,
    window,
    document,
  });
  return { window, iframe, controller };
}

const mountedDefault = createMountedHost();
mountedDefault.window.dispatchMessage({
  origin: "https://agent.sonik.local",
  source: mountedDefault.iframe.contentWindow,
  data: { source: "sonik-agent-ui", type: "sonik:agent-ui:action-request", version: "sonik.agent_ui.host_action.v1", requestId: "req-host-canvas", actionKey: "canvas.open", requiresReceipt: true },
});
await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
assert.equal(mountedDefault.controller.getMode(), "canvas", "default host SDK action handler should execute safe canvas.open requests");
assert.equal(mountedDefault.iframe.contentWindow.messages.at(-1).message.ok, true, "default host SDK handler should return a typed executed receipt for canvas.open");

mountedDefault.window.dispatchMessage({
  origin: "https://agent.sonik.local",
  source: mountedDefault.iframe.contentWindow,
  data: { source: "sonik-agent-ui", type: "sonik:agent-ui:action-request", version: "sonik.agent_ui.host_action.v1", requestId: "req-host-highlight", actionKey: "tour.highlight", targetId: "booking.context.schedule", requiresReceipt: true },
});
await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
assert.equal(mountedDefault.iframe.contentWindow.messages.at(-1).message.disabledReason, "host_action_handler_not_registered", "default SDK handler must not pretend tour/highlight executed without a host adapter");

const mountedCustom = createMountedHost({
  handleHostAction: (request) => createHostActionResult({
    requestId: request.requestId,
    actionKey: request.actionKey,
    ok: false,
    status: "approval_required",
    policyMode: "ask",
    message: "Host wants confirmation.",
  }),
});
mountedCustom.window.dispatchMessage({
  origin: "https://agent.sonik.local",
  source: mountedCustom.iframe.contentWindow,
  data: { source: "sonik-agent-ui", type: "sonik:agent-ui:action-request", version: "sonik.agent_ui.host_action.v1", requestId: "req-host-custom", actionKey: "approval.requestPreview", requiresReceipt: true },
});
await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
assert.equal(mountedCustom.iframe.contentWindow.messages.at(-1).message.status, "approval_required", "custom host action handlers should be able to return approval-required receipts");


const mountedTargetsOnly = createMountedHost({
  pageContext: { surface: "booking-context", hostUiTargets: registry.targets },
});
mountedTargetsOnly.window.dispatchMessage({
  origin: "https://agent.sonik.local",
  source: mountedTargetsOnly.iframe.contentWindow,
  data: { source: "sonik-agent-ui", type: "sonik:agent-ui:action-request", version: "sonik.agent_ui.host_action.v1", requestId: "req-host-targets-only", actionKey: "tour.highlight", targetId: "booking.context.schedule", requiresReceipt: true },
});
await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
assert.equal(mountedTargetsOnly.iframe.contentWindow.messages.at(-1).message.disabledReason, "host_action_handler_not_registered", "host SDK should synthesize an action registry from sanitized hostUiTargets when no envelope is provided");

const mountedMismatch = createMountedHost({
  handleHostAction: () => createHostActionResult({
    requestId: "different-request",
    actionKey: "canvas.close",
    ok: true,
    status: "executed",
    policyMode: "allow",
    message: "Wrong receipt.",
  }),
});
mountedMismatch.window.dispatchMessage({
  origin: "https://agent.sonik.local",
  source: mountedMismatch.iframe.contentWindow,
  data: { source: "sonik-agent-ui", type: "sonik:agent-ui:action-request", version: "sonik.agent_ui.host_action.v1", requestId: "req-host-mismatch", actionKey: "canvas.open", requiresReceipt: true },
});
await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
assert.equal(mountedMismatch.iframe.contentWindow.messages.at(-1).message.disabledReason, "host_action_result_mismatch", "host SDK should not emit custom handler receipts for the wrong request/action");

const mountedThrowing = createMountedHost({
  handleHostAction: () => { throw new Error("sk-thisSecretMustNotLeak1234567890"); },
});
mountedThrowing.window.dispatchMessage({
  origin: "https://agent.sonik.local",
  source: mountedThrowing.iframe.contentWindow,
  data: { source: "sonik-agent-ui", type: "sonik:agent-ui:action-request", version: "sonik.agent_ui.host_action.v1", requestId: "req-host-throwing", actionKey: "canvas.open", requiresReceipt: true },
});
await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
assert.equal(mountedThrowing.iframe.contentWindow.messages.at(-1).message.message, "Host action handler failed.", "host handler exceptions should not reflect private error messages to the iframe");
assert.equal(JSON.stringify(mountedThrowing.iframe.contentWindow.messages.at(-1).message).includes("thisSecretMustNotLeak"), false, "secret-like host exception text should not be posted to the embedded iframe");


console.log("agent host-action runtime tests passed");
