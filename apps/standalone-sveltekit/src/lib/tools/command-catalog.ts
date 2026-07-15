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
import { validateReservationGuestForBooking } from "../server/booking-workflows/reservation-guest-validation.ts";
import { requireCallableCapability, resolveStandaloneCapabilityReadiness, type CapabilityVersionPins } from "../server/capability-readiness.ts";

const commandAspectSchema = z.enum(["description", "schema", "examples", "policy", "output", "surfaces", "transport", "auth"]);
const directCommandInputSchema = z.object({
  commandId: z.string().describe("Command id to execute."),
  input: z.unknown().optional().describe("Direct structured command input object. For generated booking commands, prefer inputJson when arbitrary keys are rejected by the model/tool schema."),
  inputJson: z.string().optional().describe("Optional JSON string for direct command input. Use this for generated OpenAPI/ORPC commands with arbitrary path/query/body fields, e.g. {\"contextId\":\"...\"}. Parsed and schema-preflighted before runtime execution."),
});

const reservationPreviewInputSchema = z.object({
  guest: z.record(z.string(), z.unknown()).describe("Guest/customer fields for booking.create.guest. Must include a name plus a user-confirmed, non-placeholder email or phone, with contactConfirmed true."),
  booking: z.record(z.string(), z.unknown()).describe("booking.create.booking input without userId. Must include contextId, startsAt, endsAt, partySize, source, and clientRequestId."),
});

const RESERVATION_REQUIRED_BOOKING_FIELDS = ["contextId", "startsAt", "endsAt", "partySize", "source", "clientRequestId"] as const;

function missingReservationPreviewFields(guest: Record<string, unknown>, booking: Record<string, unknown>): string[] {
  const missing: string[] = [];
  missing.push(...validateReservationGuestForBooking(guest).missingFields);
  for (const field of RESERVATION_REQUIRED_BOOKING_FIELDS) {
    if (!hasUsableToolInput(booking[field])) missing.push(`booking.${field}`);
  }
  return missing;
}

function createBookingReservationPreview(guest: Record<string, unknown>, booking: Record<string, unknown>) {
  const { userId: _discardedUserId, ...bookingInput } = booking;
  return {
    commandId: "booking.create.booking" as const,
    endpoint: "/api/reservation/commit" as const,
    input: {
      guest,
      booking: bookingInput,
    },
  };
}

export function createCommandCatalogTools(context: { sessionId?: string | null; approvedCommandIds?: string[]; revokedCapabilityIds?: string[]; capabilityVersionPins?: CapabilityVersionPins; hostSession?: HostSessionEnvelope | null; pageContext?: AgentPageContext; bookingServiceBaseUrl?: string | null; bookingRuntimeAuth?: BookingRuntimeAuthContext | null; bookingRuntimeFetcher?: typeof fetch; toolPermissionModes?: Record<string, AgentToolPermissionMode> } = {}) {
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

  const resolveReadiness = () => resolveStandaloneCapabilityReadiness({
    sessionId: context.sessionId,
    pageContext: context.pageContext,
    ...hostSessionInput(),
    bookingServiceBaseUrl: context.bookingServiceBaseUrl,
    bookingRuntimeAuth: context.bookingRuntimeAuth,
    fetcher: context.bookingRuntimeFetcher,
    approvedCommandIds: context.approvedCommandIds,
    revokedCapabilityIds: context.revokedCapabilityIds,
    capabilityVersionPins: context.capabilityVersionPins,
    toolPermissionModes: context.toolPermissionModes,
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
        const readiness = new Map(resolveReadiness().map((entry) => [entry.capabilityId, entry]));
        const rankedCommands = [...result.commands]
          .filter((command) => resolveToolPermissionMode(command, context.toolPermissionModes) !== "off")
          .sort((a, b) => Number(contextCommandIds.has(b.id)) - Number(contextCommandIds.has(a.id)) || a.id.localeCompare(b.id))
          .slice(0, boundedLimit)
          .map((command) => ({ ...command, readiness: readiness.get(command.id) }));
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
        const readiness = resolveReadiness().find((entry) => entry.capabilityId === commandId);
        await writeAgentTelemetry({
          source: "server",
          event: "tool.learnCommand",
          ok: Boolean(learned.ok),
          toolCallId: commandId,
          ...summarizeCommandTelemetry(command, contextCommandIds),
        });
        return { kind: "command-learn" as const, contextLoaded: contextCommandIds.has(commandId), readiness, ...learned };
      },
    }),
    previewBookingReservationCommand: tool({
      description:
        "Prepare the human approval preview for a booking reservation after booking.get.availability succeeds. Requires user-confirmed guest email or phone (contactConfirmed true) and rejects obvious placeholders. This does not create the guest or booking. The user must click Approve, which POSTs to /api/reservation/commit outside the model turn.",
      inputSchema: reservationPreviewInputSchema,
      execute: async ({ guest, booking }) => {
        const command = createBookingReservationPreview(guest, booking);
        const missingFields = missingReservationPreviewFields(guest, command.input.booking);
        const ok = missingFields.length === 0;
        await writeAgentTelemetry({
          source: "server",
          event: "tool.previewBookingReservationCommand",
          ok,
          sessionId: context.sessionId ?? undefined,
          toolCallId: command.commandId,
          commandFamily: "booking-reservations",
          commandEffect: "write",
          payload: { missingFields, command },
        }).catch(() => undefined);
        return {
          ok,
          kind: "reservation-command-preview" as const,
          command,
          missingFields,
          nextAction: ok
            ? "Show this reservation to the user as the approval preview and stop. Do not call booking.create.guest or booking.create.booking. Publishing is a human Approve click that runs /api/reservation/commit outside this conversation."
            : "Ask the user for the missing reservation fields, including a user-confirmed non-placeholder email or phone, before requesting approval. Do not attempt booking writes.",
        };
      },
    }),
    executeCommand: tool({
      description:
        "Execute a mounted read-only command from the Sonik command catalog. This tool can only run reads: the agent's ceiling for anything that creates or publishes is a submitted draft, and the only path that publishes is a human clicking Approve on the preview card. There is no model-callable commit/write tool.",
      inputSchema: directCommandInputSchema,
      execute: async ({ commandId, input, inputJson }) => {
        const { catalog, runtimeAdapters, executionContext } = createBundle();
        const command = catalog.commands.find((entry) => entry.id === commandId);
        const contextCommandIds = createContextCommandIds();
        assertToolFamilyEnabled(command, context.toolPermissionModes);
        // Draft-only invariant (Slice A, 2026-07-08): executeCommand is the only
        // surviving command-catalog tool, and it must stay read-only regardless of
        // host approvedCommandIds. commitCommand was removed from this tool set
        // entirely so a write can never be model-triggered; this is the residual
        // guard in case a write-effect command is ever requested through the one
        // remaining tool. See docs/plans/experience-seams-resolution-plan-2026-07-08.md Slice A.
        if (command && command.effect !== "read") {
          await writeAgentTelemetry({
            source: "server",
            event: "tool.commit.unavailable_draft_only",
            ok: false,
            toolCallId: commandId,
            ...summarizeCommandTelemetry(command, contextCommandIds),
          });
          return {
            kind: "command-commit-refusal" as const,
            ok: false as const,
            error: "draft_only_invariant" as const,
            commandId,
            guidance: "This agent can only prepare drafts and previews. Publishing a write requires a human to click Approve on the preview card; there is no model-callable commit tool for this command.",
          };
        }
        requireCallableCapability(resolveReadiness(), commandId);
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
            // Approval resolves from the host-signed approvedCommandIds grant —
            // never model-provided. Without this, "ask" mode dead-ends read
            // commands: execute needs approval, but read-only commands are
            // forbidden from commit.
            approved: context.approvedCommandIds?.includes(commandId) === true,
            toolPolicy: { familyModes: context.toolPermissionModes },
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
