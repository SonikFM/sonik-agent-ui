import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// A2 reservation-commit (2026-07-08): POST /api/reservation/commit is the ONLY path that commits a
// reservation (booking.create.guest -> booking.create.booking) now that the draft-only invariant
// (Slice A) removed every model-callable write tool. This test exercises the shared commit function
// against a stubbed booking runtime and source-pins the route's trust boundary, mirroring
// intake-commit-endpoint.test.mjs (the route module itself imports $env/$lib/./$types, which don't
// resolve under plain node, so the route is source-pinned rather than invoked).

const [reservationCommitModule, hostCommandRuntimeModule, bookingRuntimeTransportModule] = await Promise.all([
  import("../../apps/standalone-sveltekit/src/lib/server/booking-workflows/reservation-commit.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/host-command-runtime.ts"),
  import("../../apps/standalone-sveltekit/src/lib/server/booking-runtime-transport.ts"),
]);
const { commitBookingReservationCommand, extractCreatedGuestId } = reservationCommitModule;
const { approvedCommandIdsFromHostSession } = hostCommandRuntimeModule;
const { createServiceBindingFetcher } = bookingRuntimeTransportModule;

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_reservation_commit_test";
const SESSION_ID = "session_reservation_commit";
const CONTEXT_ID = "22222222-2222-4222-8222-222222222222";
const GUEST_ID = "guest_reservation_123";
const BOOKING_ID = "55555555-5555-4555-8555-555555555555";
const TOKEN = "reservation-commit-secret";

const hostSession = {
  source: "amplify-embedded",
  sessionId: SESSION_ID,
  userId: USER_ID,
  principalId: USER_ID,
  organizationId: ORG_ID,
  authenticated: true,
  scopes: ["booking:read", "booking:write"],
  metadata: { approvedCommandIds: ["booking.create.guest", "booking.create.booking"] },
};

const pageContext = {
  route: "/booking/contexts/ctx",
  surface: "booking-admin",
  pageType: "event-booking-detail",
  activeEntity: { type: "booking-context", id: CONTEXT_ID, label: "Summer Jazz Night" },
  commandFamilies: ["booking"],
  visibleActions: ["view-availability"],
};

function makeFetcher() {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method: init.method, body });
    if (String(url).endsWith("/api/v1/booking/guests") && init.method === "POST") {
      if (body?.name === "force-guest-500") return Response.json({ error: "forced" }, { status: 500 });
      assert.equal("contactConfirmed" in body, false, "guest approval-only contactConfirmed is stripped before booking.create.guest");
      return Response.json({ id: GUEST_ID, name: body?.name, email: body?.email }, { status: 201 });
    }
    if (String(url).endsWith("/api/v1/booking/bookings") && init.method === "POST") {
      return Response.json(
        { id: BOOKING_ID, organizationId: ORG_ID, contextId: body?.contextId, userId: body?.userId, partySize: body?.partySize, status: "booked", source: body?.source, clientRequestId: body?.clientRequestId },
        { status: 201 },
      );
    }
    return Response.json({ error: "unexpected", url: String(url) }, { status: 500 });
  };
  return { calls, fetcher };
}

function baseContext(fetcher, approvedCommandIds = ["booking.create.guest", "booking.create.booking"]) {
  return {
    sessionId: SESSION_ID,
    pageContext,
    hostSession,
    approvedCommandIds,
    bookingServiceBaseUrl: "https://booking.example.test",
    bookingRuntimeAuth: { mode: "bearer", token: TOKEN, source: "test" },
    bookingRuntimeFetcher: fetcher,
  };
}

const guest = { name: "Dan", email: "dan@sonik.com", contactConfirmed: true };
const booking = { contextId: CONTEXT_ID, startsAt: "2026-07-01T20:00:00.000Z", endsAt: "2026-07-01T20:10:00.000Z", partySize: 3, source: "admin", clientRequestId: "reservation-commit-demo-001" };

// 0. extractCreatedGuestId probes the common provider response shapes and rejects empties.
assert.equal(extractCreatedGuestId({ id: "g1" }), "g1", "extractCreatedGuestId reads the sonik guest `id`");
assert.equal(extractCreatedGuestId({ guestId: " g2 " }), "g2", "extractCreatedGuestId falls back to guestId and trims");
assert.equal(extractCreatedGuestId({ data: { userId: "g3" } }), "g3", "extractCreatedGuestId unwraps a data envelope");
assert.equal(extractCreatedGuestId({ name: "no id" }), null, "extractCreatedGuestId returns null when no id field is present");
assert.equal(extractCreatedGuestId(null), null, "extractCreatedGuestId tolerates a non-object summary");

// 0b. Service-binding fetcher delegates directly to the platform binding with the same input/init.
{
  const binding = {
    calls: [],
    async fetch(input, init) {
      this.calls.push({ input, init });
      return new Response("binding-ok", { status: 202 });
    },
  };
  const serviceBindingFetcher = createServiceBindingFetcher(binding);
  assert.equal(typeof serviceBindingFetcher, "function", "service binding fetcher is created when binding.fetch is available");
  const init = { method: "POST", body: "payload" };
  const response = await serviceBindingFetcher("https://booking.example.test/ping", init);
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "binding-ok");
  assert.deepEqual(binding.calls, [{ input: "https://booking.example.test/ping", init }]);
}

// 1. Happy path: guest then booking, guest id threaded into the booking userId server-side.
{
  const { calls, fetcher } = makeFetcher();
  const result = await commitBookingReservationCommand(baseContext(fetcher), { guest, booking });
  assert.equal(result.ok, true, "reservation commit succeeds when both writes succeed");
  assert.equal(result.kind, "reservation-commit");
  assert.equal(result.guestId, GUEST_ID, "the created guest id is surfaced on the result");
  assert.equal(result.steps.length, 2, "both write steps are recorded");
  assert.deepEqual(result.steps.map((s) => s.commandId), ["booking.create.guest", "booking.create.booking"]);
  const guestCall = calls.find((c) => c.url.endsWith("/guests"));
  const bookingCall = calls.find((c) => c.url.endsWith("/bookings"));
  assert.ok(guestCall && bookingCall, "both runtime endpoints are called in order");
  assert.equal(bookingCall.body.userId, GUEST_ID, "booking is created against the server-resolved guest id, not a client-supplied one");
  assert.equal(bookingCall.body.contextId, CONTEXT_ID);
  assert.equal(bookingCall.body.partySize, 3);
}

// 2. A client-supplied userId is discarded in favor of the freshly created guest id.
{
  const { calls, fetcher } = makeFetcher();
  const result = await commitBookingReservationCommand(baseContext(fetcher), { guest, booking: { ...booking, userId: "attacker_user_id" } });
  assert.equal(result.ok, true);
  const bookingCall = calls.find((c) => c.url.endsWith("/bookings"));
  assert.equal(bookingCall.body.userId, GUEST_ID, "the endpoint must not book against a client-injected userId");
}

// 3. Guest creation fails -> booking never runs.
{
  const { calls, fetcher } = makeFetcher();
  const result = await commitBookingReservationCommand(baseContext(fetcher), { guest: { name: "force-guest-500", email: "x@sonik.com", contactConfirmed: true }, booking });
  assert.equal(result.ok, false, "a failed guest create fails the whole reservation");
  assert.equal(result.error, "guest_create_failed");
  assert.equal(result.steps.length, 1, "only the guest step is recorded");
  assert.equal(calls.some((c) => c.url.endsWith("/bookings")), false, "booking runtime is never called when the guest create fails");
}

// 4. Guest created but no id in the response -> fail closed, no booking.
{
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method });
    if (String(url).endsWith("/api/v1/booking/guests")) return Response.json({ name: "Dan" }, { status: 201 });
    return Response.json({ error: "unexpected" }, { status: 500 });
  };
  const result = await commitBookingReservationCommand(baseContext(fetcher), { guest, booking });
  assert.equal(result.ok, false, "a guest response with no id fails closed");
  assert.equal(result.error, "missing_guest_id");
  assert.equal(calls.some((c) => c.url.endsWith("/bookings")), false, "no booking is attempted without a resolved guest id");
}

// 5. Without a host grant the write is policy-denied at the runtime (approval_required, not approved).
{
  const { fetcher } = makeFetcher();
  const result = await commitBookingReservationCommand(baseContext(fetcher, []), { guest, booking });
  assert.equal(result.ok, false, "an unapproved reservation commit is refused by command policy");
}


// 5b. Invalid guests are rejected before any runtime fetch is attempted.
for (const [label, invalidGuest, expectedField] of [
  ["missing contact", { name: "Dan", contactConfirmed: true }, "guest.email or guest.phone"],
  ["placeholder contact", { name: "Dan", email: "dan@example.test", phone: "555-555-5555", contactConfirmed: true }, "guest.email or guest.phone"],
  ["unconfirmed contact", { name: "Dan", email: "dan@sonik.com" }, "guest.contactConfirmed"],
  ["placeholder name", { name: "Guest", email: "dan@sonik.com", contactConfirmed: true }, "guest.name"],
]) {
  const { calls, fetcher } = makeFetcher();
  const result = await commitBookingReservationCommand(baseContext(fetcher), { guest: invalidGuest, booking });
  assert.equal(result.ok, false, `${label} fails commit validation`);
  assert.equal(result.error, "invalid_reservation_guest", `${label} returns typed validation error`);
  assert.deepEqual(result.steps, [], `${label} records no runtime write steps`);
  assert.ok(result.missingFields.includes(expectedField), `${label} reports ${expectedField}`);
  assert.equal(calls.length, 0, `${label} must produce zero runtime fetches`);
}

// 6. approvedCommandIdsFromHostSession is the only grant source for the endpoint.
assert.deepEqual(
  approvedCommandIdsFromHostSession(hostSession),
  ["booking.create.guest", "booking.create.booking"],
  "the reservation grant is resolved from the trusted host session",
);

// 7. Source-pin the route: it reuses the shared trust helpers, fails closed with a typed 401,
// requires guest/booking objects, strips a client userId, and delegates to the shared commit fn.
const routeSource = await readFile("apps/standalone-sveltekit/src/routes/api/reservation/commit/+server.ts", "utf8");
assert.ok(routeSource.includes("createAgentHostSessionEnvelope"), "route must reuse the shared trusted host-session resolver");
assert.ok(routeSource.includes("approvedCommandIdsFromHostSession"), "route must reuse the shared approved-command-grant resolver");
assert.ok(routeSource.includes("commitBookingReservationCommand"), "route must delegate to the shared reservation commit function");
assert.ok(routeSource.includes("createRequestBookingRuntimeFetcher"), "route must create a request-scoped booking runtime fetcher");
assert.ok(routeSource.includes("bookingRuntimeFetcher,"), "route must pass the booking runtime fetcher into the shared reservation commit function");
assert.ok(routeSource.includes('error: "unauthenticated"'), "route must return a typed error for the missing-trusted-session branch");
assert.ok(routeSource.includes("status: 401"), "route must fail closed with 401 when no trusted host session is present");
assert.ok(routeSource.includes("userId: _discardedUserId"), "route must strip a client-provided booking userId before committing");
assert.ok(routeSource.includes("AGENT_UI_HOST_CONTEXT_HEADER"), "route must read the same signed host-context header /api/generate reads");

console.log(JSON.stringify({ ok: true, checked: "reservation-commit-endpoint", guestId: GUEST_ID, bookingId: BOOKING_ID }));
