import { generateText, Output, tool, type LanguageModel } from "ai";
import { z } from "zod";
import { workflowDefinitionSchema } from "@sonik-agent-ui/tool-contracts/marketplace";
import { gateway, resolveGatewayModelId } from "../ai-gateway";
import {
  AI_SDK_TELEMETRY_FUNCTION,
  createAiSdkTelemetryOptions,
  createAiSdkTelemetryRuntimeContext,
  type AiSdkTelemetryCorrelation,
} from "../server/ai-sdk-telemetry";
import {
  buildDraftWorkflowPrompt,
  DRAFT_WORKFLOW_INSTRUCTIONS,
  validateDraftedWorkflow,
} from "../agent-workflows/drafting-agent";

/**
 * Model-mounted tool: draft a workflow from an outcome description. Never returns an
 * unvalidated draft -- either the validated WorkflowDefinition or a list of rejection
 * reasons for the caller (model or builder UI) to fix and retry. Mounted only in
 * workflow-builder mode (see agent.ts) so regular chat is unaffected.
 */
export function createDraftWorkflow(
  aiTelemetry?: Partial<AiSdkTelemetryCorrelation>,
  model: LanguageModel = gateway(resolveGatewayModelId(undefined)),
) {
  const runtimeContext = createAiSdkTelemetryRuntimeContext(aiTelemetry, AI_SDK_TELEMETRY_FUNCTION.draftWorkflow);
  return tool({
    description: DRAFT_WORKFLOW_INSTRUCTIONS,
    inputSchema: z.object({
      outcomeDescription: z.string().min(1).describe("Plain-language description of the outcome the workflow should achieve."),
      constraints: z.array(z.string()).optional().describe("Optional extra requirements, e.g. specific commands or steps to include."),
    }),
    execute: async ({ outcomeDescription, constraints }) => {
      let drafted: unknown;
      try {
        // AI SDK 7 Output.object forces the model to emit workflowDefinitionSchema-
        // shaped JSON (no manual parse, no "unparseable JSON" failure mode). Our
        // validateDraftedWorkflow still adds the stricter gate the schema can't
        // express: only the 5 controller-live node types, approval-before-commit,
        // edges referencing existing nodes. timeout bounds a stalled model.
        const result = await generateText({
          model,
          prompt: buildDraftWorkflowPrompt(outcomeDescription, constraints),
          output: Output.object({ schema: workflowDefinitionSchema }),
          timeout: { totalMs: 45_000 },
          runtimeContext,
          telemetry: createAiSdkTelemetryOptions(AI_SDK_TELEMETRY_FUNCTION.draftWorkflow, Boolean(runtimeContext.requestId)),
        });
        drafted = result.output;
      } catch (error) {
        return { kind: "workflow-draft" as const, ok: false, reasons: [`Draft generation failed: ${error instanceof Error ? error.message : "unknown error"}`] };
      }

      const result = validateDraftedWorkflow(drafted);
      return result.ok
        ? { kind: "workflow-draft" as const, ok: true, workflow: result.workflow }
        : { kind: "workflow-draft" as const, ok: false, reasons: result.reasons };
    },
  });
}
