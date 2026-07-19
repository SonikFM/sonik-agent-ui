import { tool, generateText, type LanguageModel } from "ai";
import { gateway } from "../ai-gateway";
import { z } from "zod";
import {
  AI_SDK_TELEMETRY_FUNCTION,
  createAiSdkTelemetryOptions,
  createAiSdkTelemetryRuntimeContext,
  type AiSdkTelemetryCorrelation,
} from "../server/ai-sdk-telemetry";

/**
 * Web search tool using Perplexity Sonar via AI Gateway.
 *
 * Perplexity Sonar models have built-in internet access and return
 * synthesized answers with citations. This is wrapped as a regular tool
 * (with an `execute` function) so that ToolLoopAgent can loop: it calls
 * the model, gets results, and feeds them back for the next step.
 */
export function createWebSearch(
  aiTelemetry?: Partial<AiSdkTelemetryCorrelation>,
  model: LanguageModel = gateway("perplexity/sonar"),
) {
  const runtimeContext = createAiSdkTelemetryRuntimeContext(aiTelemetry, AI_SDK_TELEMETRY_FUNCTION.search);
  return tool({
    description:
      "Search the web for current information on any topic. Use this when the user asks about something not covered by the specialized tools (weather, crypto, GitHub, Hacker News). Returns a synthesized answer based on real-time web data.",
    inputSchema: z.object({
      query: z
        .string()
        .describe(
          "The search query — be specific and include relevant context for better results",
        ),
    }),
    execute: async ({ query }) => {
      try {
        const { text } = await generateText({
          model,
          prompt: query,
          runtimeContext,
          telemetry: createAiSdkTelemetryOptions(AI_SDK_TELEMETRY_FUNCTION.search, Boolean(runtimeContext.requestId)),
        });
        return { content: text };
      } catch (error) {
        return {
          error: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
      }
    },
  });
}
