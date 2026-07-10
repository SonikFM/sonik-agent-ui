import { env } from "$env/dynamic/private";
import { error, json } from "@sveltejs/kit";
import { writeAgentTelemetry } from "$lib/server/agent-telemetry";
import { getRequestWorkspacePersistence } from "$lib/server/workspace-request-store";
import { AGENT_UI_HOST_CONTEXT_HEADER } from "$lib/server/workspace-services";
import {
  createAgentHostSessionEnvelope,
  approvedCommandIdsFromHostSession,
  createBookingRuntimeAuthContextFromEnv,
  createBookingRuntimeAuthContextFromTrustedHostHeader,
} from "$lib/server/host-command-runtime";
import { commitBookingContextIntakeCommand } from "$lib/tools/artifact-state";
import { routeString, WORKSPACE_SESSION_ID_MAX_CHARS } from "$lib/server/workspace-route-limits";
import { createRequestBookingRuntimeFetcher } from "$lib/server/booking-runtime-transport";
import type { RequestHandler } from "./$types";

// Draft-only invariant (Slice A, 2026-07-08): this is the ONLY code path that
// publishes a booking-context intake draft. It is invoked directly by the
// client Approve button — no model turn runs in between. The model can only
// ever produce a preview (previewActiveIntakeCommand); commitActiveIntakeCommand
// and commitCommand are no longer mounted on the agent's tool set at all. See
// docs/plans/experience-seams-resolution-plan-2026-07-08.md Slice A.
export const POST: RequestHandler = async (event) => {
  const body = await parseCommitBody(event.request);
  const artifactId = routeString(body.artifactId, "artifactId", 256, "").trim();
  if (!artifactId) error(400, "artifactId is required");
  const sessionId = optionalTrimmedString(body.sessionId, "sessionId");

  // Same trust checks as /api/generate: a signed, authenticated host session is
  // required to publish anything, and the approved-command grant is resolved
  // from that trusted session, never from the request body.
  const hostSession = createAgentHostSessionEnvelope(event);
  if (!hostSession) {
    await recordCommitTelemetry({ ok: false, artifactId, sessionId, reason: "unauthenticated_host_session" });
    return json(
      { ok: false, error: "unauthenticated", message: "A trusted, authenticated host session is required to publish this draft." },
      { status: 401 },
    );
  }

  const approvedCommandIds = approvedCommandIdsFromHostSession(hostSession);
  const bookingServiceBaseUrl = env.SONIK_BOOKING_API_BASE_URL ?? env.BOOKING_SERVICE_BASE_URL ?? null;
  const bookingRuntimeAuth = createBookingRuntimeAuthContextFromTrustedHostHeader({
    header: event.request.headers.get(AGENT_UI_HOST_CONTEXT_HEADER),
    fallback: createBookingRuntimeAuthContextFromEnv(env),
  });
  const bookingRuntimeFetcher = createRequestBookingRuntimeFetcher(event);
  const persistence = getRequestWorkspacePersistence(event);

  const result = await commitBookingContextIntakeCommand(
    {
      sessionId,
      persistence,
      hostSession,
      approvedCommandIds,
      bookingServiceBaseUrl,
      bookingRuntimeAuth,
      bookingRuntimeFetcher,
    },
    artifactId,
  );

  // commitBookingContextIntakeCommand already emits commit.human_approved
  // telemetry for every artifact-load/validation/runtime outcome it reaches;
  // this endpoint only needs to cover the request-shape and trust-boundary
  // failures above that never reach that function.
  return json(result, { status: 200 });
};

async function parseCommitBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) error(400, "Commit payload must be a JSON object");
    return parsed as Record<string, unknown>;
  } catch (caught) {
    if (caught && typeof caught === "object" && "status" in caught) throw caught;
    error(400, "Invalid JSON commit payload");
  }
}

function optionalTrimmedString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = routeString(value, field, WORKSPACE_SESSION_ID_MAX_CHARS, "").trim();
  return normalized || undefined;
}

async function recordCommitTelemetry(input: { ok: boolean; artifactId: string; sessionId?: string; reason?: string }): Promise<void> {
  await writeAgentTelemetry({
    source: "server",
    event: "commit.human_approved",
    ok: input.ok,
    artifactId: input.artifactId,
    sessionId: input.sessionId,
    reason: input.reason,
  }).catch(() => undefined);
}
