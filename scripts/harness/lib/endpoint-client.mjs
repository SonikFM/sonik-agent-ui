// Thin HTTP client over the agent-ui workspace endpoints, replicating what
// workspaceFetch() + the semantic actions in
// apps/standalone-sveltekit/src/routes/+page.svelte do from the browser:
//   POST /api/session              -> create a workspace session
//   POST /api/artifact             -> upsert a json-render artifact
//   PATCH /api/artifact/:id/state  -> JSON-Pointer state patch
//   POST /api/generate             -> model turn (SSE), see lib/sse-stream.mjs
//   POST /api/session/:id/messages -> persist a turn's messages (client does
//                                     this after every stream today; see
//                                     persistConversationMessages)
//   GET /api/sessions, GET /api/session/:id
//
// No SvelteKit/browser imports: every call is a plain fetch against a base
// URL, carrying whatever headers the target (local unsigned vs deployed
// signed) needs. See lib/host-context.mjs for header construction.

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
    const requestId = init.headers?.["x-sonik-request-id"] ?? `harness-${randomUUID()}`;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...this.headers,
        "x-sonik-request-id": requestId,
        ...(init.headers ?? {}),
      },
    });
    this.onResponse?.({
      method: init.method ?? "GET",
      path,
      status: response.status,
      requestId: response.headers.get("x-sonik-request-id") ?? requestId,
      traceId: response.headers.get("x-sonik-trace-id"),
      persistenceMode: response.headers.get("x-sonik-agent-ui-persistence-mode"),
      persistencePolicy: response.headers.get("x-sonik-agent-ui-persistence-policy"),
      hostAuthenticated: response.headers.get("x-sonik-agent-ui-host-authenticated"),
      hostOrg: response.headers.get("x-sonik-agent-ui-host-org"),
      cloudError: response.headers.get("x-sonik-agent-ui-cloud-error"),
    });
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

  createSession({ name = "Harness workflow run", mode = "chat" } = {}) {
    return this.requestJson("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, mode }),
    });
  }

  getSession(sessionId) {
    return this.requestJson(`/api/session/${encodeURIComponent(sessionId)}`);
  }

  listSessions() {
    return this.requestJson("/api/sessions");
  }

  upsertArtifact(input) {
    return this.requestJson("/api/artifact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  patchArtifactState(artifactId, payload) {
    return this.requestJson(`/api/artifact/${encodeURIComponent(artifactId)}/state`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  appendSessionMessage(sessionId, message) {
    return this.requestJson(`/api/session/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
  }

  /**
   * Drive one /api/generate turn. `messages` is the full UIMessage[] history
   * (mirrors DefaultChatTransport.prepareSendMessagesRequest in +page.svelte).
   * Returns the reduced { text, toolCalls, error } plus response metadata.
   */
  async generateTurn({ messages, sessionId, pageContext, extraHeaders = {}, smokeMock = false }) {
    const headers = {
      "content-type": "application/json",
      accept: "text/event-stream",
      ...(smokeMock
        ? {
            "x-sonik-agent-ui-smoke-stream": "true",
            "x-sonik-agent-ui-smoke-run-id": `harness-${randomUUID()}`,
          }
        : {}),
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
