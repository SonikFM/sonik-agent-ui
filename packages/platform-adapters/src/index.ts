import {
  createDefaultCommandFamilyRegistry,
  createStartupCommandIndex,
  createSurfaceCommandIndex,
  createCommandCatalogFromToolManifest,
  createToolManifest,
  inferEffectFromHttpMethod,
  inferEffectFromProcedureId,
  type CommandFamilyRegistry,
  type CommandIndex,
  type CommandIndexContext,
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
    localTool("readActiveDocument", "Read active document", "Read the current Odysseus document bridge snapshot.", ["chat", "document"]),
    localTool("readDocumentArtifact", "Read document by id", "Read a specific workspace document artifact.", ["chat", "document"]),
    localTool("createDocumentArtifact", "Create document artifact", "Create a Markdown/HTML/code document in the Odysseus editor.", ["document", "canvas"], "write", "required"),
    localTool("updateDocumentArtifact", "Update document artifact", "Update the active or selected Odysseus document artifact.", ["document", "canvas"], "write", "required"),
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
      metadata: { adapter: "standalone-mock", sessionId: context.sessionId ?? null },
    },
  ], generatedAt);
}

export function createStandaloneCommandCatalog(context: PlatformAdapterContext = {}, generatedAt = new Date().toISOString()): CommandCatalog {
  return createCommandCatalogFromToolManifest(createStandaloneToolManifest(context, generatedAt));
}

export function createStandaloneCommandFamilyRegistry(generatedAt = new Date().toISOString()): CommandFamilyRegistry {
  return createDefaultCommandFamilyRegistry(generatedAt);
}

export function createStandaloneStartupCommandIndex(context: PlatformAdapterContext = {}, generatedAt = new Date().toISOString(), input: { limit?: number } = {}): CommandIndex {
  return createStartupCommandIndex(createStandaloneCommandCatalog(context, generatedAt), {
    registry: createStandaloneCommandFamilyRegistry(generatedAt),
    limit: input.limit,
  });
}

export function createStandaloneSurfaceCommandIndex(context: PlatformAdapterContext = {}, indexContext: CommandIndexContext = {}, generatedAt = new Date().toISOString(), input: { limit?: number } = {}): CommandIndex {
  return createSurfaceCommandIndex(createStandaloneCommandCatalog(context, generatedAt), {
    authenticated: context.authenticated,
    organizationId: context.organizationId,
    scopes: context.scopes,
    ...indexContext,
  }, {
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
