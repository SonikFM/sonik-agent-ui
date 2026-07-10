import assert from "node:assert/strict";
import { sanitizeAgentHostPageContext } from "../../packages/agent-embed/src/index.ts";
import { createCurrentPageContextSummary } from "../../apps/standalone-sveltekit/src/lib/page-context-summary.ts";
import {
  AGENT_UI_HOST_CONTEXT_HEADER,
  createSignedTrustedHostContextHeader,
  encodeTrustedHostContextHeader,
  resolveSignedTrustedOrganizationDisplayFromRequest,
} from "../../apps/standalone-sveltekit/src/lib/server/workspace-services.ts";

const secret = "test-secret";

function eventForHeader(header, extra = {}) {
  return {
    request: new Request("https://agent.test/api/generate", {
      headers: header ? { [AGENT_UI_HOST_CONTEXT_HEADER]: header } : {},
    }),
    platform: { env: { SONIK_AGENT_UI_HOST_CONTEXT_SECRET: secret, ...(extra.env ?? {}) } },
    locals: extra.locals,
  };
}

const signedHeader = createSignedTrustedHostContextHeader({
  secret,
  context: {
    authenticated: true,
    organizationId: "org_123",
    hostSession: {
      authenticated: true,
      organizationId: "org_123",
      userId: "user_123",
      metadata: { organizationDisplayName: "Pebble Beach" },
    },
  },
});

assert.equal(
  resolveSignedTrustedOrganizationDisplayFromRequest(eventForHeader(signedHeader)),
  "Pebble Beach (org_123)",
  "valid HMAC-signed host context metadata may supply organization display name",
);

const signedWithoutName = createSignedTrustedHostContextHeader({
  secret,
  context: {
    authenticated: true,
    organizationId: "org_456",
    hostSession: { authenticated: true, organizationId: "org_456", userId: "user_456" },
  },
});
assert.equal(
  resolveSignedTrustedOrganizationDisplayFromRequest(eventForHeader(signedWithoutName)),
  "org_456",
  "valid HMAC-signed host context falls back to organization id when no display name is present",
);

const unsignedHeader = encodeTrustedHostContextHeader({
  authenticated: true,
  organizationId: "org_unsigned",
  hostSession: {
    authenticated: true,
    organizationId: "org_unsigned",
    userId: "user_unsigned",
    metadata: { organizationDisplayName: "Unsigned Fixture Org" },
  },
});
assert.equal(
  resolveSignedTrustedOrganizationDisplayFromRequest(eventForHeader(unsignedHeader, { env: { SONIK_AGENT_UI_ALLOW_UNSIGNED_HOST_CONTEXT: "true" } })),
  null,
  "unsigned/dev fixture host context metadata must not be surfaced as trusted organization display",
);

assert.equal(
  resolveSignedTrustedOrganizationDisplayFromRequest(eventForHeader(null, {
    locals: {
      agentUiHostSession: {
        authenticated: true,
        organizationId: "org_local",
        userId: "user_local",
        metadata: { organizationDisplayName: "Server Local Org" },
      },
    },
  })),
  null,
  "server-local auth metadata must not be surfaced as signed trusted organization display",
);

assert.equal(
  createCurrentPageContextSummary({ context: { title: "Booking", organizationDisplayName: "Unsigned Page Org" } }).includes("organization:"),
  false,
  "unsigned page context cannot supply an organization line",
);
assert.equal(
  createCurrentPageContextSummary({ context: { title: "Booking" } }),
  [
    "CURRENT HOST/PAGE CONTEXT:",
    "- title: Booking",
    "If the user asks where they are, what page this is, or what context is attached, answer directly from this block. Do not create an artifact or dashboard unless the user explicitly asks for one.",
  ].join("\n"),
  "no preverified organization display means no organization line",
);

assert.equal(
  createCurrentPageContextSummary({ context: undefined, trustedOrganizationDisplay: "Pebble Beach (org_123)" }).includes("- organization: Pebble Beach (org_123)"),
  true,
  "preverified trusted organization context should be emitted even when page context is absent",
);

const unsafeRegistry = {
  version: "sonik-agent-ui.target-registry.v0",
  generatedAt: "2026-07-10T00:00:00.000Z",
  provider: "test-host",
  targets: [{
    targetId: "booking.ui.schedulePanel",
    label: "Schedule panel",
    description: "Schedule panel",
    surface: "booking-context",
    capabilities: ["describe"],
    targetInstanceId: "private-instance-secret-node",
    locator: { kind: "data-sonik-target-instance", value: "private-instance-secret-node" },
    metadata: { apiKey: "sk-secret-value", selector: "#private-secret-selector" },
  }],
};
const sanitized = sanitizeAgentHostPageContext({ hostUiTargetRegistry: unsafeRegistry });
const tourSummary = createCurrentPageContextSummary({
  context: {
    title: "Booking",
    route: "/booking",
    surface: "booking-context",
    pageType: "reservation",
    activeEntity: { type: "venue", id: "venue_123", label: "Pebble Beach" },
    commandFamilies: ["booking.get.availability", "previewBookingReservationCommand"],
    skillFamilies: ["booking.reservation.create", "booking-context-intake"],
    visibleActions: ["createReservation", "approveBookingPreview"],
    hostUiTargetRegistry: sanitized.hostUiTargetRegistry,
  },
  trustedOrganizationDisplay: "Pebble Beach (org_123)",
  productTourIntent: true,
});
assert.equal(tourSummary.includes("- route: /booking"), true, "tour summary keeps route identity");
assert.equal(tourSummary.includes("- activeEntity: venue Pebble Beach (venue_123)"), true, "tour summary keeps active entity identity");
assert.equal(tourSummary.includes("commandFamilies"), false, "tour summary must not expose command family hints");
assert.equal(tourSummary.includes("skillFamilies"), false, "tour summary must not expose skill family hints");
assert.equal(tourSummary.includes("visibleActions"), false, "tour summary must not expose visible action hints");
assert.equal(tourSummary.includes("previewBookingReservationCommand"), false, "tour summary must not expose reservation command workflow hints");
assert.equal(tourSummary.includes("booking.reservation.create"), false, "tour summary must not expose reservation skill hints");
assert.equal(tourSummary.includes("createReservation"), false, "tour summary must not expose booking action hints");
assert.equal(tourSummary.includes("booking.ui.schedulePanel: Schedule panel"), true, "tour summary includes semantic target id and label");
assert.equal(tourSummary.includes("private-instance-secret-node"), false, "tour summary must not expose host-private locator values");
assert.equal(tourSummary.includes("#private-secret-selector"), false, "tour summary must not expose metadata selectors");
assert.equal(tourSummary.includes("sk-secret-value"), false, "tour summary must not expose target metadata secrets");
assert.equal(tourSummary.includes("metadata"), false, "tour summary must not expose raw target metadata");

const normalSummary = createCurrentPageContextSummary({
  context: { title: "Booking", hostUiTargetRegistry: sanitized.hostUiTargetRegistry },
  trustedOrganizationDisplay: "Pebble Beach (org_123)",
});
assert.equal(normalSummary.includes("semanticTargets"), false, "semantic target inventory is only appended for product tours");

console.log("page-context-summary tests passed");
