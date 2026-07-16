import assert from "node:assert/strict";
import { registerHooks } from "node:module";

globalThis.__generateRouteEffects = { rateLimit: 0, workspace: 0, telemetry: 0, message: 0, run: 0, provider: 0, model: 0 };
globalThis.__generateRateLimitSuccess = false;

const stub = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "$env/dynamic/private") return stub("export const env = {}");
    if (specifier === "$app/environment") return stub('export const browser=false, dev=false, building=false, version="test"');
    if (specifier === "$lib/rate-limit") return stub(`const limiter={limit:async()=>{globalThis.__generateRouteEffects.rateLimit+=1;return {success:globalThis.__generateRateLimitSuccess}}};export const minuteRateLimit=limiter,dailyRateLimit=limiter;`);
    if (specifier === "$lib/server/workspace-request-store") return stub(`const hit=()=>{globalThis.__generateRouteEffects.workspace+=1};export const getRequestWorkspaceDocument=async()=>{hit();return null},getRequestWorkspacePersistence=()=>{hit();return {}},syncRequestActiveWorkspaceDocumentSnapshot=async()=>{hit();return null};`);
    if (specifier === "$lib/server/agent-telemetry") return stub(`export const writeAgentTelemetry=async()=>{globalThis.__generateRouteEffects.telemetry+=1};`);
    if (specifier === "$lib/server/run-event-log") return stub(`export const persistInitiatingUserMessage=async()=>{globalThis.__generateRouteEffects.message+=1},startRunRecorder=async()=>{globalThis.__generateRouteEffects.run+=1},teeRunEvents=(stream)=>stream;`);
    if (specifier === "$lib/agent") return stub(`const hit=()=>{globalThis.__generateRouteEffects.model+=1};export const createAgent=(...args)=>{hit();return {}},hasBookingContextIntakeSkill=(...args)=>{hit();return false},resolveAgentPromptComposition=(...args)=>{hit();return {moduleIds:[],skillIds:[]}},resolveCommandFamilyMountDecision=(...args)=>{hit();return {mounted:false,wouldMountWithoutStability:false}};`);
    if (specifier === "@ai-sdk/google") return stub(`export const createGoogle=(...args)=>{globalThis.__generateRouteEffects.provider+=1;return ()=>({})};`);
    if (specifier === "ai") return stub(`const hit=()=>{globalThis.__generateRouteEffects.model+=1};export const convertToModelMessages=async()=>{hit();return []},createUIMessageStream=(...args)=>{hit();return {}},createUIMessageStreamResponse=(...args)=>{hit();return new Response()},uploadFile=(...args)=>{globalThis.__generateRouteEffects.provider+=1;return {}};`);
    if (specifier.startsWith("$lib/")) return { url: new URL(`../../apps/standalone-sveltekit/src/lib/${specifier.slice(5)}.ts`, import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { POST } = await import("../../apps/standalone-sveltekit/src/routes/api/generate/+server.ts");
const message = { id: "message-1", role: "user", parts: [{ type: "text", text: "Hello" }] };

async function post(contextSelection, workspace) {
  return POST({
    request: new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-sonik-request-id": "req-generate-auth", "x-sonik-trace-id": "a".repeat(32) },
      body: JSON.stringify({ messages: [message], ...(contextSelection === undefined ? {} : { contextSelection }), ...(workspace ? { workspace } : {}) }),
    }),
    getClientAddress: () => "127.0.0.1",
  });
}

const invalid = await post({ items: [{ id: "document:missing", kind: "document", label: "Missing ref", source: "manual" }], dismissedAutoSeedIds: [] });
assert.equal(invalid.status, 400);
assert.deepEqual(globalThis.__generateRouteEffects, { rateLimit: 0, workspace: 0, telemetry: 0, message: 0, run: 0, provider: 0, model: 0 }, "invalid document context terminates with zero downstream effects");

const beforeAuthFailure = { ...globalThis.__generateRouteEffects };
const authFailure = await post({
  items: [{ id: "file:file-1", kind: "file", label: "Private file", source: "manual", ref: "file-1" }],
  dismissedAutoSeedIds: [],
}, { sessionId: "session-private" });
assert.equal(authFailure.status, 401);
assert.deepEqual(await authFailure.json(), {
  ok: false,
  error: "Authenticated host session required",
  code: "host_auth_required",
  phase: "pre_stream",
  safeToRetry: true,
  requestId: "req-generate-auth",
  traceId: "a".repeat(32),
});
assert.equal(globalThis.__generateRouteEffects.rateLimit, beforeAuthFailure.rateLimit, "pre-stream auth failure consumes no rate-limit entries before its one classified replay");
assert.equal(globalThis.__generateRouteEffects.workspace, beforeAuthFailure.workspace, "pre-stream auth failure performs no workspace lookup");
assert.equal(globalThis.__generateRouteEffects.message, beforeAuthFailure.message, "pre-stream auth failure persists no message");
assert.equal(globalThis.__generateRouteEffects.run, beforeAuthFailure.run, "pre-stream auth failure starts no run");
assert.equal(globalThis.__generateRouteEffects.provider, beforeAuthFailure.provider, "pre-stream auth failure reaches no provider");
assert.equal(globalThis.__generateRouteEffects.model, beforeAuthFailure.model, "pre-stream auth failure constructs no model");

globalThis.__generateRateLimitSuccess = true;
const missingSelectedContextSession = await post({
  items: [{ id: "file:file-1", kind: "file", label: "Private file", source: "manual", ref: "file-1" }],
  dismissedAutoSeedIds: [],
});
assert.equal(missingSelectedContextSession.status, 400);
assert.deepEqual(await missingSelectedContextSession.json(), {
  ok: false,
  error: "Selected file and document context requires a workspace session",
  code: "invalid_request",
  phase: "pre_stream",
  safeToRetry: false,
  requestId: "req-generate-auth",
  traceId: "a".repeat(32),
});
globalThis.__generateRateLimitSuccess = false;

for (const selection of [
  undefined,
  { items: [{ id: "document:doc-1", kind: "document", label: "Brief", source: "manual", ref: "doc-1" }], dismissedAutoSeedIds: [] },
  { items: [], dismissedAutoSeedIds: ["document:doc-1"] },
  { items: [{ id: "page:current", kind: "page", label: "Events", source: "auto", route: "/events" }], dismissedAutoSeedIds: [] },
]) {
  const before = globalThis.__generateRouteEffects.rateLimit;
  const response = await post(selection);
  assert.equal(response.status, 429, "preserved selection reaches the downstream limiter instead of the invalid-document guard");
  assert.equal(globalThis.__generateRouteEffects.rateLimit, before + 2);
}

console.log("generate-route-context-selection.test.mjs: all assertions passed");
