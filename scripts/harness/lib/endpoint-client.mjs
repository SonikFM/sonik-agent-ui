// Thin HTTP client over the deployed agent-ui workspace endpoints, replicating
// what workspaceFetch() + the client's own request shapes do from the browser:
//   POST /api/session              -> create a workspace session
//   POST /api/artifact             -> upsert a json-render artifact (unused
//                                     by the persona conversations themselves,
//                                     kept for parity/inspection tooling)
//   GET  /api/artifact/:id         -> read an artifact's current content
//   POST /api/generate             -> model turn (SSE), see lib/sse-stream.mjs
//   POST /api/telemetry            -> best-effort client telemetry event
//   GET  /api/sessions, GET /api/session/:id
//
// No SvelteKit/browser imports: every call is a plain fetch against a base
// URL, carrying the signed x-sonik-agent-ui-host-context header (see
// lib/host-context.mjs).

import { randomUUID } from "node:crypto";
import { readUiMessageStream, reduceUiMessageChunks } from "./sse-stream.mjs";

export class WorkspaceRequestError extends Error {
  constructor(message, { status, path, body } = {}) {
    super(message);
    this.name = "WorkspaceRequestError";
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export class EndpointClient {
  constructor({ baseUrl, headers = {}, fetchImpl = fetch, onResponse } = {}) {
    if (!baseUrl) throw new Error("EndpointClient requires baseUrl");
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.headers = headers;
    this.fetchImpl = fetchImpl;
    this.onResponse = onResponse;
  }

  async request(path, init = {}) {
    const requestId = init.headers?.["x-sonik-request-id"] ?? `harness-persona-${randomUUID()}`;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...this.headers,
        "x-sonik-request-id": requestId,
        ...(init.headers ?? {}),
      },
    });
    const entry = {
      at: new Date().toISOString(),
      method: init.method ?? "GET",
      path,
      status: response.status,
      requestId: response.headers.get("x-sonik-request-id") ?? requestId,
      traceId: response.headers.get("x-sonik-trace-id"),
      persistenceMode: response.headers.get("x-sonik-agent-ui-persistence-mode"),
      persistencePolicy: response.headers.get("x-sonik-agent-ui-persistence-policy"),
      hostAuthenticated: response.headers.get("x-sonik-agent-ui-host-authenticated"),
      hostOrg: response.headers.get("x-sonik-agent-ui-host-org"),
      hostUser: response.headers.get("x-sonik-agent-ui-host-user"),
      cloudError: response.headers.get("x-sonik-agent-ui-cloud-error"),
    };
    this.onResponse?.(entry);
    return response;
  }

  async requestJson(path, init = {}) {
    const response = await this.request(path, init);
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text };
      }
    }
    if (!response.ok) {
      throw new WorkspaceRequestError(`${init.method ?? "GET"} ${path} failed: ${response.status}`, { status: response.status, path, body });
    }
    return body;
  }

  createSession({ name = "Persona harness run", mode = "chat" } = {}) {
    return this.requestJson("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mode }),
    });
  }

  getSession(sessionId) {
    return this.requestJson(`/api/session/${encodeURIComponent(sessionId)}`);
  }

  getArtifact(artifactId) {
    return this.requestJson(`/api/artifact/${encodeURIComponent(artifactId)}`);
  }

  postTelemetry(event) {
    return this.requestJson("/api/telemetry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event }),
    }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  }

  /**
   * Drive one /api/generate turn. `messages` is the full UIMessage[] history
   * (mirrors DefaultChatTransport.prepareSendMessagesRequest in +page.svelte).
   * Returns the reduced { text, toolCalls, specPatches, error } plus response
   * metadata (requestId/traceId for Pipe-B correlation).
   */
  async generateTurn({ messages, sessionId, pageContext, extraHeaders = {} }) {
    const headers = {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...extraHeaders,
    };
    const response = await this.request("/api/generate", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: sessionId ?? randomUUID(),
        trigger: "submit-message",
        messageId: messages.at(-1)?.id,
        messages,
        workspace: { sessionId, pageContext: pageContext ?? {} },
        pageContext: pageContext ?? {},
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new WorkspaceRequestError(`POST /api/generate failed: ${response.status}`, { status: response.status, path: "/api/generate", body });
    }
    const chunks = await readUiMessageStream(response);
    const reduced = reduceUiMessageChunks(chunks);
    return {
      ...reduced,
      requestId: response.headers.get("x-sonik-request-id"),
      traceId: response.headers.get("x-sonik-trace-id"),
    };
  }
}

/** Build a UIMessage (the shape /api/generate + /api/session/:id/messages expect). */
export function buildUserMessage(text, { id = randomUUID() } = {}) {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

export function buildAssistantMessageFromReducedTurn(reduced, { id = randomUUID() } = {}) {
  return { id, role: "assistant", parts: [{ type: "text", text: reduced.text ?? "" }] };
}
