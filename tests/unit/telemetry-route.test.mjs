import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createAsyncWorkspacePersistenceAdapter, createInMemoryWorkspacePersistence } from "../../packages/workspace-session/src/index.ts";

const stub = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "$lib/server/workspace-request-store") return stub(`
      const persistence=()=>globalThis.__telemetryRoutePersistence;
      export const getRequestWorkspacePersistence=persistence;
      export const getRequestWorkspaceSession=(_event,id)=>persistence().getSession(id);
      export const listRequestWorkspaceTelemetryEvents=(_event,id)=>persistence().listTelemetryEvents(id);
      export const listRequestWorkspaceDocuments=async()=>[],listRequestWorkspaceMessages=async()=>[],listRequestWorkspaceLayoutSnapshots=async()=>[],listRequestWorkspaceRuns=async()=>[],listRequestWorkspaceRunEvents=async()=>[],listRequestWorkspaceArtifactVersions=async()=>[],getRequestWorkspaceDocument=async()=>null,getRequestWorkspaceArtifact=async()=>null;
      export const ensureRequestWorkspaceSession=(_event,id)=>persistence().ensureSession(id),patchRequestWorkspaceSession=()=>null;
    `);
    if (specifier === "$lib/server/workspace-services") return stub(`export const AGENT_UI_WORKSPACE_SESSION_CONTEXT_HEADER="x-session";export const createSignedWorkspaceSessionContextHeader=()=>null,resolveTrustedHostSessionSnapshot=()=>({});export class WorkspaceRuntimeResolutionError extends Error{constructor(code,message){super(message);this.name="WorkspaceRuntimeResolutionError";this.code=code;}};`);
    if (specifier === "$lib/server/agent-ui-files") return stub(`export class AgentUiFileError extends Error{};export const deleteAgentUiFile=async()=>{},requireAgentUiFileBucket=()=>({});`);
    if (specifier === "$lib/server/run-event-log") return stub(`export const buildRunReattachMessage=()=>null,runAssistantTurnPersisted=()=>true;`);
    if (specifier === "$lib/server/run-error-safety") return stub(`export const sanitizeFailureRecord=(value)=>value,sanitizeSessionFailureProjection=(value)=>value;`);
    if (specifier === "$lib/server/workspace-route-limits") return stub(`export const WORKSPACE_TITLE_MAX_CHARS=200,routeString=(value)=>String(value??"");`);
    if (specifier.startsWith("$lib/")) return { url: new URL(`../../apps/standalone-sveltekit/src/lib/${specifier.slice(5)}.ts`, import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const [{ POST }, { GET }] = await Promise.all([
  import("../../apps/standalone-sveltekit/src/routes/api/telemetry/+server.ts"),
  import("../../apps/standalone-sveltekit/src/routes/api/session/[id]/+server.ts"),
]);

const persistenceA = createAsyncWorkspacePersistenceAdapter(createInMemoryWorkspacePersistence());
await persistenceA.createSession({ id: "session-a" });
globalThis.__telemetryRoutePersistence = persistenceA;

const secret = `sk-${"route-secret".repeat(3)}`;
const privateThought = "raw route private thought";
const written = await POST({ request: new Request("https://agent-ui.local/api/telemetry", { method: "POST", body: JSON.stringify({ event: { source: "client", event: "telemetry.route.persisted", sessionId: "session-a", payload: { apiKey: secret, safe: "kept", nested: { Reasoning: privateThought, scratch_pad: privateThought, "chain.of.thought": privateThought } } } }) }) });
assert.equal(written.status, 200);

const detail = await GET({ params: { id: "session-a" }, request: new Request("https://agent-ui.local/api/session/session-a"), locals: {}, platform: undefined });
const body = await detail.json();
assert.equal(body.telemetry.at(-1)?.event, "telemetry.route.persisted", "telemetry POST must be durable through the session GET boundary");
assert.equal(JSON.stringify(body).includes(secret), false, "session telemetry must not expose secret sentinels");
assert.equal(JSON.stringify(body).includes(privateThought), false, "session telemetry must not persist private-thought sentinels");
assert.equal(body.telemetry.at(-1)?.payload.payload.apiKey, "[REDACTED]");
assert.deepEqual(body.telemetry.at(-1)?.payload.payload.nested, {});
assert.equal(body.telemetry.at(-1)?.payload.payload.safe, "kept");

const persistenceB = createAsyncWorkspacePersistenceAdapter(createInMemoryWorkspacePersistence());
globalThis.__telemetryRoutePersistence = persistenceB;
const foreign = await POST({ request: new Request("https://agent-ui.local/api/telemetry", { method: "POST", body: JSON.stringify({ event: { source: "client", event: "telemetry.route.foreign", sessionId: "session-a" } }) }) });
assert.equal(foreign.status, 404, "a foreign authenticated persistence scope cannot write to a guessed session");

console.log("telemetry-route tests passed");
