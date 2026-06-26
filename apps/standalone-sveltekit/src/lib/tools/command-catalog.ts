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
import { createStandaloneHostCommandIndex, createStandaloneHostCommandRuntimeBundle, type BookingRuntimeAuthContext } from "$lib/server/host-command-runtime";
import { writeAgentTelemetry } from "$lib/server/agent-telemetry";

const commandAspectSchema = z.enum(["description", "schema", "examples", "policy", "output", "surfaces", "transport", "auth"]);

export function createCommandCatalogTools(context: { sessionId?: string | null; approvedCommandIds?: string[]; pageContext?: AgentPageContext; bookingServiceBaseUrl?: string | null; bookingRuntimeAuth?: BookingRuntimeAuthContext | null } = {}) {
  const createBundle = () => createStandaloneHostCommandRuntimeBundle({ sessionId: context.sessionId, pageContext: context.pageContext, hostSessionMode: "standalone-demo", bookingServiceBaseUrl: context.bookingServiceBaseUrl, bookingRuntimeAuth: context.bookingRuntimeAuth });
  const createContextCommandIds = () => new Set(createStandaloneHostCommandIndex({ sessionId: context.sessionId, pageContext: context.pageContext, hostSessionMode: "standalone-demo", bookingServiceBaseUrl: context.bookingServiceBaseUrl, bookingRuntimeAuth: context.bookingRuntimeAuth }).commands.map((command) => command.id));
  const summarizeCommandTelemetry = (command: CommandDescriptor | undefined, contextCommandIds = createContextCommandIds()) => ({
    commandFamily: command?.familyId,
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
      inputSchema: z.object({
        commandId: z.string().describe("Command id to execute."),
        input: z.record(z.string(), z.unknown()).default({}).describe("Structured command input."),
      }),
      execute: async ({ commandId, input }) => {
        const { catalog, runtimeAdapters, executionContext } = createBundle();
        const command = catalog.commands.find((entry) => entry.id === commandId);
        const contextCommandIds = createContextCommandIds();
        const receipt = await executeHostCatalogCommand({
          catalog,
          commandId,
          commandInput: input,
          runtimeAdapters,
          execution: {
            ...executionContext,
            action: "execute",
            source: "agent-ui",
            sessionId: context.sessionId,
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
        "Request commit of an approval-gated command from the Sonik command catalog. Approval is resolved from trusted host/session state, not model-provided booleans. This slice only allows mounted local UI/demo commands; ORPC business mutations remain metadata-only.",
      inputSchema: z.object({
        commandId: z.string().describe("Command id to commit."),
        input: z.record(z.string(), z.unknown()).default({}).describe("Structured command input."),
      }),
      execute: async ({ commandId, input }) => {
        const { catalog, runtimeAdapters, executionContext } = createBundle();
        const command = catalog.commands.find((entry) => entry.id === commandId);
        const contextCommandIds = createContextCommandIds();
        const receipt = await executeHostCatalogCommand({
          catalog,
          commandId,
          commandInput: input,
          runtimeAdapters,
          execution: {
            ...executionContext,
            action: "commit",
            source: "agent-ui",
            sessionId: context.sessionId,
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
