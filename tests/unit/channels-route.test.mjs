import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import {
  AGENT_UI_HOST_CONTEXT_HEADER,
  AGENT_UI_WORKSPACE_SESSION_CONTEXT_HEADER,
  createSignedTrustedHostContextHeader,
  createSignedWorkspaceSessionContextHeader,
} from "../../apps/standalone-sveltekit/src/lib/server/workspace-services.ts";
import { getRequestWorkspacePersistence } from "../../apps/standalone-sveltekit/src/lib/server/workspace-request-store.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("$lib/")) {
      const base = new URL(`../../apps/standalone-sveltekit/src/lib/${specifier.slice(5)}`, import.meta.url);
      return { url: base.pathname.endsWith(".ts") ? base.href : `${base.href}.ts`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { GET, POST } = await import("../../apps/standalone-sveltekit/src/routes/api/session/[id]/channels/+server.ts");

const secret = "channels-route-test-secret";
const hostSession = {
  source: "channels-route-test",
  sessionId: "host-session-channels-route",
  userId: "user-channels-route",
  principalId: "user-channels-route",
  organizationId: "org-channels-route",
  authenticated: true,
  scopes: ["workspace:read", "workspace:write"],
  metadata: {},
};
const hostContextHeader = createSignedTrustedHostContextHeader({
  secret,
  context: {
    authenticated: true,
    organizationId: hostSession.organizationId,
    hostSession,
  },
});

function eventFor({ sessionId = "channels-route-session", method = "GET", body, workspaceSessionId = sessionId } = {}) {
  const baseEvent = {
    params: { id: sessionId },
    platform: { env: { SONIK_AGENT_UI_PERSISTENCE_MODE: "memory", SONIK_AGENT_UI_HOST_CONTEXT_SECRET: secret } },
    locals: {},
  };
  const hostOnlyRequest = new Request(`http://localhost/api/session/${sessionId}/channels`, {
    headers: { [AGENT_UI_HOST_CONTEXT_HEADER]: hostContextHeader },
  });
  const workspaceContext = createSignedWorkspaceSessionContextHeader({ ...baseEvent, request: hostOnlyRequest }, workspaceSessionId);
  const request = new Request(`http://localhost/api/session/${sessionId}/channels`, {
    method,
    headers: {
      [AGENT_UI_HOST_CONTEXT_HEADER]: hostContextHeader,
      ...(workspaceContext ? { [AGENT_UI_WORKSPACE_SESSION_CONTEXT_HEADER]: workspaceContext } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  return { ...baseEvent, request };
}

const sessionId = "channels-route-session";
const setupEvent = eventFor({ sessionId });
const persistence = getRequestWorkspacePersistence(setupEvent);
await persistence.createSession({ id: sessionId, name: "Channels route session" });

const firstGet = await GET(setupEvent);
assert.equal(firstGet.status, 200);
assert.equal(firstGet.headers.get("cache-control"), "private, no-store");
const firstProjection = await firstGet.json();
assert.equal(firstProjection.sessionId, sessionId);
assert.deepEqual(firstProjection.workflows.map((workflow) => workflow.workflowId), ["booking.reservation.create", "amplify.campaign.create"]);
assert.equal(firstProjection.channels.length, 8);
assert.equal(firstProjection.triggerBindings.length, 2);

const saveResponse = await POST(eventFor({
  sessionId,
  method: "POST",
  body: {
    channelId: "fixture.slack.connected",
    event: "reaction.added",
    workflowId: "amplify.campaign.create",
    sourcePath: "/event/reaction",
    targetPath: "/input/request",
  },
}));
assert.equal(saveResponse.status, 200);
const saved = await saveResponse.json();
assert.equal(saved.ok, true);
assert.equal(saved.projection.triggerBindings.length, 3);
assert.equal(saved.projection.triggerBindings.at(-1).event, "reaction.added");
assert.equal(saved.projection.triggerBindings.at(-1).enabled, false);

const persistedGet = await GET(eventFor({ sessionId }));
assert.equal((await persistedGet.json()).triggerBindings.length, 3, "GET restores the latest display-only snapshot");

const concurrentBodies = [
  {
    channelId: "fixture.slack.connected",
    event: "app.mentioned",
    workflowId: "amplify.campaign.create",
    sourcePath: "/event/mention",
    targetPath: "/input/request",
  },
  {
    channelId: "fixture.whatsapp.connected",
    event: "message.edited",
    workflowId: "booking.reservation.create",
    sourcePath: "/event/message",
    targetPath: "/input/request",
  },
];
const concurrentResponses = await Promise.all(concurrentBodies.map((body) => POST(eventFor({ sessionId, method: "POST", body }))));
assert.deepEqual(concurrentResponses.map((response) => response.status), [200, 200]);
const concurrentProjectionSizes = await Promise.all(concurrentResponses.map(async (response) => (await response.json()).projection.triggerBindings.length));
assert.deepEqual(concurrentProjectionSizes.sort((left, right) => left - right), [4, 5], "concurrent saves serialize against the latest persisted envelope");
const afterConcurrentSave = await GET(eventFor({ sessionId }));
const concurrentProjection = await afterConcurrentSave.json();
assert.equal(concurrentProjection.triggerBindings.length, 5, "neither concurrent fixture binding is lost");
for (const body of concurrentBodies) {
  assert.equal(concurrentProjection.triggerBindings.some((binding) => binding.event === body.event), true);
}

const tenantSpoof = await POST(eventFor({
  sessionId,
  method: "POST",
  body: {
    organizationId: "org-attacker",
    userId: "user-attacker",
    workspaceId: "workspace-attacker",
    channelId: "fixture.slack.connected",
    event: "message.received",
    workflowId: "amplify.campaign.create",
    sourcePath: "/event/message",
    targetPath: "/input/request",
  },
}));
assert.equal(tenantSpoof.status, 400, "strict route body rejects all client tenant fields");
assert.equal((await tenantSpoof.json()).disabledReason, "invalid_trigger_binding");

const badPointer = await POST(eventFor({
  sessionId,
  method: "POST",
  body: {
    channelId: "fixture.slack.connected",
    event: "message.received",
    workflowId: "amplify.campaign.create",
    sourcePath: "event/message",
    targetPath: "/input/request",
  },
}));
assert.equal(badPointer.status, 400);
assert.equal((await badPointer.json()).disabledReason, "unsafe_json_pointer");

await assert.rejects(
  GET(eventFor({ sessionId, workspaceSessionId: "another-session" })),
  (error) => error?.status === 404,
  "signed workspace session must exactly match the route before persistence reads",
);

const missingSession = "channels-route-missing";
await assert.rejects(
  GET(eventFor({ sessionId: missingSession })),
  (error) => error?.status === 404,
  "channels route does not implicitly create a missing workspace session",
);

console.log("channels-route tests passed");
