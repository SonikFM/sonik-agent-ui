# Booking host organization metadata handoff

Agent UI now surfaces organization display names only from valid HMAC-signed trusted-host-context envelope metadata (`hostSession.metadata.organizationName` or `organizationDisplayName`). Unsigned dev fixtures, server-local auth, and page context cannot supply or override it. If booking-service wants a friendly org label in chat context, include one of those metadata fields in the existing signed host-session envelope. Authorization remains `organizationId`-based.
