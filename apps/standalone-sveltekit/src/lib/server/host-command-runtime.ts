import bookingCommandArtifacts from "./generated/sonik-booking-command-artifacts.generated.json" with { type: "json" };
import {
  createCommandIndexContext,
  createAnonymousHostSessionEnvelope,
  createComposedCommandCatalog,
  createComposedCommandFamilyRegistry,
  createEmbeddedHostSessionEnvelope,
  createStandaloneCommandCatalog,
  createTrustedHostSessionEnvelope,
  filterEligibleHostCommandAdapters,
  platformAdapterContextFromHostSession,
  type HostCommandAdapter,
  type HostCommandRuntimeAdapter,
  type HostSessionEnvelope,
  type PlatformAdapterContext,
} from "@sonik-agent-ui/platform-adapters";
import {
  createStartupCommandIndex,
  createSurfaceCommandIndex,
  type AgentPageContext,
  type CommandCatalog,
  type CommandExecutionContext,
  type CommandFamilyRegistry,
  type CommandIndex,
  type CommandDescriptor,
  type CommandFamilyDefinition,
  type CommandIndexContext,
} from "@sonik-agent-ui/tool-contracts";

export const STANDALONE_HOST_PROVIDER = "standalone-demo-host";
export const STANDALONE_HOST_RUNTIME_PROVIDER = "standalone-demo-host-runtime";
export const STANDALONE_DEMO_ORG_ID = "standalone-demo-org";
export const STANDALONE_DEMO_BOOKING_READ_SCOPE = "booking:read";
export const STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID = "booking.demo.contexts.list";
export const STANDALONE_DEMO_BOOKING_WRITE_COMMAND_ID = "booking.demo.contexts.create";
export const GENERATED_BOOKING_PING_COMMAND_ID = "booking.ping";
export const GENERATED_BOOKING_LIST_CONTEXTS_COMMAND_ID = "booking.list.contexts";
export const GENERATED_BOOKING_TEMPLATES_COMMAND_ID = "booking.list.organizer.templates";
export const GENERATED_BOOKING_TEMPLATE_COMMAND_ID = "booking.get.organizer.template";
export const GENERATED_BOOKING_AVAILABILITY_COMMAND_ID = "booking.get.availability";
export const GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID = "booking.create.hold";
export const GENERATED_BOOKING_GET_HOLD_COMMAND_ID = "booking.get.hold";
export const GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID = "booking.release.hold";
export const GENERATED_BOOKING_RUNTIME_PROVIDER = "sonik-booking-openapi-runtime";
export const GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER = "sonik-booking-openapi-demo-runtime";

export type BookingRuntimeAuthMode = "anonymous" | "bearer" | "service-token" | "cookie";

export type BookingRuntimeAuthContext = {
  mode: BookingRuntimeAuthMode;
  token?: string | null;
  includeCredentials?: boolean;
  source?: "env" | "host" | "test";
};

const STANDALONE_BOOKING_COMMAND_FAMILY = {
  id: "booking",
  title: "Booking Contexts",
  description: "Sonik booking host commands for booking contexts.",
  aliases: [],
  source: "host" as const,
};

const GENERATED_BOOKING_READ_COMMAND_IDS = new Set([
  GENERATED_BOOKING_PING_COMMAND_ID,
  GENERATED_BOOKING_LIST_CONTEXTS_COMMAND_ID,
  GENERATED_BOOKING_TEMPLATES_COMMAND_ID,
  GENERATED_BOOKING_TEMPLATE_COMMAND_ID,
]);

const GENERATED_BOOKING_DEMO_READ_COMMAND_IDS = new Set([
  GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
  GENERATED_BOOKING_GET_HOLD_COMMAND_ID,
]);

const GENERATED_BOOKING_DEMO_WRITE_COMMAND_IDS = new Set([
  GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
  GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID,
]);

type GeneratedBookingReadInputPolicy = {
  pathParams: Set<string>;
  queryParams: Set<string>;
  queryEnums?: Record<string, Set<string>>;
};

const GENERATED_BOOKING_READ_INPUT_POLICIES: Record<string, GeneratedBookingReadInputPolicy> = {
  [GENERATED_BOOKING_PING_COMMAND_ID]: { pathParams: new Set(), queryParams: new Set() },
  [GENERATED_BOOKING_LIST_CONTEXTS_COMMAND_ID]: {
    pathParams: new Set(),
    queryParams: new Set(["kind"]),
    queryEnums: { kind: new Set(["event", "venue_schedule", "resource"]) },
  },
  [GENERATED_BOOKING_TEMPLATES_COMMAND_ID]: { pathParams: new Set(), queryParams: new Set() },
  [GENERATED_BOOKING_TEMPLATE_COMMAND_ID]: { pathParams: new Set(["slug"]), queryParams: new Set() },
  [GENERATED_BOOKING_AVAILABILITY_COMMAND_ID]: {
    pathParams: new Set(["contextId"]),
    queryParams: new Set(["from", "to", "partySize", "source", "resourceTypeId", "resourceUnitId"]),
    queryEnums: { source: new Set(["admin", "web", "mcp", "microsite"]) },
  },
  [GENERATED_BOOKING_GET_HOLD_COMMAND_ID]: { pathParams: new Set(["holdId"]), queryParams: new Set() },
};

type GeneratedBookingArtifacts = {
  catalog: CommandCatalog;
  registry: { families: CommandFamilyDefinition[] };
};

const generatedBookingArtifacts = bookingCommandArtifacts as GeneratedBookingArtifacts;

function isGeneratedMountedReadCommand(command: CommandDescriptor): boolean {
  return GENERATED_BOOKING_READ_COMMAND_IDS.has(command.id)
    && command.effect === "read"
    && command.metadata.sourceMounted === true
    && command.metadata.sourceRuntimeStatus === "mounted";
}

function generatedMountedBookingReadCommands(): CommandDescriptor[] {
  return generatedBookingArtifacts.catalog.commands
    .filter(isGeneratedMountedReadCommand)
    .map((command) => mountGeneratedBookingCommand(command, GENERATED_BOOKING_RUNTIME_PROVIDER));
}

function generatedTrustedDemoBookingReadCommands(): CommandDescriptor[] {
  return generatedBookingArtifacts.catalog.commands
    .filter((command) => GENERATED_BOOKING_DEMO_READ_COMMAND_IDS.has(command.id))
    .map((command) => mountGeneratedBookingCommand(command, GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER));
}

function generatedTrustedDemoBookingWriteCommands(): CommandDescriptor[] {
  return generatedBookingArtifacts.catalog.commands
    .filter((command) => GENERATED_BOOKING_DEMO_WRITE_COMMAND_IDS.has(command.id))
    .map((command) => mountGeneratedBookingCommand(command, GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER));
}

function mountGeneratedBookingCommand(command: CommandDescriptor, runtimeProvider: string): CommandDescriptor {
  return {
    ...command,
    transport: { ...command.transport, runtimeStatus: "mounted" },
    metadata: {
      ...command.metadata,
      liveExecution: true,
      runtimeAdapterProvider: runtimeProvider,
      mountedFromGeneratedDescriptor: true,
      descriptorRuntimeStatus: command.transport.runtimeStatus,
      trustedHostRuntimeAdapter: runtimeProvider === GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER,
    },
  };
}

function generatedMountedBookingFamilies(commands: CommandDescriptor[]): CommandFamilyDefinition[] {
  const familyIds = new Set(commands.map((command) => command.familyId));
  return generatedBookingArtifacts.registry.families.filter((family) => familyIds.has(family.id));
}

function createGeneratedBookingReadHostAdapter(): HostCommandAdapter {
  const commands = generatedMountedBookingReadCommands();
  return {
    provider: "sonik-booking-openapi-generated-host",
    families: generatedMountedBookingFamilies(commands),
    commands,
  };
}

function createGeneratedBookingDemoReadHostAdapter(): HostCommandAdapter {
  const commands = generatedTrustedDemoBookingReadCommands();
  return {
    provider: "sonik-booking-openapi-demo-read-host",
    isEligible: (context) => context.authenticated === true && Boolean(context.organizationId) && (context.scopes ?? []).includes(STANDALONE_DEMO_BOOKING_READ_SCOPE),
    families: generatedMountedBookingFamilies(commands),
    commands,
  };
}

function createGeneratedBookingDemoWriteHostAdapter(): HostCommandAdapter {
  const commands = generatedTrustedDemoBookingWriteCommands();
  return {
    provider: "sonik-booking-openapi-demo-write-host",
    isEligible: (context) => context.authenticated === true && Boolean(context.organizationId) && (context.scopes ?? []).includes("booking:write"),
    families: generatedMountedBookingFamilies(commands),
    commands,
  };
}

function createGeneratedBookingRuntimeAdapter(input: StandaloneHostRuntimeInput): HostCommandRuntimeAdapter {
  const baseUrl = normalizeBaseUrl(input.bookingServiceBaseUrl ?? readProcessEnv("SONIK_BOOKING_API_BASE_URL") ?? readProcessEnv("BOOKING_SERVICE_BASE_URL"));
  const fetcher: typeof fetch | undefined = input.fetcher ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
  const authContext = resolveBookingRuntimeAuthContext(input.bookingRuntimeAuth);
  const commands = generatedMountedBookingReadCommands();
  return {
    provider: GENERATED_BOOKING_RUNTIME_PROVIDER,
    bindings: commands.map((command) => ({
      commandId: command.id,
      status: baseUrl && fetcher && canExecuteGeneratedBookingRead(command, authContext) ? "mounted-read" : "unavailable",
      execute: baseUrl && fetcher && canExecuteGeneratedBookingRead(command, authContext) ? executeGeneratedOpenApiReadCommand(baseUrl, fetcher, authContext) : undefined,
    })),
  };
}

function createGeneratedBookingDemoRuntimeAdapter(input: StandaloneHostRuntimeInput): HostCommandRuntimeAdapter {
  const baseUrl = normalizeBaseUrl(input.bookingServiceBaseUrl ?? readProcessEnv("SONIK_BOOKING_API_BASE_URL") ?? readProcessEnv("BOOKING_SERVICE_BASE_URL"));
  const fetcher: typeof fetch | undefined = input.fetcher ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
  const authContext = resolveBookingRuntimeAuthContext(input.bookingRuntimeAuth);
  const canExecute = Boolean(baseUrl && fetcher && hasBookingRuntimeCredential(authContext));
  return {
    provider: GENERATED_BOOKING_DEMO_RUNTIME_PROVIDER,
    bindings: [
      {
        commandId: GENERATED_BOOKING_AVAILABILITY_COMMAND_ID,
        status: canExecute ? "mounted-read" : "unavailable",
        execute: canExecute ? executeGeneratedOpenApiReadCommand(baseUrl!, fetcher!, authContext) : undefined,
      },
      {
        commandId: GENERATED_BOOKING_GET_HOLD_COMMAND_ID,
        status: canExecute ? "mounted-read" : "unavailable",
        execute: canExecute ? executeGeneratedOpenApiReadCommand(baseUrl!, fetcher!, authContext) : undefined,
      },
      {
        commandId: GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID,
        status: canExecute ? "mounted-write" : "unavailable",
        commit: canExecute ? executeGeneratedOpenApiWriteCommand(baseUrl!, fetcher!, authContext) : undefined,
      },
      {
        commandId: GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID,
        status: canExecute ? "mounted-write" : "unavailable",
        commit: canExecute ? executeGeneratedOpenApiWriteCommand(baseUrl!, fetcher!, authContext) : undefined,
      },
    ],
  };
}

function canExecuteGeneratedBookingRead(command: CommandDescriptor, authContext: BookingRuntimeAuthContext): boolean {
  if (command.auth.required !== true && command.auth.orgScoped !== true) return true;
  return hasBookingRuntimeCredential(authContext);
}

function executeGeneratedOpenApiReadCommand(baseUrl: string, fetcher: typeof fetch, authContext: BookingRuntimeAuthContext) {
  return async (input: unknown, context: { command: CommandDescriptor; execution: CommandExecutionContext }) => {
    const method = context.command.transport.method ?? "GET";
    if (method.toUpperCase() !== "GET") {
      throw new Error(`Generated booking runtime only supports read GET commands, received ${method}`);
    }
    const record = isRecord(input) ? input : {};
    const inputPolicy = GENERATED_BOOKING_READ_INPUT_POLICIES[context.command.id];
    if (!inputPolicy) throw new Error(`Generated booking runtime has no input policy for ${context.command.id}`);
    const url = buildOpenApiReadUrl(baseUrl, context.command.transport.path ?? "/", record, inputPolicy);
    const headers = createGeneratedBookingRuntimeHeaders(authContext, context.execution);
    const response = await fetcher(url, {
      method: "GET",
      headers,
      credentials: authContext.includeCredentials === true ? "include" : "same-origin",
    });
    const contentType = response.headers.get("content-type") ?? "";
    const rawBody = contentType.includes("application/json") ? await response.json() : await response.text();
    const body = redactGeneratedBookingRuntimeBody(rawBody, authContext);
    const credentialed = hasBookingRuntimeCredential(authContext);
    return {
      summary: {
        ok: response.ok,
        status: response.status,
        commandId: context.command.id,
        method,
        path: context.command.transport.path,
        url: redactUrlForReceipt(url),
        authMode: authContext.mode,
        credentialed,
        body,
      },
      nextActions: response.ok ? ["learnCommand"] : ["learnCommand", "checkBookingRuntimeConfiguration"],
    };
  };
}

function executeGeneratedOpenApiWriteCommand(baseUrl: string, fetcher: typeof fetch, authContext: BookingRuntimeAuthContext) {
  return async (input: unknown, context: { command: CommandDescriptor; execution: CommandExecutionContext }) => {
    const method = context.command.transport.method ?? "POST";
    if (method.toUpperCase() !== "POST") {
      throw new Error(`Generated booking demo write runtime only supports POST commands, received ${method}`);
    }
    const record = isRecord(input) ? input : {};
    const request = buildOpenApiWriteRequest(baseUrl, context.command, record, context.execution);
    const headers = {
      ...createGeneratedBookingRuntimeHeaders(authContext, context.execution),
      "content-type": "application/json",
      "x-sonik-idempotency-key": safeHeaderValue(request.idempotencyKey, 180),
    };
    const response = await fetcher(request.url, {
      method: "POST",
      headers,
      credentials: authContext.includeCredentials === true ? "include" : "same-origin",
      body: JSON.stringify(request.body),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const rawBody = contentType.includes("application/json") ? await response.json() : await response.text();
    const body = redactGeneratedBookingRuntimeBody(rawBody, authContext);
    return {
      summary: {
        ok: response.ok,
        status: response.status,
        commandId: context.command.id,
        method,
        path: context.command.transport.path,
        url: redactUrlForReceipt(request.url),
        authMode: authContext.mode,
        credentialed: hasBookingRuntimeCredential(authContext),
        receipt: createGeneratedBookingWriteReceipt(context.command.id, context.execution, request, body),
        body,
      },
      nextActions: response.ok ? request.nextActions : ["learnCommand", "checkBookingRuntimeConfiguration"],
    };
  };
}

type GeneratedBookingWriteRequest = {
  url: string;
  body: Record<string, unknown>;
  idempotencyKey: string;
  nextActions: string[];
};

function buildOpenApiWriteRequest(baseUrl: string, command: CommandDescriptor, input: Record<string, unknown>, execution: CommandExecutionContext): GeneratedBookingWriteRequest {
  if (command.id === GENERATED_BOOKING_CREATE_HOLD_COMMAND_ID) {
    const body = normalizeCreateHoldInput(input, execution);
    const url = new URL((command.transport.path ?? "/").replace(/^\//, ""), `${baseUrl}/`).toString();
    return {
      url,
      body,
      idempotencyKey: String(body.clientRequestId),
      nextActions: ["executeCommand", GENERATED_BOOKING_GET_HOLD_COMMAND_ID, GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID],
    };
  }

  if (command.id === GENERATED_BOOKING_RELEASE_HOLD_COMMAND_ID) {
    const holdId = validateGeneratedBookingUuidParam("holdId", input.holdId);
    const path = (command.transport.path ?? "/").replace("{holdId}", encodeURIComponent(holdId));
    const url = new URL(path.replace(/^\//, ""), `${baseUrl}/`).toString();
    const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 240) : "agent-ui-v0.2-demo-cleanup";
    return {
      url,
      body: { reason },
      idempotencyKey: safeHeaderValue(`${execution.requestId ?? `agent-ui-${Date.now()}`}:release:${holdId}`, 180),
      nextActions: ["executeCommand", GENERATED_BOOKING_GET_HOLD_COMMAND_ID],
    };
  }

  throw new Error(`Unsupported generated booking write command: ${command.id}`);
}

function normalizeCreateHoldInput(input: Record<string, unknown>, execution: CommandExecutionContext): Record<string, unknown> {
  const contextId = validateGeneratedBookingUuidParam("contextId", input.contextId);
  const window = normalizeBookingWindow(input.window);
  const partySize = normalizeInteger(input.partySize ?? 2, "partySize", 1, 500);
  const source = normalizeBookingSource(input.source ?? "admin");
  const ttlSeconds = normalizeInteger(input.ttlSeconds ?? 600, "ttlSeconds", 60, 86_400);
  const resourceUnitId = optionalGeneratedBookingUuidParam("resourceUnitId", input.resourceUnitId);
  const resourceCombinationId = optionalGeneratedBookingUuidParam("resourceCombinationId", input.resourceCombinationId);
  if (resourceUnitId && resourceCombinationId) throw new Error("resourceUnitId and resourceCombinationId are mutually exclusive");
  if (!resourceUnitId && !resourceCombinationId) throw new Error("missing-resource-target: resourceUnitId or resourceCombinationId is required for mounted holds");
  const clientRequestId = normalizeClientRequestId(input.clientRequestId, execution.requestId);
  const body: Record<string, unknown> = {
    contextId,
    window,
    partySize,
    source,
    clientRequestId,
    ttlSeconds,
    metadata: normalizeMetadata(input.metadata, execution),
  };
  const trustedUserId = optionalBoundedString(execution.principalId, "execution.principalId", 128);
  const requestedUserId = optionalBoundedString(input.userId, "userId", 128);
  if (requestedUserId && trustedUserId && requestedUserId !== trustedUserId) throw new Error("trusted-principal-mismatch: userId must match the trusted host principal");
  if (requestedUserId && !trustedUserId) throw new Error("trusted-principal-required: userId cannot be supplied without a trusted host principal");
  const customerId = optionalGeneratedBookingUuidParam("customerId", input.customerId);
  if (trustedUserId) body.userId = trustedUserId;
  if (customerId) body.customerId = customerId;
  if (resourceUnitId) body.resourceUnitId = resourceUnitId;
  if (resourceCombinationId) body.resourceCombinationId = resourceCombinationId;
  return body;
}

function createGeneratedBookingWriteReceipt(commandId: string, execution: CommandExecutionContext, request: GeneratedBookingWriteRequest, responseBody: unknown): Record<string, unknown> {
  const body = isRecord(responseBody) ? responseBody : {};
  return {
    commandId,
    requestId: execution.requestId ?? null,
    organizationId: execution.organizationId ?? null,
    sessionId: execution.sessionId ?? null,
    principalId: execution.principalId ?? null,
    idempotencyKey: request.idempotencyKey,
    confirmation: pickConfirmationFields(body),
  };
}

function pickConfirmationFields(body: Record<string, unknown>): Record<string, unknown> {
  const confirmation: Record<string, unknown> = {};
  for (const key of ["id", "organizationId", "contextId", "partySize", "status", "expiresAt", "resourceUnitId", "resourceCombinationId"]) {
    if (body[key] !== undefined) confirmation[key] = body[key];
  }
  if (isRecord(body.window)) confirmation.window = { startsAt: body.window.startsAt, endsAt: body.window.endsAt };
  return confirmation;
}

function normalizeBookingWindow(value: unknown): { startsAt: string; endsAt: string } {
  if (!isRecord(value)) throw new Error("window is required");
  const startsAt = validateIsoDateString("window.startsAt", value.startsAt);
  const endsAt = validateIsoDateString("window.endsAt", value.endsAt);
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw new Error("window.endsAt must be after window.startsAt");
  return { startsAt, endsAt };
}

function validateIsoDateString(key: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required`);
  const normalized = value.trim();
  const time = new Date(normalized).getTime();
  if (!Number.isFinite(time)) throw new Error(`${key} must be an ISO date-time string`);
  return normalized;
}

function normalizeInteger(value: unknown, key: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer from ${min} to ${max}`);
  return value;
}

function normalizeBookingSource(value: unknown): "admin" | "web" | "mcp" | "microsite" {
  if (value === "admin" || value === "web" || value === "mcp" || value === "microsite") return value;
  throw new Error("source must be admin, web, mcp, or microsite");
}

function normalizeClientRequestId(value: unknown, requestId: string | undefined): string {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : `agent-ui-v02-demo-hold-${requestId ?? Date.now()}`;
  return safeHeaderValue(candidate, 180);
}

function normalizeMetadata(value: unknown, execution: CommandExecutionContext): Record<string, unknown> {
  const metadata = isRecord(value) ? redactSecretValue(value, []) as Record<string, unknown> : {};
  return {
    ...metadata,
    createdBy: "sonik-agent-ui-v0.2-demo",
    agentRequestId: execution.requestId ?? null,
  };
}

function optionalBoundedString(value: unknown, key: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new Error(`${key} is too long`);
  return normalized;
}

function optionalGeneratedBookingUuidParam(key: string, value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return validateGeneratedBookingUuidParam(key, value);
}

function validateGeneratedBookingUuidParam(key: string, value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) {
    throw new Error(`${key} must be a UUID`);
  }
  return value.trim();
}

function createGeneratedBookingRuntimeHeaders(authContext: BookingRuntimeAuthContext, execution: CommandExecutionContext): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-sonik-request-id": safeHeaderValue(execution.requestId ?? `agent-ui-${Date.now()}`, 160),
    "x-sonik-agent-host-source": safeHeaderValue(execution.hostSessionSource ?? "agent-ui", 80),
  };
  if (execution.organizationId) headers["x-sonik-agent-org-id"] = safeHeaderValue(execution.organizationId, 160);
  if (execution.sessionId) headers["x-sonik-agent-session-id"] = safeHeaderValue(execution.sessionId, 160);
  if (execution.principalId) headers["x-sonik-agent-principal-id"] = safeHeaderValue(execution.principalId, 160);
  const token = safeSecretHeaderValue(authContext.token);
  if (token && authContext.mode === "bearer") headers.authorization = `Bearer ${token}`;
  if (token && authContext.mode === "service-token") headers["x-sonik-service-token"] = token;
  return headers;
}

function redactGeneratedBookingRuntimeBody(value: unknown, authContext: BookingRuntimeAuthContext): unknown {
  const token = safeSecretHeaderValue(authContext.token);
  return redactSecretValue(value, token ? [token, `Bearer ${token}`] : []);
}

function redactSecretValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return secrets.reduce((current, secret) => current.split(secret).join("[redacted]"), value);
  if (Array.isArray(value)) return value.map((entry) => redactSecretValue(entry, secrets));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    isSecretLikeKey(key) ? "[redacted]" : redactSecretValue(entry, secrets),
  ]));
}

function isSecretLikeKey(key: string): boolean {
  return /(authorization|api[-_]?key|token|secret|password|cookie|set-cookie|credential)/i.test(key);
}

function safeHeaderValue(value: string, maxLength: number): string {
  return value.replace(/[\r\n]/g, "").slice(0, maxLength);
}

function safeSecretHeaderValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/[\r\n]/g, "");
  if (!trimmed || trimmed.length > 4096) return null;
  return trimmed;
}

function buildOpenApiReadUrl(baseUrl: string, path: string, input: Record<string, unknown>, inputPolicy: GeneratedBookingReadInputPolicy): string {
  const allowedKeys = new Set([...inputPolicy.pathParams, ...inputPolicy.queryParams]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key)) throw new Error(`Unsupported generated booking parameter: ${key}`);
  }
  const usedKeys = new Set<string>();
  const expandedPath = path.replace(/\{([^}]+)\}/g, (_match, key) => {
    usedKeys.add(key);
    if (!inputPolicy.pathParams.has(key)) throw new Error(`Unsupported path parameter: ${key}`);
    const value = input[key];
    if (typeof value !== "string" && typeof value !== "number") throw new Error(`Missing path parameter: ${key}`);
    const normalized = validateGeneratedBookingStringParam(key, value);
    return encodeURIComponent(normalized);
  });
  const url = new URL(expandedPath.replace(/^\//, ""), `${baseUrl}/`);
  for (const [key, value] of Object.entries(input)) {
    if (usedKeys.has(key) || value === undefined || value === null) continue;
    if (!inputPolicy.queryParams.has(key)) throw new Error(`Unsupported generated booking query parameter: ${key}`);
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") throw new Error(`Invalid generated booking query parameter: ${key}`);
    const normalized = validateGeneratedBookingStringParam(key, value);
    const allowedValues = inputPolicy.queryEnums?.[key];
    if (allowedValues && !allowedValues.has(normalized)) throw new Error(`Unsupported generated booking query value for ${key}`);
    url.searchParams.set(key, normalized);
  }
  return url.toString();
}

function validateGeneratedBookingStringParam(key: string, value: string | number | boolean): string {
  const normalized = String(value);
  if (normalized.length === 0) throw new Error(`Empty generated booking parameter: ${key}`);
  if (normalized.length > 120) throw new Error(`Generated booking parameter is too long: ${key}`);
  if (!/^[a-zA-Z0-9_.:-]+$/.test(normalized)) throw new Error(`Generated booking parameter contains unsupported characters: ${key}`);
  return normalized;
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function readProcessEnv(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function redactUrlForReceipt(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type StandaloneHostSessionMode = "anonymous" | "standalone-demo" | "amplify-embedded";

export type StandaloneHostRuntimeInput = PlatformAdapterContext & {
  hostSession?: HostSessionEnvelope | null;
  hostSessionMode?: StandaloneHostSessionMode;
  hostCommandAdapters?: HostCommandAdapter[];
  hostRuntimeAdapters?: HostCommandRuntimeAdapter[];
  pageContext?: AgentPageContext;
  indexContext?: CommandIndexContext;
  indexLimit?: number;
  bookingServiceBaseUrl?: string | null;
  bookingRuntimeAuth?: BookingRuntimeAuthContext | null;
  fetcher?: typeof fetch;
};

export function createBookingRuntimeAuthContextFromEnv(envLike: Record<string, string | undefined> = {}): BookingRuntimeAuthContext {
  const includeCredentials = truthyEnv(envLike.SONIK_BOOKING_INCLUDE_CREDENTIALS ?? envLike.BOOKING_SERVICE_INCLUDE_CREDENTIALS);
  const token = safeSecretHeaderValue(envLike.SONIK_BOOKING_API_BEARER_TOKEN ?? envLike.SONIK_BOOKING_API_TOKEN ?? envLike.BOOKING_SERVICE_API_TOKEN);
  const requestedMode = normalizeBookingRuntimeAuthMode(envLike.SONIK_BOOKING_AUTH_MODE ?? envLike.BOOKING_SERVICE_AUTH_MODE);
  const mode = requestedMode ?? (token ? "bearer" : includeCredentials ? "cookie" : "anonymous");
  return {
    mode,
    token: mode === "bearer" || mode === "service-token" ? token : null,
    includeCredentials: includeCredentials || mode === "cookie",
    source: "env",
  };
}

export function hasBookingRuntimeCredential(authContext: BookingRuntimeAuthContext | null | undefined): boolean {
  if (!authContext) return false;
  const mode = normalizeBookingRuntimeAuthMode(authContext.mode) ?? "anonymous";
  if (mode !== "bearer" && mode !== "service-token") return false;
  return Boolean(safeSecretHeaderValue(authContext.token));
}

function resolveBookingRuntimeAuthContext(input: BookingRuntimeAuthContext | null | undefined): BookingRuntimeAuthContext {
  if (!input) return createBookingRuntimeAuthContextFromEnv({
    SONIK_BOOKING_AUTH_MODE: readProcessEnv("SONIK_BOOKING_AUTH_MODE"),
    BOOKING_SERVICE_AUTH_MODE: readProcessEnv("BOOKING_SERVICE_AUTH_MODE"),
    SONIK_BOOKING_INCLUDE_CREDENTIALS: readProcessEnv("SONIK_BOOKING_INCLUDE_CREDENTIALS"),
    BOOKING_SERVICE_INCLUDE_CREDENTIALS: readProcessEnv("BOOKING_SERVICE_INCLUDE_CREDENTIALS"),
    SONIK_BOOKING_API_BEARER_TOKEN: readProcessEnv("SONIK_BOOKING_API_BEARER_TOKEN"),
    SONIK_BOOKING_API_TOKEN: readProcessEnv("SONIK_BOOKING_API_TOKEN"),
    BOOKING_SERVICE_API_TOKEN: readProcessEnv("BOOKING_SERVICE_API_TOKEN"),
  });
  const mode = normalizeBookingRuntimeAuthMode(input.mode) ?? "anonymous";
  const token = safeSecretHeaderValue(input.token);
  return {
    mode,
    token: mode === "bearer" || mode === "service-token" ? token : null,
    includeCredentials: input.includeCredentials === true || mode === "cookie",
    source: input.source ?? "host",
  };
}

function normalizeBookingRuntimeAuthMode(value: string | null | undefined): BookingRuntimeAuthMode | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "bearer" || normalized === "service-token" || normalized === "cookie" || normalized === "anonymous") return normalized;
  return null;
}

function truthyEnv(value: string | null | undefined): boolean {
  return /^(1|true|yes|include)$/i.test(value ?? "");
}

const bookingReadHostAdapter: HostCommandAdapter = {
  provider: STANDALONE_HOST_PROVIDER,
  isEligible: (context) => context.authenticated === true && Boolean(context.organizationId) && (context.scopes ?? []).includes(STANDALONE_DEMO_BOOKING_READ_SCOPE),
  families: [STANDALONE_BOOKING_COMMAND_FAMILY],
  commands: [
    {
      id: STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID,
      title: "List demo booking contexts",
      description: "Fixture-backed read-only booking context list used to verify host ORPC command runtime binding.",
      familyId: "booking",
      source: "orpc",
      effect: "read",
      approval: "none",
      shape: "record",
      loadPolicy: { mode: "surface-eager", priority: 80, profile: "standalone-demo-host" },
      contextHints: {
        routes: ["/booking", "/workspace"],
        surfaces: ["booking-console", "artifact", "workspace"],
        pageTypes: ["booking"],
        artifactTypes: [],
        skillFamilies: ["booking-ops"],
        commandFamilies: ["booking"],
        requiredScopes: [STANDALONE_DEMO_BOOKING_READ_SCOPE],
      },
      capabilities: ["booking", "context", "read", "demo-host"],
      searchTerms: ["booking", "contexts", "reservations", "host", "orpc", "demo"],
      examples: [{ title: "List booking contexts", input: { limit: 3 } }],
      input: {
        kind: "json-schema",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: { limit: { type: "number", minimum: 1, maximum: 10 } },
        },
      },
      inputSchemaJson: {
        type: "object",
        additionalProperties: false,
        properties: { limit: { type: "number", minimum: 1, maximum: 10 } },
      },
      output: {
        summary: "Returns fixture booking context records with runtime trace metadata.",
        schema: { kind: "json-schema", schema: { type: "object" } },
        resources: [],
      },
      auth: { required: true, orgScoped: true, scopes: [STANDALONE_DEMO_BOOKING_READ_SCOPE] },
      policy: { tags: ["orpc", "read", "booking", "demo-host"], hostProfiles: ["standalone-demo"], readOnly: true, proofTier: "fixture" },
      transport: { procedure: "booking.contexts.list", runtimeStatus: "mounted" },
      surfaces: ["chat", "artifact"],
      uiTargets: ["chat", "artifact"],
      metadata: {
        familyId: "booking",
        loadPolicy: { mode: "surface-eager", priority: 80, profile: "standalone-demo-host" },
        contextHints: {
          routes: ["/booking", "/workspace"],
          surfaces: ["booking-console", "artifact", "workspace"],
          pageTypes: ["booking"],
          skillFamilies: ["booking-ops"],
          commandFamilies: ["booking"],
          requiredScopes: [STANDALONE_DEMO_BOOKING_READ_SCOPE],
        },
        liveExecution: true,
        runtimeAdapterProvider: STANDALONE_HOST_RUNTIME_PROVIDER,
        fixtureOnly: true,
      },
    },
  ],
};

const bookingWriteHostAdapter: HostCommandAdapter = {
  provider: STANDALONE_HOST_PROVIDER,
  isEligible: (context) => context.authenticated === true && Boolean(context.organizationId) && (context.scopes ?? []).includes("booking:write"),
  families: [STANDALONE_BOOKING_COMMAND_FAMILY],
  commands: [
    {
      id: STANDALONE_DEMO_BOOKING_WRITE_COMMAND_ID,
      title: "Create demo booking context",
      description: "Fixture write descriptor that stays non-executable until a trusted host commit adapter is added.",
      familyId: "booking",
      source: "orpc",
      effect: "write",
      approval: "required",
      shape: "catalog",
      loadPolicy: { mode: "lazy", priority: 5, profile: "standalone-demo-host-shadow" },
      contextHints: {
        routes: ["/booking"],
        surfaces: ["booking-console"],
        pageTypes: ["booking"],
        artifactTypes: [],
        skillFamilies: ["booking-ops"],
        commandFamilies: ["booking"],
        requiredScopes: ["booking:write"],
      },
      capabilities: ["booking", "context", "write", "demo-host"],
      searchTerms: ["booking", "contexts", "create", "write", "host", "orpc", "demo"],
      examples: [{ title: "Create booking context", input: { name: "VIP Room" } }],
      input: { kind: "json-schema", schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
      inputSchemaJson: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      output: { summary: "Would create a booking context after trusted host approval.", schema: { kind: "json-schema", schema: { type: "object" } }, resources: [] },
      auth: { required: true, orgScoped: true, scopes: ["booking:write"] },
      policy: { tags: ["orpc", "write", "booking", "demo-host"], hostProfiles: ["standalone-demo"], readOnly: false, proofTier: "fixture" },
      transport: { procedure: "booking.contexts.create", runtimeStatus: "shadow" },
      surfaces: ["chat"],
      uiTargets: ["chat"],
      metadata: {
        familyId: "booking",
        loadPolicy: { mode: "lazy", priority: 5, profile: "standalone-demo-host-shadow" },
        contextHints: {
          routes: ["/booking"],
          surfaces: ["booking-console"],
          pageTypes: ["booking"],
          skillFamilies: ["booking-ops"],
          commandFamilies: ["booking"],
          requiredScopes: ["booking:write"],
        },
        liveExecution: false,
        fixtureOnly: true,
      },
    },
  ],
};

const bookingRuntimeAdapter: HostCommandRuntimeAdapter = {
  provider: STANDALONE_HOST_RUNTIME_PROVIDER,
  bindings: [{
    commandId: STANDALONE_DEMO_BOOKING_CONTEXTS_COMMAND_ID,
    status: "mounted-read",
    execute: (input, context) => {
      const record = typeof input === "object" && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {};
      const rawLimit = typeof record.limit === "number" ? Math.floor(record.limit) : 3;
      const limit = Math.max(1, Math.min(rawLimit, 10));
      const contexts = [
        { id: "ctx-main-room", name: "Main Room", status: "active", capacity: 120 },
        { id: "ctx-rooftop", name: "Rooftop", status: "active", capacity: 80 },
        { id: "ctx-private-dining", name: "Private Dining", status: "paused", capacity: 24 },
      ].slice(0, limit);
      return {
        summary: {
          contexts,
          count: contexts.length,
          fixtureOnly: true,
          procedure: context.command.transport.procedure,
          organizationId: context.execution.organizationId ?? null,
          sessionId: context.execution.sessionId ?? null,
        },
        nextActions: ["learnCommand"],
      };
    },
  }],
};

export function createStandaloneHostCommandAdapters(): HostCommandAdapter[] {
  return [createGeneratedBookingReadHostAdapter(), createGeneratedBookingDemoReadHostAdapter(), createGeneratedBookingDemoWriteHostAdapter(), bookingReadHostAdapter, bookingWriteHostAdapter];
}

export function createStandaloneHostRuntimeAdapters(input: StandaloneHostRuntimeInput = {}): HostCommandRuntimeAdapter[] {
  return [createGeneratedBookingRuntimeAdapter(input), createGeneratedBookingDemoRuntimeAdapter(input), bookingRuntimeAdapter];
}

export function createStandaloneDemoHostSession(input: PlatformAdapterContext = {}): HostSessionEnvelope {
  return createTrustedHostSessionEnvelope({
    source: "standalone-demo",
    sessionId: input.sessionId ?? null,
    organizationId: input.organizationId ?? STANDALONE_DEMO_ORG_ID,
    scopes: input.scopes ?? [STANDALONE_DEMO_BOOKING_READ_SCOPE],
    metadata: { fixtureOnly: true },
  });
}

export function resolveStandaloneHostSession(input: StandaloneHostRuntimeInput = {}): HostSessionEnvelope {
  if ("hostSession" in input) return input.hostSession ?? createAnonymousHostSessionEnvelope({ sessionId: input.sessionId });
  if (input.hostSessionMode === "standalone-demo") return createStandaloneDemoHostSession(input);
  if (input.hostSessionMode === "amplify-embedded") {
    return createEmbeddedHostSessionEnvelope({
      source: "amplify-embedded",
      sessionId: input.sessionId,
      organizationId: input.organizationId,
      authenticated: input.authenticated,
      scopes: input.scopes,
      metadata: { authAuthority: "server-resolved-amplify-context" },
    });
  }
  return createAnonymousHostSessionEnvelope({ sessionId: input.sessionId });
}

export function createStandaloneHostTrustedContext(input: StandaloneHostRuntimeInput = {}): Required<Pick<PlatformAdapterContext, "authenticated" | "organizationId" | "scopes">> & Pick<PlatformAdapterContext, "sessionId"> {
  const context = platformAdapterContextFromHostSession(resolveStandaloneHostSession(input));
  return {
    sessionId: context.sessionId ?? null,
    authenticated: context.authenticated === true,
    organizationId: context.organizationId ?? null,
    scopes: context.scopes ?? [],
  };
}

export function createStandaloneHostCommandCatalog(input: StandaloneHostRuntimeInput = {}, generatedAt = new Date().toISOString()): CommandCatalog {
  const trusted = createStandaloneHostTrustedContext(input);
  const hostAdapters = filterEligibleHostCommandAdapters(resolveStandaloneHostCommandAdapters(input), trusted);
  return createComposedCommandCatalog(
    STANDALONE_HOST_PROVIDER,
    createStandaloneCommandCatalog(trusted, generatedAt),
    hostAdapters,
    generatedAt,
  );
}

export function createStandaloneHostCommandFamilyRegistry(generatedAt = new Date().toISOString()): CommandFamilyRegistry {
  return createStandaloneHostCommandFamilyRegistryForAdapters(createStandaloneHostCommandAdapters(), generatedAt);
}

function createStandaloneHostCommandFamilyRegistryForAdapters(adapters: HostCommandAdapter[], generatedAt = new Date().toISOString()): CommandFamilyRegistry {
  const seenFamilies = new Map<string, NonNullable<HostCommandAdapter["families"]>[number]>();
  return createComposedCommandFamilyRegistry(STANDALONE_HOST_PROVIDER, adapters.map((adapter) => ({
    ...adapter,
    families: (adapter.families ?? []).filter((family) => {
      const existing = seenFamilies.get(family.id);
      if (!existing) {
        seenFamilies.set(family.id, family);
        return true;
      }
      if (canonicalCommandFamily(existing) !== canonicalCommandFamily(family)) {
        throw new Error(`Conflicting command family id in host adapter composition: ${family.id}`);
      }
      return false;
    }),
  })), generatedAt);
}

function canonicalCommandFamily(family: NonNullable<HostCommandAdapter["families"]>[number]): string {
  return JSON.stringify({
    id: family.id,
    title: family.title,
    description: family.description ?? null,
    parentId: family.parentId ?? null,
    aliases: [...(family.aliases ?? [])].sort(),
    source: family.source,
  });
}

function resolveStandaloneHostCommandAdapters(input: StandaloneHostRuntimeInput): HostCommandAdapter[] {
  return input.hostCommandAdapters ?? createStandaloneHostCommandAdapters();
}

function resolveStandaloneHostRuntimeAdapters(input: StandaloneHostRuntimeInput): HostCommandRuntimeAdapter[] {
  return input.hostRuntimeAdapters ?? createStandaloneHostRuntimeAdapters(input);
}

function selectRuntimeAdaptersForCatalog(adapters: HostCommandRuntimeAdapter[], catalog: CommandCatalog): HostCommandRuntimeAdapter[] {
  const commandIds = new Set(catalog.commands.map((command) => command.id));
  return adapters
    .map((adapter) => ({ ...adapter, bindings: adapter.bindings.filter((binding) => commandIds.has(binding.commandId)) }))
    .filter((adapter) => adapter.bindings.length > 0);
}

export function createStandaloneHostCommandIndex(input: StandaloneHostRuntimeInput = {}, generatedAt = new Date().toISOString()): CommandIndex {
  const trusted = createStandaloneHostTrustedContext(input);
  const hostAdapters = filterEligibleHostCommandAdapters(resolveStandaloneHostCommandAdapters(input), trusted);
  const catalog = createStandaloneHostCommandCatalog(input, generatedAt);
  const registry = hostAdapters.length > 0
    ? createStandaloneHostCommandFamilyRegistryForAdapters(hostAdapters, generatedAt)
    : createComposedCommandFamilyRegistry(STANDALONE_HOST_PROVIDER, [], generatedAt);
  const indexContext = input.indexContext ?? input.pageContext;
  if (!indexContext) {
    return createStartupCommandIndex(catalog, { registry, limit: input.indexLimit ?? 12, context: trusted });
  }
  return createSurfaceCommandIndex(catalog, createCommandIndexContext(indexContext, trusted), { registry, limit: input.indexLimit ?? 20 });
}

export function createStandaloneHostCommandRuntimeBundle(input: StandaloneHostRuntimeInput = {}, generatedAt = new Date().toISOString()): {
  catalog: CommandCatalog;
  registry: CommandFamilyRegistry;
  runtimeAdapters: HostCommandRuntimeAdapter[];
  executionContext: CommandExecutionContext;
  indexContext: CommandIndexContext;
} {
  const trusted = createStandaloneHostTrustedContext(input);
  const hostSession = resolveStandaloneHostSession(input);
  const hostAdapters = filterEligibleHostCommandAdapters(resolveStandaloneHostCommandAdapters(input), trusted);
  const catalog = createStandaloneHostCommandCatalog(input, generatedAt);
  return {
    catalog,
    registry: hostAdapters.length > 0
      ? createStandaloneHostCommandFamilyRegistryForAdapters(hostAdapters, generatedAt)
      : createComposedCommandFamilyRegistry(STANDALONE_HOST_PROVIDER, [], generatedAt),
    runtimeAdapters: hostAdapters.length > 0 ? selectRuntimeAdaptersForCatalog(resolveStandaloneHostRuntimeAdapters(input), catalog) : [],
    executionContext: {
      source: "agent-ui",
      sessionId: trusted.sessionId,
      principalId: hostSession.principalId ?? null,
      hostSessionSource: hostSession.source,
      hostSessionExpiresAt: hostSession.expiresAt ?? null,
      authenticated: trusted.authenticated,
      organizationId: trusted.organizationId,
      scopes: trusted.scopes,
    },
    indexContext: createCommandIndexContext(input.indexContext ?? input.pageContext ?? {}, trusted),
  };
}
