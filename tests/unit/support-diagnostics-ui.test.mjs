import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createTurnCorrelationRecordFromResponse,
  deploymentSnapshotFromHeaders,
} from "../../apps/standalone-sveltekit/src/lib/chat-correlation.ts";

const page = await readFile("apps/standalone-sveltekit/src/routes/+page.svelte", "utf8");
const menu = await readFile("apps/standalone-sveltekit/src/lib/SupportDiagnosticsMenu.svelte", "utf8");
const observability = await readFile("packages/agent-observability/src/index.ts", "utf8");
const generateRoute = await readFile("apps/standalone-sveltekit/src/routes/api/generate/+server.ts", "utf8");

const secret = `sk-${"supportsecret".repeat(2)}`;
const headers = new Headers({
  "x-sonik-request-id": "req-server",
  "x-sonik-trace-id": "cccccccccccccccccccccccccccccccc",
  traceparent: "00-cccccccccccccccccccccccccccccccc-dddddddddddddddd-01",
  "x-sonik-agent-ui-run-id": "run-server",
  "x-sonik-agent-ui-deployment-id": "deployment-safe-1",
  authorization: secret,
});
const success = createTurnCorrelationRecordFromResponse({
  prepared: { sessionId: "sess-h", messageId: "msg-h", requestId: "req-client", status: "error" },
  headers,
  status: "success",
  capturedAt: "2026-07-10T03:00:00.000Z",
});
assert.equal(success.requestId, "req-server", "response request id wins over prepared id");
assert.equal(success.traceId, "cccccccccccccccccccccccccccccccc");
assert.equal(success.agentUiRunId, "run-server");
assert.equal(JSON.stringify(success).includes(secret), false, "raw/secret headers are not copied into correlation record");
assert.equal(String(JSON.stringify(deploymentSnapshotFromHeaders(headers))).includes(secret), false, "deployment helper does not expose raw/secret headers");

const errored = createTurnCorrelationRecordFromResponse({
  prepared: { sessionId: "sess-h", messageId: "msg-e", requestId: "req-prepared", traceId: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", status: "error" },
  headers: new Headers(),
  status: "error",
  capturedAt: "2026-07-10T03:01:00.000Z",
});
assert.equal(errored.requestId, "req-prepared", "network-error path can record prepared client ids");
assert.equal(errored.status, "error");

assert.equal(page.includes("fetch: fetchGenerateWithSupportCorrelation"), true, "DefaultChatTransport must use custom fetch for response header capture");
assert.equal(page.includes('"x-sonik-request-id"'), true, "generate requests include support request id header");
assert.equal(page.includes('"x-sonik-trace-id"'), true, "generate requests include support trace id header");
assert.equal(page.includes("traceparent"), true, "generate requests include traceparent");
assert.equal(page.includes("getLatestActiveSessionCorrelation()"), true, "page context exposes active-session-only correlation");
assert.equal(page.includes("sanitizeTurnCorrelationSnapshot(getLatestActiveSessionCorrelation())"), true, "page context sanitizes active-session local correlation");
assert.equal(page.includes("sanitizeDeploymentSnapshot(latestDeploymentSnapshot)"), true, "page context preserves sanitized app-wide deployment identity without trusting host context");
assert.equal(page.includes("const mergedContext = mergeAgentHostPageContext(localContext, hostPageContext)"), true, "host context is merged before local support identifiers are appended");
assert.equal(page.includes("activeSessionId,"), true, "actual local active session id is reasserted after host merge");
assert.equal(page.includes("...(localCorrelation ? { correlation: localCorrelation } : {})"), true, "sanitized local correlation is authoritative after host merge");
assert.equal(page.includes("...(localDeployment ? { deployment: localDeployment } : {})"), true, "sanitized local deployment is authoritative after host merge");
assert.equal(page.includes("createSupportDiagnosticsExport"), true, "diagnostics export uses allowlist helper");
assert.equal(page.includes('collectionStatus: "partial"'), true, "diagnostics export has a privacy-safe partial fallback");
assert.equal(page.includes("Partial diagnostics exported."), true, "partial fallback reports success without raw error text");
assert.equal(page.includes("exportTranscriptMarkdown(conversation.messages)"), true, "chat export uses visible text transcript helper");
assert.equal(page.includes("<SupportDiagnosticsMenu"), true, "support actions are grouped in a compact menu");
assert.equal(menu.includes("<details"), true, "support menu uses semantic details disclosure");
assert.equal(menu.includes("aria-live=\"polite\""), true, "support status is announced accessibly");
assert.equal(menu.includes("hsl(var("), false, "support menu uses direct theme tokens, not hsl(var(...)) wrappers");
assert.equal(menu.includes("var(--muted-foreground)"), true, "support menu uses direct muted foreground token");
assert.equal(menu.includes("var(--sonik-border-color)"), true, "support menu uses the Sonik border color token, not a Daisy border-width token");
assert.equal(menu.includes("var(--app-card-shadow-elevated)"), true, "support panel uses the elevated card shadow token");
assert.equal(menu.includes("0 16px 40px"), false, "support panel does not hardcode an elevated shadow");
assert.equal(menu.includes("window.visualViewport"), true, "support panel clamps against the visual viewport for zoomed and narrow layouts");
assert.match(menu, /max-width:\$\{panelMaxWidth\}px;max-height:\$\{panelMaxHeight\}px/, "support panel applies measured visual-viewport bounds");
assert.equal(menu.includes("overflow-y: auto"), true, "support panel scrolls internally when viewport height is constrained");
assert.equal(menu.includes('event.key !== "Escape"'), true, "Escape closes the diagnostics disclosure");
assert.equal(menu.includes("summaryElement?.focus()"), true, "Escape restores focus to the diagnostics trigger");
assert.equal(menu.includes("No raw headers") || menu.includes("no raw headers"), true, "menu copy reinforces no raw headers");
assert.equal(observability.includes("exportChat?"), true, "page-control type includes exportChat action");
assert.equal(observability.includes("exportDiagnostics?"), true, "page-control type includes exportDiagnostics action");

const generateErrorTelemetry = generateRoute.indexOf('event: "api.generate.error"');
const generateCatchStart = generateRoute.lastIndexOf("  } catch (error) {", generateErrorTelemetry);
const generateCatchEnd = generateRoute.indexOf("\n  }\n};", generateErrorTelemetry);
const generateCatch = generateRoute.slice(generateCatchStart, generateCatchEnd);
assert.equal(generateCatch.includes("throw error"), false, "generate catch returns a sanitized response instead of rethrowing");
assert.equal(generateRoute.includes("class MalformedJsonRequestError"), true, "malformed JSON request parsing has an explicit sanitized 400 path");
assert.equal(generateRoute.includes('"status" in error'), true, "generate failure status checks own/inherited thrown status values structurally");
const failureStatusResolver = generateRoute.match(/function resolveGenerateFailureStatus[\s\S]*?\n}/)?.[0] ?? "";
assert.match(failureStatusResolver, /error instanceof AgentUiFileError[\s\S]*error\.status/, "typed file/auth failures preserve their public status");
assert.match(failureStatusResolver, /400[\s\S]*413/, "trusted route/page-context failures preserve 400/413 status");
const failureMessageResolver = generateRoute.match(/function resolveGenerateFailureMessage[\s\S]*?\n}/)?.[0] ?? "";
assert.match(failureMessageResolver, /status === 500 \? "Generation failed" : "Invalid request"/, "generate failures expose only generic error bodies");
const failureResponseStart = generateRoute.indexOf("function createGenerateFailureResponse");
const failureResponseEnd = generateRoute.indexOf("\nasync function finalizeRunFailure", failureResponseStart);
const failureResponse = generateRoute.slice(failureResponseStart, failureResponseEnd);
assert.match(failureResponse, /ok: false/);
assert.match(failureResponse, /error: typed\?\.message \?\? resolveGenerateFailureMessage\(status\)/, "typed public failures remain human-readable while generic failures use the sanitized resolver");
assert.match(failureResponse, /code: typed\?\.code \?\? \(status === 500 \? "generation_failed" : "invalid_request"\)/);
assert.match(failureResponse, /phase: typed\?\.phase \?\? \(status === 500 \? "post_write" : "pre_stream"\)/, "all generate failures expose a typed side-effect phase");
assert.match(failureResponse, /safeToRetry: typed\?\.safeToRetry \?\? false/, "all generate failures default to non-replayable");
assert.match(failureResponse, /requestId/);
assert.match(failureResponse, /traceId/);
assert.equal(generateRoute.includes('return "Generation failed";'), true, "stream onError exposes only a generic client message");
assert.equal(generateRoute.includes("...input.responseHeaders"), true, "generate catch preserves correlation and deployment response headers");
assert.equal(generateRoute.includes("[AGENT_UI_RUN_ID_HEADER]: input.runRecorder.runId"), true, "generate catch returns the agent UI run id when available");

console.log("support diagnostics UI contract tests passed");
