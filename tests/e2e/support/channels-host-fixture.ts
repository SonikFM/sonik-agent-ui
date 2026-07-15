import type { Page, Route } from "@playwright/test";
import {
  channelDefinitionFixtures,
  triggerBindingFixtures,
} from "../../../packages/tool-contracts/dist/channel-fixtures.js";

export const CHANNELS_FIXTURE_SESSION_ID = "channels-host-fixture-session";

export interface ChannelsHostFixtureObservation {
  channelRequests: Array<{
    method: string;
    hostContext: string;
    workspaceContext: string;
    body: unknown;
  }>;
  sessionId: string;
}

const now = "2026-07-14T15:00:00.000Z";
const sessionSummary = {
  id: CHANNELS_FIXTURE_SESSION_ID,
  name: "Embedded channels fixture",
  mode: "chat",
  archived: false,
  is_important: false,
  folder: null,
  message_count: 0,
  active_document_id: null,
  active_artifact_id: null,
  created_at: now,
  updated_at: now,
  last_accessed: now,
  last_message_at: null,
};

function integrationActionLabel(state: string): "Connect" | "Finish setup" | "Manage" | "Retry" {
  if (state === "pending") return "Finish setup";
  if (state === "connected") return "Manage";
  if (state === "error") return "Retry";
  return "Connect";
}

function channelProjection(triggerBindings: typeof triggerBindingFixtures) {
  return {
    schemaVersion: "sonik.agent_ui.channels_state.v1",
    fixtureOnly: true,
    sessionId: CHANNELS_FIXTURE_SESSION_ID,
    status: "ready",
    channels: channelDefinitionFixtures.map((channel) => ({
      schemaVersion: channel.schemaVersion,
      channelId: channel.channelId,
      kind: channel.kind,
      label: channel.label,
      provisioningState: channel.provisioningState,
      identity: channel.identity ? { displayName: channel.identity.displayName } : null,
      statusMessage: channel.statusMessage,
      runtimeMode: channel.runtimeMode,
      integrationAction: {
        label: integrationActionLabel(channel.provisioningState),
        enabled: false,
        disabledReason: "integration_not_yet_available",
      },
    })),
    triggerBindings: triggerBindings.map((binding) => ({
      schemaVersion: binding.schemaVersion,
      bindingId: binding.bindingId,
      channelId: binding.channelId,
      event: binding.event,
      workflowId: binding.workflowId,
      triggerNodeId: binding.triggerNodeId,
      inputMapping: binding.inputMapping.map((mapping) => ({ ...mapping })),
      runtimeMode: binding.runtimeMode,
      enabled: false,
      disabledReason: "integration_not_yet_available",
    })),
  };
}

async function fulfillJson(route: Route, body: unknown, headers: Record<string, string> = {}): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

export async function installChannelsHostFixture(page: Page): Promise<ChannelsHostFixtureObservation> {
  const observation: ChannelsHostFixtureObservation = {
    channelRequests: [],
    sessionId: CHANNELS_FIXTURE_SESSION_ID,
  };
  let bindings = triggerBindingFixtures.map((binding) => ({ ...binding, inputMapping: binding.inputMapping.map((mapping) => ({ ...mapping })) }));

  await page.route("**/api/documents/library**", (route) => fulfillJson(route, {
    documents: [],
    total: 0,
    languages: [],
    sessionCount: 0,
  }));

  await page.route("**/api/session**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/sessions") {
      await fulfillJson(route, url.searchParams.get("archived") === "true" ? [] : [sessionSummary]);
      return;
    }
    if (url.pathname === "/api/session" && request.method() === "POST") {
      await fulfillJson(route, sessionSummary);
      return;
    }
    if (url.pathname === `/api/session/${CHANNELS_FIXTURE_SESSION_ID}/channels`) {
      const rawBody = request.postData();
      const body = rawBody ? JSON.parse(rawBody) as Record<string, string> : null;
      observation.channelRequests.push({
        method: request.method(),
        hostContext: request.headers()["x-sonik-agent-ui-host-context"] ?? "",
        workspaceContext: request.headers()["x-sonik-agent-ui-workspace-session-context"] ?? "",
        body,
      });
      if (request.method() === "POST" && body) {
        const binding = {
          ...bindings[0],
          bindingId: "fixture.binding.saved.e2e",
          channelId: body.channelId,
          event: body.event,
          workflowId: body.workflowId,
          triggerNodeId: "trigger",
          inputMapping: [{ sourcePath: body.sourcePath, targetPath: body.targetPath }],
        };
        bindings = [...bindings.filter((candidate) => candidate.bindingId !== binding.bindingId), binding];
        await fulfillJson(route, {
          ok: true,
          projection: channelProjection(bindings),
          bindingId: binding.bindingId,
          message: "Fixture trigger binding saved. Integration activation remains unavailable.",
        });
        return;
      }
      await fulfillJson(route, channelProjection(bindings));
      return;
    }
    if (url.pathname === `/api/session/${CHANNELS_FIXTURE_SESSION_ID}` && request.method() === "GET") {
      await fulfillJson(route, {
        session: sessionSummary,
        activeDocument: null,
        messages: [],
        runs: [],
        telemetry: [],
        reattach: null,
        activeArtifact: null,
        activeArtifactState: null,
        activeArtifactVersions: [],
      }, { "x-sonik-agent-ui-workspace-session-context": "signed-workspace-session-fixture-token" });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
  });

  await page.waitForFunction(() => Boolean((window as Window & { __sonikAgentUI?: unknown }).__sonikAgentUI));
  await page.evaluate(() => {
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    window.postMessage({
      source: "sonik-agent-ui-host",
      type: "sonik:agent-ui:page-context",
      authority: {
        header: "channels_host_fixture_header",
        revision: Date.now(),
        expiresAt,
      },
      payload: {
        route: "/channels",
        surface: "embedded-channels-fixture",
        authenticated: true,
        organizationId: "11111111-1111-4111-8111-111111111111",
        scopes: ["agent-ui:read"],
        hostSession: {
          source: "embedded-host",
          sessionId: "channels-host-parent-session",
          userId: "channels-host-fixture-user",
          principalId: "channels-host-fixture-user",
          organizationId: "11111111-1111-4111-8111-111111111111",
          authenticated: true,
          scopes: ["agent-ui:read"],
          expiresAt,
        },
      },
    }, window.location.origin);
  });
  return observation;
}
