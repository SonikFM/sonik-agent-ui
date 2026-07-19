import { json, error, type RequestHandler } from "@sveltejs/kit";
import { createSignedTrustedHostContext, encodeTrustedHostContextHeader, type WorkspaceTrustedHostContext } from "$lib/server/workspace-services";
import { createSmokeHostAuthority } from "$lib/server/smoke-host-authority";

const FIXTURE_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const FIXTURE_USER_ID = "fixture-user-0001";
const SMOKE_GUEST_EMAIL = "agent-ui-smoke@example.test";
const SMOKE_GUEST_NAME = "Agent UI Smoke Guest";
const MAX_SMOKE_RUN_ID_LENGTH = 120;
const SMOKE_CONTEXT_NAME = "Agent UI Smoke Context";
const LOCAL_SMOKE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function readEnvString(env: Record<string, unknown> | null | undefined, key: string, { allowProcessEnv = false }: { allowProcessEnv?: boolean } = {}): string | null {
  const processValue = allowProcessEnv && typeof process !== "undefined" ? process.env?.[key] : undefined;
  const value = env?.[key] ?? processValue;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isLocalSmokeRequest(request: Request): boolean {
  try {
    return LOCAL_SMOKE_HOSTS.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

function cleanSmokeRunId(value: unknown): string {
  if (typeof value !== "string") return `fake-booking-host-${Date.now()}`;
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, "-").slice(0, MAX_SMOKE_RUN_ID_LENGTH);
  return cleaned || `fake-booking-host-${Date.now()}`;
}

type SmokeBookingContext = { id: string; label: string; kind?: string | null };
type SmokeBookingPrincipal = { id: string; label: string; email?: string | null };

function platformFetcher(platform: Parameters<RequestHandler>[0]["platform"]): typeof fetch {
  const binding = (platform?.env as Record<string, unknown> | undefined)?.BOOKING_SERVICE;
  if (binding && typeof binding === "object" && typeof (binding as { fetch?: unknown }).fetch === "function") {
    const bindingFetch = ((binding as { fetch: typeof fetch }).fetch).bind(binding);
    return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => bindingFetch(input, init)) as typeof fetch;
  }
  return fetch;
}

function bookingBaseUrl(env: Record<string, unknown> | null | undefined): string | null {
  return readEnvString(env, "SONIK_BOOKING_API_BASE_URL") ?? readEnvString(env, "BOOKING_SERVICE_BASE_URL");
}

function collectContextRecords(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectContextRecords(item, out);
    return out;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && (typeof record.name === "string" || typeof record.label === "string" || typeof record.title === "string" || typeof record.kind === "string")) out.push(record);
  for (const key of ["contexts", "items", "data", "results", "rows"]) collectContextRecords(record[key], out);
  return out;
}

function contextFromRecord(record: Record<string, unknown> | undefined): SmokeBookingContext | null {
  if (!record || typeof record.id !== "string" || !record.id.trim()) return null;
  const label = typeof record.name === "string" && record.name.trim()
    ? record.name.trim()
    : typeof record.label === "string" && record.label.trim()
      ? record.label.trim()
      : typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : record.id.trim();
  return { id: record.id.trim(), label, kind: typeof record.kind === "string" ? record.kind : null };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}


function collectPrincipalRecords(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectPrincipalRecords(item, out);
    return out;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string" && (typeof record.email === "string" || typeof record.name === "string" || typeof record.displayName === "string")) out.push(record);
  for (const key of ["user", "guest", "principal", "item", "data", "result", "results", "rows"]) collectPrincipalRecords(record[key], out);
  return out;
}

function principalFromRecord(record: Record<string, unknown> | undefined): SmokeBookingPrincipal | null {
  if (!record || typeof record.id !== "string" || !record.id.trim()) return null;
  const label = typeof record.name === "string" && record.name.trim()
    ? record.name.trim()
    : typeof record.displayName === "string" && record.displayName.trim()
      ? record.displayName.trim()
      : typeof record.email === "string" && record.email.trim()
        ? record.email.trim()
        : record.id.trim();
  return { id: record.id.trim(), label, email: typeof record.email === "string" ? record.email : null };
}

async function ensureSmokeBookingPrincipal(input: { platform: Parameters<RequestHandler>[0]["platform"]; env: Record<string, unknown> | null | undefined; signedHeader: string; smokeRunId: string }): Promise<{ principal: SmokeBookingPrincipal | null; warning?: string }> {
  const baseUrl = bookingBaseUrl(input.env);
  if (!baseUrl) return { principal: null, warning: "booking_base_url_missing" };
  const fetcher = platformFetcher(input.platform);
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "x-sonik-agent-ui-host-context": input.signedHeader,
    "x-sonik-request-id": `agent-ui-smoke-principal-${input.smokeRunId}`.slice(0, 160),
  };
  const createGuestUrl = new URL("/api/v1/booking/guests", baseUrl);
  const response = await fetcher(createGuestUrl, {
    headers,
    method: "POST",
    body: JSON.stringify({ name: SMOKE_GUEST_NAME, email: SMOKE_GUEST_EMAIL }),
  });
  const body = await readJsonResponse(response);
  if (!response.ok) return { principal: null, warning: `booking_principal_unavailable:${response.status}` };
  const principal = principalFromRecord(collectPrincipalRecords(body)[0] ?? (body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : undefined));
  return { principal, warning: principal ? undefined : "booking_principal_response_missing_id" };
}

async function ensureSmokeBookingContext(input: { platform: Parameters<RequestHandler>[0]["platform"]; env: Record<string, unknown> | null | undefined; signedHeader: string; smokeRunId: string }): Promise<{ context: SmokeBookingContext | null; warning?: string }> {
  const baseUrl = bookingBaseUrl(input.env);
  if (!baseUrl) return { context: null, warning: "booking_base_url_missing" };
  const fetcher = platformFetcher(input.platform);
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "x-sonik-agent-ui-host-context": input.signedHeader,
    "x-sonik-request-id": `agent-ui-smoke-context-${input.smokeRunId}`.slice(0, 160),
  };
  const listUrl = new URL("/api/v1/booking/contexts", baseUrl);
  const listed = await fetcher(listUrl, { headers, method: "GET" });
  const listedBody = await readJsonResponse(listed);
  if (listed.ok) {
    const records = collectContextRecords(listedBody);
    const preferred = records.find((entry) => entry.name === SMOKE_CONTEXT_NAME) ?? records[0];
    const context = contextFromRecord(preferred);
    if (context) return { context };
  }

  const createUrl = new URL("/api/v1/booking/contexts", baseUrl);
  const slug = `agent-ui-smoke-${input.smokeRunId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 48)}`.replace(/-+$/g, "") || `agent-ui-smoke-${Date.now()}`;
  const created = await fetcher(createUrl, {
    headers,
    method: "POST",
    body: JSON.stringify({ kind: "event", name: SMOKE_CONTEXT_NAME, timezone: "America/New_York", slug }),
  });
  const createdBody = await readJsonResponse(created);
  if (!created.ok) return { context: null, warning: `booking_context_unavailable:${listed.status}:${created.status}` };
  const context = contextFromRecord(collectContextRecords(createdBody)[0] ?? (createdBody && typeof createdBody === "object" && !Array.isArray(createdBody) ? createdBody as Record<string, unknown> : undefined));
  return { context, warning: context ? undefined : "booking_context_create_response_missing_id" };
}

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!isLocalSmokeRequest(request)) {
    throw error(404, "Smoke host context signer is local-dev only.");
  }

  const env = platform?.env as Record<string, unknown> | null | undefined;
  if (readEnvString(env, "SONIK_AGENT_UI_ENABLE_SMOKE_HOST_CONTEXT_SIGNER", { allowProcessEnv: true }) !== "true") {
    throw error(404, "Smoke host context signer is disabled.");
  }

  const secret = readEnvString(env, "SONIK_AGENT_UI_HOST_CONTEXT_SECRET", { allowProcessEnv: true });
  if (!secret) throw error(503, "SONIK_AGENT_UI_HOST_CONTEXT_SECRET is required to sign smoke host context.");

  const body = await request.json().catch(() => ({})) as { smokeRunId?: unknown };
  const smokeRunId = cleanSmokeRunId(body.smokeRunId);
  const approvedCommandIds = [
    "booking.create.context",
    "booking.create.guest",
    "booking.create.booking",
    "booking.create.hold",
    "booking.commit.hold",
    "booking.release.hold",
  ];
  const bootstrapHostSession = {
    source: "embedded-host",
    sessionId: `fixture-session-${smokeRunId}`,
    userId: FIXTURE_USER_ID,
    principalId: FIXTURE_USER_ID,
    organizationId: FIXTURE_ORGANIZATION_ID,
    authenticated: true,
    scopes: ["booking:read", "booking:write"],
    expiresAt: null,
    metadata: { approvedCommandIds },
  } satisfies NonNullable<WorkspaceTrustedHostContext["hostSession"]>;

  const bootstrapSigned = createSignedTrustedHostContext({
    secret,
    context: {
      authenticated: true,
      organizationId: FIXTURE_ORGANIZATION_ID,
      scopes: bootstrapHostSession.scopes,
      hostSession: bootstrapHostSession,
    },
  });
  const bookingPrincipalResult = await ensureSmokeBookingPrincipal({
    platform,
    env,
    signedHeader: encodeTrustedHostContextHeader(bootstrapSigned),
    smokeRunId,
  }).catch((bookingPrincipalError: unknown) => ({
    principal: null,
    warning: bookingPrincipalError instanceof Error ? bookingPrincipalError.message : String(bookingPrincipalError),
  }));
  const smokePrincipalId = bookingPrincipalResult.principal?.id ?? FIXTURE_USER_ID;
  const hostSession = {
    ...bootstrapHostSession,
    source: "amplify-login-proxy",
    userId: smokePrincipalId,
    principalId: null,
    metadata: { approvedCommandIds },
  } satisfies NonNullable<WorkspaceTrustedHostContext["hostSession"]>;

  const signed = createSignedTrustedHostContext({
    secret,
    context: {
      authenticated: true,
      organizationId: FIXTURE_ORGANIZATION_ID,
      scopes: hostSession.scopes,
      hostSession,
    },
  });
  const authority = createSmokeHostAuthority(signed);
  const signedHeader = authority.header;
  const bookingContextResult = await ensureSmokeBookingContext({
    platform,
    env,
    signedHeader,
    smokeRunId,
  }).catch((bookingContextError: unknown) => ({
    context: null,
    warning: bookingContextError instanceof Error ? bookingContextError.message : String(bookingContextError),
  }));

  const warnings = [bookingPrincipalResult.warning, bookingContextResult.warning].filter(Boolean);
  return json(
    {
      ok: true,
      context: signed,
      authority,
      bookingContext: bookingContextResult.context,
      bookingPrincipal: bookingPrincipalResult.principal,
      warning: warnings.length ? warnings.join(";") : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
};
