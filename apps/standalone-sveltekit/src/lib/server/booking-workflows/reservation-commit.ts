import { executeHostCatalogCommand } from "@sonik-agent-ui/platform-adapters";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import {
  createStandaloneHostCommandIndex,
  createStandaloneHostCommandRuntimeBundle,
  type BookingRuntimeAuthContext,
} from "../host-command-runtime.ts";
import { writeAgentTelemetry } from "../agent-telemetry.ts";
import type { AgentToolPermissionMode } from "../../agent-settings.ts";

// A2 reservation-commit (2026-07-08): the human-only publish path for reservations.
//
// The draft-only invariant (Slice A) made executeCommand read-only, so the agent can run
// booking.get.availability (a read) and prepare a reservation preview, but it can NO LONGER commit
// booking.create.guest / booking.create.booking itself. This is the deterministic server endpoint
// -- invoked by a human clicking Approve on the reservation preview card, never by a model turn --
// that runs those two writes in order, exactly mirroring commitBookingContextIntakeCommand.
//
// The two write command ids are fixed here (not client-chosen); the client only supplies the
// approved reservation DATA. The guest's persistent id (POST /api/v1/booking/guests -> { id }) is
// resolved server-side and threaded into the booking's userId, so the client never has to correlate
// the two calls and can't inject a foreign user id.

export interface ReservationCommitContext {
  sessionId?: string | null;
  pageContext?: AgentPageContext;
  hostSession?: HostSessionEnvelope | null;
  approvedCommandIds?: string[];
  bookingServiceBaseUrl?: string | null;
  bookingRuntimeAuth?: BookingRuntimeAuthContext | null;
  bookingRuntimeFetcher?: typeof fetch;
  toolPermissionModes?: Record<string, AgentToolPermissionMode>;
}

const GUEST_COMMAND_ID = "booking.create.guest";
const BOOKING_COMMAND_ID = "booking.create.booking";

export interface ReservationCommitInput {
  /** POST /api/v1/booking/guests body -- at minimum the guest's name + a contact channel. */
  guest: Record<string, unknown>;
  /** POST /api/v1/booking/bookings body WITHOUT userId; userId is resolved from the guest receipt. */
  booking: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function pickId(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  for (const key of ["id", "guestId", "userId", "customerId"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

/**
 * The created guest's persistent id lives in the generated booking runtime receipt `summary` (the
 * command receipt `summary` is z.unknown() -- provider-specific). host-command-runtime wraps the
 * provider response as `{ ok, status, receipt: { confirmation: { id } }, body: { id, name, ... } }`,
 * where `id` is the sonik guest id "stored as booking.user_id". Prefer the runtime's canonical
 * `receipt.confirmation.id`, then the raw provider `body.id`, then a few looser fallbacks.
 */
export function extractCreatedGuestId(summary: unknown): string | null {
  const record = asRecord(summary);
  if (!record) return null;
  return (
    pickId(asRecord(asRecord(record.receipt)?.confirmation)) ??
    pickId(asRecord(record.body)) ??
    pickId(asRecord(record.data)) ??
    pickId(record)
  );
}

export interface ReservationCommitStep {
  commandId: string;
  receipt: Awaited<ReturnType<typeof executeHostCatalogCommand>>;
}

export async function commitBookingReservationCommand(context: ReservationCommitContext, input: ReservationCommitInput) {
  const hostSessionInput = context.hostSession ? { hostSession: context.hostSession } : { hostSessionMode: "standalone-demo" as const };
  const bundleInput = {
    sessionId: context.sessionId,
    pageContext: context.pageContext,
    ...hostSessionInput,
    bookingServiceBaseUrl: context.bookingServiceBaseUrl,
    bookingRuntimeAuth: context.bookingRuntimeAuth,
    fetcher: context.bookingRuntimeFetcher,
  };
  const { catalog, runtimeAdapters, executionContext } = createStandaloneHostCommandRuntimeBundle(bundleInput);
  const contextCommandIds = new Set(createStandaloneHostCommandIndex(bundleInput).commands.map((entry) => entry.id));

  const runCommit = async (commandId: string, commandInput: Record<string, unknown>) => {
    const receipt = await executeHostCatalogCommand({
      catalog,
      commandId,
      commandInput,
      runtimeAdapters,
      execution: {
        ...executionContext,
        action: "commit",
        source: "agent-ui",
        sessionId: executionContext.sessionId ?? context.sessionId,
        approved: context.approvedCommandIds?.includes(commandId) === true,
        toolPolicy: { familyModes: context.toolPermissionModes },
      },
    });
    await writeAgentTelemetry({
      source: "server",
      event: "commit.human_approved",
      ok: receipt.ok,
      sessionId: context.sessionId ?? undefined,
      toolCallId: commandId,
      mode: receipt.policy.decision,
      policyReasons: receipt.policy.reasons,
      runtimeProvider: receipt.trace.provider,
      hostSessionSource: executionContext.hostSessionSource,
      commandFamily: catalog.commands.find((entry) => entry.id === commandId)?.familyId,
      runtimeStatus: contextCommandIds.has(commandId) ? "mounted" : "not_context_loaded",
    }).catch(() => undefined);
    return receipt;
  };

  const guestReceipt = await runCommit(GUEST_COMMAND_ID, input.guest);
  const steps: ReservationCommitStep[] = [{ commandId: GUEST_COMMAND_ID, receipt: guestReceipt }];
  if (!guestReceipt.ok) {
    return { ok: false, kind: "reservation-commit" as const, error: "guest_create_failed", guestId: null, steps, message: "Could not create or resolve the guest; the reservation was not booked." };
  }
  const guestId = extractCreatedGuestId(guestReceipt.summary);
  if (!guestId) {
    return { ok: false, kind: "reservation-commit" as const, error: "missing_guest_id", guestId: null, steps, message: "The guest was created but the runtime returned no id to attach the booking to." };
  }

  // Server-resolved userId always wins over any client-supplied one -- the client can't book on
  // behalf of a different user than the guest it just approved.
  const bookingInput = { ...input.booking, userId: guestId };
  const bookingReceipt = await runCommit(BOOKING_COMMAND_ID, bookingInput);
  steps.push({ commandId: BOOKING_COMMAND_ID, receipt: bookingReceipt });
  return {
    ok: bookingReceipt.ok,
    kind: "reservation-commit" as const,
    error: bookingReceipt.ok ? undefined : "booking_create_failed",
    guestId,
    steps,
    message: bookingReceipt.ok ? undefined : "The guest was created but the booking could not be committed.",
  };
}
