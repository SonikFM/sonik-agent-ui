const RESERVED_EXAMPLE_DOMAINS = new Set(["example.com", "example.org", "example.net"]);
const RESERVED_DOMAIN_TLDS = new Set(["test", "invalid", "example"]);

export interface ReservationGuestValidationResult {
  ok: boolean;
  missingFields: string[];
  reasons: string[];
}

export function validateReservationGuestForBooking(guest: Record<string, unknown>): ReservationGuestValidationResult {
  const missingFields: string[] = [];
  const reasons: string[] = [];
  const name = typeof guest.name === "string" ? guest.name.trim() : "";
  const email = typeof guest.email === "string" ? guest.email.trim() : "";
  const phone = typeof guest.phone === "string" ? guest.phone.trim() : "";

  if (!name || isPlaceholderGuestName(name)) {
    missingFields.push("guest.name");
    reasons.push(name ? "placeholder_guest_name" : "missing_guest_name");
  }
  if (guest.contactConfirmed !== true) {
    missingFields.push("guest.contactConfirmed");
    reasons.push("unconfirmed_guest_contact");
  }
  if (!isUsableReservationGuestEmail(email) && !isUsableReservationGuestPhone(phone)) {
    missingFields.push("guest.email or guest.phone");
    reasons.push("missing_usable_guest_contact");
  }

  return { ok: missingFields.length === 0, missingFields, reasons };
}

export function stripReservationGuestApprovalFields(guest: Record<string, unknown>): Record<string, unknown> {
  const { contactConfirmed: _discardedContactConfirmed, ...guestInput } = guest;
  return guestInput;
}

function isPlaceholderGuestName(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) return true;
  if (/^(guest|customer|user|test|fake|placeholder|unknown|anonymous|none|null|n\/?a)(\s*\d+)?$/.test(normalized)) return true;
  return /^(john|jane) doe$/.test(normalized);
}

function isUsableReservationGuestEmail(value: string): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at !== normalized.indexOf("@") || at === normalized.length - 1) return false;
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (!local || !domain.includes(".")) return false;
  if (/(^|[._+-])(example|fake|placeholder|unknown|test|noreply|no-reply)([._+-]|$)/.test(local)) return false;
  if (RESERVED_EXAMPLE_DOMAINS.has(domain)) return false;
  const labels = domain.split(".");
  const tld = labels[labels.length - 1] ?? "";
  if (RESERVED_DOMAIN_TLDS.has(tld)) return false;
  return !labels.some((label) => /^(example|fake|placeholder|unknown|test|invalid)$/.test(label));
}

function isUsableReservationGuestPhone(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return false;
  const nationalDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (/^(\d)\1+$/.test(nationalDigits)) return false;
  if (nationalDigits.includes("555")) return false;
  return !["1234567", "1234567890", "0123456789"].includes(nationalDigits);
}
