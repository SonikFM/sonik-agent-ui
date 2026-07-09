import { env } from "$env/dynamic/private";
import { error, json } from "@sveltejs/kit";
import { writeAgentTelemetry } from "$lib/server/agent-telemetry";
import { AGENT_UI_HOST_CONTEXT_HEADER } from "$lib/server/workspace-services";
import {
  createAgentHostSessionEnvelope,
  approvedCommandIdsFromHostSession,
  createBookingRuntimeAuthContextFromEnv,
  createBookingRuntimeAuthContextFromTrustedHostHeader,
} from "$lib/server/host-command-runtime";
import { commitBookingReservationCommand } from "$lib/server/booking-workflows/reservation-commit";
import { routeString, WORKSPACE_SESSION_ID_MAX_CHARS } from "$lib/server/workspace-route-limits";
import type { RequestHandler } from "./$types";

// A2 reservation-commit (2026-07-08): the ONLY code path that commits a reservation
// (booking.create.guest -> booking.create.booking). Invoked directly by the human clicking Approve
// on the reservation preview card -- no model turn runs. The draft-only invariant (Slice A) removed
// every model-callable write tool, so this endpoint restores reservations for the new deploy. Same
// trust boundary as /api/intake/commit: a signed, authenticated host session is required, and the
// approved-command grant is resolved from that trusted session, never from the request body.
export const POST: RequestHandler = async (event) => {
  const body = await parseCommitBody(event.request);
  const sessionId = optionalTrimmedString(body.sessionId, "sessionId");
  const guest = requireObject(body.guest, "guest");
  const booking = requireObject(body.booking, "booking");
  // The client supplies the reservation DATA; the endpoint fixes WHICH commands run and resolves
  // the guest id server-side, so drop any client-provided userId before it can be booked against.
  const { userId: _discardedUserId, ...bookingInput } = booking;

  const hostSession = createAgentHostSessionEnvelope(event);
  if (!hostSession) {
    await recordCommitTelemetry({ ok: false, sessionId, reason: "unauthenticated_host_session" });
    return json(
      { ok: false, error: "unauthenticated", message: "A trusted, authenticated host session is required to book this reservation." },
      { status: 401 },
    );
  }

  const approvedCommandIds = approvedCommandIdsFromHostSession(hostSession);
  const bookingServiceBaseUrl = env.SONIK_BOOKING_API_BASE_URL ?? env.BOOKING_SERVICE_BASE_URL ?? null;
  const bookingRuntimeAuth = createBookingRuntimeAuthContextFromTrustedHostHeader({
    header: event.request.headers.get(AGENT_UI_HOST_CONTEXT_HEADER),
    fallback: createBookingRuntimeAuthContextFromEnv(env),
  });

  const result = await commitBookingReservationCommand(
    {
      sessionId,
      hostSession,
      approvedCommandIds,
      bookingServiceBaseUrl,
      bookingRuntimeAuth,
    },
    { guest, booking: bookingInput },
  );

  // commitBookingReservationCommand emits commit.human_approved telemetry per write command; this
  // endpoint only covers the request-shape / trust-boundary failures above that never reach it.
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

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) error(400, `${field} is required and must be an object`);
  return value as Record<string, unknown>;
}

function optionalTrimmedString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const normalized = routeString(value, field, WORKSPACE_SESSION_ID_MAX_CHARS, "").trim();
  return normalized || undefined;
}

async function recordCommitTelemetry(input: { ok: boolean; sessionId?: string; reason?: string }): Promise<void> {
  await writeAgentTelemetry({
    source: "server",
    event: "commit.human_approved",
    ok: input.ok,
    sessionId: input.sessionId,
    reason: input.reason,
  }).catch(() => undefined);
}
