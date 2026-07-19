import assert from "node:assert/strict";

import { commitBookingReservationCommand } from "../../apps/standalone-sveltekit/src/lib/server/booking-workflows/reservation-commit.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CONTEXT_ID = "22222222-2222-4222-8222-222222222222";
const HOST_PRINCIPAL_ID = "host_organizer_123";
const GUEST_ID = "44444444-4444-4444-8444-444444444444";
const GUEST_LABEL = "Jordan Rivera";

function reservationGuestLabel(booking, guests) {
  if (!booking.userId) return "No guest identity";
  const guest = guests.find((candidate) => candidate.id === booking.userId);
  return guest?.name || guest?.email || guest?.phone || "Guest identity not loaded";
}

const persisted = { guests: [], bookings: [] };
const calls = [];
const fetcher = async (url, init = {}) => {
  const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
  const headers = new Headers(init.headers);
  calls.push({ url: String(url), body, headers });

  if (String(url).endsWith("/api/v1/booking/guests")) {
    const guest = { id: GUEST_ID, name: body.name, email: body.email, phone: body.phone ?? null };
    persisted.guests.push(guest);
    return Response.json(guest, { status: 201 });
  }

  if (String(url).endsWith("/api/v1/booking/bookings")) {
    const booking = { id: "55555555-5555-4555-8555-555555555555", ...body };
    persisted.bookings.push(booking);
    return Response.json(booking, { status: 201 });
  }

  return Response.json({ error: "unexpected mock route" }, { status: 500 });
};

const result = await commitBookingReservationCommand(
  {
    sessionId: "reservation-guest-linkage-session",
    hostSession: {
      source: "amplify-embedded",
      sessionId: "reservation-guest-linkage-session",
      userId: HOST_PRINCIPAL_ID,
      principalId: HOST_PRINCIPAL_ID,
      organizationId: ORGANIZATION_ID,
      authenticated: true,
      scopes: ["booking:read", "booking:write"],
      metadata: { approvedCommandIds: ["booking.create.guest", "booking.create.booking"] },
    },
    approvedCommandIds: ["booking.create.guest", "booking.create.booking"],
    bookingServiceBaseUrl: "https://booking.example.test",
    bookingRuntimeAuth: { mode: "bearer", token: "reservation-linkage-test-token", source: "test" },
    bookingRuntimeFetcher: fetcher,
  },
  {
    guest: { name: GUEST_LABEL, email: "jordan.rivera@sonik.fm", contactConfirmed: true },
    booking: {
      contextId: CONTEXT_ID,
      userId: "client-supplied-identity-must-not-win",
      startsAt: "2026-07-15T23:00:00.000Z",
      endsAt: "2026-07-16T00:00:00.000Z",
      partySize: 2,
      source: "admin",
      clientRequestId: "reservation-guest-linkage-001",
    },
  },
);

assert.equal(result.ok, true, "the approved reservation commits both writes");
assert.equal(result.guestId, GUEST_ID, "the shared commit boundary surfaces the created guest identity");
assert.equal(calls.length, 2, "guest creation precedes booking creation");

const [guestCall, bookingCall] = calls;
assert.equal(guestCall.body.name, GUEST_LABEL, "the guest service receives the safe human-readable label");
assert.equal(bookingCall.body.userId, GUEST_ID, "the booking service receives the server-created guest linkage");
assert.equal(bookingCall.body.clientRequestId, "reservation-guest-linkage-001", "the booking idempotency key remains stable");
assert.equal(bookingCall.headers.get("x-sonik-idempotency-key"), "reservation-guest-linkage-001");
assert.equal(bookingCall.headers.get("x-sonik-agent-principal-id"), HOST_PRINCIPAL_ID, "the trusted host actor remains an audit identity, not the booking subject");
assert.equal("guestName" in bookingCall.body, false, "the strict booking payload is not extended with an unsupported label field");
assert.equal("guestLabel" in bookingCall.body, false, "the strict booking payload is not extended with an unsupported label field");
assert.equal("name" in bookingCall.body, false, "the label remains on the guest record rather than the booking write");

assert.equal(
  reservationGuestLabel(persisted.bookings[0], persisted.guests),
  GUEST_LABEL,
  "a backend that persists the supplied userId resolves the reservation to the created guest label",
);
assert.equal(
  reservationGuestLabel({ ...persisted.bookings[0], userId: undefined }, persisted.guests),
  "No guest identity",
  "the reported symptom reproduces only when persistence drops the linkage after the Agent UI boundary",
);

console.log(JSON.stringify({ ok: true, checked: "reservation-guest-linkage", guestId: GUEST_ID, guestLabel: GUEST_LABEL }));
