import { tool, type Tool } from "ai";
import { z } from "zod";
import type { Spec } from "@json-render/core";
import { executeHostCatalogCommand } from "@sonik-agent-ui/platform-adapters";
import { validateIntakeManifest as validateManifestContract } from "@sonik-agent-ui/tool-contracts";
import type { AgentPageContext } from "@sonik-agent-ui/tool-contracts";
import type { HostSessionEnvelope } from "@sonik-agent-ui/platform-adapters";
import type { AsyncWorkspacePersistenceAdapter, WorkspaceArtifactRecord } from "@sonik-agent-ui/workspace-session";
import { getWorkspaceArtifact } from "../server/workspace-store.ts";
import { createStandaloneHostCommandIndex, createStandaloneHostCommandRuntimeBundle, type BookingRuntimeAuthContext } from "../server/host-command-runtime.ts";
import { writeAgentTelemetry } from "../server/agent-telemetry.ts";

const artifactIdSchema = z.object({
  artifactId: z.string().optional().describe("Artifact id to read. Must match the active artifact when page context declares one."),
});

const FORBIDDEN_TRUSTED_SCOPE_KEYS = new Set([
  "actorid",
  "currentuserid",
  "hostprincipalid",
  "orgid",
  "organizationid",
  "principalid",
  "userid",
]);

function normalizeTrustedScopeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const commitSchema = artifactIdSchema.extend({
  confirmation: z.literal("APPROVE_AND_RUN").describe("Literal confirmation that the user requested trusted execution after preview."),
});

type ArtifactStateToolContext = {
  sessionId?: string | null;
  pageContext?: AgentPageContext;
  persistence?: AsyncWorkspacePersistenceAdapter | null;
  hostSession?: HostSessionEnvelope | null;
  approvedCommandIds?: string[];
  bookingServiceBaseUrl?: string | null;
  bookingRuntimeAuth?: BookingRuntimeAuthContext | null;
  bookingRuntimeFetcher?: typeof fetch;
  allowIntakeCommandCommit?: boolean;
};

type JsonRenderArtifact = WorkspaceArtifactRecord<Spec>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSpec(value: unknown): value is Spec {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { root?: unknown }).root === "string" && isRecord((value as { elements?: unknown }).elements);
}

type ArtifactLoadResult =
  | { ok: true; artifact: JsonRenderArtifact }
  | { ok: false; error: "missing_active_artifact" | "stale_artifact_selection" | "artifact_not_found"; message: string };

async function loadActiveArtifact(context: ArtifactStateToolContext, artifactId?: string): Promise<ArtifactLoadResult> {
  const requestedId = artifactId?.trim();
  const activeId = context.pageContext?.activeArtifactId?.trim();
  if (requestedId && activeId && requestedId !== activeId) {
    return {
      ok: false,
      error: "stale_artifact_selection",
      message: `Refusing to read artifact ${requestedId}; the active artifact is ${activeId}. Re-preview the active canvas artifact before committing.`,
    };
  }
  const targetId = activeId || requestedId;
  if (!targetId) {
    return {
      ok: false,
      error: "missing_active_artifact",
      message: "No active JSON-render intake artifact is selected. Re-open or select the intake artifact, then try again.",
    };
  }
  const artifact = context.persistence
    ? await context.persistence.getArtifact<Spec>(targetId)
    : getWorkspaceArtifact(targetId) as WorkspaceArtifactRecord<Spec> | null;
  if (!artifact || artifact.kind !== "json-render" || !isSpec(artifact.content)) {
    return {
      ok: false,
      error: "artifact_not_found",
      message: "The active artifact is not a readable JSON-render intake artifact.",
    };
  }
  return { ok: true, artifact: artifact as JsonRenderArtifact };
}

function readManifest(artifact: JsonRenderArtifact): Record<string, unknown> | null {
  const manifest = artifact.content.state?.manifest;
  return isRecord(manifest) ? manifest : null;
}

function titleCaseFromSlug(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function stringAt(record: Record<string, unknown>, path: string[]): string | undefined {
  let cursor: unknown = record;
  for (const segment of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return typeof cursor === "string" && cursor.trim() ? cursor.trim() : undefined;
}

function createSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "booking-context";
}

function stripTrustedScopeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stripTrustedScopeKeys(entry));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !FORBIDDEN_TRUSTED_SCOPE_KEYS.has(normalizeTrustedScopeKey(key)))
      .map(([key, entry]) => [key, stripTrustedScopeKeys(entry)]),
  );
}

function sanitizedManifestForCommand(manifest: Record<string, unknown>): Record<string, unknown> {
  const sanitized = stripTrustedScopeKeys(manifest);
  return isRecord(sanitized) ? sanitized : {};
}

function createBookingContextCommandInput(artifact: JsonRenderArtifact, manifest: Record<string, unknown>) {
  const commandManifest = sanitizedManifestForCommand(manifest);
  const manifestTitle = stringAt(commandManifest, ["business", "name"])
    ?? stringAt(commandManifest, ["bookableContext", "contextName"])
    ?? stringAt(commandManifest, ["context", "name"])
    ?? stringAt(commandManifest, ["inventory", "name"])
    ?? (artifact.title && !/intake|manifest|create booking context/i.test(artifact.title) ? artifact.title : undefined)
    ?? stringAt(manifest, ["inventory", "coreDescription"])?.split(/[.;\n]/)[0]
    ?? "Booking Context";
  const name = titleCaseFromSlug(manifestTitle).slice(0, 96);
  const timezone = stringAt(commandManifest, ["schedule", "timezone"]) ?? "America/New_York";
  const intakeMode = stringAt(commandManifest, ["intakeMode"]);
  const kind = intakeMode === "event" ? "event" : intakeMode === "resource" ? "resource" : "venue_schedule";
  return {
    commandId: "booking.create.context" as const,
    input: {
      kind,
      name,
      timezone,
      slug: createSlug(name),
      config: {
        source: "sonik-agent-ui-intake",
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        manifest: commandManifest,
      },
    },
  };
}

function commandToolUnavailable(reason: string, message?: string) {
  return {
    ok: false,
    error: reason,
    message: message ?? (reason === "missing_active_artifact"
      ? "No active JSON-render intake artifact is selected. Re-open or select the intake artifact, then try again."
      : "The active artifact is not a readable JSON-render intake artifact."),
  };
}

function artifactLoadUnavailable(result: Extract<ArtifactLoadResult, { ok: false }>) {
  return commandToolUnavailable(result.error, result.message);
}

export function createArtifactStateTools(context: ArtifactStateToolContext = {}) {
  const readActiveArtifactState = tool({
    description:
      "Read the current active JSON-render artifact state from the workspace canvas. Use this before validating or committing an intake manifest; do not use readActiveDocument for JSON-render artifact state.",
    inputSchema: artifactIdSchema,
    execute: async ({ artifactId }) => {
      const loaded = await loadActiveArtifact(context, artifactId);
      if (!loaded.ok) return artifactLoadUnavailable(loaded);
      const artifact = loaded.artifact;
      const manifest = readManifest(artifact);
      await writeAgentTelemetry({
        source: "server",
        event: "tool.readActiveArtifactState",
        ok: true,
        sessionId: artifact.session_id ?? context.sessionId ?? undefined,
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        title: artifact.title,
      }).catch(() => undefined);
      return {
        ok: true,
        kind: "active-artifact-state" as const,
        artifact: { id: artifact.id, title: artifact.title, version: artifact.version, kind: artifact.kind, sessionId: artifact.session_id },
        state: artifact.content.state ?? {},
        manifest,
      };
    },
  });

  const previewActiveIntakeCommand = tool({
    description:
      "Validate the latest active booking/event/campaign intake artifact and return the trusted command preview plus concrete booking.create.context input when valid. This does not execute the command.",
    inputSchema: artifactIdSchema,
    execute: async ({ artifactId }) => {
      const loaded = await loadActiveArtifact(context, artifactId);
      if (!loaded.ok) return artifactLoadUnavailable(loaded);
      const artifact = loaded.artifact;
      const manifest = readManifest(artifact);
      if (!manifest) return { ok: false, error: "missing_manifest", message: "The active artifact has no manifest draft in state." };
      const validation = validateManifestContract(manifest);
      if (validation.ok && validation.manifestType !== "venue_schedule") {
        await writeAgentTelemetry({
          source: "server",
          event: "tool.previewActiveIntakeCommand",
          ok: false,
          sessionId: artifact.session_id ?? context.sessionId ?? undefined,
          artifactId: artifact.id,
          artifactVersion: artifact.version,
          payload: { validation, error: "unsupported_manifest_type" },
        }).catch(() => undefined);
        return {
          ok: false,
          error: "unsupported_manifest_type",
          kind: "intake-command-preview" as const,
          artifact: { id: artifact.id, title: artifact.title, version: artifact.version },
          manifest,
          validation,
          command: null,
          nextAction: "This artifact validates, but it is not a venue_schedule manifest. Use the matching event/campaign export path instead of booking.create.context.",
        };
      }
      const command = validation.ok ? createBookingContextCommandInput(artifact, manifest) : null;
      await writeAgentTelemetry({
        source: "server",
        event: "tool.previewActiveIntakeCommand",
        ok: validation.ok,
        sessionId: artifact.session_id ?? context.sessionId ?? undefined,
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        toolCallId: command?.commandId ?? validation.commandPreview[0]?.commandId,
        payload: { validation, command },
      }).catch(() => undefined);
      return {
        ok: validation.ok,
        kind: "intake-command-preview" as const,
        artifact: { id: artifact.id, title: artifact.title, version: artifact.version },
        manifest,
        validation,
        command,
        nextAction: validation.ok
          ? "Show the command input to the user. If they explicitly approve, call commitActiveIntakeCommand with confirmation=APPROVE_AND_RUN. Do not use generic commitCommand for booking.context.create."
          : "Ask the next highest-impact missing intake question before requesting approval.",
      };
    },
  });

  const tools: Record<string, Tool<any, any>> = { readActiveArtifactState, previewActiveIntakeCommand };

  if (context.allowIntakeCommandCommit) {
    tools.commitActiveIntakeCommand = tool({
      description:
        "Commit booking.create.context from the active validated intake artifact. This is approval-gated by trusted host approvedCommandIds; user text alone cannot grant approval.",
      inputSchema: commitSchema,
      execute: async ({ artifactId }) => {
        const loaded = await loadActiveArtifact(context, artifactId);
        if (!loaded.ok) return artifactLoadUnavailable(loaded);
        const artifact = loaded.artifact;
        const manifest = readManifest(artifact);
        if (!manifest) return { ok: false, error: "missing_manifest", message: "The active artifact has no manifest draft in state." };
        const validation = validateManifestContract(manifest);
        if (!validation.ok || validation.manifestType !== "venue_schedule") {
          return { ok: false, error: "invalid_manifest", validation, message: "The manifest must validate as a venue_schedule before booking.create.context can commit." };
        }
        const command = createBookingContextCommandInput(artifact, manifest);
        const hostSessionInput = context.hostSession ? { hostSession: context.hostSession } : { hostSessionMode: "standalone-demo" as const };
        const { catalog, runtimeAdapters, executionContext } = createStandaloneHostCommandRuntimeBundle({
          sessionId: context.sessionId,
          pageContext: context.pageContext,
          ...hostSessionInput,
          bookingServiceBaseUrl: context.bookingServiceBaseUrl,
          bookingRuntimeAuth: context.bookingRuntimeAuth,
          fetcher: context.bookingRuntimeFetcher,
        });
        const receipt = await executeHostCatalogCommand({
          catalog,
          commandId: command.commandId,
          commandInput: command.input,
          runtimeAdapters,
          execution: {
            ...executionContext,
            action: "commit",
            source: "agent-ui",
            sessionId: executionContext.sessionId ?? context.sessionId,
            approved: context.approvedCommandIds?.includes(command.commandId) === true,
          },
        });
        const contextCommandIds = new Set(createStandaloneHostCommandIndex({
          sessionId: context.sessionId,
          pageContext: context.pageContext,
          ...hostSessionInput,
          bookingServiceBaseUrl: context.bookingServiceBaseUrl,
          bookingRuntimeAuth: context.bookingRuntimeAuth,
          fetcher: context.bookingRuntimeFetcher,
        }).commands.map((entry) => entry.id));
        await writeAgentTelemetry({
          source: "server",
          event: "tool.commitActiveIntakeCommand",
          ok: receipt.ok,
          sessionId: artifact.session_id ?? context.sessionId ?? undefined,
          artifactId: artifact.id,
          artifactVersion: artifact.version,
          toolCallId: command.commandId,
          mode: receipt.policy.decision,
          policyReasons: receipt.policy.reasons,
          runtimeProvider: receipt.trace.provider,
          hostSessionSource: executionContext.hostSessionSource,
          commandFamily: catalog.commands.find((entry) => entry.id === command.commandId)?.familyId,
          runtimeStatus: contextCommandIds.has(command.commandId) ? "mounted" : "not_context_loaded",
        }).catch(() => undefined);
        return { ok: receipt.ok, kind: "intake-command-commit" as const, command, receipt };
      },
    });
  }

  return tools;
}
