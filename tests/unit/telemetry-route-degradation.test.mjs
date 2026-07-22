import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createAsyncWorkspacePersistenceAdapter, createInMemoryWorkspacePersistence } from "../../packages/workspace-session/src/index.ts";

// Live smoke on the deployed standalone worker (opened WITHOUT host context / anonymous
// mode) showed POST /api/telemetry looping at HTTP 500 (~1/sec client retries). Root cause:
// getRequestWorkspacePersistence() throws WorkspaceRuntimeResolutionError("missing-host-context",
// ...) in that mode, and unlike GET /api/sessions/+server.ts (which wraps its body in
// try/catch and returns 503 {ok:false,...}), the telemetry route has no try/catch at all --
// the throw propagates uncaught through SvelteKit as a raw 500. This suite locks in the
// desired degrade-gracefully behavior mirrored from /api/sessions.

const stub = (source) => ({ url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true });

globalThis.__telemetryDegradePersistenceFactory = () => {
  throw new Error("persistence factory not configured for this test");
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "$lib/server/workspace-services") {
      return stub(`
        export class WorkspaceRuntimeResolutionError extends Error {
          constructor(code, message) {
            super(message);
            this.name = "WorkspaceRuntimeResolutionError";
            this.code = code;
          }
        }
        export const createWorkspaceRuntimeDiagnosticHeaders = () => ({});
      `);
    }
    if (specifier === "$lib/server/workspace-request-store") {
      return stub(`
        export const getRequestWorkspacePersistence = (event) => globalThis.__telemetryDegradePersistenceFactory(event);
      `);
    }
    if (specifier.startsWith("$lib/")) return { url: new URL(`../../apps/standalone-sveltekit/src/lib/${specifier.slice(5)}.ts`, import.meta.url).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { POST } = await import("../../apps/standalone-sveltekit/src/routes/api/telemetry/+server.ts");
const { WorkspaceRuntimeResolutionError } = await import("$lib/server/workspace-services");

function postRequest(body) {
  return { request: new Request("https://agent-ui.local/api/telemetry", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }) };
}

async function withPersistence(persistence, fn) {
  globalThis.__telemetryDegradePersistenceFactory = () => persistence;
  try {
    await fn();
  } finally {
    globalThis.__telemetryDegradePersistenceFactory = () => {
      throw new Error("persistence factory not configured for this test");
    };
  }
}

test("missing host context / unavailable persistence degrades to a structured non-500 response instead of throwing", async () => {
  globalThis.__telemetryDegradePersistenceFactory = () => {
    throw new WorkspaceRuntimeResolutionError("missing-host-context", "Cannot resolve workspace persistence without a trusted host context.");
  };
  const response = await POST(postRequest({ event: { source: "client", event: "telemetry.anonymous.probe" } }));
  assert.equal(response.status, 503, "anonymous/missing-host-context mode must degrade to the documented 503, not a raw 500");
  const body = await response.json();
  assert.deepEqual(body, {
    ok: false,
    error: "Workspace cloud runtime is not available.",
    code: "missing-host-context",
  }, "the degrade response shape must be locked exactly, matching GET /api/sessions's contract");
});

test("happy path: valid batch against an existing session still returns {ok:true, accepted:N}", async () => {
  const persistence = createAsyncWorkspacePersistenceAdapter(createInMemoryWorkspacePersistence());
  await persistence.createSession({ id: "session-degrade-happy" });
  await withPersistence(persistence, async () => {
    const response = await POST(postRequest({ event: { source: "client", event: "telemetry.happy.path", sessionId: "session-degrade-happy" } }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { ok: true, accepted: 1 });
  });
});

test("regression: an invalid batch still returns batch.status, unchanged", async () => {
  const persistence = createAsyncWorkspacePersistenceAdapter(createInMemoryWorkspacePersistence());
  await withPersistence(persistence, async () => {
    const response = await POST(postRequest("not json"));
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "invalid_json_body");
  });
});

test("regression: an unknown session still returns 404, unchanged", async () => {
  const persistence = createAsyncWorkspacePersistenceAdapter(createInMemoryWorkspacePersistence());
  await withPersistence(persistence, async () => {
    const response = await POST(postRequest({ event: { source: "client", event: "telemetry.unknown.session", sessionId: "session-does-not-exist" } }));
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, "session_not_found");
  });
});
