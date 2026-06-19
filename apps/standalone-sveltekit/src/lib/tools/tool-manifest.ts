import { tool } from "ai";
import { z } from "zod";
import { createStandaloneAvailableToolManifest } from "$lib/server/tool-manifest";
import { writeAgentTelemetry } from "$lib/server/agent-telemetry";

export function createToolManifestTools() {
  return {
    listAvailableTools: tool({
      description:
        "List the current contract-derived tool manifest. Use this for questions about this app's available tools, ORPC app-state capabilities, or approval-gated operations instead of inventing a capability list.",
      inputSchema: z.object({
        sourceMode: z.enum(["all", "orpc-app-state", "mcp", "sandbox", "local-ui"]).default("all"),
        includeApprovalRequired: z.boolean().default(true),
      }),
      execute: async ({ sourceMode, includeApprovalRequired }) => {
        const manifest = createStandaloneAvailableToolManifest({
          // Standalone local mode is intentionally unauthenticated unless a host adapter injects context.
          authenticated: false,
          organizationId: null,
          scopes: [],
          sourceMode,
          includeApprovalRequired,
        });
        await writeAgentTelemetry({
          source: "server",
          event: "tool.listAvailableTools",
          ok: true,
          mode: sourceMode,
          elementCount: manifest.tools.length,
        });
        return {
          kind: "tool-manifest" as const,
          manifest,
          tools: manifest.tools.map((entry) => ({
            id: entry.id,
            source: entry.source,
            effect: entry.effect,
            approval: entry.approval,
            title: entry.title,
            uiTargets: entry.uiTargets,
            auth: entry.auth,
            policyDecision: entry.metadata.policyDecision,
            policyReasons: entry.metadata.policyReasons,
          })),
        };
      },
    }),
  };
}
