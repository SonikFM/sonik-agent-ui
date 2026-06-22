import assert from "node:assert/strict";
import {
  SONIK_AGENT_UI_HOST_MESSAGE_SOURCE,
  SONIK_AGENT_UI_PAGE_CONTEXT_MESSAGE,
  isAgentHostPageContextMessage,
  mergeAgentHostPageContext,
  normalizeAgentEmbedIntent,
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
assert.equal("organizationId" in sanitized, false, "host page context must not carry trusted organization fields");
assert.equal("scopes" in sanitized, false, "host page context must not carry trusted scopes");

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

console.log("agent-embed tests passed");
