import { tool } from "ai";
import { z } from "zod";
import {
  learnCommandDescriptor,
  searchCommandCatalogWithMetadata,
  type AgentPageContext,
  type CommandDescriptor,
  type CommandLearnAspect,
} from "@sonik-agent-ui/tool-contracts";
import { executeHostCatalogCommand } from "@sonik-agent-ui/platform-adapters";
import { createStandaloneHostCommandIndex, createStandaloneHostCommandRuntimeBundle, type BookingRuntimeAuthContext } from "../server/host-command-runtime.ts";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import { writeAgentTelemetry } from "../server/agent-telemetry.ts";
import { resolveAgentToolPermissionMode, type AgentToolPermissionMode } from "../agent-settings.ts";

const commandAspectSchema = z.enum(["description", "schema", "examples", "policy", "output", "surfaces", "transport", "auth"]);
const directCommandInputSchema = z.object({
  commandId: z.string().describe("Command id to execute."),
  input: z.unknown().optional().describe("Direct structured command input object. For generated booking commands, prefer inputJson when arbitrary keys are rejected by the model/tool schema."),
  inputJson: z.string().optional().describe("Optional JSON string for direct command input. Use this for generated OpenAPI/ORPC commands with arbitrary path/query/body fields, e.g. {\"contextId\":\"...\"}. Parsed and schema-preflighted before runtime execution."),
});

export function createCommandCatalogTools(context: { sessionId?: string | null; approvedCommandIds?: string[]; hostSession?: HostSessionEnvelope | null; pageContext?: AgentPageContext; bookingServiceBaseUrl?: string | null; bookingRuntimeAuth?: BookingRuntimeAuthContext | null; bookingRuntimeFetcher?: typeof fetch; toolPermissionModes?: Record<string, AgentToolPermissionMode> } = {}) {
  const hostSessionInput = () => context.hostSession ? { hostSession: context.hostSession } : { hostSessionMode: "standalone-demo" as const };
  const createBundle = () => createStandaloneHostCommandRuntimeBundle({ sessionId: context.sessionId, pageContext: context.pageContext, ...hostSessionInput(), bookingServiceBaseUrl: context.bookingServiceBaseUrl, bookingRuntimeAuth: context.bookingRuntimeAuth, fetcher: context.bookingRuntimeFetcher });
  const createContextCommandIds = () => new Set(createStandaloneHostCommandIndex({ sessionId: context.sessionId, pageContext: context.pageContext, ...hostSessionInput(), bookingServiceBaseUrl: context.bookingServiceBaseUrl, bookingRuntimeAuth: context.bookingRuntimeAuth, fetcher: context.bookingRuntimeFetcher }).commands.map((command) => command.id));
  const summarizeCommandTelemetry = (command: CommandDescriptor | undefined, contextCommandIds = createContextCommandIds()) => ({
    commandFamily: command?.familyId,
    toolPermissionMode: resolveToolPermissionMode(command, context.toolPermissionModes),
    commandSource: command?.source,
    commandEffect: command?.effect,
    runtimeStatus: command?.transport.runtimeStatus,
    loadMode: command?.loadPolicy.mode,
    reason: command ? (contextCommandIds.has(command.id) ? "context_loaded" : "lazy_or_global") : undefined,
  });

  return {
    searchCommandCatalog: tool({
      description:
        "Search the compact Sonik Agent UI command catalog before learning or executing commands. Use this instead of loading every tool into context.",
      inputSchema: z.object({
        query: z.string().default("").describe("User-language search query, e.g. artifact, document, booking, weather, tool manifest."),
        limit: z.number().int().min(1).max(20).default(10).describe("Maximum compact command summaries to return."),
      }),
      execute: async ({ query, limit }) => {
        const { catalog } = createBundle();
        const contextCommandIds = createContextCommandIds();
        const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 20));
        const result = searchCommandCatalogWithMetadata(catalog, query, 50);
        const rankedCommands = [...result.commands]
          .filter((command) => resolveToolPermissionMode(command, context.toolPermissionModes) !== "off")
          .sort((a, b) => Number(contextCommandIds.has(b.id)) - Number(contextCommandIds.has(a.id)) || a.id.localeCompare(b.id))
          .slice(0, boundedLimit);
        const rankedResult = { ...result, commands: rankedCommands, limit: boundedLimit, truncated: result.totalMatches > boundedLimit };
        await writeAgentTelemetry({
          source: "server",
          event: "tool.searchCommandCatalog",
          ok: true,
          mode: "command-catalog",
          elementCount: rankedResult.commands.length,
          totalMatches: rankedResult.totalMatches,
          query,
        });
        return { kind: "command-catalog-search" as const, provider: catalog.provider, contextLoadedCommandIds: [...contextCommandIds], ...rankedResult };
      },
    }),
    learnCommand: tool({
      description:
        "Learn one command's schema, examples, policy, output, transport, and surfaces before executing it. This keeps agent context small and command-specific.",
      inputSchema: z.object({
        commandId: z.string().describe("Command id returned by searchCommandCatalog."),
        aspects: z.array(commandAspectSchema).optional().describe("Optional detail slices to load."),
      }),
      execute: async ({ commandId, aspects }) => {
        const { catalog } = createBundle();
        const command = catalog.commands.find((entry) => entry.id === commandId);
        const contextCommandIds = createContextCommandIds();
        const learned = learnCommandDescriptor(catalog, commandId, aspects as CommandLearnAspect[] | undefined);
        await writeAgentTelemetry({
          source: "server",
          event: "tool.learnCommand",
          ok: Boolean(learned.ok),
          toolCallId: commandId,
          ...summarizeCommandTelemetry(command, contextCommandIds),
        });
        return { kind: "command-learn" as const, contextLoaded: contextCommandIds.has(commandId), ...learned };
      },
    }),
    executeCommand: tool({
      description:
        "Execute a mounted read-only command from the Sonik command catalog. Mutations must use commitCommand and require explicit approval.",
      inputSchema: directCommandInputSchema,
      execute: async ({ commandId, input, inputJson }) => {
        const { catalog, runtimeAdapters, executionContext } = createBundle();
        const command = catalog.commands.find((entry) => entry.id === commandId);
        const contextCommandIds = createContextCommandIds();
        assertToolFamilyEnabled(command, context.toolPermissionModes);
        const commandInput = coerceDirectCommandInput(input, inputJson);
        const repairedInput = repairCommandInputFromPageContext(command, commandInput, context.pageContext);
        const receipt = await executeHostCatalogCommand({
          catalog,
          commandId,
          commandInput: repairedInput,
          runtimeAdapters,
          execution: {
            ...executionContext,
            action: "execute",
            source: "agent-ui",
            sessionId: executionContext.sessionId ?? context.sessionId,
          },
        });
        await writeAgentTelemetry({
          source: "server",
          event: "tool.executeCommand",
          ok: receipt.ok,
          toolCallId: commandId,
          mode: receipt.policy.decision,
          policyReasons: receipt.policy.reasons,
          runtimeProvider: receipt.trace.provider,
          hostSessionSource: executionContext.hostSessionSource,
          ...summarizeCommandTelemetry(command, contextCommandIds),
        });
        return { kind: "command-receipt" as const, receipt };
      },
    }),
    commitCommand: tool({
      description:
        "Request commit of an approval-gated command from the Sonik command catalog. Approval is resolved from trusted host/session state, not model-provided booleans. Only trusted host/runtime-mounted mutations can commit; generated discovery records remain metadata-only unless this runtime adapter mounted the command.",
      inputSchema: directCommandInputSchema.extend({
        commandId: z.string().describe("Command id to commit."),
      }),
      execute: async ({ commandId, input, inputJson }) => {
        const { catalog, runtimeAdapters, executionContext } = createBundle();
        const command = catalog.commands.find((entry) => entry.id === commandId);
        const contextCommandIds = createContextCommandIds();
        assertToolFamilyEnabled(command, context.toolPermissionModes);
        const commandInput = coerceDirectCommandInput(input, inputJson);
        const repairedInput = repairCommandInputFromPageContext(command, commandInput, context.pageContext);
        const receipt = await executeHostCatalogCommand({
          catalog,
          commandId,
          commandInput: repairedInput,
          runtimeAdapters,
          execution: {
            ...executionContext,
            action: "commit",
            source: "agent-ui",
            sessionId: executionContext.sessionId ?? context.sessionId,
            approved: context.approvedCommandIds?.includes(commandId) === true,
          },
        });
        await writeAgentTelemetry({
          source: "server",
          event: "tool.commitCommand",
          ok: receipt.ok,
          toolCallId: commandId,
          mode: receipt.policy.decision,
          policyReasons: receipt.policy.reasons,
          runtimeProvider: receipt.trace.provider,
          hostSessionSource: executionContext.hostSessionSource,
          ...summarizeCommandTelemetry(command, contextCommandIds),
        });
        return { kind: "command-receipt" as const, receipt };
      },
    }),
  };
}


function resolveToolPermissionMode(command: { familyId: string } | undefined, modes: Record<string, AgentToolPermissionMode> | undefined): AgentToolPermissionMode {
  return resolveAgentToolPermissionMode(command?.familyId, modes);
}

function assertToolFamilyEnabled(command: CommandDescriptor | undefined, modes: Record<string, AgentToolPermissionMode> | undefined): void {
  const mode = resolveToolPermissionMode(command, modes);
  if (mode === "off") {
    throw new Error(`Tool family ${command?.familyId ?? "unknown"} is disabled in Agent Settings for this run.`);
  }
}

function coerceDirectCommandInput(input: unknown, inputJson: string | undefined): Record<string, unknown> {
  if (typeof inputJson === "string" && inputJson.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(inputJson);
    } catch (error) {
      throw new Error(`inputJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("inputJson must parse to a JSON object");
    return parsed as Record<string, unknown>;
  }
  if (input === undefined || input === null) return {};
  if (typeof input === "string" && input.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      throw new Error("input must be a JSON object, or pass JSON text through inputJson");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("input JSON must parse to an object");
    return parsed as Record<string, unknown>;
  }
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("input must be a JSON object");
  return input as Record<string, unknown>;
}

function repairCommandInputFromPageContext(
  command: CommandDescriptor | undefined,
  input: Record<string, unknown>,
  pageContext: AgentPageContext | undefined,
): Record<string, unknown> {
  if (!command || !command.id.startsWith("booking.")) return input;
  const schema = command.inputSchemaJson && typeof command.inputSchemaJson === "object" && !Array.isArray(command.inputSchemaJson)
    ? command.inputSchemaJson as { required?: unknown; properties?: unknown; additionalProperties?: unknown }
    : command.input.schema && typeof command.input.schema === "object" && !Array.isArray(command.input.schema)
      ? command.input.schema as { required?: unknown; properties?: unknown; additionalProperties?: unknown }
      : null;
  const required = Array.isArray(schema?.required) ? schema.required.filter((field): field is string => typeof field === "string") : [];
  const properties = schema?.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
  const repaired: Record<string, unknown> = { ...input };
  if (required.includes("contextId") && !hasUsableToolInput(repaired.contextId)) {
    const pageContextId = pageContext?.activeEntity?.id;
    if (typeof pageContextId === "string" && pageContextId.trim()) repaired.contextId = pageContextId.trim();
  }
  if (command.id === "booking.get.availability" && typeof repaired.date === "string") {
    const day = repaired.date.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      if (!hasUsableToolInput(repaired.from) && "from" in properties) repaired.from = `${day}T18:00:00.000Z`;
      if (!hasUsableToolInput(repaired.to) && "to" in properties) repaired.to = `${day}T19:00:00.000Z`;
      if (schema?.additionalProperties === false || !("date" in properties)) delete repaired.date;
    }
  }
  return repaired;
}

function hasUsableToolInput(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}
