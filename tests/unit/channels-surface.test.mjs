import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizePageContext } from "../../packages/agent-observability/src/index.ts";

const safeBinding = {
  schemaVersion: "v1",
  bindingId: "fixture.binding.safe",
  channelId: "fixture.slack.connected",
  event: "message.received",
  workflowId: "amplify.campaign.create",
  triggerNodeId: "trigger",
  inputMapping: [{ sourcePath: "/event/message", targetPath: "/input/request" }],
  runtimeMode: "fixture_only",
  enabled: false,
  disabledReason: "integration_not_yet_available",
};
const sanitized = sanitizePageContext({
  route: "/",
  workflow: {
    activeWorkflowId: null,
    activeArtifactId: null,
    phase: "idle",
    answeredCount: 0,
    requiredCount: 0,
    unansweredRequiredIds: [],
    visibleErrors: [],
    canSubmitAnswer: false,
    canRequestApproval: false,
    canApproveAndRun: false,
    disabledReasons: [],
    triggers: [
      safeBinding,
      { ...safeBinding, bindingId: "unsafe", enabled: true, disabledReason: undefined },
    ],
  },
});
assert.deepEqual(sanitized?.workflow?.triggers, [safeBinding], "observability keeps only structurally safe dormant fixture triggers");

const [pageSource, channelsRootSource, routeSource, observabilitySource] = await Promise.all([
  readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8"),
  readFile("apps/standalone-sveltekit/src/lib/components/channels/ChannelsRoot.svelte", "utf8"),
  readFile("apps/standalone-sveltekit/src/routes/api/session/[id]/channels/+server.ts", "utf8"),
  readFile("packages/agent-observability/src/index.ts", "utf8"),
]);

assert.match(pageSource, /let workspaceMode = \$state<"workspace" \| "workflow-builder" \| "channels">\("workspace"\)/);
assert.match(pageSource, /\{:else if workspaceMode === "channels"\}\s*<ChannelsRoot/);
assert.match(pageSource, /bind:this=\{channelsActionButton\}[\s\S]*?aria-label="Open channels"/);
assert.match(pageSource, /getChannelsState: \(\) => \$state\.snapshot\(channelsProjection\)/);
assert.match(pageSource, /createActionDescriptor\("connectChannel"[\s\S]*?enabled: false,[\s\S]*?disabledReason: channelIntegrationDisabledReason\(\)/);
assert.match(pageSource, /createActionDescriptor\("enableTriggerBinding"[\s\S]*?enabled: false,[\s\S]*?disabledReason: triggerIntegrationDisabledReason\(\)/);
assert.match(pageSource, /connectChannel: \(\{ channelId \}\) => \{[\s\S]*?semanticActionResult\([\s\S]*?false,[\s\S]*?channelIntegrationDisabledReason\(\)/);
assert.match(pageSource, /enableTriggerBinding: \(\{ bindingId \}\) => \{[\s\S]*?semanticActionResult\([\s\S]*?false,[\s\S]*?triggerIntegrationDisabledReason\(\)/);
assert.match(pageSource, /if \(isEmbeddedHostContextExpected\(\) && !isWorkspaceHostContextReady\(\)\) \{[\s\S]*?missing_signed_host_context[\s\S]*?return;[\s\S]*?const revision = \+\+channelsProjectionRevision;[\s\S]*?workspaceFetch/,
  "contextless embed must return before a channels request is created");
assert.equal((pageSource.match(/revision !== channelsProjectionRevision \|\| activeSessionId !== sessionId/g) ?? []).length >= 4, true,
  "GET and POST state writes remain guarded against stale active-session changes");
assert.equal(pageSource.includes("...(mergedContext.workflow ?? workflow)"), true);
assert.match(pageSource, /triggers: workflow\.triggers \?\? \[\]/, "host merge cannot replace server-derived dormant trigger bindings");

assert.match(channelsRootSource, /data-agent-mode="channels"/);
assert.match(channelsRootSource, /data-channel-id=\{channel\.channelId\}/);
assert.match(channelsRootSource, /data-channel-status=\{channel\.provisioningState\}/);
assert.match(channelsRootSource, /data-trigger-binding-id=\{binding\.bindingId\}/);
assert.match(channelsRootSource, /projection\.workflows\.map\(\(workflow\) => workflow\.workflowId\)/,
  "fixture workflow options come from the complete scoped workflow projection, not existing bindings");
assert.equal((channelsRootSource.match(/min-h-11/g) ?? []).length >= 8, true, "all interactive controls meet the 44px target");
assert.equal((channelsRootSource.match(/data-disabled-reason=/g) ?? []).length >= 3, true);
assert.match(channelsRootSource, /aria-describedby=\{`channel-disabled-reason-/);
assert.match(channelsRootSource, /aria-describedby=\{`trigger-disabled-reason-/);
assert.match(channelsRootSource, /Unavailable: \{channel\.integrationAction\.disabledReason\}/,
  "channel controls render the disabled reason supplied by the projection");
assert.match(channelsRootSource, /Unavailable: \{binding\.disabledReason\}/,
  "trigger controls render the disabled reason supplied by the projection");
assert.match(channelsRootSource, /role="alert"/);
assert.doesNotMatch(channelsRootSource, /gradient|bg-gradient|from-[a-z]|to-[a-z]/i);
assert.match(channelsRootSource, /<form[\s\S]*?onsubmit=\{submitBinding\}[\s\S]*?<label[\s\S]*?<select[\s\S]*?<label[\s\S]*?<input/,
  "fixture form uses native labeled controls and a real submit path");

assert.match(routeSource, /z\.strictObject\(/, "POST body rejects unknown tenant fields");
assert.match(routeSource, /if \(auth\.authenticated\)[\s\S]*?resolveSignedWorkspaceSessionId\(event\)[\s\S]*?signedWorkspaceSessionId !== event\.params\.id/,
  "authenticated channels calls require an exact signed workspace session");
for (const handler of ["GET", "POST"]) {
  const body = routeSource.match(new RegExp(`export const ${handler}:[\\s\\S]*?(?=export const|$)`))?.[0] ?? "";
  assert.ok(body.indexOf("resolveChannelsScope(event)") < body.indexOf("getRequestWorkspaceSession"), `${handler} checks signed scope before persistence`);
}
assert.doesNotMatch(observabilitySource, /@sonik-agent-ui\/(tool-contracts|workspace-session)/,
  "agent-observability channel types stay structural and package-independent");

console.log("channels-surface tests passed");
