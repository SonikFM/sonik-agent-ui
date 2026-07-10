import assert from "node:assert/strict";

// Draft-only invariant (Slice A, 2026-07-08 -- Dan-ratified):
// "The agent's ceiling for anything that creates or publishes is a submitted
// draft. The only code path that publishes is a human clicking Approve on the
// preview card." commitCommand and commitActiveIntakeCommand must NEVER be
// mounted on the agent's tool set, under ANY context or skill combination --
// this is the structural closure of the R5 bypass (a host approvedCommandIds
// grant used to silently override the per-family "ask" toggle because
// commitCommand's approval resolved straight from that grant with no
// interactive gate). Removing the tool entirely makes that bypass physically
// impossible for the model to trigger, regardless of what the policy engine
// (evaluateCommandPolicy, unchanged) would have decided.
//
// This test asserts the closure two ways:
//   1. Directly, against the two tool factories agent.ts composes the model's
//      tool set from (createCommandCatalogTools, createArtifactStateTools),
//      across a broad matrix of contexts -- including the exact shape of a
//      fully host-approved, authenticated context that used to trigger R5.
//   2. By source-pinning agent.ts, so a future change that hardcodes a commit
//      key directly into the `tools: {...}` object (bypassing the factories)
//      is also caught.
//
// agent.ts itself can't be imported from a plain node test (it pulls in
// SvelteKit's $env/$lib aliases), so (2) is a text assertion rather than a
// runtime one -- consistent with the rest of this suite's agent.ts source pins
// (see intake-command-execution-seam.test.mjs).

const [fsModule, commandCatalogModule, artifactStateModule] = await Promise.all([
  import("node:fs"),
  import("../../apps/standalone-sveltekit/src/lib/tools/command-catalog.ts"),
  import("../../apps/standalone-sveltekit/src/lib/tools/artifact-state.ts"),
]);

const { readFileSync } = fsModule;
const { createCommandCatalogTools } = commandCatalogModule;
const { createArtifactStateTools } = artifactStateModule;

const FORBIDDEN_TOOL_KEYS = ["commitCommand", "commitActiveIntakeCommand"];

const FULLY_APPROVED_HOST_SESSION = {
  source: "amplify-embedded",
  sessionId: "session_r5_regression",
  userId: "user_r5_regression",
  principalId: "user_r5_regression",
  organizationId: "org_r5_regression",
  authenticated: true,
  scopes: ["booking:read", "booking:write"],
  expiresAt: null,
  // The exact shape that used to make commitCommand auto-approve under "ask":
  // a standing host grant list unrelated to any per-turn interactive prompt.
  metadata: { approvedCommandIds: ["booking.create.context", "booking.create.hold", "booking.create.booking", "booking.demo.contexts.create"] },
};

const COMMAND_CATALOG_CONTEXT_MATRIX = [
  { name: "no context at all", context: {} },
  { name: "sessionId only", context: { sessionId: "session_1" } },
  { name: "fully authenticated + host-approved (the exact R5 shape)", context: {
    sessionId: "session_r5_regression",
    hostSession: FULLY_APPROVED_HOST_SESSION,
    approvedCommandIds: FULLY_APPROVED_HOST_SESSION.metadata.approvedCommandIds,
    bookingServiceBaseUrl: "https://booking.example.test",
    bookingRuntimeAuth: { mode: "bearer", token: "irrelevant", source: "test" },
  } },
  { name: "tool family explicitly allowed (not just ask)", context: {
    sessionId: "session_r5_allow",
    hostSession: FULLY_APPROVED_HOST_SESSION,
    approvedCommandIds: FULLY_APPROVED_HOST_SESSION.metadata.approvedCommandIds,
    toolPermissionModes: { booking: "allow" },
  } },
  { name: "tool family off", context: {
    sessionId: "session_r5_off",
    hostSession: FULLY_APPROVED_HOST_SESSION,
    approvedCommandIds: FULLY_APPROVED_HOST_SESSION.metadata.approvedCommandIds,
    toolPermissionModes: { booking: "off" },
  } },
];

for (const { name, context } of COMMAND_CATALOG_CONTEXT_MATRIX) {
  const tools = createCommandCatalogTools(context);
  for (const forbidden of FORBIDDEN_TOOL_KEYS) {
    assert.equal(tools[forbidden], undefined, `createCommandCatalogTools(${name}) must never mount ${forbidden}`);
  }
  assert.equal(typeof tools.executeCommand?.execute, "function", `createCommandCatalogTools(${name}) must still mount executeCommand (reads stay open)`);
  assert.equal(typeof tools.searchCommandCatalog?.execute, "function", `createCommandCatalogTools(${name}) must still mount searchCommandCatalog`);
  assert.equal(typeof tools.learnCommand?.execute, "function", `createCommandCatalogTools(${name}) must still mount learnCommand`);
  assert.deepEqual(
    Object.keys(tools).sort(),
    ["executeCommand", "learnCommand", "previewBookingReservationCommand", "searchCommandCatalog"],
    `createCommandCatalogTools(${name}) must mount only read/discovery plus reservation preview tools, nothing else`,
  );
}

const ARTIFACT_STATE_CONTEXT_MATRIX = [
  { name: "no context at all", context: {} },
  { name: "sessionId + pageContext only", context: { sessionId: "session_1", pageContext: { activeArtifactId: "artifact_1" } } },
  { name: "fully authenticated + host-approved (the exact R5 shape)", context: {
    sessionId: "session_r5_regression",
    pageContext: { activeArtifactId: "artifact_r5_regression" },
    hostSession: FULLY_APPROVED_HOST_SESSION,
    approvedCommandIds: FULLY_APPROVED_HOST_SESSION.metadata.approvedCommandIds,
    bookingServiceBaseUrl: "https://booking.example.test",
    bookingRuntimeAuth: { mode: "bearer", token: "irrelevant", source: "test" },
  } },
  // The removed allowIntakeCommandCommit flag: even if a caller still passes
  // it (stale integration, typo, etc.), it must be a no-op -- there is no
  // longer any branch in createArtifactStateTools that reads it.
  { name: "stale allowIntakeCommandCommit:true passthrough", context: {
    sessionId: "session_stale_flag",
    pageContext: { activeArtifactId: "artifact_stale_flag" },
    hostSession: FULLY_APPROVED_HOST_SESSION,
    approvedCommandIds: FULLY_APPROVED_HOST_SESSION.metadata.approvedCommandIds,
    allowIntakeCommandCommit: true,
  } },
];

for (const { name, context } of ARTIFACT_STATE_CONTEXT_MATRIX) {
  const tools = createArtifactStateTools(context);
  for (const forbidden of FORBIDDEN_TOOL_KEYS) {
    assert.equal(tools[forbidden], undefined, `createArtifactStateTools(${name}) must never mount ${forbidden}`);
  }
  assert.equal(typeof tools.readActiveArtifactState?.execute, "function", `createArtifactStateTools(${name}) must still mount readActiveArtifactState`);
  assert.equal(typeof tools.previewActiveIntakeCommand?.execute, "function", `createArtifactStateTools(${name}) must still mount previewActiveIntakeCommand`);
  assert.deepEqual(
    Object.keys(tools).sort(),
    ["previewActiveIntakeCommand", "readActiveArtifactState"],
    `createArtifactStateTools(${name}) must mount exactly the draft/preview tools, nothing else`,
  );
}

// commitBookingContextIntakeCommand is exported for the deterministic
// /api/intake/commit endpoint to call directly -- it must NOT be re-exposed as
// a `tool()`-wrapped, model-callable entry anywhere in this module.
assert.equal(typeof artifactStateModule.commitBookingContextIntakeCommand, "function", "the endpoint-only commit function must exist for /api/intake/commit to call");
assert.equal(
  Object.prototype.hasOwnProperty.call(artifactStateModule.commitBookingContextIntakeCommand, "inputSchema"),
  false,
  "commitBookingContextIntakeCommand must be a plain function, not an ai SDK tool() wrapper",
);

// Source-pin: agent.ts must never hardcode a commit key into the `tools: {...}`
// object it hands to ToolLoopAgent, bypassing the factories checked above.
const agentSource = readFileSync(new URL("../../apps/standalone-sveltekit/src/lib/agent.ts", import.meta.url), "utf8");
for (const forbidden of FORBIDDEN_TOOL_KEYS) {
  assert.equal(agentSource.includes(forbidden), false, `agent.ts source must not reference ${forbidden} anywhere`);
}
assert.ok(agentSource.includes("...commandCatalogTools"), "agent.ts must still compose the model's tools from createCommandCatalogTools' output");
assert.ok(agentSource.includes("...artifactStateTools"), "agent.ts must still compose the model's tools from createArtifactStateTools' output");

console.log(JSON.stringify({
  ok: true,
  checked: "draft-only-commit-invariant",
  commandCatalogContextsChecked: COMMAND_CATALOG_CONTEXT_MATRIX.length,
  artifactStateContextsChecked: ARTIFACT_STATE_CONTEXT_MATRIX.length,
  forbiddenToolKeys: FORBIDDEN_TOOL_KEYS,
}));
