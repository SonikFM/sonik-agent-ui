// P1 #5 (production-readiness-agent-creation-2026-07-13.md): thin HTTP wrapper around
// $lib/server/workflow-runs.ts (the controller's first production caller). All logic lives in
// that plain module so it stays testable without a SvelteKit runtime, matching the
// api/reservation/commit precedent.
import { json } from "@sveltejs/kit";
import { executeHostCatalogCommand } from "@sonik-agent-ui/platform-adapters";
import {
  createAgentHostSessionEnvelope,
  createBookingRuntimeAuthContextFromEnv,
  createBookingRuntimeAuthContextFromTrustedHostHeader,
  createStandaloneHostCommandRuntimeBundle,
} from "$lib/server/host-command-runtime";
import { createRequestBookingRuntimeFetcher } from "$lib/server/booking-runtime-transport";
import { AGENT_UI_HOST_CONTEXT_HEADER } from "$lib/server/workspace-services";
import { getRequestWorkspacePersistence } from "$lib/server/workspace-request-store";
import { workflowRunOwnerFromHostSession, type WorkflowRunsAction } from "$lib/server/workflow-runs";
import { resolveWorkflowRunJournalStore, resolveWorkflowRunStore } from "$lib/server/workflow-run-store";
import { resolveWorkflowDefinitionRepository } from "$lib/server/workflow-definition-repository";
import { handlePublicWorkflowDriverAction, type PublicWorkflowDriverAction } from "$lib/server/workflow-runs-public";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async (event) => {
  const body = await event.request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).action !== "string") {
    return json({ ok: false, error: "invalid_json_body" }, { status: 400 });
  }
  const action = body as WorkflowRunsAction;
  if (!["start", "preview", "approve", "commit", "run_until_blocked", "resume_run", "cancel_run"].includes(action.action)) {
    return json({ ok: false, error: "unknown_action" }, { status: 400 });
  }

  const hostSession = createAgentHostSessionEnvelope(event);
  if (!hostSession || !workflowRunOwnerFromHostSession(hostSession)) {
    return json({ ok: false, reason: "authenticated_workspace_owner_required" }, { status: 401 });
  }
  const env = event.platform?.env as Record<string, unknown> | undefined;
  const store = resolveWorkflowRunStore(env);
  const stringEnv = Object.fromEntries(Object.entries(env ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const bundle = createStandaloneHostCommandRuntimeBundle({
    hostSession,
    bookingServiceBaseUrl: stringEnv.SONIK_BOOKING_API_BASE_URL ?? stringEnv.BOOKING_SERVICE_BASE_URL ?? null,
    bookingRuntimeAuth: createBookingRuntimeAuthContextFromTrustedHostHeader({
      header: event.request.headers.get(AGENT_UI_HOST_CONTEXT_HEADER),
      fallback: createBookingRuntimeAuthContextFromEnv(stringEnv),
    }),
    fetcher: createRequestBookingRuntimeFetcher(event),
  });
  const persistence = getRequestWorkspacePersistence(event);
  const response = await handlePublicWorkflowDriverAction(action as PublicWorkflowDriverAction, {
    hostSession,
    store,
    journal: resolveWorkflowRunJournalStore(env),
    repository: resolveWorkflowDefinitionRepository(env),
    loadArtifact: async (artifact) => {
      const loaded = await persistence.getArtifact(artifact.artifactId);
      if (!loaded) throw new Error("artifact_not_found");
      return loaded.content;
    },
    executionContext: (node) => {
      const commandId = node.previewEffect?.commandId ?? node.effectBinding?.commandId;
      if (!commandId) return {};
      if (node.nodeType === "tool_preview") return { commandId };
      if (node.nodeType !== "tool_commit") return {};
      return {
        commandId,
        providerSupportsIdempotency: false,
        executors: {
          tool_commit: async (request) => {
            const receipt = await executeHostCatalogCommand({
              catalog: bundle.catalog,
              commandId,
              commandInput: request.input,
              runtimeAdapters: bundle.runtimeAdapters,
              execution: {
                ...bundle.executionContext,
                action: "commit",
                source: "agent-ui",
                requestId: request.idempotencyKey,
                approved: true,
              },
            });
            if (!receipt.ok) {
              const failure = receipt.errors?.[0] ?? { code: "host_runtime_not_ok", message: `Host runtime rejected ${commandId}`, retryable: false };
              return failure.retryable
                ? { status: "retryable_error" as const, error: { code: failure.code, message: failure.message, retrySafe: true } }
                : { status: "terminal_error" as const, error: { code: failure.code, message: failure.message, retrySafe: false } };
            }
            const value = JSON.parse(JSON.stringify(receipt));
            return {
              status: "succeeded" as const,
              output: { storage: "inline" as const, value, byteLength: new TextEncoder().encode(JSON.stringify(value)).byteLength },
              receipt: { receiptId: receipt.trace.requestId, semanticStatus: "success" as const },
            };
          },
        },
      };
    },
  });
  return json(response.result, { status: response.status });
};
