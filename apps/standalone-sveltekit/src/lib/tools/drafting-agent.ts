import { generateText, tool } from "ai";
import { z } from "zod";
import { gateway, resolveGatewayModelId } from "../ai-gateway";
import {
  buildDraftWorkflowPrompt,
  DRAFT_WORKFLOW_INSTRUCTIONS,
  extractDraftedWorkflowJson,
  validateDraftedWorkflow,
} from "../agent-workflows/drafting-agent";

/**
 * Model-mounted tool: draft a workflow from an outcome description. Never returns an
 * unvalidated draft -- either the validated WorkflowDefinition or a list of rejection
 * reasons for the caller (model or builder UI) to fix and retry. Mounted only in
 * workflow-builder mode (see agent.ts) so regular chat is unaffected.
 */
export const draftWorkflow = tool({
  description: DRAFT_WORKFLOW_INSTRUCTIONS,
  inputSchema: z.object({
    outcomeDescription: z.string().min(1).describe("Plain-language description of the outcome the workflow should achieve."),
    constraints: z.array(z.string()).optional().describe("Optional extra requirements, e.g. specific commands or steps to include."),
  }),
  execute: async ({ outcomeDescription, constraints }) => {
    let text: string;
    try {
      const result = await generateText({
        model: gateway(resolveGatewayModelId(undefined)),
        prompt: buildDraftWorkflowPrompt(outcomeDescription, constraints),
      });
      text = result.text;
    } catch (error) {
      return { kind: "workflow-draft" as const, ok: false, reasons: [`Draft generation failed: ${error instanceof Error ? error.message : "unknown error"}`] };
    }

    const json = extractDraftedWorkflowJson(text);
    if (json === undefined) {
      return { kind: "workflow-draft" as const, ok: false, reasons: ["Model did not return parseable JSON."] };
    }

    const result = validateDraftedWorkflow(json);
    return result.ok
      ? { kind: "workflow-draft" as const, ok: true, workflow: result.workflow }
      : { kind: "workflow-draft" as const, ok: false, reasons: result.reasons };
  },
});
