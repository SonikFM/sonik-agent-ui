import {
  createCommandCatalog,
  createCommandFamilyRegistry,
  createDefaultCommandFamilyRegistry,
  createStartupCommandIndex,
  createSurfaceCommandIndex,
  createCommandCatalogFromToolManifest,
  commandReceiptSchema,
  evaluateCommandPolicy,
  executeCatalogCommand,
  createToolManifest,
  inferEffectFromHttpMethod,
  inferEffectFromProcedureId,
  type AgentPageContext,
  type CommandDescriptor,
  type CommandExecutionContext,
  type CommandFamilyDefinition,
  type CommandFamilyRegistry,
  type CommandIndex,
  type CommandIndexContext,
  type CommandReceipt,
  type ToolContractEntry,
  type ToolEffect,
  type CommandCatalog,
  type ToolManifest,
  type ToolSource,
  type ToolUiTarget,
} from "@sonik-agent-ui/tool-contracts";

export type PlatformAdapterContext = {
  sessionId?: string | null;
  organizationId?: string | null;
  authenticated?: boolean;
  scopes?: string[];
};

export type HostSessionSource = "anonymous" | "standalone-demo" | "embedded-host" | "amplify-embedded";

export type HostSessionEnvelope = {
  source: HostSessionSource;
  sessionId?: string | null;
  userId?: string | null;
  principalId?: string | null;
  organizationId?: string | null;
  authenticated: boolean;
  scopes: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
};

export type HostSessionResolver<TInput = unknown> = (input: TInput) => HostSessionEnvelope | Promise<HostSessionEnvelope>;

export function createAnonymousHostSessionEnvelope(input: Partial<HostSessionEnvelope> = {}): HostSessionEnvelope {
  return {
    source: input.source ?? "anonymous",
    sessionId: input.sessionId ?? null,
    userId: input.userId ?? null,
    principalId: input.principalId ?? null,
    organizationId: null,
    authenticated: false,
    scopes: [],
    expiresAt: input.expiresAt ?? null,
    metadata: input.metadata,
  };
}

export function createTrustedHostSessionEnvelope(input: {
  source: Exclude<HostSessionSource, "anonymous">;
  sessionId?: string | null;
  userId?: string | null;
  principalId?: string | null;
  organizationId: string;
  scopes: string[];
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}): HostSessionEnvelope {
  return {
    source: input.source,
    sessionId: input.sessionId ?? null,
    userId: input.userId ?? null,
    principalId: input.principalId ?? null,
    organizationId: input.organizationId,
    authenticated: true,
    scopes: [...new Set(input.scopes)].sort(),
    expiresAt: input.expiresAt ?? null,
    metadata: input.metadata,
  };
}

export function createEmbeddedHostSessionEnvelope(input: {
  sessionId?: string | null;
  userId?: string | null;
  principalId?: string | null;
  organizationId?: string | null;
  authenticated?: boolean;
  scopes?: string[];
  expiresAt?: string | null;
  source?: "embedded-host" | "amplify-embedded";
  metadata?: Record<string, unknown>;
}): HostSessionEnvelope {
  if (input.authenticated !== true || !input.organizationId) {
    return createAnonymousHostSessionEnvelope({
      source: input.source ?? "embedded-host",
      sessionId: input.sessionId,
      userId: input.userId,
      principalId: input.principalId,
      expiresAt: input.expiresAt,
      metadata: input.metadata,
    });
  }

  return createTrustedHostSessionEnvelope({
    source: input.source ?? "embedded-host",
    sessionId: input.sessionId,
    userId: input.userId,
    principalId: input.principalId,
    organizationId: input.organizationId,
    scopes: input.scopes ?? [],
    expiresAt: input.expiresAt,
    metadata: input.metadata,
  });
}

export function platformAdapterContextFromHostSession(session: HostSessionEnvelope | null | undefined): PlatformAdapterContext {
  if (!session) return { authenticated: false, organizationId: null, scopes: [] };
  return {
    sessionId: session.sessionId ?? null,
    authenticated: session.authenticated,
    organizationId: session.authenticated ? session.organizationId ?? null : null,
    scopes: session.authenticated ? session.scopes : [],
  };
}

export type HostCommandAdapter = {
  provider: string;
  families?: CommandFamilyDefinition[];
  commands?: CommandDescriptor[];
  manifest?: ToolManifest;
  isEligible?: (context: PlatformAdapterContext) => boolean;
};

export type HostCommandRuntimeStatus = "shadow" | "mounted-read" | "mounted-write" | "disabled" | "unavailable";

export type HostCommandRuntimeResult = {
  summary: unknown;
  handle?: string;
  resources?: Array<{ uri: string; title: string; mimeType?: string }>;
  nextActions?: string[];
};

export type HostCommandRuntimeHandler = (input: unknown, context: {
  command: CommandDescriptor;
  execution: CommandExecutionContext;
  action: "execute" | "commit";
}) => HostCommandRuntimeResult | Promise<HostCommandRuntimeResult>;

export type HostCommandRuntimeBinding = {
  commandId: string;
  status: HostCommandRuntimeStatus;
  execute?: HostCommandRuntimeHandler;
  commit?: HostCommandRuntimeHandler;
};

export type HostCommandRuntimeAdapter = {
  provider: string;
  bindings: HostCommandRuntimeBinding[];
};

export type OpenApiOperationLike = {
  operationId?: string;
  summary?: string;
  description?: string;
  security?: unknown[];
  tags?: string[];
  requestBody?: unknown;
  responses?: unknown;
  [key: string]: unknown;
};

export type OpenApiDocumentLike = {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  security?: unknown[];
  paths?: Record<string, Record<string, OpenApiOperationLike>>;
};

const httpMethods = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

export function createStandaloneToolManifest(context: PlatformAdapterContext = {}, generatedAt = new Date().toISOString()): ToolManifest {
  return createToolManifest("standalone-local", [
    localTool("getWeather", "Get weather", "Fetch current conditions and forecast data.", ["chat", "inline-json"]),
    localTool("getGitHubRepo", "Get GitHub repository", "Fetch repository stats and metadata.", ["chat", "inline-json"]),
    localTool("getGitHubPullRequests", "Get GitHub pull requests", "Fetch pull request lists for repository review.", ["chat", "inline-json"]),
    localTool("getCryptoPrice", "Get crypto price", "Fetch current cryptocurrency market data.", ["chat", "inline-json"]),
    localTool("getCryptoPriceHistory", "Get crypto price history", "Fetch historical cryptocurrency price data.", ["chat", "inline-json"]),
    localTool("getHackerNewsTop", "Get Hacker News top stories", "Fetch current Hacker News top stories.", ["chat", "inline-json"]),
    localTool("webSearch", "Search web", "Search the web for real-time information.", ["chat"]),
    localTool("createJsonArtifact", "Create JSON-render artifact", "Promote a JSON-render spec into the live canvas artifact.", ["artifact", "canvas"], "write", "required"),
    localTool("readActiveDocument", "Read active document", "Read the current workspace document bridge snapshot.", ["chat", "document"]),
    localTool("readDocumentArtifact", "Read document by id", "Read a specific workspace document artifact.", ["chat", "document"]),
    localTool("createDocumentArtifact", "Create document artifact", "Create a Markdown/HTML/code document in the workspace editor.", ["document", "canvas"], "write", "required"),
    localTool("updateDocumentArtifact", "Update document artifact", "Update the active or selected workspace document artifact.", ["document", "canvas"], "write", "required"),
    {
      id: "booking.contexts.list",
      source: "orpc",
      title: "List booking contexts",
      description: "Mock Sonik booking read capability used to validate app-state ORPC manifest wiring before live client adoption.",
      effect: "read",
      approval: "none",
      uiTargets: ["chat", "artifact"],
      capabilities: ["booking", "context", "read"],
      input: { kind: "unknown" },
      output: { kind: "unknown" },
      auth: { required: true, scopes: ["booking:read"], orgScoped: true },
      transport: { procedure: "booking.contexts.list", runtimeStatus: "shadow" },
      metadata: {
        adapter: "standalone-mock",
        sessionId: context.sessionId ?? null,
        familyId: "integration",
        loadPolicy: { mode: "surface-eager", priority: 5, profile: "standalone-shadow" },
        contextHints: {
          surfaces: ["artifact"],
          commandFamilies: ["integration"],
          requiredScopes: ["booking:read"],
        },
      },
    },
  ], generatedAt);
}

export function createStandaloneCommandCatalog(context: PlatformAdapterContext = {}, generatedAt = new Date().toISOString()): CommandCatalog {
  return createCommandCatalogFromToolManifest(createStandaloneToolManifest(context, generatedAt));
}

export function createComposedCommandFamilyRegistry(provider: string, adapters: HostCommandAdapter[] = [], generatedAt = new Date().toISOString()): CommandFamilyRegistry {
  const base = createDefaultCommandFamilyRegistry(generatedAt);
  const familiesById = new Map(base.families.map((family) => [family.id, family]));
  for (const adapter of adapters) {
    for (const family of adapter.families ?? []) {
      if (familiesById.has(family.id)) throw new Error(`Duplicate command family id in host adapter composition: ${family.id}`);
      familiesById.set(family.id, family);
    }
  }
  return createCommandFamilyRegistry(provider, [...familiesById.values()], generatedAt);
}

export function createComposedCommandCatalog(provider: string, baseCatalog: CommandCatalog, adapters: HostCommandAdapter[] = [], generatedAt = baseCatalog.generatedAt): CommandCatalog {
  const commandIds = new Set(baseCatalog.commands.map((command) => command.id));
  const hostCommands = adapters.flatMap((adapter) => [
    ...(adapter.commands ?? []),
    ...(adapter.manifest ? createCommandCatalogFromToolManifest(adapter.manifest).commands : []),
  ].map((command) => {
    if (commandIds.has(command.id)) throw new Error(`Duplicate command id in host adapter composition: ${command.id}`);
    commandIds.add(command.id);
    return command;
  }));
  return createCommandCatalog(provider, [...baseCatalog.commands, ...hostCommands], generatedAt);
}

export function filterEligibleHostCommandAdapters(adapters: HostCommandAdapter[] = [], context: PlatformAdapterContext = {}): HostCommandAdapter[] {
  return adapters.filter((adapter) => adapter.isEligible ? adapter.isEligible(context) : true);
}

export function createCommandIndexContext(pageContext: AgentPageContext = {}, trustedContext: PlatformAdapterContext = {}): CommandIndexContext {
  return {
    ...pageContext,
    authenticated: trustedContext.authenticated,
    organizationId: trustedContext.organizationId,
    scopes: trustedContext.scopes,
  };
}

export async function executeHostCatalogCommand(input: {
  catalog: CommandCatalog;
  commandId: string;
  commandInput?: unknown;
  execution?: CommandExecutionContext;
  runtimeAdapters?: HostCommandRuntimeAdapter[];
}): Promise<CommandReceipt> {
  const startedAt = Date.now();
  const execution = input.execution ?? {};
  const source = execution.source ?? "agent-ui";
  const requestId = execution.requestId ?? `cmd_${input.commandId.replace(/[^a-z0-9]+/gi, "_")}_${startedAt}`;
  const command = input.catalog.commands.find((entry) => entry.id === input.commandId);
  if (!command) return executeCatalogCommand(input.catalog, input.commandId, input.commandInput, { ...execution, requestId, source });

  const binding = findRuntimeBinding(input.runtimeAdapters ?? [], input.commandId);
  if (!binding) {
    if (command.source === "local-ui") return executeCatalogCommand(input.catalog, input.commandId, input.commandInput, { ...execution, requestId, source });
    return deniedRuntimeReceipt(input.catalog, command, execution.action ?? "execute", input.commandInput, { ...execution, requestId, source }, startedAt, input.catalog.provider, ["runtime_unavailable"]);
  }
  if (binding.binding.status === "shadow") {
    return deniedRuntimeReceipt(input.catalog, command, execution.action ?? "execute", input.commandInput, { ...execution, requestId, source }, startedAt, binding.adapter.provider, ["runtime_shadow"]);
  }
  if (command.transport.runtimeStatus !== "mounted") {
    return deniedRuntimeReceipt(input.catalog, command, execution.action ?? "execute", input.commandInput, { ...execution, requestId, source }, startedAt, binding.adapter.provider, [`runtime_not_mounted:${command.transport.runtimeStatus}`]);
  }
  if ((command.source === "orpc" || command.source === "openapi") && command.metadata.runtimeAdapterProvider !== binding.adapter.provider) {
    return deniedRuntimeReceipt(input.catalog, command, execution.action ?? "execute", input.commandInput, { ...execution, requestId, source }, startedAt, binding.adapter.provider, ["runtime_adapter_not_authorized_for_descriptor"]);
  }

  const action = execution.action ?? "execute";
  if (binding.binding.status === "unavailable") {
    return deniedRuntimeReceipt(input.catalog, command, action, input.commandInput, { ...execution, requestId, source }, startedAt, binding.adapter.provider, ["runtime_unavailable"]);
  }
  if (binding.binding.status === "disabled") {
    return deniedRuntimeReceipt(input.catalog, command, action, input.commandInput, { ...execution, requestId, source }, startedAt, binding.adapter.provider, ["runtime_disabled"]);
  }
  if (!runtimeStatusAllowsAction(binding.binding.status, command, action)) {
    return deniedRuntimeReceipt(input.catalog, command, action, input.commandInput, { ...execution, requestId, source }, startedAt, binding.adapter.provider, [`runtime_not_mounted_for_${action}`]);
  }

  const runtimeCommand: CommandDescriptor = {
    ...command,
    transport: { ...command.transport, runtimeStatus: "mounted" },
    metadata: { ...command.metadata, liveExecution: true, runtimeAdapterProvider: binding.adapter.provider, runtimeStatus: binding.binding.status },
  };
  const policy = evaluateCommandPolicy(runtimeCommand, { ...execution, requestId, source, action });
  if (policy.decision !== "allow") {
    return commandReceiptSchema.parse({
      ok: false,
      commandId: command.id,
      summary: { message: `Command ${command.id} was not executed`, reasons: policy.reasons },
      nextActions: policy.decision === "needs_approval" ? ["commitCommand"] : ["learnCommand"],
      policy,
      trace: { requestId, sessionId: execution.sessionId, durationMs: Date.now() - startedAt, provider: binding.adapter.provider, cache: "miss", source },
      errors: policy.reasons.map((reason) => ({ code: reason.toUpperCase().replace(/[^A-Z0-9]+/g, "_"), message: reason, retryable: policy.decision === "needs_approval" })),
    });
  }

  const handler = action === "commit" ? binding.binding.commit : binding.binding.execute;
  if (!handler) {
    return deniedRuntimeReceipt(input.catalog, command, action, input.commandInput, { ...execution, requestId, source }, startedAt, binding.adapter.provider, [`runtime_handler_missing_for_${action}`]);
  }

  try {
    const result = await handler(input.commandInput, { command: runtimeCommand, execution: { ...execution, requestId, source, action }, action });
    return commandReceiptSchema.parse({
      ok: true,
      commandId: command.id,
      summary: result.summary,
      handle: result.handle,
      resources: result.resources,
      nextActions: result.nextActions ?? runtimeCommand.output.resources,
      policy,
      trace: { requestId, sessionId: execution.sessionId, durationMs: Date.now() - startedAt, provider: binding.adapter.provider, cache: "miss", source },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return commandReceiptSchema.parse({
      ok: false,
      commandId: command.id,
      summary: { message: "Host runtime command failed", error: message },
      nextActions: ["learnCommand"],
      policy: { decision: "deny", reasons: ["host_runtime_error"] },
      trace: { requestId, sessionId: execution.sessionId, durationMs: Date.now() - startedAt, provider: binding.adapter.provider, cache: "miss", source },
      errors: [{ code: "HOST_RUNTIME_ERROR", message, retryable: true }],
    });
  }
}

export function createStandaloneCommandFamilyRegistry(generatedAt = new Date().toISOString()): CommandFamilyRegistry {
  return createDefaultCommandFamilyRegistry(generatedAt);
}

function findRuntimeBinding(adapters: HostCommandRuntimeAdapter[], commandId: string): { adapter: HostCommandRuntimeAdapter; binding: HostCommandRuntimeBinding } | undefined {
  let found: { adapter: HostCommandRuntimeAdapter; binding: HostCommandRuntimeBinding } | undefined;
  for (const adapter of adapters) {
    for (const binding of adapter.bindings) {
      if (binding.commandId !== commandId) continue;
      if (found) throw new Error(`Duplicate runtime binding for command id: ${commandId}`);
      found = { adapter, binding };
    }
  }
  return found;
}

function runtimeStatusAllowsAction(status: HostCommandRuntimeStatus, command: CommandDescriptor, action: "execute" | "commit"): boolean {
  if (status === "mounted-read") return action === "execute" && command.policy.readOnly;
  if (status === "mounted-write") return action === "commit" || (action === "execute" && command.policy.readOnly);
  return false;
}

function deniedRuntimeReceipt(
  catalog: CommandCatalog,
  command: CommandDescriptor,
  action: "execute" | "commit",
  commandInput: unknown,
  execution: CommandExecutionContext,
  startedAt: number,
  provider: string,
  reasons: string[],
): CommandReceipt {
  const policy = { decision: "deny" as const, reasons };
  return commandReceiptSchema.parse({
    ok: false,
    commandId: command.id,
    summary: { message: `Command ${command.id} was not executed`, action, input: commandInput, reasons },
    nextActions: ["learnCommand"],
    policy,
    trace: { requestId: execution.requestId ?? `cmd_${command.id.replace(/[^a-z0-9]+/gi, "_")}_${startedAt}`, sessionId: execution.sessionId, durationMs: Date.now() - startedAt, provider: provider || catalog.provider, cache: "miss", source: execution.source ?? "agent-ui" },
    errors: reasons.map((reason) => ({ code: reason.toUpperCase().replace(/[^A-Z0-9]+/g, "_"), message: reason, retryable: false })),
  });
}

export function createStandaloneStartupCommandIndex(context: PlatformAdapterContext = {}, generatedAt = new Date().toISOString(), input: { limit?: number } = {}): CommandIndex {
  return createStartupCommandIndex(createStandaloneCommandCatalog(context, generatedAt), {
    registry: createStandaloneCommandFamilyRegistry(generatedAt),
    limit: input.limit,
    context: {
      authenticated: context.authenticated,
      organizationId: context.organizationId,
      scopes: context.scopes,
    },
  });
}

export function createStandaloneSurfaceCommandIndex(context: PlatformAdapterContext = {}, indexContext: CommandIndexContext = {}, generatedAt = new Date().toISOString(), input: { limit?: number } = {}): CommandIndex {
  return createSurfaceCommandIndex(createStandaloneCommandCatalog(context, generatedAt), createCommandIndexContext(indexContext, context), {
    registry: createStandaloneCommandFamilyRegistry(generatedAt),
    limit: input.limit,
  });
}

export function createManifestFromOpenApiDocument(input: {
  document: OpenApiDocumentLike;
  provider?: string;
  source?: ToolSource;
  includeShadow?: boolean;
  generatedAt?: string;
}): ToolManifest {
  const provider = input.provider ?? input.document.info?.title ?? "openapi";
  const tools: ToolContractEntry[] = [];
  const documentSecurity = input.document.security;
  for (const [path, pathItem] of Object.entries(input.document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!httpMethods.has(method.toLowerCase())) continue;
      const status = normalizeRuntimeStatus(operation["x-sonik-status"]);
      if (status === "shadow" && input.includeShadow !== true) continue;
      const operationId = operation.operationId ?? `${method.toLowerCase()} ${path}`;
      const effect = inferEffectFromProcedureId(operationId, inferEffectFromHttpMethod(method));
      const effectiveSecurity = resolveEffectiveSecurity(operation, documentSecurity);
      tools.push({
        id: normalizeOperationId(operationId, method, path),
        source: input.source ?? "openapi",
        title: operation.summary ?? operationId,
        description: operation.description ?? "",
        effect,
        approval: effect === "read" ? "none" : "required",
        uiTargets: defaultTargetsForEffect(effect),
        capabilities: ["booking", ...(operation.tags ?? [])],
        input: { kind: operation.requestBody ? "openapi" : "unknown", ref: `${method.toUpperCase()} ${path} requestBody` },
        output: { kind: operation.responses ? "openapi" : "unknown", ref: `${method.toUpperCase()} ${path} responses` },
        auth: { required: hasSecurity(effectiveSecurity), scopes: extractSecurityScopes(effectiveSecurity), orgScoped: hasSecurity(effectiveSecurity) },
        transport: { method: method.toUpperCase(), path, procedure: operationId, runtimeStatus: status },
        metadata: {
          sonikStatus: operation["x-sonik-status"] ?? "unknown",
          sonikAdapter: operation["x-sonik-adapter"] ?? "unknown",
        },
      });
    }
  }
  return createToolManifest(provider, tools, input.generatedAt ?? new Date().toISOString());
}

export function createSonikBookingManifestFromOpenApiDocument(document: OpenApiDocumentLike, generatedAt?: string): ToolManifest {
  return createManifestFromOpenApiDocument({
    document,
    provider: "sonik-booking-openapi",
    source: "orpc",
    includeShadow: false,
    generatedAt,
  });
}

function localTool(
  id: string,
  title: string,
  description: string,
  uiTargets: ToolUiTarget[],
  effect: ToolEffect = "read",
  approval: "none" | "required" | "denied" = effect === "read" ? "none" : "required",
): ToolContractEntry {
  return {
    id,
    source: "local-ui",
    title,
    description,
    effect,
    approval,
    uiTargets,
    capabilities: [id],
    input: { kind: "zod" },
    output: { kind: "unknown" },
    auth: { required: false, scopes: [], orgScoped: false },
    transport: { runtimeStatus: "mounted" },
    metadata: { adapter: "standalone" },
  };
}

function resolveEffectiveSecurity(operation: OpenApiOperationLike, documentSecurity: unknown[] | undefined): unknown[] | undefined {
  // OpenAPI security is inherited from the document unless an operation explicitly
  // overrides it. An explicit empty array marks a public operation.
  return Array.isArray(operation.security) ? operation.security : documentSecurity;
}

function hasSecurity(security: unknown[] | undefined): boolean {
  return Array.isArray(security) && security.length > 0;
}

function extractSecurityScopes(security: unknown[] | undefined): string[] {
  if (!Array.isArray(security)) return [];
  const scopes = new Set<string>();
  for (const requirement of security) {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) continue;
    for (const value of Object.values(requirement as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      for (const scope of value) {
        if (typeof scope === "string" && scope) scopes.add(scope);
      }
    }
  }
  return [...scopes].sort();
}

function normalizeRuntimeStatus(value: unknown): "mounted" | "shadow" | "unknown" {
  return value === "mounted" || value === "shadow" ? value : "unknown";
}

function defaultTargetsForEffect(effect: ToolEffect): ToolUiTarget[] {
  if (effect === "read") return ["chat", "artifact"];
  if (effect === "environment") return ["terminal"];
  return ["none"];
}

function normalizeOperationId(operationId: string, method: string, path: string): string {
  if (/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)+$/i.test(operationId)) return operationId;
  return `${method.toLowerCase()}.${path.replace(/^\//, "").replace(/\{([^}]+)\}/g, "$1").replace(/[^a-z0-9]+/gi, ".").replace(/^\.|\.$/g, "")}`;
}
